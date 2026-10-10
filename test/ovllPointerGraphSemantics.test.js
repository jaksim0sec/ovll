import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {buildExecutionPlan,semanticFingerprint} from '../backend/ovllPointer/executionPlan.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const definition={definitionId:'d',version:1,purpose:'Do work',instruction:'Keep evidence',executorKind:'model_task',inputs:[{name:'source',representation:'text'}],outputs:[{name:'summary',representation:'text'}]};
function sample(){return {definitions:[clone(definition)],graph:{graphId:'g',revision:1,nodes:['a','b','other'].map(nodeId=>({nodeId,definitionRef:{definitionId:'d',version:1},settings:{},inputBindings:{}})),connections:[]}};}
const edge=(kind,fromPort='summary',toPort='source',from='a',to='b')=>({id:'link_'+from+fromPort+toPort,kind,from:{nodeId:from,port:fromPort},to:{nodeId:to,port:toPort}});
const plan=s=>buildExecutionPlan(s,{graphRef:{graphId:'g',revision:1},targets:['b'],damMode:'closed'});
function ui(){const window={};for(const name of ['Projection','GraphPatch'])vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointer'+name+'.js',import.meta.url),'utf8'),{window});return window;}
test('graph and plan accept declared dynamic sequencing ports and multiple flow parents',()=>{
 const s=sample();s.graph.connections=[edge('flow'),edge('flow','summary','source','other')];
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);
 assert.deepEqual(plan(s).order.find(n=>n.nodeId==='b').predecessors,['a','other']);
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
 assert.deepEqual(plan(s).order.map(n=>n.nodeId),['a','other','b']);
 s.graph.nodes[1].inputBindings={source:'fixed'};
 assert.throws(()=>new MemoryGraphRepository().restore('w','g',s),e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
 s.graph.nodes[1].inputBindings={};
 s.definitions[0].inputs[0].multiple=false;
 assert.throws(()=>new MemoryGraphRepository().restore('w','g',s),e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
 s.definitions[0].inputs[0].multiple=true;
 s.graph.connections.push({...edge('flow'),id:'gate'});
 new MemoryGraphRepository().restore('w','g',s);
 assert.equal(plan(s).order.length,3);
});
test('implicit control endpoints remain distinct from data and survive an unrelated request edit',()=>{
 const s=sample();s.definitions[0].inputs=[];s.graph.connections=[edge('flow','next','flow_in')];
 const w=ui(),projected=w.OvllPointerProjection.projectGraph(s);
 assert.deepEqual(Array.from(projected.workflow.links[0]),['a.next','b.flow_in']);
 const ports=projected.definitions['pointer:d:1'];assert.ok(ports.inputs.some(p=>p.id==='flow_in'&&p.channel==='flow'));
 assert.equal(projected.workflow.connections[0].id,s.graph.connections[0].id);
 const workflow={nodes:clone(projected.workflow.nodes),connections:clone(projected.workflow.connections)};
 assert.equal(w.OvllPointerGraphPatch.build(s,workflow),null);
 workflow.nodes[0].data.params={request:'Updated request'};
 const edit=w.OvllPointerGraphPatch.build(s,workflow);
 assert.deepEqual(Array.from(edit.patch.operations,p=>p.op),['node.update']);
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);repo.apply('w',clone(edit.patch));
 assert.deepEqual(repo.get('w','g').graph.connections,s.graph.connections);
});
test('projected data input accepts fan-in and flow ports retain fan-in',()=>{
 const s=sample();s.graph.connections=[edge('flow','next','flow_in')];
 const p=ui().OvllPointerProjection.projectGraph(s).definitions['pointer:d:1'];
 assert.equal(p.inputs.find(p=>p.id==='source').multiple,true);
 assert.equal(p.inputs.find(p=>p.id==='flow_in').multiple,true);
});
test('backend result fingerprint remains current across unrelated revisions and excludes UI settings',()=>{
 const s=sample(),node=s.graph.nodes[0],args={run:{graphRef:{graphId:'g',revision:1},planEpoch:0},node,definition,inputRefs:['v1']};
 const fingerprint=semanticFingerprint(args);
 assert.equal(semanticFingerprint({...args,run:{graphRef:{graphId:'elsewhere',revision:99},planEpoch:4}}),fingerprint);
 assert.equal(semanticFingerprint({...args,node:{...node,settings:{position:{x:4,y:5},expanded:true}}}),fingerprint);
 assert.notEqual(semanticFingerprint({...args,definition:{...definition,purpose:'Different objective'}}),fingerprint);
 assert.notEqual(semanticFingerprint({...args,executorVersion:'provider/model-v2'}),fingerprint);
});

test('heterogeneous flow ports use control sockets and reverse to unchanged declared logical ports',()=>{
 const s=sample();s.definitions.push({...clone(definition),definitionId:'consumer',inputs:[{name:'payload',representation:'boolean'}]});
 s.graph.nodes[1].definitionRef={definitionId:'consumer',version:1};s.graph.connections=[edge('flow','summary','payload')];
 const w=ui(),p=w.OvllPointerProjection.projectGraph(s),c=p.workflow.connections[0];
 assert.notEqual(c.from.port,'summary');assert.notEqual(c.to.port,'payload');
 assert.equal(p.definitions['pointer:d:1'].outputs.find(port=>port.id===c.from.port).type,'control_flow');
 assert.equal(p.definitions['pointer:consumer:1'].inputs.find(port=>port.id===c.to.port).type,'control_flow');
 assert.equal(w.OvllPointerGraphPatch.build(s,{nodes:p.workflow.nodes,connections:p.workflow.connections}),null);
 const changed=clone(p.workflow.nodes);changed[0].data.params={request:'Updated'};
 const patch=w.OvllPointerGraphPatch.build(s,{nodes:changed,connections:p.workflow.connections});
 assert.deepEqual(Array.from(patch.patch.operations,p=>p.op),['node.update']);
});

test('one control socket per logical endpoint handles repeated types and simultaneous data and flow links',()=>{
 const s=sample();s.graph.connections=[edge('data'),{...edge('flow'),id:'gate'},edge('flow','summary','source','b','other')];
 const w=ui(),p=w.OvllPointerProjection.projectGraph(s),outputs=p.definitions['pointer:d:1'].outputs;
 assert.equal(outputs.filter(port=>port.channel==='flow').length,1);
 assert.equal(p.workflow.connections[1].from.port,p.workflow.connections[2].from.port);
 assert.equal(p.workflow.connections[0].from.port,'summary');
 assert.notEqual(p.workflow.connections[0].from.port,p.workflow.connections[1].from.port);
 assert.equal(w.OvllPointerGraphPatch.build(s,{nodes:p.workflow.nodes,connections:p.workflow.connections}),null);
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);assert.equal(plan(s).order.length,2);
});

