import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as skillStorage from '../front/js/ovllSkillStorageRuntime.mjs';
const source=readFileSync(new URL('../front/js/workspaceStore.js',import.meta.url),'utf8');
function create(seed={}){
 const data=new Map(Object.entries(seed));
 const localStorage={getItem:k=>data.get(k)??null,
  setItem:(k,v)=>data.set(k,String(v))};
 const window={OvllSkillStorageRuntime:skillStorage};
 vm.runInNewContext(source,{window,localStorage,Date,Math,console});
 return {store:window.OvllWorkspaceStore,data,localStorage};
}
const graph=()=>({skillDefinitions:[{definitionId:'d1',version:1,purpose:'Read',
 executorKind:'model_task',instruction:'Read',inputs:[],outputs:[]}],
 graph:{graphId:'g_c',revision:0,skills:[],connections:[]}});
test('browser workspace facade writes and reads exact v2 graph, while retaining runtime legacy adapter',()=>{
 const {store,data}=create();
 const chat=store.getActiveConversation().id;
 const saved=store.updateConversationSkillGraph(chat,graph());
 assert.equal(saved.graph.graphId,'g_c');
 assert.equal(saved.graph.skills.length,0);
 assert.equal('nodes' in saved.graph,false);
 const selected=store.getSkillConversation(chat);
 assert.equal(selected.state.skillGraph.graph.graphId,'g_c');
 assert.equal(selected.state.skillGraph.graph.skills.length,0);
 assert.equal(selected.state.skillGraph.skillDefinitions[0].definitionId,'d1');
 assert.equal(store.getConversation(chat).state.pointerGraph.graph.graphId,'g_c');
 assert.equal(store.storageKey,'ovll:workspace:skill:v2');
 const onDisk=JSON.parse(data.get(store.storageKey));
 assert.ok('skillGraph' in onDisk.conversations[0].state);
 assert.equal('pointerGraph' in onDisk.conversations[0].state,false);
});
test('Skill API rejects mixed v1 and v2 fields rather than losing old graph',()=>{
 const {store}=create(),chat=store.getActiveConversation().id;
 const mixed=graph();mixed.graph.nodes=[];
 assert.throws(()=>store.updateConversationSkillGraph(chat,mixed));
 assert.equal(store.getConversation(chat).state.pointerGraph,null);
});
