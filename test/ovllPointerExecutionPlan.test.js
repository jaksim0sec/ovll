import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionPlan, semanticFingerprint } from '../backend/ovllPointer/executionPlan.js';
const def={definitionId:'d',version:1,executorKind:'model_task',instruction:'Analyze',inputs:[{name:'input',representation:'text'}],outputs:[{name:'result',representation:'text'}]};
function sample(){
 const nodes=['root','middle','sibling','end','source'].map(nodeId=>({nodeId,definitionRef:{definitionId:'d',version:1}}));
 const edge=(a,b,kind='flow',port='result')=>({kind,from:{nodeId:a,port},to:{nodeId:b,port:'input'}});
 return {graph:{graphId:'g',revision:4,nodes,connections:[edge('root','middle'),edge('root','sibling'),edge('middle','end'),edge('source','end','data')]},definitions:[def]};
}
const run=(targets,damMode='closed')=>({graphRef:{graphId:'g',revision:4},planEpoch:0,targets,damMode});
test('closed scope executes only the target and all required upstream, not sibling',()=>{
 const plan=buildExecutionPlan(sample(),run(['middle']));
 assert.deepEqual(plan.order.map(x=>x.nodeId),['root','middle']);
});
test('open scope expands flow downstream and its data predecessors, not sibling',()=>{
 const plan=buildExecutionPlan(sample(),run(['middle'],'open'));
 assert.deepEqual(plan.order.map(x=>x.nodeId),['root','middle','source','end']);
 assert.equal(plan.order.some(x=>x.nodeId==='sibling'),false);
});
test('pinning graph revisions is mandatory',()=>{
 assert.throws(()=>buildExecutionPlan(sample(),{...run(['middle']),graphRef:{graphId:'g',revision:3}}),e=>e.code==='PINNED_GRAPH_MISMATCH');
});
test('conditional branch semantics are refused until defined',()=>{
 const s=sample();s.graph.connections.push({kind:'flow',from:{nodeId:'middle',port:'true'},to:{nodeId:'end',port:'input'}});
 assert.throws(()=>buildExecutionPlan(s,run(['end'])),e=>e.code==='CONDITIONAL_ROUTING_NOT_IMPLEMENTED');
});
test('fingerprints ignore visual layout but retain semantic settings, input refs and definition version',()=>{
 const s=sample(),runState=run(['middle']),node={...s.graph.nodes[0],settings:{temperature:0.1},inputBindings:{input:'example'}};
 const args={run:runState,node,definition:def,inputRefs:['v1']};
 const a=semanticFingerprint(args);
 assert.equal(semanticFingerprint({...args,node:{...node,position:{x:800,y:-250}}}),a);
 assert.notEqual(semanticFingerprint({...args,node:{...node,settings:{temperature:0.5}}}),a);
 assert.notEqual(semanticFingerprint({...args,inputRefs:['v2']}),a);
 assert.notEqual(semanticFingerprint({...args,node:{...node,definitionRef:{definitionId:'d',version:2}}}),a);
});

test('custom branch flow ports refuse ambiguous routing before any node executes',()=>{
 const s=sample();s.graph.connections[0].from.port='approved';
 assert.throws(()=>buildExecutionPlan(s,run(['middle'])),e=>e.code==='CONDITIONAL_ROUTING_NOT_IMPLEMENTED');
});
test('subgraph execution is rejected during preflight',()=>{
 const s=sample();s.definitions[0]={...def,executorKind:'subgraph',procedureRef:'p'};
 assert.throws(()=>buildExecutionPlan(s,run(['middle'])),e=>e.code==='SUBGRAPH_EXECUTOR_NOT_IMPLEMENTED');
});
test('multiple data producers cannot silently overwrite one input port',()=>{
 const s=sample();s.graph.connections.push({kind:'data',from:{nodeId:'root',port:'result'},to:{nodeId:'end',port:'input'}});
 assert.throws(()=>buildExecutionPlan(s,run(['end'])),e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
});
test('missing required bound input is rejected at preflight',()=>{
 const s=sample();s.definitions[0]={...def,inputs:[{name:'needed',required:true,representation:'text'}]};
 assert.throws(()=>buildExecutionPlan(s,run(['middle'])),e=>e.code==='REQUIRED_INPUT_MISSING');
});
