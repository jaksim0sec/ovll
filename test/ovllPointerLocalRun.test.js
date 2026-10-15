import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
const script=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function browser({fileStore}={}){
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},localStorage:storage};
 vm.runInNewContext(script('front/js/workspaceStore.js'),{window,localStorage:storage,console});
 vm.runInNewContext(script('front/js/ovllPointerLocal.js'),{window,console});
 const store=window.OvllWorkspaceStore;
 const local=window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,loadPlan:async()=>plan,fileStore,loadResults:()=>import('../front/js/ovllPointerResults.mjs')});
 // ESM dynamic imports run inside the adapter; callback injection lets tests avoid browser URL resolution.
 return {store,local,map};
}
test('portable planning kernel is identical to server execution planner',async()=>{
 const backend=await import('../backend/ovllPointer/executionPlan.js');
 assert.equal(backend.buildExecutionPlan,plan.buildExecutionPlan);
});
test('local storage holds a second read-after-write revision and blocks unsupported tools',async()=>{
 const {store,local}=browser();const id=store.getActiveConversation().id,graphId=local.graphId(id);
 const patch={graphId,expectedGraphRevision:0,skillDefinitions:[
  {localKey:'d',purpose:'test',instruction:'test',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}],
  operations:[{op:'skillNode.add',localSkillNodeKey:'a',skillDefinitionRef:{localDefinitionKey:'d'}}]};
 await local.turn({conversationId:id,graphId,actions:[{localKey:'patch',kind:'ir.applyPatch',args:{patch}}]});
 assert.equal((await local.state(id)).graph.graph.revision,1);
 const skillNodeId=(await local.state(id)).graph.graph.skillNodes[0].skillNodeId;
 const run=await local.run({conversationId:id,targets:[skillNodeId],
  executeSkillNode:async()=>({status:'success',outputs:{status:'produced',values:{result:{inline:'done'}}}})});
 assert.equal(run.status,'completed');
 assert.equal(run.skillNodes[0].outputs.values.result.inline,'done');
 const exported=store.exportJSON();
 store.reset();store.importJSON(exported);
 assert.equal(store.getConversation(id).state.skillRuns[0].status,'completed');
});

test('cancellation never marks a late model response as successfully executed',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id,graphId=local.graphId(id);
 await local.turn({conversationId:id,graphId,actions:[{localKey:'build',kind:'ir.applyPatch',
  args:{patch:{graphId,expectedGraphRevision:0,skillDefinitions:[
   {localKey:'d',purpose:'Test',executorKind:'model_task',instruction:'Test',inputs:[],
    outputs:[{name:'result',representation:'text'}]}],
   operations:[{op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{localDefinitionKey:'d'}}]}}}]});
 const skillNodeId=(await local.state(id)).graph.graph.skillNodes[0].skillNodeId;
 const controller=new AbortController();
 const result=await local.run({conversationId:id,targets:[skillNodeId],signal:controller.signal,
   executeSkillNode:async()=>{controller.abort();return {status:'success',
    outputs:{status:'produced',values:{result:{inline:'late'}}}};}});
 assert.equal(result.status,'cancelled');
 assert.notEqual(result.skillNodes[0].status,'success');
});

