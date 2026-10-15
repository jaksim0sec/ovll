import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionPlan, semanticFingerprint } from '../backend/ovllPointer/executionPlan.js';
const def={definitionId:'d',version:1,executorKind:'model_task',instruction:'Analyze',inputs:[{name:'input',representation:'text'}],outputs:[{name:'result',representation:'text'}]};
function sample(){
 const skillNodes=['root','middle','sibling','end','source'].map(skillNodeId=>({skillNodeId,skillDefinitionRef:{definitionId:'d',version:1}}));
 const edge=(a,b,kind='flow',port='result')=>({kind,from:{skillNodeId:a,port},to:{skillNodeId:b,port:'input'}});
 return {graph:{graphId:'g',revision:4,skillNodes,connections:[edge('root','middle'),edge('root','sibling'),edge('middle','end'),edge('source','end','data')]},skillDefinitions:[def]};
}
const run=(targets,damMode='closed')=>({graphRef:{graphId:'g',revision:4},planEpoch:0,targets,damMode});
test('closed scope executes only the target and all required upstream, not sibling',()=>{
 const plan=buildExecutionPlan(sample(),run(['middle']));
 assert.deepEqual(plan.order.map(x=>x.skillNodeId),['root','middle']);
});
test('open scope expands flow downstream and its data predecessors, not sibling',()=>{
 const plan=buildExecutionPlan(sample(),run(['middle'],'open'));
 assert.deepEqual(plan.order.map(x=>x.skillNodeId),['root','middle','source','end']);
 assert.equal(plan.order.some(x=>x.skillNodeId==='sibling'),false);
});
test('pinning graph revisions is mandatory',()=>{
 assert.throws(()=>buildExecutionPlan(sample(),{...run(['middle']),graphRef:{graphId:'g',revision:3}}),e=>e.code==='PINNED_GRAPH_MISMATCH');
});
test('undeclared conditional flow source is rejected',()=>{
 const s=sample();s.graph.connections.push({kind:'flow',from:{skillNodeId:'middle',port:'true'},to:{skillNodeId:'end',port:'input'}});
 assert.throws(()=>buildExecutionPlan(s,run(['end'])),e=>e.code==='PORT_MISMATCH');
});
test('fingerprints ignore visual layout but retain semantic settings, input refs and definition version',()=>{
 const s=sample(),runState=run(['middle']),skillNode={...s.graph.skillNodes[0],settings:{temperature:0.1},inputBindings:{input:'example'}};
 const args={run:runState,skillNode,definition:def,inputRefs:['v1']};
 const a=semanticFingerprint(args);
 assert.equal(semanticFingerprint({...args,skillNode:{...skillNode,position:{x:800,y:-250}}}),a);
 assert.notEqual(semanticFingerprint({...args,skillNode:{...skillNode,settings:{temperature:0.5}}}),a);
 assert.notEqual(semanticFingerprint({...args,inputRefs:['v2']}),a);
 assert.notEqual(semanticFingerprint({...args,skillNode:{...skillNode,skillDefinitionRef:{definitionId:'d',version:2}}}),a);
});

test('unknown custom flow ports are rejected before any skillNode executes',()=>{
 const s=sample();s.graph.connections[0].from.port='approved';
 assert.throws(()=>buildExecutionPlan(s,run(['middle'])),e=>e.code==='PORT_MISMATCH');
});
test('subgraph execution is rejected during preflight',()=>{
 const s=sample();s.skillDefinitions[0]={...def,executorKind:'subgraph',procedureRef:'p'};
 assert.throws(()=>buildExecutionPlan(s,run(['middle'])),e=>e.code==='SUBGRAPH_EXECUTOR_NOT_IMPLEMENTED');
});
test('multiple data producers are independently scheduled and single-producer ports remain exclusive',()=>{
 const s=sample();s.graph.connections.push({kind:'data',from:{skillNodeId:'root',port:'result'},to:{skillNodeId:'end',port:'input'}});
 const result=buildExecutionPlan(s,run(['end']));
 assert.deepEqual(result.order.find(skillNode=>skillNode.skillNodeId==='end').predecessors,['middle','root','source']);
 s.skillDefinitions[0]={...def,inputs:[{...def.inputs[0],multiple:false}]};
 assert.throws(()=>buildExecutionPlan(s,run(['end'])),e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
});
test('missing required bound input is rejected at preflight',()=>{
 const s=sample();s.skillDefinitions[0]={...def,inputs:[{name:'input',representation:'text'},{name:'needed',required:true,representation:'text'}]};
 assert.throws(()=>buildExecutionPlan(s,run(['middle'])),e=>e.code==='REQUIRED_INPUT_MISSING');
});
