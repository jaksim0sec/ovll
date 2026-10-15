import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as storageRuntime from '../front/js/ovllSkillStorageRuntime.mjs';
const old=JSON.parse(readFileSync(new URL('./fixtures/workspace-node-v9.json',import.meta.url)));
function context(seed={}){const data=new Map(Object.entries(seed));const window={OvllSkillStorageRuntime:storageRuntime,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))},addEventListener(){},dispatchEvent(){}};return{data,window};}
test('saved functions import their graph and public bindings once without replacing old bytes',()=>{
 const fn={id:'f',version:1,name:'Words',snapshot:old.conversations[0].state.pointerGraph,targets:['n_saved'],inputMap:{source:{nodeId:'n_saved',port:'input'}},outputMap:{words:{nodeId:'n_saved',port:'result'}}};
 const original=JSON.stringify([fn]),c=context({'ovll:pointer:functions:v1':original});
 vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerFunctions.js',import.meta.url),'utf8'),{window:c.window,console});
 const found=c.window.OvllPointerFunctions.get('f',1);
 assert.equal(found.snapshot.graph.skillNodes[0].skillNodeId,'n_saved');
 assert.equal(found.outputMap.words.skillNodeId,'n_saved');
 assert.equal(found.inputMap.source.skillNodeId,'n_saved');
 assert.equal(c.data.get('ovll:pointer:functions:v1'),original);
 assert.ok(c.data.has(c.window.OvllPointerFunctions.storageKey));
});
test('custom skill import retains its inner skill nodes, boundary and opaque parameters',()=>{
 const original=JSON.stringify({schemaVersion:2,records:[{id:'custom:words',name:'Words',workflow:{nodes:[{id:'n',type:'write',x:1,y:2,data:{params:{nodeId:'opaque'}}}],connections:[]},boundary:{entryNodeIds:['n'],exitNodeId:'n'}}]});
 const c=context({'ovll:custom-nodes:v1':original});
 vm.runInNewContext(readFileSync(new URL('../front/js/customSkillStore.js',import.meta.url),'utf8'),{window:c.window,console,Date,Math,CustomEvent:class{}});
 const found=c.window.OvllCustomSkillStore.list()[0];
 assert.equal(found.workflow.skillNodes[0].id,'n');assert.equal(found.boundary.exitSkillNodeId,'n');
 assert.equal(found.workflow.skillNodes[0].data.params.nodeId,'opaque');
 assert.equal(c.data.get('ovll:custom-nodes:v1'),original);
});
