import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const window={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerGraphPatch.js',import.meta.url),'utf8'),{window});
const {build,resolvedView}=window.OvllPointerGraphPatch;
const clone=x=>JSON.parse(JSON.stringify(x));
const d={definitionId:'d1',version:1,purpose:'Summarize',executorKind:'model_task',
  instruction:'Summarize notes',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]};
const snapshot={graph:{graphId:'g',revision:4,skillNodes:[
  {skillNodeId:'n1',skillDefinitionRef:{definitionId:'d1',version:1},inputBindings:{}},
  {skillNodeId:'n2',skillDefinitionRef:{definitionId:'d1',version:1},inputBindings:{}}],
  connections:[{id:'l1',kind:'flow',from:{skillNodeId:'n1',port:'result'},to:{skillNodeId:'n2',port:'in'}}]},
  skillDefinitions:[d]};
const ui=()=>({skillNodes:['n1','n2'].map(id=>({id,type:'pointer:d1:1',x:0,y:0,
  data:{params:{request:''},pointer:{inputBindings:{}}}})),
  connections:[{from:{skillNode:'n1',port:'result'},to:{skillNode:'n2',port:'in'},data:{kind:'flow'}}]});
test('movement and view-only changes do not issue any server mutation',()=>{
  const v=ui();v.skillNodes[0].x=300;v.skillNodes[0].expanded=true;
  assert.equal(build(snapshot,v),null);
});
test('skillNode addition uses existing versioned definition and server remaps temporary skillNode id',()=>{
  const v=ui();v.skillNodes.push({id:'temporary',type:'pointer:d1:1',x:42,y:44,data:{}});
  v.connections.push({from:{skillNode:'n2',port:'result'},to:{skillNode:'temporary',port:'in'},data:{kind:'flow'}});
  const result=build(snapshot,v);const ops=result.patch.operations;
  assert.equal(ops[0].op,'skillNode.add');assert.equal(ops[1].op,'link.add');
  assert.equal(ops[1].to.skillNode.localSkillNodeKey,result.newSkillNodeKeys.temporary);
  assert.equal(resolvedView(v,{['skillNode:'+result.newSkillNodeKeys.temporary]:'n3'},result.newSkillNodeKeys).skillNodes[2].id,'n3');
});
test('deleted skillNodes remove links first and do not affect unrelated skillNodes',()=>{
  const v=ui();v.skillNodes.splice(1);v.connections=[];
  const result=build(snapshot,v);
  assert.deepEqual(Array.from(result.patch.operations,x=>x.op),['link.remove','skillNode.delete']);
});
test('instance request edits preserve shared reusable definition and revision',()=>{
  const v=ui();v.skillNodes[0].data.params.request='Create a concise bilingual summary';
  const result=build(snapshot,v);
  assert.equal(result.patch.skillDefinitions.length,0);
  assert.equal(result.patch.operations[0].settings.request,'Create a concise bilingual summary');
  assert.equal(result.patch.operations[0].skillDefinitionRef,undefined);
  assert.equal(result.patch.expectedGraphRevision,4);
});
test('unknown skillNode types fail closed; two instances may scope requests independently',()=>{
  const v=ui();v.skillNodes.push({id:'x',type:'file',data:{}});
  assert.throws(()=>build(snapshot,v),/UNSUPPORTED_UI_SKILL_NODE_TYPE/);
  const w=ui();w.skillNodes.forEach((n,i)=>n.data.params.request='changed '+i);
  const result=build(snapshot,w);
  assert.equal(result.patch.skillDefinitions.length,0);
  assert.deepEqual(Array.from(result.patch.operations,x=>x.settings.request),['changed 0','changed 1']);
});

test('skillNode builder only offers types which have a canonical Pointer definition',()=>{
 const supported=window.OvllPointerGraphPatch.supportedTypes(snapshot);
 assert.equal(supported.has('pointer:d1:1'),true);
 assert.equal(supported.has('custom:legacy'),false);
 assert.equal(supported.has('file'),false);
 assert.equal(supported.has('start'),false);
 const extended={...snapshot,skillDefinitions:[...snapshot.skillDefinitions,
   {definitionId:'builtin:file',version:1}]};
 assert.equal(window.OvllPointerGraphPatch.supportedTypes(extended).has('file'),true);
});
