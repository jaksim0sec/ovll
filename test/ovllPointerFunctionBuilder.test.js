import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('function builder uses Pointer action proposals instead of the retired workflow planner',()=>{
  const builder=read('front/js/functionWorkspace.js');
  assert.doesNotMatch(builder,/\.planWorkflow\(/);
  assert.match(builder,/OvllPointerApi\.localTurn/);
  assert.match(builder,/OvllPointerLocalActions\.execute/);
  assert.match(builder,/OvllPointerFunctions\.save/);
  assert.match(builder,/OvllPointerProjection\.applyGraph/);
});
test('saved functions from the builder are canonical Pointer assets and remain executable',async()=>{
  const values=new Map();
  const window={localStorage:{getItem:k=>values.get(k)||null,
    setItem:(k,v)=>values.set(k,String(v))},
    crypto:{randomUUID:()=> 'f44a44a4-3333-3333-3333-444444444444'}};
  vm.runInNewContext(read('front/js/ovllPointerFunctions.js'),{window,console});
  const store=window.OvllPointerFunctions;
  const catalog=getPointerCatalog();
  const ref=catalog.definitions.find(d=>d.definitionId==='builtin:write');
  const snapshot={graph:{graphId:'g_function',revision:1,nodes:[{
    nodeId:'write_1',definitionRef:{definitionId:ref.definitionId,version:ref.version},
    inputBindings:{},settings:{request:'Write the report'}}],connections:[]},
    definitions:catalog.definitions};
  const fn=store.save({purpose:'Reusable report',snapshot,targets:['write_1'],
    presentation:{name:'Report',description:'Report writer',iconKey:'pen',color:'#4f8ef7',
      view:[{id:'write_1',x:100,y:80}]}});
  assert.equal(store.list()[0].presentation.name,'Report');
  assert.equal(store.get(fn.id).snapshot.graph.nodes[0].nodeId,'write_1');
  assert.equal(store.bind(fn,{}).targets[0],'write_1');
  assert.equal(store.remove(fn.id),true);
  assert.equal(store.get(fn.id),null);
});
test('draft projection translates built-in canvas graphs without persisting to unrelated conversations',async()=>{
  const window={OvllWorkspaceStore:{updateConversationPointerGraph(){},getConversation(){return null;}}};
  vm.runInNewContext(read('front/js/ovllPointerLocal.js'),{window,console});
  const local=window.createOvllPointerLocal({workspaceStore:window.OvllWorkspaceStore,
    loadCore:async()=>core,loadCatalog:async()=>getPointerCatalog()});
  const graph=await local.projectCanvasDraft({workflow:{nodes:[{id:'n',type:'write',
    data:{params:{request:'Describe the idea'}}}],connections:[]}},'g_builder');
  assert.equal(graph.graph.nodes.length,1);
  assert.equal(graph.graph.nodes[0].settings.request,'Describe the idea');
  assert.equal(graph.graph.revision,1);
});
