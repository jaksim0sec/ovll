import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
import * as results from '../front/js/ovllPointerResults.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';

function browser({fileStore}={}){
  const saved=new Map(),storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
  const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)}};
  for(const path of ['workspaceStore.js','ovllPointerLocal.js'])vm.runInNewContext(readFileSync(new URL('../front/js/'+path,import.meta.url),'utf8'),{window,localStorage:storage,console});
  const store=window.OvllWorkspaceStore;
  return {conversationId:store.getActiveConversation().id,local:window.createOvllPointerLocal({workspaceStore:store,fileStore,loadCore:async()=>core,loadPlan:async()=>plan,loadResults:async()=>results})};
}
const definition={definitionId:'m',version:1,purpose:'Research',instruction:'Research from declared inputs',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]};
const node=(nodeId,definitionId='m',extra={})=>({nodeId,definitionRef:{definitionId,version:1},...extra});
const snapshot=(nodes,connections=[],definitions=[definition])=>({definitions,graph:{graphId:'g',revision:1,nodes,connections}});
const produced=inline=>({status:'success',outputs:{status:'produced',values:{result:{inline}}}});

test('runtime representation checks preserve false and zero while rejecting non-JSON objects',()=>{
  assert.equal(plan.matchesRuntimeRepresentation('boolean',false),true);
  assert.equal(plan.matchesRuntimeRepresentation('number',0),true);
  assert.equal(plan.matchesRuntimeRepresentation('json',null),true);
  assert.equal(plan.matchesRuntimeRepresentation('json',new Date()),false);
});

test('local model success requires nonempty declared output values of the declared type',async()=>{
  for(const output of [{status:'success',outputs:{status:'produced',values:{}}},produced({unexpected:'object'}),produced(undefined)]){
    const {conversationId,local}=browser();
    const run=await local.run({conversationId,targets:['research'],snapshotOverride:snapshot([node('research')]),executeNode:async()=>output});
    assert.equal(run.status,'failed');assert.equal(run.nodes[0].error,'LOCAL_OUTPUT_NOT_VERIFIED');
    assert.equal(run.coverage.complete,false);
  }
});

test('local bound values must match actual declared input representation before calling executor',async()=>{
  const {conversationId,local}=browser();let calls=0;
  const run=await local.run({conversationId,targets:['research'],snapshotOverride:snapshot([node('research','m',{inputBindings:{in:{wrong:'type'}}})],[],[{...definition,inputs:[{name:'in',representation:'text',required:true}]}]),executeNode:async()=>{calls++;return produced('unverified');}});
  assert.equal(calls,0);assert.equal(run.status,'failed');assert.equal(run.nodes[0].error,'INPUT_REPRESENTATION_MISMATCH');
});

test('flow ordering does not supply required material to export or invent a data edge',async()=>{
  const {conversationId,local}=browser();let calls=0;
  const exportDefinition={...getPointerCatalog().definitions.find(d=>d.definitionId==='builtin:createFile'),inputs:[{name:'in',representation:'json',required:true}]};
  const s=snapshot([node('research'),node('file','builtin:createFile')],[{kind:'flow',from:{nodeId:'research',port:'result'},to:{nodeId:'file',port:'in'}}],[definition,exportDefinition]);
  await assert.rejects(local.run({conversationId,targets:['file'],snapshotOverride:s,executeNode:async()=>{calls++;return produced('research');}}),error=>error.code==='REQUIRED_INPUT_MISSING');
  assert.equal(calls,0);assert.equal(s.graph.connections.length,1);
});

test('empty independently bound exports are blocked before artifact creation',async()=>{
  for(const value of ['', '  ',null,{},[],{text:''}]){
    const {conversationId,local}=browser();let calls=0;
    const run=await local.run({conversationId,targets:['file'],snapshotOverride:snapshot([node('file','builtin:createFile',{inputBindings:{in:value}})],[],getPointerCatalog().definitions),resolveArtifactRequest:()=>({format:'MD'}),createArtifact:async()=>{calls++;return{artifact:{downloadUrl:'/empty.md'}};}});
    assert.equal(calls,0);assert.equal(run.status,'waiting');assert.equal(run.coverage.complete,false);
  }
});

