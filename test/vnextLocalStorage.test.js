import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository,computeScope} from '../backend/vnext/graph.js';
import * as browserCore from '../front/js/vnextGraphCore.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function browser(){
  const values=new Map();
  const localStorage={getItem:k=>values.get(k)??null,
    setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const window={};
  const context={window,localStorage,console};
  vm.runInNewContext(read('front/js/workspaceStore.js'),context);
  vm.runInNewContext(read('front/js/vnextLocal.js'),context);
  const store=window.OvllWorkspaceStore;
  const local=window.createOvllVNextLocal({workspaceStore:store,loadCore:async()=>browserCore});
  return {store,local,values};
}
const definition={localKey:'summary',executorKind:'model_task',purpose:'Summarize',
  instruction:'Summarize text',inputs:[],outputs:[{name:'result',representation:'text'}]};
test('browser vNext graph uses the same semantic kernel as backend without PostgreSQL',()=>{
  assert.equal(browserCore.MemoryGraphRepository,MemoryGraphRepository);
  assert.equal(browserCore.computeScope,computeScope);
});
test('local GraphPatch persists into exported conversation, survives reload, preserves chat state',async()=>{
  const {store,local,values}=browser(),chat=store.getActiveConversation(),conversationId=chat.id;
  const graphId=local.graphId(conversationId);
  assert.equal((await local.state(conversationId)).graph.graph.revision,0);
  const patch={graphId,expectedGraphRevision:0,definitions:[definition],
    operations:[{op:'node.add',localNodeKey:'root',definitionRef:{localDefinitionKey:'summary'}}]};
  const applied=await local.turn({conversationId,graphId,
    actions:[{kind:'ir.applyPatch',localKey:'edit',args:{patch}}]});
  assert.equal(applied.results[0].status,'applied');
  assert.equal((await local.state(conversationId)).graph.graph.revision,1);
  const prior=store.getConversation(conversationId).state;
  store.updateConversationState(conversationId,{...prior,messages:[{role:'user',text:'hello'}]});
  assert.equal((await local.state(conversationId)).graph.graph.nodes.length,1);
  const exported=store.exportJSON();
  assert.equal(JSON.parse(exported).conversations.find(c=>c.id===conversationId).state.vnextGraph.graph.revision,1);
  store.reset();store.importJSON(exported);
  assert.equal((await local.state(conversationId)).graph.graph.revision,1);
  assert.equal(store.getConversation(conversationId).state.messages[0].text,'hello');
  assert.ok(values.has(store.storageKey));
});
test('stale graph writes fail closed and distinct conversations never share graphs',async()=>{
  const {store,local}=browser(),first=store.getActiveConversation().id,g=local.graphId(first);
  const patch={graphId:g,expectedGraphRevision:0,definitions:[definition],
    operations:[{op:'node.add',localNodeKey:'root',definitionRef:{localDefinitionKey:'summary'}}]};
  const args={conversationId:first,graphId:g,actions:[{kind:'ir.applyPatch',localKey:'a',args:{patch}}]};
  await local.turn(args);
  await assert.rejects(()=>local.turn(args),error=>error.code==='STALE_REVISION');
  assert.equal((await local.state(first)).graph.graph.revision,1);
  const section=store.getSnapshot().sections[0].id,ctx=store.getSnapshot().contextBundles[0].id;
  const second=store.createConversation(section,ctx,'Another');
  const other=await local.state(second.id);
  assert.equal(other.graph.graph.nodes.length,0);
  await assert.rejects(()=>local.turn({...args,conversationId:second.id}),
    /LOCAL_GRAPH_SCOPE_MISMATCH/);
  assert.equal((await local.state(first)).graph.graph.revision,1);
});
test('local mode is default and SQL-dependent runtime stays opt-in',()=>{
  const config=read('front/runtime-config.js'),server=read('server.js');
  assert.match(config,/vnextStorageMode:"local"/);
  assert.match(config,/vnextEnabled:true/);
  assert.doesNotMatch(server,/from ['"]\.\/backend\/vnext\/durable/);
  assert.match(read('backend/vnext/runtime.js'),/PostgresVNextStore/);
});
