import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {buildExecutionPlan,semanticFingerprint} from '../backend/ovllPointer/executionPlan.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const definition={definitionId:'d',version:1,purpose:'Do work',instruction:'Keep evidence',executorKind:'model_task',inputs:[{name:'source',representation:'text'}],outputs:[{name:'summary',representation:'text'}]};
function sample(){return {skillDefinitions:[clone(definition)],graph:{graphId:'g',revision:1,skillNodes:['a','b','other'].map(skillNodeId=>({skillNodeId,skillDefinitionRef:{definitionId:'d',version:1},settings:{},inputBindings:{}})),connections:[]}};}
const edge=(kind,fromPort='summary',toPort='source',from='a',to='b')=>({id:'link_'+from+fromPort+toPort,kind,from:{skillNodeId:from,port:fromPort},to:{skillNodeId:to,port:toPort}});
const plan=s=>buildExecutionPlan(s,{graphRef:{graphId:'g',revision:1},targets:['b'],damMode:'closed'});
function ui(){const window={};for(const name of ['Projection','GraphPatch'])vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointer'+name+'.js',import.meta.url),'utf8'),{window});return window;}
test('graph and plan accept declared dynamic sequencing ports and multiple flow parents',()=>{
 const s=sample();s.graph.connections=[edge('flow'),edge('flow','summary','source','other')];
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);
 assert.deepEqual(plan(s).order.find(n=>n.skillNodeId==='b').predecessors,['a','other']);
});
test('graph and plan reject nonexistent flow source and destination endpoints',()=>{
 for(const bad of [edge('flow','missing'),edge('flow','summary','missing')]){
  const s=sample();s.graph.connections=[bad];const repo=new MemoryGraphRepository();
  assert.throws(()=>repo.restore('w','g',s),e=>e.code==='PORT_MISMATCH');
  assert.throws(()=>plan(s),e=>e.code==='PORT_MISMATCH');
 }
});
test('multiple upstream data sources share a port, but fixed literals and single-source ports remain protected',()=>{
 const s=sample();s.graph.connections=[edge('data'),edge('data','summary','source','other')];
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);
 assert.deepEqual(plan(s).order.map(n=>n.skillNodeId),['a','other','b']);
 s.graph.skillNodes[1].inputBindings={source:'fixed'};
 assert.throws(()=>new MemoryGraphRepository().restore('w','g',s),e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
 s.graph.skillNodes[1].inputBindings={};
 s.skillDefinitions[0].inputs[0].multiple=false;
 assert.throws(()=>new MemoryGraphRepository().restore('w','g',s),e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
 s.skillDefinitions[0].inputs[0].multiple=true;
 s.graph.connections.push({...edge('flow'),id:'gate'});
 new MemoryGraphRepository().restore('w','g',s);
 assert.equal(plan(s).order.length,3);
});
test('implicit control endpoints reuse semantic sockets and survive an unrelated request edit',()=>{
 const s=sample();s.skillDefinitions[0].inputs=[];s.graph.connections=[edge('flow','next','flow_in')];
 const w=ui(),projected=w.OvllPointerProjection.projectGraph(s);
 assert.deepEqual(Array.from(projected.workflow.links[0]),['a.summary','b.flow_in']);
 const ports=projected.skillDefinitions['pointer:d:1'];assert.ok(ports.inputs.some(p=>p.id==='flow_in'&&p.channel==='flow'));
 assert.deepEqual(Array.from(ports.outputs,p=>p.id),['summary']);
 assert.equal(projected.workflow.connections[0].id,s.graph.connections[0].id);
 const workflow={skillNodes:clone(projected.workflow.skillNodes),connections:clone(projected.workflow.connections)};
 assert.equal(w.OvllPointerGraphPatch.build(s,workflow),null);
 workflow.skillNodes[0].data.params={request:'Updated request'};
 const edit=w.OvllPointerGraphPatch.build(s,workflow);
 assert.deepEqual(Array.from(edit.patch.operations,p=>p.op),['skillNode.update']);
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);repo.apply('w',clone(edit.patch));
 assert.deepEqual(repo.get('w','g').graph.connections,s.graph.connections);
});
test('projected data input shares its fan-in socket with flow',()=>{
 const s=sample();s.graph.connections=[edge('flow','next','flow_in')];
 const p=ui().OvllPointerProjection.projectGraph(s).skillDefinitions['pointer:d:1'];
 assert.equal(p.inputs.find(p=>p.id==='source').multiple,true);
 assert.equal(p.inputs.some(p=>p.id==='flow_in'),false);
});
test('backend result fingerprint remains current across unrelated revisions and excludes UI settings',()=>{
 const s=sample(),skillNode=s.graph.skillNodes[0],args={run:{graphRef:{graphId:'g',revision:1},planEpoch:0},skillNode,definition,inputRefs:['v1']};
 const fingerprint=semanticFingerprint(args);
 assert.equal(semanticFingerprint({...args,run:{graphRef:{graphId:'elsewhere',revision:99},planEpoch:4}}),fingerprint);
 assert.equal(semanticFingerprint({...args,skillNode:{...skillNode,settings:{position:{x:4,y:5},expanded:true}}}),fingerprint);
 assert.notEqual(semanticFingerprint({...args,definition:{...definition,purpose:'Different objective'}}),fingerprint);
 assert.notEqual(semanticFingerprint({...args,executorVersion:'provider/model-v2'}),fingerprint);
});

