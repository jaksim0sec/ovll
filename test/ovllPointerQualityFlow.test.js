import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createStoredArtifact,getStoredArtifact} from '../backend/artifacts/artifactStore.js';
function setup(){
 const values=new Map(),localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const window={crypto:{randomUUID},localStorage};
 for(const name of ['workspaceStore','ovllPointerLocal','ovllPointerLocalActions','ovllPointerFunctions','ovllPointerGraphPatch','ovllPointerProjection'])
  vm.runInNewContext(readFileSync(new URL('../front/js/'+name+'.js',import.meta.url),'utf8'),{window,localStorage,console});
 const store=window.OvllWorkspaceStore,id=store.getActiveConversation().id;
 const local=window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,loadPlan:async()=>plan,loadCatalog:async()=>getPointerCatalog()});
 return {window,store,local,id,graphId:local.graphId(id)};
}
test('uploaded source → reused and custom work → actual artifact → immutable new-input replay',async()=>{
 const {window:w,store,local,id,graphId}=setup();
 const initial=(await local.state(id)).graph;
 const edit=w.OvllPointerGraphPatch.build(initial,{nodes:[{id:'upload',type:'file',data:{name:'source.txt',mime:'text/plain',textPreview:'Original evidence',textTruncated:false}}],connections:[]});
 await local.turn({conversationId:id,graphId,actions:[{localKey:'upload',kind:'ir.applyPatch',args:{patch:edit.patch}}]});
 const fileId=(await local.state(id)).graph.graph.nodes[0].nodeId;
 let turns=0,nodes=0;
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'fixture'}),gateway:{complete:async({messages})=>{
  const data=JSON.parse(messages.at(-1).content);
  if(data.nodeContext){nodes++;
   const ctx=data.nodeContext;
   if(ctx.purpose==='Retain evidence')return{text:JSON.stringify({outputs:{status:'produced',values:{result:{ref:ctx.upstreamArtifacts[0].valueRef}}}})};
   const source=ctx.upstreamArtifacts[0]?.value||ctx.inputBindings.in;
   if(source==='New evidence')assert.deepEqual(data.context.constraints,['Keep actual names']);
   return{text:JSON.stringify({outputs:{status:'produced',values:{result:{inline:'# Report\n\n'+(typeof source==='string'?source:source.textPreview)+'\n\n'+'Complete useful text. '.repeat(220)}}}})};
  }
  turns++;assert.ok(data.context.materials[0].content.definitions.some(d=>d.definitionId==='builtin:write'));
  const ref=nodeId=>({nodeId}),temp=localNodeKey=>({localNodeKey});
  const link=(key,from,fromPort,to)=>({op:'link.add',localLinkKey:key,kind:'data',from:{node:from,port:fromPort},to:{node:to,port:'in'}});
  return{text:JSON.stringify({message:'Unverified proposal completion must not be a delivered result.',actions:[
   {localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId,expectedGraphRevision:1,definitions:[{localKey:'d',purpose:'Retain evidence',executorKind:'model_task',instruction:'Pass the actual evidence without changing it',inputs:[{name:'in',role:'evidence',representation:'json'}],outputs:[{name:'result',role:'evidence',representation:'json'}],presentation:{name:'근거 보존',iconKey:'custom',color:'#7C6CF2'}}],operations:[
    {op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'d'}},
    {op:'node.add',localNodeKey:'b',definitionRef:{definitionId:'builtin:write',version:1},settings:{request:'Write a complete report'}},
    {op:'node.add',localNodeKey:'c',definitionRef:{definitionId:'builtin:createFile',version:1},settings:{request:'report.md'}},
    link('fa',ref(fileId),'file',temp('a')),link('ab',temp('a'),'result',temp('b')),link('bc',temp('b'),'result',temp('c'))]}}},
   {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[{fromAction:'p',localNodeKey:'c'}]}}
  ]})};
 }}});
 let target,write;
 const result=await w.OvllPointerLocalActions.coordinate({getContext:async()=>({snapshot:(await local.state(id)).graph}),
  request:args=>host.turn({...JSON.parse(JSON.stringify(args)),requestRef:'request',requestText:'자료로 보고서를 만들고 파일로 저장해'}),handlers:{
   'ir.applyPatch':async action=>(await local.turn({conversationId:id,graphId,actions:[action]})).results[0],
   'run.start':async(action,applied)=>{
    const refs=applied.get('p').createdRefs;target=refs['node:c'];write=refs['node:b'];
    const run=await local.run({conversationId:id,targets:[target],executeNode:args=>host.node({...JSON.parse(JSON.stringify(args)),requestRef:'node'}),
     resolveArtifactRequest:()=>({format:'MD',filename:'report'}),createArtifact:async args=>({artifact:await createStoredArtifact(args)})});
    return{status:run.status,run};}
  }});
 assert.equal(result.facts.at(-1).status,'completed');assert.equal(turns,1);assert.equal(nodes,2);
 assert.equal(result.messages.length,0);
 const run=result.runs[0],artifact=run.nodes.find(n=>n.nodeId===target).outputs.values.artifact.inline;
 assert.match(getStoredArtifact(artifact.id).buffer.toString('utf8'),/Original evidence/);
 assert.ok(getStoredArtifact(artifact.id).buffer.length>3500);
 assert.match(w.OvllPointerLocalActions.deliver(run),/report.md/);
 assert.ok(run.nodes.find(n=>n.provenance?.result?.length));
 const graph=(await local.state(id)).graph;
 const projection=w.OvllPointerProjection.projectGraph(graph);
 assert.ok(Object.values(projection.definitions).some(d=>d.iconKey==='custom'));
 const fn=w.OvllPointerFunctions.save({purpose:'Write evidence report',snapshot:graph,targets:[write],invariants:['Keep actual names']});
 // File reading has no exposed model input; save a simple processing task for fresh named input replay.
 const simple=w.OvllPointerFunctions.saveDraft({purpose:fn.purpose,inputs:[{name:'in',role:'material',representation:'json'}],outputs:[{name:'result',role:'report',representation:'json'}],invariants:fn.invariants,procedure:{kind:'model_task',instruction:'Write from supplied material'}});
 const rebound=w.OvllPointerFunctions.bind(simple,{in:'New evidence'});
 const replay=await local.run({conversationId:id,snapshotOverride:rebound.snapshot,targets:rebound.targets,requestText:rebound.requestText,taskConstraints:rebound.invariants,executeNode:args=>host.node({...JSON.parse(JSON.stringify(args)),requestRef:'replay'})});
 assert.match(w.OvllPointerLocalActions.deliver(replay),/New evidence/);
 assert.equal(w.OvllPointerFunctions.get(simple.id).snapshot.graph.nodes[0].inputBindings.in,undefined);
 store.importJSON(store.exportJSON());assert.equal(store.getConversation(id).state.pointerRuns.at(-1).status,'completed');
});
