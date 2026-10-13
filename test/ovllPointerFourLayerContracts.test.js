import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {phaseWireContract} from '../backend/ovllPointer/modelContract.js';

const snapshot={graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]};
const add={action:'node.add',alias:'writer',definition:{kind:'builtin',type:'write'},request:'Write the requested report'};
const execute={action:'execute',target:{kind:'created',alias:'writer'},damMode:'closed'};
const plan=actions=>({contract:'action-plan.v1',actions});
const nullFields={requestDigest:null,responseDigest:null,sessionContext:null,constraints:null,supersededConstraints:null};
function selection(decision,actionKinds=[],message=null,needs=[]){
 return {decision,actionKinds,message,needs,taskContext:decision==='work'?{objective:'Follow current request',constraints:[]}:null,...nullFields};
}
function wireTurn(input){
 return {contract:'action-plan.v1',executionIntent:input.executionIntent??null,message:input.message??null,
  actions:(input.actions||[]).map(({action,...fields})=>({action,payloadJson:JSON.stringify(fields)})),
  needs:[],taskContext:null,...nullFields};
}
function fixture(outputs,wire=false){
 const calls=[];
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),
  gateway:{capabilities:()=>({structuredOutput:wire}),complete:async options=>{
   calls.push(options);
   assert.ok(outputs.length,'unexpected provider call');
   return {text:JSON.stringify(outputs.shift()),providerCalls:1};
  }}});
 return {host,calls};
}
test('corridor selection has no action payload schema and maps to compiler action kinds',()=>{
 const shape=phaseWireContract('selection').schema;
 assert.deepEqual(shape.properties.decision.enum,['answer','read','work']);
 assert.equal(shape.properties.actions,undefined);
 assert.ok(shape.properties.actionKinds.items.enum.includes('node.define'));
});
test('direct conversation stays in corridor with one provider call',async()=>{
 for(const wire of [false,true]){
  const {host,calls}=fixture([selection('answer',[],'Six')],wire);
  const reply=await host.turn({snapshot,requestRef:'direct',requestText:'What is six?'});
  assert.equal(reply.message,'Six');
  assert.equal(calls.length,1);
  assert.ok(calls[0].messages.some(m=>m.content.includes('CORRIDOR SELECTION')));
  assert.ok(!calls[0].messages.some(m=>m.content.includes('## action.nodes')));
 }
});
test('new node action is produced only after its server-selected workshop contract',async()=>{
 for(const wire of [false,true]){
  const [first,second]=[selection('work',['node.add']),plan([add])];
  const {host,calls}=fixture([first,wire?wireTurn(second):second],wire);
  const output=await host.turn({snapshot,requestRef:'new_node',requestText:'Make a writer node'});
  assert.equal(calls.length,2);
  assert.deepEqual(output.actions.map(a=>a.kind),['ir.applyPatch']);
  assert.ok(calls[1].messages.some(m=>m.content.includes('## action.nodes')));
  assert.ok(calls[1].messages.some(m=>m.content.includes('skill.add requires alias')));
  assert.ok(!calls[0].messages.some(m=>m.content.includes('## action.nodes')));
  assert.ok(output._meta.selectedModules.includes('action.nodes'));
 }
});
test('unselected action triggers contract injection before any compiled actions return',async()=>{
 const both={...plan([add,execute]),executionIntent:'requested'};
 const {host,calls}=fixture([selection('work',['node.add']),both,both]);
 const output=await host.turn({snapshot,requestRef:'drift',requestText:'Add a writer and run it'});
 assert.equal(calls.length,3);
 assert.ok(!calls[1].messages.some(m=>m.content.includes('## action.execution')));
 assert.ok(calls[2].messages.some(m=>m.content.includes('## action.execution')));
 assert.deepEqual(output.actions.map(a=>a.kind),['ir.applyPatch','run.start']);
 assert.ok(output._meta.selectedModules.includes('action.execution'));
});
test('invalid semantic fields repair gets the exact allowlist and offending keys',async()=>{
 const bad=plan([{...add,unexpected:'unknown'}]),good=plan([add]);
 const {host,calls}=fixture([selection('work',['node.add']),bad,good]);
 const output=await host.turn({snapshot,requestRef:'bad_field',requestText:'Add a writer'});
 assert.equal(calls.length,3);
 assert.ok(calls[2].messages.at(-1).content.includes('Allowed top-level fields for node.add'));
 assert.ok(calls[2].messages.at(-1).content.includes('unexpected'));
 assert.deepEqual(output.actions.map(a=>a.kind),['ir.applyPatch']);
});
