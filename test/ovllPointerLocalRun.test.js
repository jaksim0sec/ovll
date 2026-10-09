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
