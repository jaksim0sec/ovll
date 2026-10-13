import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSkillWorkspace, readSkillWorkspace, saveSkillWorkspace,
  SKILL_WORKSPACE_KEY, LEGACY_WORKSPACE_KEY, SkillStorageError
} from '../front/js/ovllSkillStorage.mjs';

function oldWorkspace() {
  return {
    schemaVersion:9, storageRevision:4,
    workspace:{id:'local', activeConversationId:'c_1'},
    sections:[{id:'sec',title:'Work'}],
    contextBundles:[{id:'ctx'}],
    pointerDefinitions:[{definitionId:'custom:review',version:1,purpose:'Review'}],
    conversations:[{id:'c_1',title:'Hello',state:{
      composerDraft:'@saved',messages:[{role:'user',text:'file',file:{localFileId:'file-a'}}],
      canvas:{workflow:{nodes:[{id:'visual_1',type:'custom'}],connections:[]},viewport:{scale:1}},
      pointerGraph:{graph:{graphId:'g_1',revision:4,nodes:[
        {nodeId:'n_1',definitionRef:{definitionId:'custom:review',version:1},
          settings:{nodeId:'literal user setting'}}],
        connections:[{from:{nodeId:'n_1',port:'out'},to:{nodeId:'n_2',port:'in'}}]},
        definitions:[{definitionId:'custom:review',version:1,purpose:'Review'}]},
      pointerRuns:[{runId:'r_1',nodes:[{nodeId:'n_1',status:'success',
        semanticFingerprint:'legacy-hash',outputs:{out:{inline:{nodeId:'opaque'}}}}]}]
    }}]
  };
}
function storage(entries={},denyWrites=false) {
  const entriesMap=new Map(Object.entries(entries));
  return {
    getItem(key){return entriesMap.get(key)??null;},
    setItem(key,value){
      if(denyWrites)throw Object.assign(new Error('QuotaExceededError'),{name:'QuotaExceededError'});
      entriesMap.set(key,String(value));
    },
    dump(){return Object.fromEntries(entriesMap)}
  };
}

test('old workspace converts only domain graph fields, leaves files and canvas opaque',()=>{
  const before=oldWorkspace(), copy=structuredClone(before);
  const migrated=normalizeSkillWorkspace(before);
  assert.deepEqual(before,copy);
  assert.equal(migrated.schemaVersion,10);
  assert.equal(migrated.storageRevision,4);
  assert.equal('pointerDefinitions' in migrated,false);
  assert.equal(migrated.skillDefinitions[0].definitionId,'custom:review');
  const c=migrated.conversations[0].state;
  assert.equal(c.pointerGraph.graph.skills[0].skillId,'n_1');
  assert.equal(c.pointerGraph.graph.skills[0].skillDefinitionRef.version,1);
  assert.equal(c.pointerGraph.graph.connections[0].from.skillId,'n_1');
  assert.equal(c.pointerRuns[0].skills[0].semanticFingerprint,'legacy-hash');
  assert.equal(c.pointerRuns[0].skills[0].outputs.out.inline.nodeId,'opaque');
  assert.equal(c.pointerGraph.graph.skills[0].settings.nodeId,'literal user setting');
  assert.deepEqual(c.canvas,before.conversations[0].state.canvas);
  assert.deepEqual(c.messages,before.conversations[0].state.messages);
  assert.deepEqual(normalizeSkillWorkspace(migrated),migrated);
});

test('valid Skill snapshot takes priority without rewriting legacy storage',()=>{
  const old=oldWorkspace();
  const fresh=normalizeSkillWorkspace(old);
  fresh.storageRevision=9;
  const oldBytes=JSON.stringify(old);
  const db=storage({[LEGACY_WORKSPACE_KEY]:oldBytes,[SKILL_WORKSPACE_KEY]:JSON.stringify(fresh)});
  const result=readSkillWorkspace(db);
  assert.equal(result.source,'skill-v2');
  assert.equal(result.snapshot.storageRevision,9);
  assert.equal(db.getItem(LEGACY_WORKSPACE_KEY),oldBytes);
});

