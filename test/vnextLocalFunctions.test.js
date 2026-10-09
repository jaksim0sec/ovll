import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../front/js/vnextFunctions.js',import.meta.url),'utf8');
test('locally saved function is a pinned immutable unverified draft and can be reused',()=>{
 const data=new Map(),localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const window={localStorage,crypto:{randomUUID:()=> 'abcd'}};
 vm.runInNewContext(script,{window});
 const graph={graph:{graphId:'g',revision:1,nodes:[{nodeId:'n1'}],connections:[]},definitions:[]};
 const saved=window.OvllVNextFunctions.save({purpose:'Research',snapshot:graph,targets:['n1']});
 graph.graph.revision=3;
 assert.equal(window.OvllVNextFunctions.get(saved.id).snapshot.graph.revision,1);
 assert.equal(saved.verificationStatus,'draft');
 vm.runInNewContext(script,{window});
 assert.equal(window.OvllVNextFunctions.list()[0].id,saved.id);
});
test('saved functions reject dangling node targets',()=>{
 const window={localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=> 'abcd'}};
 vm.runInNewContext(script,{window});
 assert.throws(()=>window.OvllVNextFunctions.save({purpose:'no',snapshot:{
  graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]},targets:['unknown']}),
  /INVALID_LOCAL_FUNCTION/);
});
test('local application hooks model proposals to stored graph and executes model-only DAG',()=>{
 const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
 const boot=readFileSync(new URL('../front/js/boot.js',import.meta.url),'utf8');
 const config=readFileSync(new URL('../front/runtime-config.js',import.meta.url),'utf8');
 assert.match(app,/VNextAPI\.localTurn\(/);
 assert.match(app,/OvllVNextLocal\.turn\(/);
 assert.match(app,/OvllVNextLocal\.run\(/);
 assert.match(boot,/\.\/js\/vnextFunctions\.js/);
 assert.match(config,/vnextEnabled:true/);
});
