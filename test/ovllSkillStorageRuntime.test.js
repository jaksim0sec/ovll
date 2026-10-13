import test from 'node:test';
import assert from 'node:assert/strict';
import {read,write,canonicalWorkspace,runtimeWorkspace,storageKey,schemaVersion}
  from '../front/js/ovllSkillStorageRuntime.mjs';
import {LEGACY_WORKSPACE_KEY} from '../front/js/ovllSkillStorageBridge.mjs';
const original=()=>({
  storageRevision:4,schemaVersion:9,
  workspace:{id:'local',activeConversationId:'c'},
  sections:[],contextBundles:[],pointerDefinitions:[{definitionId:'custom:one',version:1}],
  conversations:[{id:'c',state:{
    canvas:{workflow:{nodes:[{id:'n_old',type:'write',x:4,y:3}],connections:[]}},
    pointerGraph:{graph:{graphId:'g',revision:2,nodes:[{
      nodeId:'n_old',definitionRef:{definitionId:'custom:one',version:1},
      settings:{nodeId:'user data'}}],connections:[]},
      definitions:[{definitionId:'custom:one',version:1}]},
    pointerRuns:[{runId:'r',nodes:[{nodeId:'n_old',status:'success',
      outputs:{user:{nodeId:'opaque'}}}]}],messages:[{role:'user',text:'hi'}],
    composerDraft:'pending'
  }}]
});
function mem(seed={}){
  const map=new Map(Object.entries(seed));
  return {map,storage:{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value))}};
}
test('real storage writes canonical v2 and never alters original v1 bytes',()=>{
  const old=JSON.stringify(original()),fixture=mem({[LEGACY_WORKSPACE_KEY]:old});
  const loaded=read(fixture.storage);
  assert.deepEqual(loaded,original());
  assert.equal(storageKey,'ovll:workspace:skill:v2');
  assert.equal(schemaVersion,10);
  loaded.storageRevision++;
  assert.equal(write(fixture.storage,loaded,{expectedRevision:4}),5);
  assert.equal(fixture.map.get(LEGACY_WORKSPACE_KEY),old);
  const saved=JSON.parse(fixture.map.get(storageKey));
  assert.equal(saved.schemaVersion,10);
  assert.equal(saved.conversations[0].state.skillGraph.graph.skills[0].skillId,'n_old');
  assert.equal(saved.conversations[0].state.canvas.workflow.skills[0].skillId,'n_old');
  assert.equal(saved.conversations[0].state.skillRuns[0].skills[0].skillId,'n_old');
  assert.equal(saved.conversations[0].state.skillRuns[0].skills[0].outputs.user.nodeId,'opaque');
  assert.deepEqual(read(fixture.storage),{...loaded,schemaVersion:9});
  assert.deepEqual(canonicalWorkspace(runtimeWorkspace(saved)),saved);
});
test('stale revision cannot overwrite newer v2',()=>{
  const fixture=mem();
  const value=original();value.storageRevision=1;
  assert.equal(write(fixture.storage,value,{expectedRevision:0}),1);
  assert.throws(()=>write(fixture.storage,value,{expectedRevision:0}),e=>e.code==='WORKSPACE_REVISION_CONFLICT');
  assert.equal(read(fixture.storage).storageRevision,1);
});
test('invalid new key is never replaced by a fresh workspace',()=>{
  const fixture=mem({[storageKey]:'{broken'});
  assert.throws(()=>read(fixture.storage),e=>e.code==='SKILL_STORAGE_EXISTING_INVALID');
  assert.equal(fixture.map.get(storageKey),'{broken');
});
test('quota and partial writes never alter original v1',()=>{
  const old=JSON.stringify(original()),fixture=mem({[LEGACY_WORKSPACE_KEY]:old});
  const value=original();value.storageRevision++;
  const denied={...fixture.storage,setItem(){throw Error('quota')}};
  assert.throws(()=>write(denied,value,{expectedRevision:4}),e=>e.code==='SKILL_STORAGE_WRITE_FAILED');
  assert.equal(fixture.map.get(LEGACY_WORKSPACE_KEY),old);
  const partial={...fixture.storage,setItem(k,v){fixture.map.set(k,v.slice(0,16))}};
  assert.throws(()=>write(partial,value,{expectedRevision:4}),e=>e.code==='SKILL_STORAGE_VERIFY_FAILED');
  assert.equal(fixture.map.get(LEGACY_WORKSPACE_KEY),old);
});
test('mixed v1 and v2 graph fields never persist',()=>{
  const fixture=mem();
  const value=original();value.storageRevision=1;
  value.conversations[0].state.pointerGraph.graph.skills=[];
  assert.throws(()=>write(fixture.storage,value,{expectedRevision:0}),e=>e.code==='INVALID_SKILL_WORKSPACE');
  assert.equal(fixture.map.has(storageKey),false);
});