test('an independent bound export remains valid alongside disconnected research',async()=>{
  const {conversationId,local}=browser();let calls=0;
  const run=await local.run({conversationId,targets:['research','file'],snapshotOverride:snapshot([node('research'),node('file','builtin:createFile',{inputBindings:{in:'Actual independently supplied report'}})],[],[definition,...getPointerCatalog().definitions]),executeNode:async()=>produced('Separate research'),resolveArtifactRequest:()=>({format:'MD'}),createArtifact:async input=>{calls++;assert.deepEqual(Array.from(input.sources),['Actual independently supplied report']);return{artifact:{downloadUrl:'/real.md'}};}});
  assert.equal(calls,1);assert.equal(run.status,'completed');assert.equal(run.validity.snapshotCurrent,true);
});

test('changing only task followup text and history preserves existing semantic evidence',()=>{
  const s=snapshot([node('research')]),taskContext={objective:'Research subject',constraints:['Cite sources'],requestText:'Research it',requestHistory:[],historyDigest:'old'};
  const context={requestText:'Actual node request',taskContext};
  const row={nodeId:'research',status:'success',semanticContext:context,semanticFingerprint:results.nodeSemanticFingerprint(s,'research',context),outputs:produced('Report').outputs};
  const followup={...taskContext,requestText:'Export PDF',requestHistory:['Research it'],historyDigest:'new'};
  assert.equal(results.currentResultNodes(s,[row],{taskContext:followup})[0].resultCurrent,true);
  assert.equal(results.currentResultNodes(s,[row],{taskContext:{...followup,objective:'Different subject'}})[0].status,'stale');
  assert.equal(results.currentResultNodes(s,[row],{taskContext:{...followup,constraints:['New requirement']}})[0].status,'stale');
  assert.equal(results.currentResultNodes(s,[row],{requestText:'Different actual node request'})[0].status,'stale');
});

test('persisted full-task fingerprints survive followup but cannot rescue semantic edits',()=>{
  const s=snapshot([node('research')]),taskContext={objective:'Research subject',constraints:['Cite sources'],requestText:'Research it',requestHistory:[],historyDigest:'old'};
  const semanticContext={requestText:'Actual node request',taskContext};
  // Fixture written by the original full-Task fingerprint implementation.
  const row={nodeId:'research',status:'success',semanticContext,semanticFingerprint:'1f2db28c48369d20342967f2e09b86930a2bbc7036166a47cdc2a02657c759cd',outputs:produced('Report').outputs};
  const followup={...taskContext,requestText:'Export PDF',requestHistory:['Research it'],historyDigest:'new'};
  assert.equal(results.currentResultNodes(s,[row])[0].resultCurrent,true);
  assert.equal(results.currentResultNodes(s,[row],{taskContext:followup})[0].resultCurrent,true);
  assert.equal(results.currentResultNodes(s,[row],{taskContext:{...followup,objective:'Different subject'}})[0].status,'stale');
  assert.equal(results.currentResultNodes(s,[row],{taskContext:{...followup,constraints:['New requirement']}})[0].status,'stale');
  s.graph.nodes[0].settings={request:'Changed actual instruction'};
  assert.equal(results.currentResultNodes(s,[row],{taskContext:followup})[0].status,'stale');
});

test('current downstream results require evidence for every actual graph predecessor',()=>{
  const s=snapshot([node('research'),node('writer')],[{kind:'data',from:{nodeId:'research',port:'result'},to:{nodeId:'writer',port:'in'}}]);
  const parent={nodeId:'research',status:'success',semanticContext:{},semanticFingerprint:results.nodeSemanticFingerprint(s,'research'),outputs:produced('Research').outputs};
  const semanticContext={dependencyResults:{research:{status:'success',semanticFingerprint:parent.semanticFingerprint,outputs:parent.outputs}}};
  const downstream={nodeId:'writer',status:'success',semanticContext,semanticFingerprint:results.nodeSemanticFingerprint(s,'writer',semanticContext),outputs:produced('Report').outputs};
  assert.equal(results.currentResultNodes(s,[parent,downstream])[1].resultCurrent,true);
  assert.equal(results.currentResultNodes(s,[downstream])[0].status,'stale');
  const missing={...downstream,semanticContext:{},semanticFingerprint:results.nodeSemanticFingerprint(s,'writer')};
  assert.equal(results.currentResultNodes(s,[parent,missing])[1].status,'stale');
});

