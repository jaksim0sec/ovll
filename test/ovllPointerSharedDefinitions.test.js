import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {nodeDefinitionsPublic,getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';

const read=path=>readFileSync(new URL('../front/js/'+path+'.js',import.meta.url),'utf8');
function browser(){
  const data=new Map(),localStorage={getItem:key=>data.get(key)||null,
    setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const window={};
  for(const name of ['workspaceStore','ovllPointerLocal','ovllPointerProjection','ovllPointerGraphPatch'])
    vm.runInNewContext(read(name),{window,localStorage,console});
  const store=window.OvllWorkspaceStore;
  const local=window.createOvllPointerLocal({workspaceStore:store,
    loadCore:async()=>({MemoryGraphRepository}),loadCatalog:async()=>getPointerCatalog()});
  return {window,store,local,data};
}
const definition={localKey:'shared',purpose:'사용자 지정 분류',executorKind:'model_task',
  instruction:'특정 규칙으로 분류',inputs:[{name:'source',role:'자료',representation:'text'}],
  outputs:[{name:'result',role:'결과',representation:'text'}],
  presentation:{name:'내 분류 노드',iconKey:'custom',color:'#7C6CF2'}};
test('a definition created in conversation A is selectable and reusable in conversation B',async()=>{
  const {window,store,local}=browser();
  const a=store.getActiveConversation().id,graphId=local.graphId(a);
  const patch={graphId,expectedGraphRevision:0,definitions:[definition],
    operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'shared'}}]};
  const result=await local.turn({conversationId:a,graphId,actions:[{localKey:'p',
    kind:'ir.applyPatch',args:{patch}}]});
  assert.equal(result.results[0].status,'applied');
  const ref=result.results[0].createdRefs['definition:shared'];
  assert.equal(store.getPointerDefinitions().find(d=>d.definitionId===ref).presentation.name,'내 분류 노드');
  const b=store.createConversation({title:'New conversation'}).id;
  const next=(await local.state(b)).graph;
  assert.equal(next.graph.nodes.length,0,'other sessions must not share node instances');
  assert.ok(next.definitions.find(d=>d.definitionId===ref),'definition must be shared');
  const projected=window.OvllPointerProjection.projectGraph(next);
  assert.equal(projected.definitions['pointer:'+ref+':1'].catalog.group,'custom');
  const reused={graphId:next.graph.graphId,expectedGraphRevision:0,definitions:[],
    operations:[{op:'node.add',localNodeKey:'other',
      definitionRef:{definitionId:ref,version:1}}]};
  await local.turn({conversationId:b,graphId:next.graph.graphId,
    actions:[{kind:'ir.applyPatch',localKey:'reuse',args:{patch:reused}}]});
  assert.equal((await local.state(b)).graph.graph.nodes[0].definitionRef.definitionId,ref);
  assert.equal((await local.state(a)).graph.graph.nodes.length,1);
  const exported=store.exportJSON();
  store.reset();
  store.importJSON(exported);
  assert.ok(store.getPointerDefinitions().some(d=>d.definitionId===ref),'export/import retains reusable definitions');
  assert.equal((await local.state(b)).graph.graph.nodes.length,1);
});
test('previously stored per-conversation definitions become shared on workspace restoration',async()=>{
  const {store,local}=browser(),a=store.getActiveConversation().id;
  const doc=JSON.parse(store.exportJSON());
  const historic={definitionId:'d_prior',version:1,purpose:'Older kind',
    instruction:'Older work',executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]};
  doc.conversations[0].state.pointerGraph={graph:{graphId:local.graphId(a),revision:1,
    nodes:[],connections:[]},definitions:[historic]};
  delete doc.pointerDefinitions;
  store.importJSON(doc);
  assert.ok(store.getPointerDefinitions().some(d=>d.definitionId==='d_prior'));
  const b=store.createConversation({title:'Other'}).id;
  assert.ok((await local.state(b)).graph.definitions.some(d=>d.definitionId==='d_prior'));
});
test('builtins keep original UI port count and node request is never invented',()=>{
  const {window}=browser(),catalog=getPointerCatalog().definitions;
  const nodes=['write','organize','file','createFile'].map(type=>({nodeId:type,
    definitionRef:{definitionId:'builtin:'+type,version:1},settings:{},inputBindings:{}}));
  const snapshot={graph:{graphId:'g_ports',revision:0,nodes,connections:[]},definitions:catalog};
  const projected=window.OvllPointerProjection.projectGraph(snapshot,undefined,nodeDefinitionsPublic);
  for(const type of ['write','organize','file','createFile']){
    assert.deepEqual(JSON.parse(JSON.stringify(projected.definitions[type].inputs)),JSON.parse(JSON.stringify(nodeDefinitionsPublic[type].inputs)));
    assert.deepEqual(JSON.parse(JSON.stringify(projected.definitions[type].outputs)),JSON.parse(JSON.stringify(nodeDefinitionsPublic[type].outputs)));
  }
  assert.equal(projected.workflow.nodes.find(n=>n.id==='write').params.request,'');
  const custom={definitionId:'d_ui',version:1,purpose:'Visible name',instruction:'Internal policy',
    inputs:[{name:'source',role:'자료',representation:'text'}],
    outputs:[{name:'result',role:'결과',representation:'text'}]};
  const customProjected=window.OvllPointerProjection.projectGraph({definitions:[custom],
    graph:{graphId:'g_ui',revision:0,nodes:[{nodeId:'n',definitionRef:{
      definitionId:'d_ui',version:1},settings:{},inputBindings:{}}],connections:[]}});
  assert.deepEqual(customProjected.definitions['pointer:d_ui:1'].inputs.map(p=>p.id),['source']);
  assert.deepEqual(customProjected.definitions['pointer:d_ui:1'].outputs.map(p=>p.id),['result']);
  assert.equal(customProjected.definitions['pointer:d_ui:1'].params[0].default,'');
  assert.equal(customProjected.workflow.nodes[0].params.request,'');
});
test('legacy synthetic flow endpoints are visually redirected to existing single ports without losing routing',()=>{
  const {window}=browser(),definitions=getPointerCatalog().definitions;
  const graph={graphId:'g_links',revision:1,nodes:['write','organize'].map(type=>({
    nodeId:type,definitionRef:{definitionId:'builtin:'+type,version:1},settings:{},inputBindings:{}})),
    connections:[{id:'c1',kind:'flow',from:{nodeId:'write',port:'next'},
      to:{nodeId:'organize',port:'flow_in'}}]};
  const snapshot={graph,definitions};
  const projected=window.OvllPointerProjection.projectGraph(snapshot,undefined,nodeDefinitionsPublic);
  assert.deepEqual(JSON.parse(JSON.stringify(projected.workflow.links)),[['write.result','organize.in']]);
  const patch=window.OvllPointerGraphPatch.build(snapshot,{nodes:projected.workflow.nodes,
    connections:[{from:{node:'write',port:'result'},to:{node:'organize',port:'in'},data:{kind:'links'}}]});
  assert.ok(patch,'legacy ports are migrated only with an actual edit');
  const repo=new MemoryGraphRepository();repo.restore('local',graph.graphId,snapshot);
  repo.apply('local',JSON.parse(JSON.stringify(patch.patch)));
  const links=repo.get('local',graph.graphId).graph.connections;
  assert.equal(links.length,1);
  assert.equal(links[0].kind,'flow');
  assert.equal(links[0].from.port,'result');
  assert.equal(links[0].to.port,'in');
});
