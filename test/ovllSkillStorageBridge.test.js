import test from 'node:test';
import assert from 'node:assert/strict';
import {stageSkillWorkspaceCopy,SkillStorageBridgeError,LEGACY_WORKSPACE_KEY,SKILL_WORKSPACE_KEY}
  from '../front/js/ovllSkillStorageBridge.mjs';

function fixture() {
  return {schemaVersion:9,storageRevision:3,workspace:{id:'local'},
    pointerDefinitions:[],
    conversations:[{id:'c1',state:{canvas:{workflow:{nodes:[],connections:[]}},
      pointerGraph:{graph:{graphId:'g1',revision:0,nodes:[],connections:[]},definitions:[]},
      pointerRuns:[],messages:[{role:'user',text:'hello'}]}}]};
}
function storage(seed={},custom={}) {
  const entries=new Map(Object.entries(seed));
  const api={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,String(v)),
    removeItem:k=>entries.delete(k)};
  return {entries,api:{...api,...custom}};
}
const errs=code=>e=>e instanceof SkillStorageBridgeError&&e.code===code;

test('creates a verified v2 copy without ever replacing the v1 workspace',()=>{
  const original=JSON.stringify(fixture());
  const s=storage({[LEGACY_WORKSPACE_KEY]:original});
  const result=stageSkillWorkspaceCopy(s.api);
  assert.equal(result.status,'staged');
  assert.equal(s.entries.get(LEGACY_WORKSPACE_KEY),original);
  const skill=JSON.parse(s.entries.get(SKILL_WORKSPACE_KEY));
  assert.equal(skill.schemaVersion,10);
  assert.equal(skill.storageRevision,3);
  assert.deepEqual(skill.conversations[0].state.skillGraph.graph.skills,[]);
  assert.equal(skill.conversations[0].state.messages[0].text,'hello');
});

test('repeated staging is idempotent and does not change either stored value',()=>{
  const s=storage({[LEGACY_WORKSPACE_KEY]:JSON.stringify(fixture())});
  stageSkillWorkspaceCopy(s.api);
  const prior=Object.fromEntries(s.entries);
  const result=stageSkillWorkspaceCopy(s.api);
  assert.equal(result.status,'already-staged');
  assert.deepEqual(Object.fromEntries(s.entries),prior);
});

test('quota failure leaves original workspace byte-identical and never claims success',()=>{
  const original=JSON.stringify(fixture());
  const s=storage({[LEGACY_WORKSPACE_KEY]:original});
  const guarded={...s.api,setItem(){throw new Error('QuotaExceededError')}};
  assert.throws(()=>stageSkillWorkspaceCopy(guarded),errs('SKILL_STORAGE_WRITE_FAILED'));
  assert.equal(s.entries.get(LEGACY_WORKSPACE_KEY),original);
  assert.equal(s.entries.has(SKILL_WORKSPACE_KEY),false);
});

test('readback mismatch detects partial writes; original workspace remains safe',()=>{
  const original=JSON.stringify(fixture());
  const s=storage({[LEGACY_WORKSPACE_KEY]:original});
  const storageWithPartialWrite={...s.api,setItem(k,v){s.entries.set(k,String(v).slice(0,17))}};
  assert.throws(()=>stageSkillWorkspaceCopy(storageWithPartialWrite),errs('SKILL_STORAGE_VERIFY_FAILED'));
  assert.equal(s.entries.get(LEGACY_WORKSPACE_KEY),original);
  assert.notEqual(s.entries.get(SKILL_WORKSPACE_KEY),original);
});

test('invalid or incomplete existing v2 copy never gets overwritten silently',()=>{
  const legacy=JSON.stringify(fixture()),broken='{oops';
  const s=storage({[LEGACY_WORKSPACE_KEY]:legacy,[SKILL_WORKSPACE_KEY]:broken});
  assert.throws(()=>stageSkillWorkspaceCopy(s.api),errs('SKILL_STORAGE_EXISTING_INVALID'));
  assert.equal(s.entries.get(SKILL_WORKSPACE_KEY),broken);
  assert.equal(s.entries.get(LEGACY_WORKSPACE_KEY),legacy);
});

test('v2 key containing legacy-shaped JSON is rejected rather than silently upgraded',()=>{
  const legacy=JSON.stringify(fixture()),fakeCopy=JSON.stringify(fixture());
  const s=storage({[LEGACY_WORKSPACE_KEY]:legacy,[SKILL_WORKSPACE_KEY]:fakeCopy});
  assert.throws(()=>stageSkillWorkspaceCopy(s.api),errs('SKILL_STORAGE_EXISTING_INVALID'));
  assert.equal(s.entries.get(LEGACY_WORKSPACE_KEY),legacy);
  assert.equal(s.entries.get(SKILL_WORKSPACE_KEY),fakeCopy);
});

test('missing legacy source is a no-op; malformed legacy source never mutates storage',()=>{
  const blank=storage();assert.equal(stageSkillWorkspaceCopy(blank.api).status,'no-source');
  const malformed=storage({[LEGACY_WORKSPACE_KEY]:'{not json'});
  assert.throws(()=>stageSkillWorkspaceCopy(malformed.api),errs('SKILL_STORAGE_LEGACY_INVALID'));
  assert.equal(malformed.entries.has(SKILL_WORKSPACE_KEY),false);
});

test('an active v1 revision changed during staging aborts rather than writing a stale copy',()=>{
  const first=JSON.stringify(fixture());
  const second=JSON.stringify({...fixture(),storageRevision:4});
  const s=storage({[LEGACY_WORKSPACE_KEY]:first});
  let reads=0;
  const racing={...s.api,getItem(key){if(key===LEGACY_WORKSPACE_KEY&&++reads===2)s.entries.set(key,second);return s.api.getItem(key)}};
  assert.throws(()=>stageSkillWorkspaceCopy(racing),errs('SKILL_STORAGE_STALE_SOURCE'));
  assert.equal(s.entries.get(SKILL_WORKSPACE_KEY),undefined);
  assert.equal(s.entries.get(LEGACY_WORKSPACE_KEY),second);
});