test('corrupt persisted success never becomes current without real declared outputs',()=>{
  const s=snapshot([node('research')]);
  for(const outputs of [undefined,{status:'produced',values:{}},produced({unexpected:'object'}).outputs,{status:'produced',values:{wrong:{inline:'fake'}}}]){
    const row={nodeId:'research',status:'success',semanticContext:{},semanticFingerprint:results.nodeSemanticFingerprint(s,'research'),outputs};
    assert.equal(results.currentResultNodes(s,[row])[0].status,'stale');
  }
});

test('a selected branch diamond preserves current evidence through an actually skipped parent',async()=>{
  const {conversationId,local}=browser();
  const judge={...definition,definitionId:'judge',requiredCapabilities:['branch.exclusive'],outputs:['true','false'].map(name=>({name,representation:'text'}))};
  const link=(from,port,to)=>({kind:'flow',from:{nodeId:from,port},to:{nodeId:to,port:'in'}});
  const run=await local.run({conversationId,targets:['end'],snapshotOverride:snapshot([node('branch','judge'),node('a'),node('b'),node('end')],[link('branch','true','a'),link('branch','false','b'),link('a','next','end'),link('b','next','end')],[definition,judge]),executeNode:async({nodeId})=>nodeId==='branch'?{status:'success',outputs:{status:'produced',values:{true:{inline:'selected'}}}}:produced('Report')});
  assert.equal(run.status,'completed');assert.equal(run.validity.snapshotCurrent,true);
  assert.equal(run.nodes.find(n=>n.nodeId==='b').status,'skipped');
  assert.equal(results.currentResultNodes(run.snapshot,run.nodes).find(n=>n.nodeId==='end').resultCurrent,true);
});

test('PDF followup exports a current research predecessor without rerunning the model',async()=>{
  const {conversationId,local}=browser();
  const taskContext={objective:'Research subject',constraints:['Cite sources'],requestText:'Research it'};
  const first=await local.run({conversationId,targets:['research'],snapshotOverride:snapshot([node('research')]),taskContext,requestText:'Research it',executeNode:async()=>produced('Actual researched report')});
  const followup={...taskContext,requestText:'Export PDF',requestHistory:['Research it']};
  const connected=snapshot([node('research'),node('file','builtin:createFile')],[{kind:'data',from:{nodeId:'research',port:'result'},to:{nodeId:'file',port:'in'}}],[definition,...getPointerCatalog().definitions]);
  let calls=0,exported;
  const run=await local.run({conversationId,targets:['file'],snapshotOverride:connected,taskContext:followup,requestText:'Export PDF',executeNode:async()=>{calls++;return produced('Unexpected regeneration');},resolveArtifactRequest:()=>({format:'PDF'}),createArtifact:async input=>{exported=Array.from(input.sources);return{artifact:{downloadUrl:'/actual.pdf'}};}});
  assert.equal(calls,0);assert.equal(run.status,'completed');assert.deepEqual(exported,['Actual researched report']);
  const reused=run.nodes.find(n=>n.nodeId==='research');
  assert.equal(reused.reused,true);assert.equal(reused.execution.providerCalls,0);
  assert.equal(reused.semanticFingerprint,first.nodes[0].semanticFingerprint);
  assert.deepEqual(reused.semanticContext,first.nodes[0].semanticContext);
});