test('heterogeneous flow ports reuse visible semantics and preserve canonical control links',()=>{
 const s=sample();s.skillDefinitions.push({...clone(definition),definitionId:'consumer',inputs:[{name:'payload',representation:'boolean'}]});
 s.graph.skillNodes[1].skillDefinitionRef={definitionId:'consumer',version:1};s.graph.connections=[edge('flow','summary','payload')];
 const w=ui(),p=w.OvllPointerProjection.projectGraph(s),c=p.workflow.connections[0];
 assert.equal(c.from.port,'summary');assert.equal(c.to.port,'payload');
 assert.equal(p.skillDefinitions['pointer:d:1'].outputs.find(port=>port.id===c.from.port).type,'text');
 assert.equal(p.skillDefinitions['pointer:consumer:1'].inputs.find(port=>port.id===c.to.port).type,'boolean');
 assert.equal(w.OvllPointerGraphPatch.build(s,{skillNodes:p.workflow.skillNodes,connections:p.workflow.connections}),null);
 const changed=clone(p.workflow.skillNodes);changed[0].data.params={request:'Updated'};
 const patch=w.OvllPointerGraphPatch.build(s,{skillNodes:changed,connections:p.workflow.connections});
 assert.deepEqual(Array.from(patch.patch.operations,p=>p.op),['skillNode.update']);
});

test('shared semantic sockets handle repeated types and simultaneous data and flow links',()=>{
 const s=sample();s.graph.connections=[edge('data'),{...edge('flow'),id:'gate'},edge('flow','summary','source','b','other')];
 const w=ui(),p=w.OvllPointerProjection.projectGraph(s),outputs=p.skillDefinitions['pointer:d:1'].outputs;
 assert.equal(outputs.filter(port=>port.channel==='flow').length,0);
 assert.equal(p.workflow.connections[1].from.port,p.workflow.connections[2].from.port);
 assert.equal(p.workflow.connections[0].from.port,'summary');
 assert.equal(p.workflow.connections[0].from.port,p.workflow.connections[1].from.port);
 assert.equal(w.OvllPointerGraphPatch.build(s,{skillNodes:p.workflow.skillNodes,connections:p.workflow.connections}),null);
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);assert.equal(plan(s).order.length,2);
});

test('new canvas instances accept explicit flow links on shared sockets without copying settings',()=>{
 const s=sample();s.graph.connections=[edge('flow')];const w=ui(),p=w.OvllPointerProjection.projectGraph(s);
 const skillNodes=clone(p.workflow.skillNodes);skillNodes.push({id:'new',type:'pointer:d:1',data:{}});
 const connections=clone(p.workflow.connections);connections.push({from:{skillNode:'b',port:connections[0].from.port},to:{skillNode:'new',port:connections[0].to.port},data:{kind:'flow'}});
 const edit=w.OvllPointerGraphPatch.build(s,{skillNodes,connections}),add=edit.patch.operations.find(p=>p.op==='link.add');
 assert.equal(add.from.port,'summary');assert.equal(add.to.port,'source');assert.equal(add.kind,'flow');
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);repo.apply('w',clone(edit.patch));
 assert.equal(repo.get('w','g').graph.connections.at(-1).to.port,'source');
});
test('backend snapshot fingerprint retains relevant ancestors but ignores disconnected changes',()=>{
 const s=sample();s.graph.connections=[edge('flow')];
 const args={snapshot:s,skillNode:s.graph.skillNodes[1],definition,inputRefs:[]};const fingerprint=semanticFingerprint(args);
 const changed=clone(s);changed.graph.skillNodes[2].settings.request='Unrelated';changed.graph.revision++;
 assert.equal(semanticFingerprint({...args,snapshot:changed}),fingerprint);
 changed.graph.skillNodes[0].settings.request='Changed ancestor';
 assert.notEqual(semanticFingerprint({...args,snapshot:changed}),fingerprint);
});
test('custom data representations retain their meaning even when named like control representations',()=>{
 for(const representation of ['flow','control_flow']){
  const s=sample();s.skillDefinitions[0].inputs[0].representation=representation;s.skillDefinitions[0].outputs[0].representation=representation;s.graph.connections=[edge('data')];
  const repo=new MemoryGraphRepository();repo.restore('w','g',s);assert.equal(plan(s).order.length,2);
  const p=ui().OvllPointerProjection.projectGraph(s);assert.deepEqual(Array.from(p.workflow.data[0]),['a.summary','b.source']);
  assert.equal(p.skillDefinitions['pointer:d:1'].inputs[0].channel,'data');
 }
});

test('linked skillNode deletion honors later explicit link removals without silently removing edges',()=>{
 const s=sample();s.graph.connections=[edge('data')];
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);
 const change=operations=>({graphId:'g',expectedGraphRevision:1,skillDefinitions:[],operations});
 assert.throws(()=>repo.apply('w',change([{op:'skillNode.delete',skillNodeId:'a'}])),e=>e.code==='SKILL_NODE_HAS_LINKS');
 assert.equal(repo.get('w','g').graph.revision,1);
 const removed=repo.apply('w',change([
  {op:'skillNode.delete',skillNodeId:'a'},
  {op:'link.remove',linkId:s.graph.connections[0].id}
 ]));
 assert.equal(removed.graphRef.revision,2);
 assert.deepEqual(repo.get('w','g').graph.skillNodes.map(n=>n.skillNodeId),['b','other']);
 assert.equal(repo.get('w','g').graph.connections.length,0);
});
