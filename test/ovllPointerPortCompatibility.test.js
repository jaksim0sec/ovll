import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {buildExecutionPlan} from '../front/js/ovllPointerPlanCore.mjs';
import {compatibleDataRepresentation,matchesInputRepresentation} from '../front/js/ovllPointerPortTypes.mjs';
import * as results from '../front/js/ovllPointerResults.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
const source=readFileSync(new URL('../front/js/ovllPointerLocal.js',import.meta.url),'utf8');
const workspaceSource=readFileSync(new URL('../front/js/workspaceStore.js',import.meta.url),'utf8');
const def=(localKey,input,output)=>({localKey,purpose:localKey,executorKind:'model_task',
  instruction:localKey,inputs:input?[{name:'in',role:'input',representation:input}]:[],
  outputs:[{name:'result',role:'result',representation:output}]});
function setup(out,input){
 const db=new Map(),storage={getItem:k=>db.get(k)||null,setItem:(k,v)=>db.set(k,v)};
 const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)}};
 vm.runInNewContext(workspaceSource,{window,localStorage:storage,console});
 vm.runInNewContext(source,{window,console});
 const store=window.OvllWorkspaceStore,id=store.getActiveConversation().id,graphId='g_'+id;
 const local=window.createOvllPointerLocal({workspaceStore:store,
   loadCore:async()=>({MemoryGraphRepository}),
   loadPlan:async()=>({buildExecutionPlan,matchesInputRepresentation}),loadResults:async()=>results,
   loadCatalog:async()=>getPointerCatalog()});
 const patch={graphId,expectedGraphRevision:0,definitions:[def('source',null,out),def('consumer',input,'text')],
   operations:[{op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'source'}},
   {op:'node.add',localNodeKey:'b',definitionRef:{localDefinitionKey:'consumer'}},
   {op:'link.add',localLinkKey:'link',kind:'data',from:{node:{localNodeKey:'a'},port:'result'},
     to:{node:{localNodeKey:'b'},port:'in'}}]};
 return {store,id,local,graphId,patch};
}
test('data port compatibility shares strict semantic rules between graph and plan',async()=>{
 assert.equal(compatibleDataRepresentation('text','json'),true);
 assert.equal(compatibleDataRepresentation('json','text'),true);
 assert.equal(compatibleDataRepresentation('json','object'),true);
 assert.equal(compatibleDataRepresentation('object','json'),true);
 assert.equal(compatibleDataRepresentation('json','private_type'),false);
 assert.equal(compatibleDataRepresentation('private_type','json'),false);
 assert.equal(matchesInputRepresentation('text','real source'),true);
 assert.equal(matchesInputRepresentation('text',{unexpected:true}),false);
 const textToJson=setup('text','json');
 const result=await textToJson.local.turn({conversationId:textToJson.id,graphId:textToJson.graphId,
  actions:[{kind:'ir.applyPatch',localKey:'a',args:{patch:textToJson.patch}}]});
 assert.equal(result.results[0].status,'applied');
 const graph=(await textToJson.local.state(textToJson.id)).graph;
 const targets=[graph.graph.nodes[1].nodeId];
 assert.equal(buildExecutionPlan(graph,{graphRef:{graphId:graph.graph.graphId,revision:1},
   targets,damMode:'closed'}).order.length,2);
});
test('text output is delivered unchanged to JSON input as a JSON string',async()=>{
 const x=setup('text','json');
 await x.local.turn({conversationId:x.id,graphId:x.graphId,actions:[{
  kind:'ir.applyPatch',localKey:'build',args:{patch:x.patch}}]});
 const state=(await x.local.state(x.id)).graph;
 const target=state.graph.nodes[1].nodeId;
 let consumed;
 const result=await x.local.run({conversationId:x.id,targets:[target],executeNode:async({nodeId,inputArtifacts})=>{
   if(nodeId===target)consumed=inputArtifacts[0].value;
   return {status:'success',outputs:{status:'produced',values:{result:{inline:nodeId===target?'ok':'日本語の単語'}}}};
 }});
 assert.equal(result.status,'completed');
 assert.equal(consumed,'日本語の単語');
});
test('JSON output narrows to text only after checking the actual runtime value',async()=>{
 const x=setup('json','text');
 await x.local.turn({conversationId:x.id,graphId:x.graphId,actions:[{
  kind:'ir.applyPatch',localKey:'build',args:{patch:x.patch}}]});
 const state=(await x.local.state(x.id)).graph,target=state.graph.nodes[1].nodeId;
 let consumed=false;
 const failed=await x.local.run({conversationId:x.id,targets:[target],executeNode:async({nodeId})=>{
   if(nodeId===target)consumed=true;
   return {status:'success',outputs:{status:'produced',values:{result:{inline:{words:['a']}}}}};
 }});
 assert.equal(failed.status,'failed');
 assert.equal(failed.nodes.at(-1).error,'INPUT_REPRESENTATION_MISMATCH');
 assert.equal(consumed,false,'invalid object cannot reach text-only executor');
 const passed=await x.local.run({conversationId:x.id,targets:[target],executeNode:async({nodeId})=>({
   status:'success',outputs:{status:'produced',values:{result:{inline:nodeId===target?'done':'string content'}}}
 })});
 assert.equal(passed.status,'completed');
});
test('unknown custom semantic representations cannot be bridged into JSON without a validator',()=>{
 assert.equal(compatibleDataRepresentation('custom/undocumented','json'),false);
 const repository=new MemoryGraphRepository(),graphId='g_types';
 repository.create('local',graphId);
 const patch={graphId,expectedGraphRevision:0,definitions:[def('a',null,'custom/undocumented'),
  def('b','json','text')],operations:[
   {op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'a'}},
   {op:'node.add',localNodeKey:'b',definitionRef:{localDefinitionKey:'b'}},
   {op:'link.add',localLinkKey:'link',kind:'data',
    from:{node:{localNodeKey:'a'},port:'result'},to:{node:{localNodeKey:'b'},port:'in'}}]};
 assert.throws(()=>repository.apply('local',patch),e=>e.code==='PORT_MISMATCH');
 assert.equal(repository.get('local',graphId).graph.revision,0,'no partial write');
});
