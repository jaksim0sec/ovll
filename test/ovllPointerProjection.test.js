import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
const source=readFileSync(new URL('../front/js/ovllPointerProjection.js',import.meta.url),'utf8');
const window={};vm.runInNewContext(source,{window});
const p=window.OvllPointerProjection;
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
  assert.equal(result.workflow.nodes[0].type,'pointer:d1:3');
  assert.equal(result.definitions['pointer:d2:1'].inputs[0].id,'source');
  assert.equal(result.workflow.data[0][0],'n1.result');
  assert.equal(result.workflow.data[0][1],'n2.source');
  assert.equal(result.workflow.nodes[1].x,undefined,'new nodes use layout engine');
});
test('persisted frontend-only view coordinates survive server graph rehydration',()=>{
  const captured=[];
  const canvas={getWorkflow:()=>({nodes:[]}),getBaseNodeDefinitions:()=>({}),
    setNodeDefinitions:x=>captured.push(x),applyWorkflowIR:x=>captured.push(x)};
  p.applyGraph(canvas,snapshot,{nodes:[{id:'n2',x:82,y:94,expanded:true}]});
  assert.equal(captured[1].nodes[1].x,82);
  assert.equal(captured[1].nodes[1].y,94);
  assert.equal(captured[1].nodes[1].expanded,true);
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
test('artifact previews read actual content without inventing download URLs',()=>{
  const preview=p.artifactPreview([
    {artifact:{semanticRole:'summary'},content:{representation:'text',value:'A useful result'}},
    {artifact:{semanticRole:'metadata'},content:{representation:'json',value:{count:2}}}
  ]);
  assert.match(preview,/summary: A useful result/);
  assert.match(preview,/metadata:.*count/);
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
test('existing data ports remain unchanged and sequencing uses reversible control sockets',()=>{
  const definitions=getPointerCatalog().definitions;
  const graph={graphId:'g_controls',revision:1,nodes:['write','organize'].map(type=>({nodeId:type,
    definitionRef:{definitionId:'builtin:'+type,version:1},settings:{},inputBindings:{}})),connections:[]};
  const snapshot={graph,definitions},projected=p.projectGraph(snapshot);
  assert.deepEqual(projected.definitions.write.inputs.map(port=>port.id),['in']);
  assert.deepEqual(projected.definitions.write.outputs.map(port=>port.id),['result']);
  assert.deepEqual(projected.definitions.organize.inputs.map(port=>port.id),['in']);
  assert.deepEqual(projected.definitions.organize.outputs.map(port=>port.id),['result']);
  assert.equal(projected.workflow.nodes[0].params.request,'');
  const canvasSource=readFileSync(new URL('../front/js/canvasNode.js',import.meta.url),'utf8');
  const compatible=vm.runInNewContext('('+canvasSource.slice(canvasSource.indexOf('function compatible('),canvasSource.indexOf('function wouldCycle(')).trim()+')');
  assert.equal(compatible(projected.definitions.write.outputs[0],projected.definitions.organize.inputs[0]),true);
  const w={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerGraphPatch.js',import.meta.url),'utf8'),{window:w});
  const edit=w.OvllPointerGraphPatch.build(snapshot,{nodes:projected.workflow.nodes,
    connections:[{from:{node:'write',port:'result'},to:{node:'organize',port:'in'},data:{kind:'links'}}]});
  assert.equal(edit.patch.operations[0].kind,'flow');
  const repo=new MemoryGraphRepository();repo.restore('local',graph.graphId,snapshot);
  repo.apply('local',JSON.parse(JSON.stringify(edit.patch)));
  const saved=repo.get('local',graph.graphId);
  assert.equal(saved.graph.connections[0].to.port,'in');
  const restored=p.projectGraph(saved);
  assert.deepEqual(Array.from(restored.workflow.links[0]),['write.__flow_out_result','organize.__flow_in_in']);
  assert.equal(w.OvllPointerGraphPatch.build(saved,{nodes:restored.workflow.nodes,connections:restored.workflow.connections}),null);
  const collision={...definitions[0],definitionId:'custom_controls',
    inputs:[{name:'in',role:'data',representation:'text'},{name:'flow_in',role:'more data',representation:'text'}],
    outputs:[{name:'next',role:'result',representation:'text'}]};
  const custom=p.projectGraph({definitions:[collision],graph:{...graph,nodes:[{nodeId:'custom',definitionRef:{definitionId:collision.definitionId,version:1}}]}}).definitions['pointer:custom_controls:1'];
  assert.deepEqual(custom.inputs.map(port=>port.id),['in','flow_in']);
  assert.deepEqual(custom.outputs.map(port=>port.id),['next']);
});
