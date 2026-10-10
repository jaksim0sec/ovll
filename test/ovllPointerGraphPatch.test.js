import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const window={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerGraphPatch.js',import.meta.url),'utf8'),{window});
const {build,resolvedView}=window.OvllPointerGraphPatch;
const clone=x=>JSON.parse(JSON.stringify(x));
const d={definitionId:'d1',version:1,purpose:'Summarize',executorKind:'model_task',
  instruction:'Summarize notes',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]};
const snapshot={graph:{graphId:'g',revision:4,nodes:[
  {nodeId:'n1',definitionRef:{definitionId:'d1',version:1},inputBindings:{}},
  {nodeId:'n2',definitionRef:{definitionId:'d1',version:1},inputBindings:{}}],
  connections:[{id:'l1',kind:'flow',from:{nodeId:'n1',port:'result'},to:{nodeId:'n2',port:'in'}}]},
  definitions:[d]};
const ui=()=>({nodes:['n1','n2'].map(id=>({id,type:'pointer:d1:1',x:0,y:0,
  data:{params:{request:''},pointer:{inputBindings:{}}}})),
  connections:[{from:{node:'n1',port:'result'},to:{node:'n2',port:'in'},data:{kind:'flow'}}]});
test('movement and view-only changes do not issue any server mutation',()=>{
  const v=ui();v.nodes[0].x=300;v.nodes[0].expanded=true;
  assert.equal(build(snapshot,v),null);
});
test('node addition uses existing versioned definition and server remaps temporary node id',()=>{
  const v=ui();v.nodes.push({id:'temporary',type:'pointer:d1:1',x:42,y:44,data:{}});
  v.connections.push({from:{node:'n2',port:'result'},to:{node:'temporary',port:'in'},data:{kind:'flow'}});
  const result=build(snapshot,v);const ops=result.patch.operations;
  assert.equal(ops[0].op,'node.add');assert.equal(ops[1].op,'link.add');
  assert.equal(ops[1].to.node.localNodeKey,result.newNodeKeys.temporary);
  assert.equal(resolvedView(v,{['node:'+result.newNodeKeys.temporary]:'n3'},result.newNodeKeys).nodes[2].id,'n3');
});
test('deleted nodes remove links first and do not affect unrelated nodes',()=>{
  const v=ui();v.nodes.splice(1);v.connections=[];
  const result=build(snapshot,v);
  assert.deepEqual(Array.from(result.patch.operations,x=>x.op),['link.remove','node.delete']);
});
test('instance request edits preserve shared reusable definition and revision',()=>{
  const v=ui();v.nodes[0].data.params.request='Create a concise bilingual summary';
  const result=build(snapshot,v);
  assert.equal(result.patch.definitions.length,0);
  assert.equal(result.patch.operations[0].settings.request,'Create a concise bilingual summary');
  assert.equal(result.patch.operations[0].definitionRef,undefined);
  assert.equal(result.patch.expectedGraphRevision,4);
});
test('unknown node types fail closed; two instances may scope requests independently',()=>{
  const v=ui();v.nodes.push({id:'x',type:'file',data:{}});
  assert.throws(()=>build(snapshot,v),/UNSUPPORTED_UI_NODE_TYPE/);
  const w=ui();w.nodes.forEach((n,i)=>n.data.params.request='changed '+i);
  const result=build(snapshot,w);
  assert.equal(result.patch.definitions.length,0);
  assert.deepEqual(Array.from(result.patch.operations,x=>x.settings.request),['changed 0','changed 1']);
});

test('node builder only offers types which have a canonical Pointer definition',()=>{
 const supported=window.OvllPointerGraphPatch.supportedTypes(snapshot);
 assert.equal(supported.has('pointer:d1:1'),true);
 assert.equal(supported.has('custom:legacy'),false);
 assert.equal(supported.has('file'),false);
 assert.equal(supported.has('start'),false);
 const extended={...snapshot,definitions:[...snapshot.definitions,
   {definitionId:'builtin:file',version:1}]};
 assert.equal(window.OvllPointerGraphPatch.supportedTypes(extended).has('file'),true);
});
