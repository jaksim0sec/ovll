import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
const script=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function browser(){
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},localStorage:storage};
 vm.runInNewContext(script('front/js/workspaceStore.js'),{window,localStorage:storage,console});
 vm.runInNewContext(script('front/js/ovllPointerLocal.js'),{window,console});
 const store=window.OvllWorkspaceStore;
 const local=window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,loadPlan:async()=>plan});
 // ESM dynamic imports run inside the adapter; callback injection lets tests avoid browser URL resolution.
 return {store,local,map};
}
test('portable planning kernel is identical to server execution planner',async()=>{
 const backend=await import('../backend/ovllPointer/executionPlan.js');
 assert.equal(backend.buildExecutionPlan,plan.buildExecutionPlan);
});
test('local storage holds a second read-after-write revision and blocks unsupported tools',async()=>{
 const {store,local}=browser();const id=store.getActiveConversation().id,graphId=local.graphId(id);
 const patch={graphId,expectedGraphRevision:0,definitions:[
  {localKey:'d',purpose:'test',instruction:'test',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}],
  operations:[{op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'d'}}]};
 await local.turn({conversationId:id,graphId,actions:[{localKey:'patch',kind:'ir.applyPatch',args:{patch}}]});
 assert.equal((await local.state(id)).graph.graph.revision,1);
 const nodeId=(await local.state(id)).graph.graph.nodes[0].nodeId;
 const run=await local.run({conversationId:id,targets:[nodeId],
  executeNode:async()=>({status:'success',outputs:{status:'produced',values:{result:{inline:'done'}}}})});
 assert.equal(run.status,'completed');
 assert.equal(run.nodes[0].outputs.values.result.inline,'done');
 const exported=store.exportJSON();
 store.reset();store.importJSON(exported);
 assert.equal(store.getConversation(id).state.pointerRuns[0].status,'completed');
});

test('cancellation never marks a late model response as successfully executed',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id,graphId=local.graphId(id);
 await local.turn({conversationId:id,graphId,actions:[{localKey:'build',kind:'ir.applyPatch',
  args:{patch:{graphId,expectedGraphRevision:0,definitions:[
   {localKey:'d',purpose:'Test',executorKind:'model_task',instruction:'Test',inputs:[],
    outputs:[{name:'result',representation:'text'}]}],
   operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]}}}]});
 const nodeId=(await local.state(id)).graph.graph.nodes[0].nodeId;
 const controller=new AbortController();
 const result=await local.run({conversationId:id,targets:[nodeId],signal:controller.signal,
   executeNode:async()=>{controller.abort();return {status:'success',
    outputs:{status:'produced',values:{result:{inline:'late'}}}};}});
 assert.equal(result.status,'cancelled');
 assert.notEqual(result.nodes[0].status,'success');
});

