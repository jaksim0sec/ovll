import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/skillCatalog.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('saved functions remain canonical Pointer assets and executable without the builder page',async()=>{
  const values=new Map();
  const window={localStorage:{getItem:k=>values.get(k)||null,
    setItem:(k,v)=>values.set(k,String(v))},
    crypto:{randomUUID:()=> 'f44a44a4-3333-3333-3333-444444444444'}};
  vm.runInNewContext(read('front/js/ovllPointerFunctions.js'),{window,console});
  const store=window.OvllPointerFunctions;
  const catalog=getPointerCatalog();
  const ref=catalog.skillDefinitions.find(d=>d.definitionId==='builtin:write');
  const snapshot={graph:{graphId:'g_function',revision:1,skillNodes:[{
    skillNodeId:'write_1',skillDefinitionRef:{definitionId:ref.definitionId,version:ref.version},
    inputBindings:{},settings:{request:'Write the report'}}],connections:[]},
    skillDefinitions:catalog.skillDefinitions};
  const fn=store.save({purpose:'Reusable report',snapshot,targets:['write_1'],
    presentation:{name:'Report',description:'Report writer',iconKey:'pen',color:'#4f8ef7',
      view:[{id:'write_1',x:100,y:80}]}});
  assert.equal(store.list()[0].presentation.name,'Report');
  assert.equal(store.get(fn.id).snapshot.graph.skillNodes[0].skillNodeId,'write_1');
  assert.equal(store.bind(fn,{}).targets[0],'write_1');
  assert.equal(store.remove(fn.id),true);
  assert.equal(store.get(fn.id),null);
});
test('draft projection translates built-in canvas graphs without persisting to unrelated conversations',async()=>{
  const window={OvllWorkspaceStore:{updateConversationSkillGraph(){},getConversation(){return null;}}};
  vm.runInNewContext(read('front/js/ovllPointerLocal.js'),{window,console});
  const local=window.createOvllPointerLocal({workspaceStore:window.OvllWorkspaceStore,
    loadCore:async()=>core,loadCatalog:async()=>getPointerCatalog()});
  const graph=await local.projectCanvasDraft({workflow:{skillNodes:[{id:'n',type:'write',
    data:{params:{request:'Describe the idea'}}}],connections:[]}},'g_builder');
  assert.equal(graph.graph.skillNodes.length,1);
  assert.equal(graph.graph.skillNodes[0].settings.request,'Describe the idea');
  assert.equal(graph.graph.revision,1);
});