test('new canvas instances reverse inherited control sockets without copying another instance settings',()=>{
 const s=sample();s.graph.connections=[edge('flow')];const w=ui(),p=w.OvllPointerProjection.projectGraph(s);
 const nodes=clone(p.workflow.nodes);nodes.push({id:'new',type:'pointer:d:1',data:{}});
 const connections=clone(p.workflow.connections);connections.push({from:{node:'b',port:connections[0].from.port},to:{node:'new',port:connections[0].to.port}});
 const edit=w.OvllPointerGraphPatch.build(s,{nodes,connections}),add=edit.patch.operations.find(p=>p.op==='link.add');
 assert.equal(add.from.port,'summary');assert.equal(add.to.port,'source');assert.equal(add.kind,'flow');
 const repo=new MemoryGraphRepository();repo.restore('w','g',s);repo.apply('w',clone(edit.patch));
 assert.equal(repo.get('w','g').graph.connections.at(-1).to.port,'source');
});
test('backend snapshot fingerprint retains relevant ancestors but ignores disconnected changes',()=>{
 const s=sample();s.graph.connections=[edge('flow')];
 const args={snapshot:s,node:s.graph.nodes[1],definition,inputRefs:[]};const fingerprint=semanticFingerprint(args);
 const changed=clone(s);changed.graph.nodes[2].settings.request='Unrelated';changed.graph.revision++;
 assert.equal(semanticFingerprint({...args,snapshot:changed}),fingerprint);
 changed.graph.nodes[0].settings.request='Changed ancestor';
 assert.notEqual(semanticFingerprint({...args,snapshot:changed}),fingerprint);
});
test('custom data representations retain their meaning even when named like control representations',()=>{
 for(const representation of ['flow','control_flow']){
  const s=sample();s.definitions[0].inputs[0].representation=representation;s.definitions[0].outputs[0].representation=representation;s.graph.connections=[edge('data')];
  const repo=new MemoryGraphRepository();repo.restore('w','g',s);assert.equal(plan(s).order.length,2);
  const p=ui().OvllPointerProjection.projectGraph(s);assert.deepEqual(Array.from(p.workflow.data[0]),['a.summary','b.source']);
  assert.equal(p.definitions['pointer:d:1'].inputs[0].channel,'data');
 }
});