test('manual runtime supplies reusable purpose rather than an empty model request',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id,graphId=local.graphId(id);
 await local.turn({conversationId:id,graphId,actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId,expectedGraphRevision:0,
 skillDefinitions:[{localKey:'d',purpose:'Repeatable summary',instruction:'Use evidence',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}],
 operations:[{op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{localDefinitionKey:'d'}}]}}}]});
 const target=(await local.state(id)).graph.graph.skillNodes[0].skillNodeId;
 await local.run({conversationId:id,targets:[target],executeSkillNode:async args=>{
  assert.equal(args.requestText,'Repeatable summary');
  return {status:'success',outputs:{status:'produced',values:{result:{inline:'done'}}}};
 }});
 assert.equal(store.getConversation(id).state.skillRuns[0].status,'completed');
});
test('file input, model and artifact share a bound-value execution path',async()=>{
 const {getPointerCatalog}=await import('../backend/ovllPointer/skillCatalog.js');
 const {store,local}=browser({fileStore:{getBlob:async()=>new Blob(['Actual notes'],{type:'text/plain'})}}),id=store.getActiveConversation().id;
 const defs=getPointerCatalog().skillDefinitions;
 const snapshot={skillDefinitions:defs,graph:{graphId:'saved',revision:1,skillNodes:[
  {skillNodeId:'a',skillDefinitionRef:{definitionId:'builtin:file',version:1},settings:{file:{name:'notes.txt',mime:'text/plain',localFileId:'source-1',textPreview:'Cached incomplete notes',textTruncated:true}}},
  {skillNodeId:'b',skillDefinitionRef:{definitionId:'builtin:write',version:1}},
  {skillNodeId:'c',skillDefinitionRef:{definitionId:'builtin:createFile',version:1},settings:{request:'report.md'}}],connections:[
  {id:'ab',kind:'data',from:{skillNodeId:'a',port:'file'},to:{skillNodeId:'b',port:'in'}},
  {id:'bc',kind:'data',from:{skillNodeId:'b',port:'result'},to:{skillNodeId:'c',port:'in'}}]}};
 let calls=0;
 const run=await local.run({conversationId:id,targets:['c'],snapshotOverride:snapshot,
  createArtifact:async args=>{assert.deepEqual(Array.from(args.sources),['Full report']);return {artifact:{name:'report.md',downloadUrl:'/actual/report.md'}};},
  resolveArtifactRequest:()=>({format:'MD',filename:'report'}),
  executeSkillNode:async args=>{calls++;assert.equal(args.inputArtifacts[0].value.text,'Actual notes');
   assert.equal(args.inputArtifacts[0].value.textTruncated,false);
   assert.equal(args.inputArtifacts[0].value.availability,'local_bytes');
   return {status:'success',outputs:{status:'produced',values:{result:{inline:'Full report'}}}};}});
 assert.equal(run.status,'completed');assert.equal(calls,1);
 assert.equal(run.skillNodes[2].outputs.values.artifact.inline.downloadUrl,'/actual/report.md');
});
test('exclusive branch executes only its selected path, never invents the absent value',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id;
 const judge={definitionId:'j',version:1,purpose:'Choose',instruction:'Choose',executorKind:'model_task',requiredCapabilities:['branch.exclusive'],inputs:[],outputs:['true','false'].map(name=>({name,representation:'text'}))};
 const d={definitionId:'d',version:1,purpose:'Use',instruction:'Use',executorKind:'model_task',inputs:[{name:'in',representation:'text'}],outputs:[{name:'result',representation:'text'}]};
 const snapshot={skillDefinitions:[judge,d],graph:{graphId:'saved',revision:1,skillNodes:[{skillNodeId:'a',skillDefinitionRef:{definitionId:'j',version:1}},...['b','c'].map(skillNodeId=>({skillNodeId,skillDefinitionRef:{definitionId:'d',version:1}}))],connections:['b','c'].map((skillNodeId,i)=>({id:skillNodeId,kind:'data',from:{skillNodeId:'a',port:i?'false':'true'},to:{skillNodeId,port:'in'}}))}};
 const called=[];const run=await local.run({conversationId:id,targets:['b','c'],snapshotOverride:snapshot,executeSkillNode:async({skillNodeId})=>{
  called.push(skillNodeId);return {status:'success',outputs:{status:'produced',values:{[skillNodeId==='a'?'true':'result']:{inline:'selected'}}}};
 }});
 assert.equal(run.status,'completed');assert.deepEqual(called,['a','b']);
 assert.equal(run.skillNodes.find(n=>n.skillNodeId==='c').status,'skipped');
});
test('unsupported execution capability is identified before spending upstream model calls',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id;let calls=0;
 const snapshot={skillDefinitions:[{definitionId:'m',version:1,purpose:'Prepare',executorKind:'model_task',instruction:'Prepare',inputs:[],outputs:[{name:'result',representation:'text'}]},
  {definitionId:'t',version:1,purpose:'Missing tool',executorKind:'tool_task',instruction:'Tool',requiredCapabilities:['unavailable'],inputs:[],outputs:[{name:'result',representation:'text'}]}],graph:{graphId:'g',revision:1,skillNodes:[{skillNodeId:'a',skillDefinitionRef:{definitionId:'m',version:1}},{skillNodeId:'b',skillDefinitionRef:{definitionId:'t',version:1}}],connections:[{id:'ab',kind:'flow',from:{skillNodeId:'a',port:'result'},to:{skillNodeId:'b',port:'in'}}]}};
 const run=await local.run({conversationId:id,targets:['b'],snapshotOverride:snapshot,executeSkillNode:async()=>{calls++;return{status:'success',outputs:{status:'produced',values:{result:{inline:'data'}}}};}});
 assert.equal(run.status,'waiting');assert.equal(calls,0);assert.equal(run.skillNodes[1].error,'LOCAL_EXECUTOR_UNAVAILABLE');
});
test('exclusive diamond converges through the selected flow path and delivers the final target',async()=>{
 const {store,local}=browser(),id=store.getActiveConversation().id;
 const defs=[{definitionId:'j',version:1,purpose:'Choose',instruction:'Choose',executorKind:'model_task',requiredCapabilities:['branch.exclusive'],inputs:[],outputs:['true','false'].map(name=>({name,representation:'text'}))},{definitionId:'d',version:1,purpose:'Work',instruction:'Work',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}];
 const skillNodes=['a','b','c','d'].map(skillNodeId=>({skillNodeId,skillDefinitionRef:{definitionId:skillNodeId==='a'?'j':'d',version:1}}));
 const link=(from,port,to)=>({id:from+to,kind:'flow',from:{skillNodeId:from,port},to:{skillNodeId:to,port:'in'}});
 const snapshot={skillDefinitions:defs,graph:{graphId:'g',revision:1,skillNodes,connections:[link('a','true','b'),link('a','false','c'),link('b','next','d'),link('c','next','d')]}};
 const called=[];const run=await local.run({conversationId:id,snapshotOverride:snapshot,targets:['d'],executeSkillNode:async({skillNodeId})=>{called.push(skillNodeId);return{status:'success',outputs:{status:'produced',values:{[skillNodeId==='a'?'true':'result']:{inline:'Final '+skillNodeId}}}};}});
 assert.equal(run.status,'completed');assert.deepEqual(called,['a','b','d']);assert.equal(run.skillNodes[3].outputs.values.result.inline,'Final d');
});
test('cancellation retains an artifact whose effect is confirmed by the adapter',async()=>{
 const {getPointerCatalog}=await import('../backend/ovllPointer/skillCatalog.js');const {store,local}=browser(),id=store.getActiveConversation().id;
 const snapshot={skillDefinitions:getPointerCatalog().skillDefinitions,graph:{graphId:'g',revision:1,skillNodes:[{skillNodeId:'a',skillDefinitionRef:{definitionId:'builtin:createFile',version:1},inputBindings:{in:'Actual body'}}],connections:[]}};
 const controller=new AbortController();
 const run=await local.run({conversationId:id,snapshotOverride:snapshot,targets:['a'],signal:controller.signal,resolveArtifactRequest:()=>({format:'MD',filename:'report'}),createArtifact:async()=>{controller.abort();return{artifact:{name:'report.md',downloadUrl:'/actual.md'}};}});
 assert.equal(run.status,'cancelled');assert.equal(run.skillNodes[0].outputs.values.artifact.inline.downloadUrl,'/actual.md');
});