test('first migration is validated and preserves legacy storage exactly',()=>{
  const old=oldWorkspace(),raw=JSON.stringify(old);
  const db=storage({[LEGACY_WORKSPACE_KEY]:raw});
  const migrated=readSkillWorkspace(db);
  assert.equal(migrated.source,'migrated');
  assert.equal(migrated.snapshot.conversations[0].state.pointerGraph.graph.skills[0].skillId,'n_1');
  assert.equal(db.getItem(LEGACY_WORKSPACE_KEY),raw);
  assert.equal(JSON.parse(db.getItem(SKILL_WORKSPACE_KEY)).schemaVersion,10);
  assert.deepEqual(readSkillWorkspace(db).snapshot,migrated.snapshot);
});

test('quota failure leaves original data intact and exposes read-only legacy snapshot',()=>{
  const old=oldWorkspace(),raw=JSON.stringify(old);
  const db=storage({[LEGACY_WORKSPACE_KEY]:raw},true);
  const result=readSkillWorkspace(db);
  assert.equal(result.source,'legacy-readonly');
  assert.equal(result.snapshot.schemaVersion,10);
  assert.equal(db.getItem(LEGACY_WORKSPACE_KEY),raw);
  assert.equal(db.getItem(SKILL_WORKSPACE_KEY),null);
});

test('invalid Skill payload never silently overwrites corrupt or legacy storage',()=>{
  const old=oldWorkspace(),raw=JSON.stringify(old);
  const invalid=JSON.stringify({schemaVersion:10,conversations:[]});
  const db=storage({[LEGACY_WORKSPACE_KEY]:raw,[SKILL_WORKSPACE_KEY]:invalid});
  const result=readSkillWorkspace(db);
  assert.equal(result.source,'legacy-readonly');
  assert.ok(result.warning);
  assert.equal(db.getItem(SKILL_WORKSPACE_KEY),invalid);
  assert.equal(db.getItem(LEGACY_WORKSPACE_KEY),raw);
});

test('ambiguous mixed old/new schema fails closed',()=>{
  const old=oldWorkspace();
  old.pointerDefinitions=[];
  old.skillDefinitions=[];
  assert.throws(()=>normalizeSkillWorkspace(old),e=>e instanceof SkillStorageError&&e.code==='MIXED_SKILL_WORKSPACE');
  const x=oldWorkspace();
  x.conversations[0].state.pointerGraph.graph.skills=[];
  assert.throws(()=>normalizeSkillWorkspace(x),/MIXED_SKILL_SCHEMA/);
});

test('v2 writes use compare-and-swap revisions, preserve legacy and never mutate inputs',()=>{
  const old=oldWorkspace(),raw=JSON.stringify(old);
  const db=storage({[LEGACY_WORKSPACE_KEY]:raw});
  const initial=readSkillWorkspace(db).snapshot;
  const copy=structuredClone(initial);
  const next=saveSkillWorkspace(db,initial,{expectedRevision:4});
  assert.equal(next.storageRevision,5);
  assert.deepEqual(initial,copy);
  assert.equal(db.getItem(LEGACY_WORKSPACE_KEY),raw);
  assert.throws(()=>saveSkillWorkspace(db,initial,{expectedRevision:4}),e=>e.code==='SKILL_WORKSPACE_REVISION_CONFLICT');
});

test('old snapshots never lose data if storage read fails',()=>{
  const original=oldWorkspace(),raw=JSON.stringify(original);
  const db=storage({[LEGACY_WORKSPACE_KEY]:raw});
  const damaged=oldWorkspace();
  damaged.conversations[0].state.pointerGraph.graph.nodes[0].nodeId='';
  db.setItem(SKILL_WORKSPACE_KEY,JSON.stringify(damaged));
  const result=readSkillWorkspace(db);
  assert.equal(result.source,'legacy-readonly');
  assert.equal(db.getItem(LEGACY_WORKSPACE_KEY),raw);
});
