import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkspaceDataAccess} from '../../front/js/workspace/dataAccess.js';
import {createWorkspaceModel} from '../../front/js/workspace/model.js';
test('view flushes buffered edits; returns no local file blobs or executable IR',()=>{
  let flushed=false;
  const graph={version:1,blocks:[{id:'b',skillId:'file',x:1,y:2,expanded:false,values:{},file:{name:'a.txt',type:'text/plain',size:3,text:'abc',blob:new Blob(['abc'])}}],links:[]};
  const reader=createWorkspaceDataAccess({roomId:'r',model:{getSnapshot(){assert.ok(flushed);return structuredClone(graph)}},canvas:{flushPendingEdits(){flushed=true}},composer:{getDraft:()=>({parts:[{type:'skill',id:'write',label:'쓰기'}],attachments:[{name:'b',type:'text/plain',size:1,file:new Blob(['x'])}]})},data:{cache:{read:async()=>null,list:async()=>[]}},listSkills:()=>[{id:'write',name:'쓰기'}]});
  const state=reader.readCanvasSnapshot();assert.equal(state.source,'local-view');assert.equal(state.format,'beta-local-edit-graph-v1');assert.equal(state.snapshot.blocks[0].file.localBlobAvailable,true);assert.ok(!('blob' in state.snapshot.blocks[0].file));assert.ok(!('text' in state.snapshot.blocks[0].file));assert.ok(!('executionIR' in state));
  state.snapshot.blocks[0].x=100;assert.equal(graph.blocks[0].x,1);
  const draft=reader.readComposerDraft();assert.ok(!('file' in draft.attachments[0]));assert.equal(draft.parts[0].id,'write');
  const skills=reader.readSkillCatalog();skills.definitions[0].name='changed';assert.equal(reader.readSkillCatalog().definitions[0].name,'쓰기');
});
test('cached chat and context reads preserve cache source/revision and absence',async()=>{
  const calls=[];const cache={read:async(...args)=>{calls.push(['read',...args]);return null},list:async(...args)=>{calls.push(['list',...args]);return [{source:'server',revision:4}]}};
  const a=createWorkspaceDataAccess({roomId:'r',model:{getSnapshot:()=>({version:1,blocks:[],links:[]})},canvas:{flushPendingEdits(){}},composer:{getDraft:()=>({parts:[],attachments:[]})},data:{cache},listSkills:()=>[]});
  assert.equal(await a.readCached('contextData'),null);assert.equal((await a.readCached('chatRecord',{limit:7}))[0].revision,4);
  assert.deepEqual(calls,[['read','contextData','r','state'],['list','chatRecord','r',{limit:7}]]);
  await assert.rejects(a.readCached('not-a-cache-domain'),TypeError);
});
test('workspace model can inject a local presentation Skill resolver',()=>{
  const skill={id:'custom',fields:[],inputs:[],outputs:[]};const m=createWorkspaceModel({resolveSkill:id=>id==='custom'?skill:undefined});
  const block=m.addBlock('custom',{x:5,y:7});assert.equal(block.skillId,'custom');assert.equal(m.validateCurrent(),true);
  const snapshot=m.getSnapshot();snapshot.blocks[0].x=99;assert.equal(m.getBlock(block.id).x,5);
});
