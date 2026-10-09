import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function setup(){
  const values=new Map(),localStorage={getItem:k=>values.get(k)||null,
    setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const window={};
  vm.runInNewContext(read('front/js/workspaceStore.js'),{window,localStorage,console});
  vm.runInNewContext(read('front/js/ovllPointerLocal.js'),{window,console});
  const store=window.OvllWorkspaceStore;
  const local=window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,
    loadCatalog:async()=>getPointerCatalog()});
  return {store,local,id:store.getActiveConversation().id};
}
function saved(store,id,canvas){
  const state=store.getConversation(id).state;
  store.updateConversationState(id,{...state,canvas});
}
test('saved built-in workflow becomes a Pointer graph without changing canvas node identities',async()=>{
  const {store,local,id}=setup(),graphId=local.graphId(id);
  const canvas={workflow:{nodes:[
    {id:'file_1',type:'file',x:20,y:40,data:{name:'facts.txt',mime:'text/plain',textPreview:'Original facts'}},
    {id:'write_1',type:'write',x:310,y:40,data:{params:{request:'Summarize the facts'}}}
  ],connections:[{id:'old_edge',from:{node:'file_1',port:'file'},
    to:{node:'write_1',port:'in'},data:{kind:'data'}}]},viewport:{scale:0.8,offset:{x:80,y:20}}};
  saved(store,id,canvas);
  assert.equal(await local.migrateConversation(id,canvas),true);
  const graph=(await local.state(id)).graph;
  assert.equal(graph.graph.graphId,graphId);
  assert.deepEqual(graph.graph.nodes.map(n=>n.nodeId),['file_1','write_1']);
  assert.equal(graph.graph.nodes[0].settings.file.textPreview,'Original facts');
  assert.equal(graph.graph.nodes[1].settings.request,'Summarize the facts');
  assert.equal(graph.graph.connections[0].kind,'data');
  assert.equal(graph.graph.connections[0].from.port,'file');
  assert.equal(graph.graph.connections[0].to.port,'in');
  assert.equal(store.getConversation(id).state.canvas.viewport.scale,0.8);
  assert.equal(await local.migrateConversation(id,canvas),false);
  assert.equal((await local.state(id)).graph.graph.nodes.length,2);
});
test('unsupported legacy custom subgraph stays intact and cannot silently become a different model task',async()=>{
  const {store,local,id}=setup();
  const canvas={workflow:{nodes:[{id:'custom_1',type:'custom:old',data:{params:{request:'Preserve this'}}}],
    connections:[]},viewport:{scale:1,offset:{x:0,y:0}}};
  saved(store,id,canvas);
  const before=JSON.stringify(store.getConversation(id).state.canvas);
  await assert.rejects(local.migrateConversation(id,canvas),/LEGACY_GRAPH_REQUIRES_REVIEW/);
  assert.equal(store.getConversation(id).state.pointerGraph,null);
  assert.equal(JSON.stringify(store.getConversation(id).state.canvas),before);
});
test('empty chats need no graph migration and legacy start marker does not become an executable node',async()=>{
  const {store,local,id}=setup();
  assert.equal(await local.migrateConversation(id,{workflow:{nodes:[],connections:[]}}),false);
  const canvas={workflow:{nodes:[{id:'start_1',type:'start',data:{}},
    {id:'write_1',type:'write',data:{params:{request:'Draft'}}}],
    connections:[{from:{node:'start_1',port:'out'},to:{node:'write_1',port:'in'}}]}};
  saved(store,id,canvas);
  await local.migrateConversation(id,canvas);
  const graph=(await local.state(id)).graph.graph;
  assert.deepEqual(graph.nodes.map(n=>n.nodeId),['write_1']);
  assert.equal(graph.connections.length,0);
});