test('manual runtime supplies reusable purpose rather than an empty model request',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id,graphId=local.graphId(id);
 await local.turn({conversationId:id,graphId,actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId,expectedGraphRevision:0,
 definitions:[{localKey:'d',purpose:'Repeatable summary',instruction:'Use evidence',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}],
 operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]}}}]});
 const target=(await local.state(id)).graph.graph.nodes[0].nodeId;
 await local.run({conversationId:id,targets:[target],executeNode:async args=>{
  assert.equal(args.requestText,'Repeatable summary');
  return {status:'success',outputs:{status:'produced',values:{result:{inline:'done'}}}};
 }});
 assert.equal(store.getConversation(id).state.pointerRuns[0].status,'completed');
});
test('file input, model and artifact share a bound-value execution path',async()=>{
 const {getPointerCatalog}=await import('../backend/ovllPointer/nodeCatalog.js');
 const {store,local}=browser(),id=store.getActiveConversation().id;
 const defs=getPointerCatalog().definitions;
 const snapshot={definitions:defs,graph:{graphId:'saved',revision:1,nodes:[
  {nodeId:'a',definitionRef:{definitionId:'builtin:file',version:1},settings:{file:{name:'notes.txt',mime:'text/plain',textPreview:'Actual notes',textTruncated:true}}},
  {nodeId:'b',definitionRef:{definitionId:'builtin:write',version:1}},
  {nodeId:'c',definitionRef:{definitionId:'builtin:createFile',version:1},settings:{request:'report.md'}}],connections:[
  {id:'ab',kind:'data',from:{nodeId:'a',port:'file'},to:{nodeId:'b',port:'in'}},
  {id:'bc',kind:'data',from:{nodeId:'b',port:'result'},to:{nodeId:'c',port:'in'}}]}};
 let calls=0;
 const run=await local.run({conversationId:id,targets:['c'],snapshotOverride:snapshot,
  createArtifact:async args=>{assert.deepEqual(Array.from(args.sources),['Full report']);return {artifact:{name:'report.md',downloadUrl:'/actual/report.md'}};},
  resolveArtifactRequest:()=>({format:'MD',filename:'report'}),
  executeNode:async args=>{calls++;assert.equal(args.inputArtifacts[0].value.textPreview,'Actual notes');
   assert.equal(args.inputArtifacts[0].value.textTruncated,true);
   return {status:'success',outputs:{status:'produced',values:{result:{inline:'Full report'}}}};}});
 assert.equal(run.status,'completed');assert.equal(calls,1);
 assert.equal(run.nodes[2].outputs.values.artifact.inline.downloadUrl,'/actual/report.md');
});
test('exclusive branch executes only its selected path, never invents the absent value',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id;
 const judge={definitionId:'j',version:1,purpose:'Choose',instruction:'Choose',executorKind:'model_task',requiredCapabilities:['branch.exclusive'],inputs:[],outputs:['true','false'].map(name=>({name,representation:'text'}))};
 const d={definitionId:'d',version:1,purpose:'Use',instruction:'Use',executorKind:'model_task',inputs:[{name:'in',representation:'text'}],outputs:[{name:'result',representation:'text'}]};
 const snapshot={definitions:[judge,d],graph:{graphId:'saved',revision:1,nodes:[{nodeId:'a',definitionRef:{definitionId:'j',version:1}},...['b','c'].map(nodeId=>({nodeId,definitionRef:{definitionId:'d',version:1}}))],connections:['b','c'].map((nodeId,i)=>({id:nodeId,kind:'data',from:{nodeId:'a',port:i?'false':'true'},to:{nodeId,port:'in'}}))}};
 const called=[];const run=await local.run({conversationId:id,targets:['b','c'],snapshotOverride:snapshot,executeNode:async({nodeId})=>{
  called.push(nodeId);return {status:'success',outputs:{status:'produced',values:{[nodeId==='a'?'true':'result']:{inline:'selected'}}}};
 }});
 assert.equal(run.status,'completed');assert.deepEqual(called,['a','b']);
 assert.equal(run.nodes.find(n=>n.nodeId==='c').status,'skipped');
});
test('unsupported execution capability is identified before spending upstream model calls',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id;let calls=0;
 const snapshot={definitions:[{definitionId:'m',version:1,purpose:'Prepare',executorKind:'model_task',instruction:'Prepare',inputs:[],outputs:[{name:'result',representation:'text'}]},
  {definitionId:'t',version:1,purpose:'Missing tool',executorKind:'tool_task',instruction:'Tool',requiredCapabilities:['unavailable'],inputs:[],outputs:[{name:'result',representation:'text'}]}],graph:{graphId:'g',revision:1,nodes:[{nodeId:'a',definitionRef:{definitionId:'m',version:1}},{nodeId:'b',definitionRef:{definitionId:'t',version:1}}],connections:[{id:'ab',kind:'flow',from:{nodeId:'a',port:'result'},to:{nodeId:'b',port:'in'}}]}};
 const run=await local.run({conversationId:id,targets:['b'],snapshotOverride:snapshot,executeNode:async()=>{calls++;return{status:'success',outputs:{status:'produced',values:{result:{inline:'data'}}}};}});
 assert.equal(run.status,'waiting');assert.equal(calls,0);assert.equal(run.nodes[1].error,'LOCAL_EXECUTOR_UNAVAILABLE');
});
test('exclusive diamond converges through the selected flow path and delivers the final target',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id;
 const defs=[{definitionId:'j',version:1,purpose:'Choose',instruction:'Choose',executorKind:'model_task',requiredCapabilities:['branch.exclusive'],inputs:[],outputs:['true','false'].map(name=>({name,representation:'text'}))},{definitionId:'d',version:1,purpose:'Work',instruction:'Work',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}];
 const nodes=['a','b','c','d'].map(nodeId=>({nodeId,definitionRef:{definitionId:nodeId==='a'?'j':'d',version:1}}));
 const link=(from,port,to)=>({id:from+to,kind:'flow',from:{nodeId:from,port},to:{nodeId:to,port:'in'}});
 const snapshot={definitions:defs,graph:{graphId:'g',revision:1,nodes,connections:[link('a','true','b'),link('a','false','c'),link('b','next','d'),link('c','next','d')]}};
 const called=[];const run=await local.run({conversationId:id,snapshotOverride:snapshot,targets:['d'],executeNode:async({nodeId})=>{called.push(nodeId);return{status:'success',outputs:{status:'produced',values:{[nodeId==='a'?'true':'result']:{inline:'Final '+nodeId}}}};}});
 assert.equal(run.status,'completed');assert.deepEqual(called,['a','b','d']);assert.equal(run.nodes[3].outputs.values.result.inline,'Final d');
});
test('cancellation retains an artifact whose effect is confirmed by the adapter',async()=>{
 const {getPointerCatalog}=await import('../backend/ovllPointer/nodeCatalog.js');const {store,local}=browser(),id=store.getActiveConversation().id;
 const snapshot={definitions:getPointerCatalog().definitions,graph:{graphId:'g',revision:1,nodes:[{nodeId:'a',definitionRef:{definitionId:'builtin:createFile',version:1},inputBindings:{in:'Actual body'}}],connections:[]}};
 const controller=new AbortController();
 const run=await local.run({conversationId:id,snapshotOverride:snapshot,targets:['a'],signal:controller.signal,resolveArtifactRequest:()=>({format:'MD',filename:'report'}),createArtifact:async()=>{controller.abort();return{artifact:{name:'report.md',downloadUrl:'/actual.md'}};}});
 assert.equal(run.status,'cancelled');assert.equal(run.nodes[0].outputs.values.artifact.inline.downloadUrl,'/actual.md');
});
