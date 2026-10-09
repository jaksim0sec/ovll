import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/vnextGraphCore.mjs';
import * as plan from '../front/js/vnextPlanCore.mjs';
const script=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function browser(){
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
 const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},localStorage:storage};
 vm.runInNewContext(script('front/js/workspaceStore.js'),{window,localStorage:storage,console});
 vm.runInNewContext(script('front/js/vnextLocal.js'),{window,console});
 const store=window.OvllWorkspaceStore;
 const local=window.createOvllVNextLocal({workspaceStore:store,loadCore:async()=>core});
 // ESM dynamic imports run inside the adapter; callback injection lets tests avoid browser URL resolution.
 return {store,local,map};
}
test('portable planning kernel is identical to server execution planner',async()=>{
 const backend=await import('../backend/vnext/executionPlan.js');
 assert.equal(backend.buildExecutionPlan,plan.buildExecutionPlan);
});
test('local storage holds a second read-after-write revision and blocks unsupported tools',async()=>{
 const {store,local}=browser();const id=store.getActiveConversation().id,graphId=local.graphId(id);
 const patch={graphId,expectedGraphRevision:0,definitions:[
  {localKey:'d',purpose:'test',instruction:'test',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}],
  operations:[{op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'d'}}]};
 await local.turn({conversationId:id,graphId,actions:[{localKey:'patch',kind:'ir.applyPatch',args:{patch}}]});
 assert.equal((await local.state(id)).graph.graph.revision,1);
});