test('an explicitly targeted research node reruns even when its prior result is current',async()=>{
  const {conversationId,local}=browser(),s=snapshot([node('research')]);
  await local.run({conversationId,targets:['research'],snapshotOverride:s,executeNode:async()=>produced('First')});
  let calls=0;
  const run=await local.run({conversationId,targets:['research'],snapshotOverride:s,executeNode:async()=>{calls++;return produced('Second');}});
  assert.equal(calls,1);assert.equal(run.nodes[0].reused,undefined);assert.equal(run.nodes[0].outputs.values.result.inline,'Second');
});

test('changed actual upstream values prevent persisted model predecessor reuse',async()=>{
  const {conversationId,local}=browser();
  const material={...getPointerCatalog().definitions.find(d=>d.definitionId==='builtin:createFile'),definitionId:'material',inputs:[{name:'in',representation:'json'}]};
  const research={...definition,inputs:[{name:'in',representation:'json'}]};
  const link=(from,port,to)=>({kind:'data',from:{nodeId:from,port},to:{nodeId:to,port:'in'}});
  const s=snapshot([node('material','material',{inputBindings:{in:'Actual input'}}),node('research')],[link('material','artifact','research')],[material,research]);
  await local.run({conversationId,targets:['research'],snapshotOverride:s,resolveArtifactRequest:()=>({format:'MD'}),createArtifact:async()=>({artifact:{downloadUrl:'/original-input.md'}}),executeNode:async()=>produced('First research')});
  const connected=snapshot([...s.graph.nodes,node('file','builtin:createFile')],[...s.graph.connections,link('research','result','file')],[material,research,...getPointerCatalog().definitions]);
  let calls=0;
  const run=await local.run({conversationId,targets:['file'],snapshotOverride:connected,resolveArtifactRequest:()=>({format:'MD'}),createArtifact:async input=>({artifact:{downloadUrl:input.sources[0]==='Actual input'?'/changed-input.md':'/report.md'}}),executeNode:async input=>{calls++;assert.equal(input.inputArtifacts[0].value.downloadUrl,'/changed-input.md');return produced('Research from changed input');}});
  assert.equal(run.status,'completed');assert.equal(calls,1);assert.equal(run.nodes.find(n=>n.nodeId==='research').reused,undefined);
});

for(const changed of [false,true])test(`file research export ${changed?'reruns research after source bytes change':'reuses research while confirming unchanged source bytes'}`,async()=>{
  let source='Original local bytes';
  const {conversationId,local}=browser({fileStore:{getBlob:async()=>new Blob([source],{type:'text/plain'})}});
  const catalog=getPointerCatalog().definitions,research={...definition,inputs:[{name:'in',representation:'json'}]};
  const link=(from,port,to)=>({kind:'data',from:{nodeId:from,port},to:{nodeId:to,port:'in'}});
  const s=snapshot([node('input','builtin:file',{settings:{file:{localFileId:'source',name:'notes.txt',mime:'text/plain'}}}),node('research')],[link('input','file','research')],[research,...catalog]);
  const taskContext={objective:'Research local notes',constraints:[],requestText:'Research notes'};
  await local.run({conversationId,targets:['research'],snapshotOverride:s,requestText:taskContext.requestText,taskContext,executeNode:async()=>produced('Report from '+source)});
  if(changed)source='Changed local bytes';
  const connected=snapshot([...s.graph.nodes,node('file','builtin:createFile')],[...s.graph.connections,link('research','result','file')],s.definitions);
  let calls=0,exported;
  const followup={...taskContext,requestText:'Export PDF',requestHistory:['Research notes']};
  const run=await local.run({conversationId,targets:['file'],snapshotOverride:connected,requestText:followup.requestText,taskContext:followup,executeNode:async input=>{calls++;assert.equal(input.inputArtifacts[0].value.text,source);return produced('Report from '+source);},resolveArtifactRequest:()=>({format:'PDF'}),createArtifact:async input=>{exported=Array.from(input.sources);return{artifact:{downloadUrl:'/local-report.pdf'}};}});
  assert.equal(run.status,'completed');assert.equal(calls,changed?1:0);
  assert.deepEqual(exported,['Report from '+source]);assert.equal(run.validity.snapshotCurrent,true);
});
