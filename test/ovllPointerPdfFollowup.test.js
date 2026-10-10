import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createStoredArtifact,getStoredArtifact} from '../backend/artifacts/artifactStore.js';

test('existing research → connected PDF export → saved file metadata preserves actual source evidence',async()=>{
  const values=new Map(),localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const window={crypto:{randomUUID},localStorage};
  for(const script of ['workspaceStore','ovllPointerLocal','ovllPointerLocalActions'])
    vm.runInNewContext(readFileSync(new URL('../front/js/'+script+'.js',import.meta.url),'utf8'),{window,localStorage,console,Blob,TextDecoder});
  const store=window.OvllWorkspaceStore,id=store.getActiveConversation().id,blobs=new Map();
  const local=window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,loadPlan:async()=>plan,
    loadResults:()=>import('../front/js/ovllPointerResults.mjs'),loadCatalog:async()=>getPointerCatalog(),
    fileStore:{putBlob:async blob=>{blobs.set('actual-pdf',blob);return{id:'actual-pdf'};}}});
  const graphId=local.graphId(id),task={objective:'조사 결과를 정리해줘',requestText:'조사 결과를 정리해줘',constraints:['출처 보존']};
  await local.turn({conversationId:id,graphId,actions:[{localKey:'source',kind:'ir.applyPatch',args:{patch:{
    graphId,expectedGraphRevision:0,definitions:[],operations:[{op:'node.add',localNodeKey:'research',
      definitionRef:{definitionId:'builtin:research',version:1},settings:{request:'제공된 자료를 조사해 정리'}}]
  }}}]});
  const source=(await local.state(id)).graph.graph.nodes[0].nodeId;
  const body='# 기존 조사 결과\n\n원래 확인한 근거와 출처를 그대로 보존한다\n\n[자료] https://example.com/source\n\n'+ '확인된 조사 내용 '.repeat(240);
  let modelCalls=0;
  await local.run({conversationId:id,targets:[source],requestText:task.requestText,taskContext:task,taskConstraints:task.constraints,
    executeNode:async()=>{modelCalls++;return{status:'success',outputs:{status:'produced',values:{result:{inline:body}}}};}});
  const followup={...task,requestText:'기존 조사 결과를 PDF 파일로 줘',requestHistory:[]};
  const sourceRun=store.getConversation(id).state.pointerRuns[0];
  assert.equal((await local.validateResults((await local.state(id)).graph,sourceRun.nodes,{taskContext:followup}))[0].resultCurrent,true);
  const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async({messages})=>{
    const data=JSON.parse(messages.at(-1).content);
    assert.equal(data.extraContext.availableResults.items[0].nodeId,source);
    assert.equal(data.extraContext.availableResults.items[0].resultCurrent,true);
    assert.match(messages.map(m=>m.content).join('\n'),/Existing-result export/);
    return{text:JSON.stringify({message:'PDF 완료라는 제안은 실행 근거가 아니다',actions:[
      {localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId,expectedGraphRevision:1,definitions:[],operations:[
        {op:'node.add',localNodeKey:'pdf',definitionRef:{definitionId:'builtin:createFile',version:1},settings:{request:'research.pdf'}},
        {op:'link.add',localLinkKey:'contents',kind:'data',from:{node:{nodeId:source},port:'result'},to:{node:{localNodeKey:'pdf'},port:'in'}}
      ]}}},
      {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[{fromAction:'p',localNodeKey:'pdf'}]}}
    ]})};
  }}});
  const oldChrome=process.env.OVLL_DISABLE_CHROME;process.env.OVLL_DISABLE_CHROME='1';
  try{
    const result=await window.OvllPointerLocalActions.coordinate({
      getContext:async()=>({snapshot:(await local.state(id)).graph,runs:store.getConversation(id).state.pointerRuns,taskContext:followup}),
      request:args=>host.turn({...JSON.parse(JSON.stringify(args)),requestRef:'pdf_followup',requestText:followup.requestText}),handlers:{
        'ir.applyPatch':async action=>(await local.turn({conversationId:id,graphId,actions:[action]})).results[0],
        'run.start':async(action,applied)=>{
          const target=applied.get('p').createdRefs['node:pdf'];
          const run=await local.run({conversationId:id,targets:[target],requestText:followup.requestText,taskContext:followup,taskConstraints:followup.constraints,
            executeNode:async()=>{modelCalls++;throw Error('valid existing research must not be regenerated for export');},
            resolveArtifactRequest:()=>({format:'PDF',filename:'research'}),createArtifact:async input=>{
              assert.deepEqual(Array.from(input.sources),[body]);
              const artifact=await createStoredArtifact(input);
              return{artifact,blob:new Blob([getStoredArtifact(artifact.id).buffer],{type:'application/pdf'})};
            }});
          return{status:run.status,run};
        }
      }});
    assert.equal(result.runs[0].status,'completed');assert.equal(modelCalls,1);
    assert.deepEqual(Array.from(result.runs[0].executionScope),[source,result.runs[0].targets[0]]);
    const delivery=window.OvllPointerLocalActions.presentation(result);
    assert.equal(delivery.artifacts.length,1);assert.doesNotMatch(delivery.text,/\/api\/artifacts\//);
    const artifact=delivery.artifacts[0];
    assert.equal(artifact.localFileId,'actual-pdf');assert.equal(artifact.previewKind,'pdf');
    assert.equal(getStoredArtifact(artifact.id).buffer.subarray(0,5).toString('ascii'),'%PDF-');
    assert.match(artifact.previewText,/원래 확인한 근거/);assert.ok(blobs.get('actual-pdf').size>5000);
    const changed=(await local.state(id)).graph;
    changed.graph.nodes.find(n=>n.nodeId===source).settings.request='다른 자료로 조사';
    const checked=await local.validateResults(changed,result.runs[0].nodes,{taskContext:followup});
    assert.ok(checked.every(n=>n.resultCurrent===false));
    assert.equal(window.OvllPointerLocalActions.presentation({runs:[{...result.runs[0],nodes:checked}]}).artifacts.length,0);
  }finally{
    if(oldChrome===undefined)delete process.env.OVLL_DISABLE_CHROME;else process.env.OVLL_DISABLE_CHROME=oldChrome;
  }
});
