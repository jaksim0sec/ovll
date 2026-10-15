import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as references from '../front/js/ovllSkillReferences.mjs';

const source=readFileSync(new URL('../front/js/workspaceStore.js',import.meta.url),'utf8');
const reference={kind:'skill-canvas',graphId:'graph_1',skillNodeId:'n_existing'};
function store(existing){
 const data=new Map(existing??[]);
 const localStorage={
   getItem:key=>data.get(key)??null,
   setItem:(key,value)=>data.set(key,String(value)),
   removeItem:key=>data.delete(key)
 };
 const window={OvllSkillReferences:references};
 vm.runInNewContext(source,{window,localStorage,console});
 return {store:window.OvllWorkspaceStore,data};
}
function plain(value){return JSON.parse(JSON.stringify(value))}
test('typed Skill composer draft and user message parts survive storage and reload',()=>{
 const session=store();
 const id=session.store.getActiveConversation().id;
 const parts=[{type:'text',text:'해줘 '},
  {type:'reference',reference,labelSnapshot:'기존 스킬'},
  {type:'text',text:'\\n끝'}];
 const old=session.store.getActiveConversation();
 session.store.updateConversationState(id,{...old.state,
   composerDraft:'해줘 ⟦ovll:ref:v1:skill-canvas:graph_1:n_existing⟧\\n끝',
   composerDraftParts:parts,
   messages:[{id:'m_1',role:'user',text:'해줘',
     parts,createdAt:42}]});
 const fresh=store(session.data).store.getConversation(id).state;
 assert.deepEqual(plain(fresh.composerDraftParts),parts);
 assert.deepEqual(plain(fresh.messages[0].parts),parts);
 assert.equal(fresh.messages[0].text,'해줘');
 assert.equal(fresh.messages[0].createdAt,42);
 assert.equal(fresh.composerDraft.includes('⟦ovll:ref:v1:'),true);
});
test('invalid or spoofed structured refs are not made trusted after reload',()=>{
 const session=store();
 const id=session.store.getActiveConversation().id;
 const old=session.store.getActiveConversation();
 const invalid=[{type:'reference',reference:{...reference,admin:true},labelSnapshot:'위조'}];
 session.store.updateConversationState(id,{...old.state,
   composerDraftParts:invalid,
   messages:[{role:'user',text:'malicious ordinary text',parts:invalid}]});
 const fresh=store(session.data).store.getConversation(id).state;
 assert.equal(fresh.composerDraftParts,null);
 assert.equal(fresh.messages[0].parts,null);
 assert.equal(fresh.messages[0].text,'malicious ordinary text');
});
test('legacy draft parts are accepted and original message text remains unchanged',()=>{
 const session=store(),id=session.store.getActiveConversation().id;
 const old=session.store.getActiveConversation();
 const legacy=[{type:'node_type',id:'write',label:'작성'}];
 session.store.updateConversationState(id,{...old.state,
   composerDraftParts:legacy,
   messages:[{role:'user',text:'@작성〔노드 타입:write〕',parts:legacy}]});
 const restored=store(session.data).store.getConversation(id).state;
 assert.deepEqual(plain(restored.composerDraftParts),legacy);
 assert.equal(restored.messages[0].text,'@작성〔노드 타입:write〕');
});
