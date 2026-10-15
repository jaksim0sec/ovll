import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
const graph=()=>({
 graph:{graphId:'g',revision:1,skillNodes:[{
  skillNodeId:'n_preserved',skillDefinitionRef:{definitionId:'builtin:write',version:1},
  settings:{request:'Write'},inputBindings:{}
 }],connections:[]},skillDefinitions:[]
});
test('model corridor sees canonical Skill v2 graph without legacy domain names',async()=>{
 const calls=[];
 const host=createLocalPointerHost({
  resolveModel:async()=>({providerId:'fixture',model:'fixture'}),
  gateway:{complete:async options=>{calls.push(options);
    return {text:JSON.stringify({message:'Ready'}),providerCalls:1};}}
 });
 const result=await host.turn({snapshot:graph(),requestRef:'g_test',requestText:'Hello'});
 assert.equal(result.message,'Ready');
 assert.equal(calls.length,1);
 const content=JSON.parse(calls[0].messages.find(m=>m.role==='user').content).context;
 const view=content.materials[0].content;
 assert.equal(view.graph.skillNodes[0].skillNodeId,'n_preserved');
 assert.equal('nodes' in view.graph,false);
 assert.equal('definitions' in view,false);
 assert.ok(Array.isArray(view.skillDefinitions));
 assert.ok(content.capabilities.includes('skillNode.add'));
 assert.ok(!content.capabilities.includes('node.add'));
});
