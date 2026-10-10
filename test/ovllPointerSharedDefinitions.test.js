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
    const semantic=catalog.find(d=>d.definitionId==='builtin:'+type);
    const expected=(ports,direction)=>ports.map(p=>{
      const port=semantic[direction].find(item=>item.name===p.id);
      const representation=port?.representation||p.type;
      return {...p,type:representation,accepts:[representation],
        multiple:port?.multiple!==false,channel:'data'};
    });
    assert.deepEqual(JSON.parse(JSON.stringify(projected.definitions[type].inputs)),
      JSON.parse(JSON.stringify(expected(nodeDefinitionsPublic[type].inputs,'inputs'))));
    assert.deepEqual(JSON.parse(JSON.stringify(projected.definitions[type].outputs)),
      JSON.parse(JSON.stringify(expected(nodeDefinitionsPublic[type].outputs,'outputs'))));
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
test('legacy synthetic flow endpoints remain distinct and preserve logical routing on unrelated edits',()=>{
  const {window}=browser(),definitions=getPointerCatalog().definitions;
  const graph={graphId:'g_links',revision:1,nodes:['write','organize'].map(type=>({
    nodeId:type,definitionRef:{definitionId:'builtin:'+type,version:1},settings:{},inputBindings:{}})),
    connections:[{id:'c1',kind:'flow',from:{nodeId:'write',port:'next'},
      to:{nodeId:'organize',port:'flow_in'}}]};
  const snapshot={graph,definitions};
  const projected=window.OvllPointerProjection.projectGraph(snapshot,undefined,nodeDefinitionsPublic);
  assert.deepEqual(JSON.parse(JSON.stringify(projected.workflow.links)),[['write.next','organize.flow_in']]);
  assert.equal(window.OvllPointerGraphPatch.build(snapshot,{nodes:projected.workflow.nodes,
    connections:projected.workflow.connections}),null);
  const nodes=JSON.parse(JSON.stringify(projected.workflow.nodes));nodes[0].data.params={request:'Use these sources'};
  const patch=window.OvllPointerGraphPatch.build(snapshot,{nodes,connections:projected.workflow.connections});
  const repo=new MemoryGraphRepository();repo.restore('local',graph.graphId,snapshot);
  repo.apply('local',JSON.parse(JSON.stringify(patch.patch)));
  assert.deepEqual(repo.get('local',graph.graphId).graph.connections,graph.connections);
});

test('renaming a shared definition changes its single visible entry in every conversation and after reload',async()=>{
  const {window,store,local}=browser(),a=store.getActiveConversation().id,graphId=local.graphId(a);
  const created=await local.turn({conversationId:a,graphId,actions:[{localKey:'create',
    kind:'ir.applyPatch',args:{patch:{graphId,expectedGraphRevision:0,definitions:[definition],
      operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'shared'}}]}}}]});
  const definitionId=created.results[0].createdRefs['definition:shared'];
  const b=store.createConversation({title:'B'}).id,graphB=local.graphId(b);
  await local.turn({conversationId:b,graphId:graphB,actions:[{localKey:'reuse',
    kind:'ir.applyPatch',args:{patch:{graphId:graphB,expectedGraphRevision:0,definitions:[],
      operations:[{op:'node.add',localNodeKey:'n',definitionRef:{definitionId,version:1}}]}}}]});
  await local.turn({conversationId:a,graphId,actions:[{localKey:'rename',
    kind:'ir.applyPatch',args:{patch:{graphId,expectedGraphRevision:1,definitions:[],
      operations:[{op:'definition.appearance',definitionRef:{definitionId,version:1},
        presentation:{name:'내 분류'}}]}}}]});
  const shared=store.getPointerDefinitions().filter(d=>d.definitionId===definitionId);
  assert.equal(shared.length,1);
  assert.equal(shared[0].presentation.name,'내 분류');
  for(const id of [a,b]){
    const snapshot=(await local.state(id)).graph;
    const defs=snapshot.definitions.filter(d=>d.definitionId===definitionId);
    assert.equal(defs.length,1);
    assert.equal(defs[0].presentation.name,'내 분류');
    assert.equal(snapshot.graph.nodes[0].definitionRef.version,1);
    const ui=window.OvllPointerProjection.projectGraph(snapshot);
    assert.equal(ui.definitions['pointer:'+definitionId+':1'].name,'내 분류');
  }
  store.importJSON(store.exportJSON());
  assert.equal(store.getPointerDefinitions().filter(d=>d.definitionId===definitionId).length,1);
  assert.equal((await local.state(b)).graph.definitions.find(d=>d.definitionId===definitionId).presentation.name,'내 분류');
});

test('stored cosmetic alias versions are folded into the original without removing semantic revisions',async()=>{
  const {window,store,local}=browser(),a=store.getActiveConversation().id;
  const base={definitionId:'d_legacy',version:1,purpose:'Vocabulary',
    instruction:'Make list',executorKind:'model_task',inputs:[],
    outputs:[{name:'result',role:'result',representation:'text'}],
    presentation:{name:'일본어 단어장 생성기',iconKey:'notebook',color:'#ffbb00'}};
  const alias={...base,version:2,cosmeticBaseVersion:1,
    presentation:{...base.presentation,name:'일본어 단어장'}};
  const semantic={...base,version:3,instruction:'Make advanced list',
    presentation:{...base.presentation,name:'고급 일본어 단어장'}};
  const doc=JSON.parse(store.exportJSON());
  doc.pointerDefinitions=[base,alias,semantic];
  doc.conversations[0].state.pointerGraph={graph:{graphId:local.graphId(a),revision:3,
    nodes:[{nodeId:'alias_node',definitionRef:{definitionId:'d_legacy',version:2},
      settings:{request:'JLPT N4'},inputBindings:{}}],connections:[]},
    definitions:[base,alias,semantic]};
  store.importJSON(doc);
  const versions=store.getPointerDefinitions().filter(d=>d.definitionId==='d_legacy');
  assert.deepEqual(Array.from(versions,d=>d.version),[1,3]);
  assert.equal(versions[0].presentation.name,'일본어 단어장');
  assert.equal(versions[1].instruction,'Make advanced list');
  const restored=(await local.state(a)).graph;
  assert.equal(restored.graph.nodes[0].definitionRef.version,1);
  assert.equal(restored.definitions.filter(d=>d.definitionId==='d_legacy').length,2);
  assert.equal(Object.keys(window.OvllPointerProjection.projectGraph(restored).definitions)
    .filter(key=>key.startsWith('pointer:d_legacy:')).length,2);
});
