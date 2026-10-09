import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../front/js/vnextProjection.js',import.meta.url),'utf8');
const window={};vm.runInNewContext(source,{window});
const p=window.OvllVNextProjection;
const snapshot={
  graph:{graphId:'g1',revision:2,nodes:[{nodeId:'n1',
    definitionRef:{definitionId:'d1',version:3},inputBindings:{topic:'text'}},
    {nodeId:'n2',definitionRef:{definitionId:'d2',version:1},inputBindings:{}}],
    connections:[{kind:'data',from:{nodeId:'n1',port:'result'},to:{nodeId:'n2',port:'source'}}]},
  definitions:[{definitionId:'d1',version:3,purpose:'Research',instruction:'Inspect evidence',
      inputs:[],outputs:[{name:'result',role:'Result',representation:'text'}]},
    {definitionId:'d2',version:1,purpose:'Summarize',instruction:'Short summary',
      inputs:[{name:'source',role:'Source',representation:'text'}],
      outputs:[{name:'text',role:'Result',representation:'text'}]}]
};
test('dynamic definitions and port identities survive frontend projection',()=>{
  const result=p.projectGraph(snapshot,{nodes:[{id:'n1',x:12,y:40,expanded:true}]});
  assert.equal(result.revision,2);
  assert.equal(result.workflow.nodes[0].x,12);
  assert.equal(result.workflow.nodes[0].expanded,true);
  assert.equal(result.workflow.nodes[0].type,'vnext:d1:3');
  assert.equal(result.definitions['vnext:d2:1'].inputs[0].id,'source');
  assert.equal(result.workflow.data[0][0],'n1.result');
  assert.equal(result.workflow.data[0][1],'n2.source');
  assert.equal(result.workflow.nodes[1].x,undefined,'new nodes use layout engine');
});
test('projection rejects unknown definition and edge instead of dropping meaningful state',()=>{
  const broken=JSON.parse(JSON.stringify(snapshot));broken.graph.nodes[0].definitionRef.version=99;
  assert.throws(()=>p.projectGraph(broken),/UNRESOLVED_NODE_DEFINITION/);
  const link=JSON.parse(JSON.stringify(snapshot));link.graph.connections[0].kind='unknown';
  assert.throws(()=>p.projectGraph(link),/UNSUPPORTED_CONNECTION_KIND/);
});
test('graph renders via existing canvas methods without replacing legacy definitions',()=>{
  const calls=[];
  const canvas={getWorkflow:()=>({nodes:[]}),getBaseNodeDefinitions:()=>({file:{name:'File'}}),
    setNodeDefinitions:x=>calls.push(['defs',x]),applyWorkflowIR:x=>calls.push(['ir',x])};
  p.applyGraph(canvas,snapshot);
  assert.equal(calls[0][1].file.name,'File');
  assert.equal(calls[1][1].nodes.length,2);
});
test('server node evidence status maps to existing canvas runtime state without fake file links',()=>{
  const entries=[],canvas={setRuntimeNodeState:(...xs)=>entries.push(xs)};
  const state={run:{runId:'r1',status:'running'},nodes:[
    {nodeId:'n1',status:'success',outputRefs:['v1']},
    {nodeId:'n2',status:'outcome_unknown',code:'EXTERNAL_UNKNOWN'}]};
  assert.equal(p.applyRunState(canvas,state),'running');
  assert.equal(entries[0][1].status,'SUCCESS');
  assert.deepEqual(Array.from(entries[0][1].result.outputRefs),['v1']);
  assert.equal(entries[1][1].status,'FAILED');
  assert.equal(entries[0][1].result.downloadUrl,undefined);
});
