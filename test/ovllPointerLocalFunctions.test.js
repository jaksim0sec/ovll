import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../front/js/ovllPointerFunctions.js',import.meta.url),'utf8');
test('locally saved function is a pinned immutable unverified draft and can be reused',()=>{
 const data=new Map(),localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const window={localStorage,crypto:{randomUUID:()=> 'abcd'}};
 vm.runInNewContext(script,{window});
 const graph={graph:{graphId:'g',revision:1,nodes:[{nodeId:'n1'}],connections:[]},definitions:[]};
 const saved=window.OvllPointerFunctions.save({purpose:'Research',snapshot:graph,targets:['n1']});
 graph.graph.revision=3;
 assert.equal(window.OvllPointerFunctions.get(saved.id).snapshot.graph.revision,1);
 assert.equal(saved.verificationStatus,'draft');
 vm.runInNewContext(script,{window});
 assert.equal(window.OvllPointerFunctions.list()[0].id,saved.id);
});
test('saved functions reject dangling node targets',()=>{
 const window={localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=> 'abcd'}};
 vm.runInNewContext(script,{window});
 assert.throws(()=>window.OvllPointerFunctions.save({purpose:'no',snapshot:{
  graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]},targets:['unknown']}),
  /INVALID_LOCAL_FUNCTION/);
});
test('local application hooks model proposals to stored graph and executes model-only DAG',()=>{
 const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
 const boot=readFileSync(new URL('../front/js/boot.js',import.meta.url),'utf8');
 const config=readFileSync(new URL('../front/runtime-config.js',import.meta.url),'utf8');
 assert.match(app,/PointerAPI\.localTurn\(/);
 assert.match(app,/OvllPointerLocal\.turn\(/);
 assert.match(app,/OvllPointerLocal\.run\(/);
 assert.match(boot,/\.\/js\/pointerFunctions\.js/);
 assert.match(config,/pointerEnabled:true/);
});

test('preserves saved function drafts created before OvllPointer rename',()=>{
  const cache=new Map(),storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
  cache.set('ovll:vnext:functions:v1',JSON.stringify([{id:'fn_old',purpose:'기존 초안',version:1,
    snapshot:{graph:{graphId:'g_old',revision:1,nodes:[{nodeId:'a'}],connections:[]},definitions:[]},targets:['a']}])));
  const window={localStorage:storage,crypto:{randomUUID:()=> 'abcd'}};
  vm.runInNewContext(script,{window});
  assert.equal(window.OvllPointerFunctions.list()[0].purpose,'기존 초안');
  window.OvllPointerFunctions.save({purpose:'new',snapshot:{graph:{graphId:'g_new',revision:1,nodes:[{nodeId:'n'}],connections:[]},definitions:[]},targets:['n']});
  assert.equal(window.OvllPointerFunctions.list().length,2);
});
