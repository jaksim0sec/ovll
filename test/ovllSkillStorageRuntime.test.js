import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {read,write,storageKey,schemaVersion,LEGACY_WORKSPACE_KEY,PREVIOUS_SKILL_WORKSPACE_KEY} from '../front/js/ovllSkillStorageRuntime.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
function memory(seed={}){const data=new Map(Object.entries(seed));return{data,storage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v))}};}
for(const [name,key] of [['workspace-node-v9.json',LEGACY_WORKSPACE_KEY],['workspace-skill-v10.json',PREVIOUS_SKILL_WORKSPACE_KEY]])test('storage imports once into native runtime and preserves original bytes: '+name,()=>{
 const original=JSON.stringify(fixture(name)),m=memory({[key]:original}),loaded=read(m.storage);
 assert.equal(schemaVersion,11);assert.equal(loaded.schemaVersion,11);
 assert.equal(loaded.conversations[0].state.skillGraph.graph.skillNodes[0].skillNodeId,'n_saved');
 loaded.storageRevision++;assert.equal(write(m.storage,loaded,{expectedRevision:2}),3);
 assert.equal(m.data.get(key),original);assert.deepEqual(read(m.storage),loaded);
 assert.equal(JSON.parse(m.data.get(storageKey)).schemaVersion,11);
});
test('stale writers and newer historical tabs cannot overwrite current work',()=>{
 const m=memory(),value=read(memory({[LEGACY_WORKSPACE_KEY]:JSON.stringify(fixture('workspace-node-v9.json'))}).storage);
 value.storageRevision=1;write(m.storage,value,{expectedRevision:0});
 assert.throws(()=>write(m.storage,value,{expectedRevision:0}),e=>e.code==='WORKSPACE_REVISION_CONFLICT');
 const old=fixture('workspace-node-v9.json');old.storageRevision=10;m.data.set(LEGACY_WORKSPACE_KEY,JSON.stringify(old));
 assert.throws(()=>read(m.storage),e=>e.code==='SKILL_STORAGE_STALE_SOURCE');
});
test('invalid native storage never silently resets or overwrites the damaged data',()=>{
 const m=memory({[storageKey]:'{broken'});assert.throws(()=>read(m.storage));assert.equal(m.data.get(storageKey),'{broken');
});
test('quota, partial writes and source races preserve historical bytes and report failure',()=>{
 const raw=JSON.stringify(fixture('workspace-node-v9.json')),m=memory({[LEGACY_WORKSPACE_KEY]:raw}),value=read(m.storage);value.storageRevision++;
 assert.throws(()=>write({...m.storage,setItem(){throw Error('quota');}},value,{expectedRevision:2}),e=>e.code==='SKILL_STORAGE_WRITE_FAILED');
 assert.equal(m.data.get(LEGACY_WORKSPACE_KEY),raw);
 assert.throws(()=>write({...m.storage,setItem(k,v){m.data.set(k,v.slice(0,12));}},value,{expectedRevision:2}),e=>e.code==='SKILL_STORAGE_VERIFY_FAILED');
 assert.equal(m.data.get(LEGACY_WORKSPACE_KEY),raw);
});
test('mixed domain fields do not enter native storage',()=>{
 const m=memory(),value=read(memory({[LEGACY_WORKSPACE_KEY]:JSON.stringify(fixture('workspace-node-v9.json'))}).storage);
 value.storageRevision=1;value.conversations[0].state.skillGraph.graph.nodes=[];
 assert.throws(()=>write(m.storage,value,{expectedRevision:0}));assert.equal(m.data.has(storageKey),false);
});
