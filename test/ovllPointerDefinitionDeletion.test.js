import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
const load=path=>readFileSync(new URL('../front/js/'+path+'.js',import.meta.url),'utf8');
const def=(key)=>({localKey:key,purpose:'Generate Japanese vocabulary',instruction:'Generate wordlist '+key,
 executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'words',representation:'text'}],
 presentation:{name:'일본어 단어장 '+key,iconKey:'custom',color:'#7C6CF2'}});
function fixture(){
 const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)};
 const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)}};
 vm.runInNewContext(load('workspaceStore'),{window,localStorage:storage,console});
 vm.runInNewContext(load('ovllPointerLocal'),{window,console});
 const store=window.OvllWorkspaceStore,local=window.createOvllPointerLocal({workspaceStore:store,
  loadCore:async()=>({MemoryGraphRepository}),loadCatalog:async()=>getPointerCatalog()});
 return {window,store,local};
}
const patch=(graphId,revision,definitions,operations)=>({
 graphId,expectedGraphRevision:revision,definitions,operations
});
test('unused custom definitions can be deleted atomically; they stay gone across conversations and reload',async()=>{
 const {store,local}=fixture(),a=store.getActiveConversation().id,graphId=local.graphId(a);
 const create=await local.turn({conversationId:a,graphId,actions:[{localKey:'create',
   kind:'ir.applyPatch',args:{patch:patch(graphId,0,[def('a'),def('b')],[
    {op:'node.add',localNodeKey:'keep',definitionRef:{localDefinitionKey:'b'}}])}}]});
 const removeId=create.results[0].createdRefs['definition:a'];
 const keepId=create.results[0].createdRefs['definition:b'];
 assert.equal(store.getPointerDefinitions().length,2);
 const unused={definitionId:removeId,version:1};
 const removePatch=patch(graphId,1,[],[{op:'definition.delete',definitionRef:unused}]);
 assert.equal(createContractValidation().validateTurn({actions:[{localKey:'remove',kind:'ir.applyPatch',
   args:{patch:removePatch}}]}),true);
 const removed=await local.turn({conversationId:a,graphId,actions:[{localKey:'remove',
   kind:'ir.applyPatch',args:{patch:removePatch}}]});
 assert.equal(removed.results[0].status,'applied');
 assert.ok(!store.getPointerDefinitions().some(d=>d.definitionId===removeId));
 assert.ok(store.getPointerDefinitions().some(d=>d.definitionId===keepId));
 const b=store.createConversation({title:'another'}).id;
 assert.ok(!(await local.state(b)).graph.definitions.some(d=>d.definitionId===removeId));
 assert.ok((await local.state(b)).graph.definitions.some(d=>d.definitionId===keepId));
 store.importJSON(store.exportJSON());
 assert.ok(!store.getPointerDefinitions().some(d=>d.definitionId===removeId));
 assert.equal((await local.state(a)).graph.graph.nodes.length,1);
});
test('definition deletion is rejected while an instance still uses it; removal follows links and nodes',async()=>{
 const repo=new MemoryGraphRepository(),graphId='g_delete_linked';
 repo.create('local',graphId);
 const consumer={...def('b'),inputs:[{name:'in',role:'input',representation:'text'}]};
 const result=repo.apply('local',patch(graphId,0,[def('a'),consumer],[
  {op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'a'}},
  {op:'node.add',localNodeKey:'b',definitionRef:{localDefinitionKey:'b'}},
  {op:'link.add',localLinkKey:'connect',kind:'data',
   from:{node:{localNodeKey:'a'},port:'result'},to:{node:{localNodeKey:'b'},port:'in'}}]));
 const a=result.createdRefs['definition:a'],aNode=result.createdRefs['node:a'];
 const before=repo.get('local',graphId),link=before.graph.connections[0].id;
 assert.throws(()=>repo.apply('local',patch(graphId,1,[],[
  {op:'definition.delete',definitionRef:{definitionId:a,version:1}}])),
  e=>e.code==='DEFINITION_IN_USE');
 assert.equal(repo.get('local',graphId).graph.revision,1,'no partial deletion');
 const applied=repo.apply('local',patch(graphId,1,[],[
  {op:'link.remove',linkId:link},
  {op:'node.delete',nodeId:aNode},
  {op:'definition.delete',definitionRef:{definitionId:a,version:1}}
 ]));
 assert.equal(applied.graphRef.revision,2);
 assert.equal(repo.get('local',graphId).graph.nodes.length,1);
 assert.ok(!repo.get('local',graphId).definitions.some(d=>d.definitionId===a));
});
test('other conversations referencing a definition block deletion without touching saved graphs',async()=>{
 const {store,local}=fixture(),a=store.getActiveConversation().id,gA=local.graphId(a);
 const created=await local.turn({conversationId:a,graphId:gA,actions:[{localKey:'create',
  kind:'ir.applyPatch',args:{patch:patch(gA,0,[def('a')],[])}}]});
 const defId=created.results[0].createdRefs['definition:a'];
 const b=store.createConversation({title:'other'}).id,gB=local.graphId(b);
 const added=await local.turn({conversationId:b,graphId:gB,actions:[{localKey:'instance',
  kind:'ir.applyPatch',args:{patch:patch(gB,0,[],[
   {op:'node.add',localNodeKey:'n',definitionRef:{definitionId:defId,version:1}}
  ])}}]});
 assert.equal(added.results[0].status,'applied');
 const before=store.exportJSON();
 await assert.rejects(local.turn({conversationId:a,graphId:gA,actions:[{
   localKey:'delete',kind:'ir.applyPatch',args:{patch:patch(gA,1,[],[
    {op:'definition.delete',definitionRef:{definitionId:defId,version:1}}
   ])}}]}),e=>e.message==='DEFINITION_IN_USE_OTHER_CONVERSATION');
 assert.equal(store.exportJSON(),before);
 assert.equal((await local.state(b)).graph.graph.nodes.length,1);
 assert.ok(store.getPointerDefinitions().some(d=>d.definitionId===defId));
});
test('builtin definitions are immutable and deleting an unknown definition never succeeds',()=>{
 const repo=new MemoryGraphRepository(),graphId='g_immutable';
 repo.create('local',graphId);
 for(const [ref,code] of [[{definitionId:'builtin:write',version:1},'BUILTIN_DEFINITION_IMMUTABLE'],
  [{definitionId:'d_no',version:1},'UNKNOWN_DEFINITION']]){
  assert.throws(()=>repo.apply('local',patch(graphId,0,[],[
    {op:'definition.delete',definitionRef:ref}])),e=>e.code===code);
  assert.equal(repo.get('local',graphId).graph.revision,0);
 }
});
