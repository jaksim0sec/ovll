import test from 'node:test';
import assert from 'node:assert/strict';
import {migrateWorkspaceToSkills,SkillWorkspaceMigrationError} from '../front/js/ovllSkillWorkspaceMigration.mjs';

function legacyWorkspace() {
  return {schemaVersion:9,storageRevision:7,
    workspace:{id:'local',activeConversationId:'chat_a'},
    sections:[{id:'section_a',title:'Examples'}],
    contextBundles:[],
    pointerDefinitions:[{definitionId:'custom:analysis',version:1,purpose:'Analysis'}],
    conversations:[{id:'chat_a',title:'Example',state:{
      canvas:{workflow:{
        nodes:[{id:'file_1',type:'file',x:15,y:40,data:{nodeId:'literal payload'}},
          {id:'analysis_1',type:'pointer:custom:analysis',x:110,y:40,data:{params:{nodes:['keep']}}}],
        connections:[{id:'edge1',from:{node:'file_1',port:'out'},to:{node:'analysis_1',port:'in'}}]
      },viewport:{scale:0.8,offset:{x:80,y:20}}},
      pointerGraph:{graph:{graphId:'g_1',revision:4,nodes:[
        {nodeId:'analysis_1',definitionRef:{definitionId:'custom:analysis',version:1},
          settings:{nodes:'user-data'}}
      ],connections:[]},definitions:[{definitionId:'custom:analysis',version:1,purpose:'Analysis'}]},
      pointerRuns:[{runId:'run1',nodes:[{nodeId:'analysis_1',status:'success',
        semanticFingerprint:'legacy-fingerprint',outputs:{text:{nodeId:'opaque output'}}}],
        targets:['analysis_1'],metadata:{nodes:'user metadata'}}],
      messages:[{role:'user',text:'unchanged'}],
      composerDraft:'hello',composerDraftParts:[{type:'text',text:'hello'}]
    }}],
    metadata:{nodeId:'opaque',nodes:['keep']}
  };
}
function isError(code){return error=>error instanceof SkillWorkspaceMigrationError&&error.code===code;}

test('whole workspace snapshot migrates structurally without changing IDs or payloads',()=>{
  const raw=legacyWorkspace(),original=structuredClone(raw);
  const now=migrateWorkspaceToSkills(raw);
  assert.deepEqual(raw,original);
  assert.equal(now.schemaVersion,10);
  assert.equal(now.storageRevision,7);
  assert.equal(now.workspace.activeConversationId,'chat_a');
  assert.deepEqual(now.metadata,raw.metadata);
  assert.deepEqual(now.skillDefinitions,raw.pointerDefinitions);
  assert.ok(!('pointerDefinitions' in now));
  const state=now.conversations[0].state;
  assert.equal(state.canvas.workflow.skills[0].skillId,'file_1');
  assert.equal(state.canvas.workflow.skills[1].skillId,'analysis_1');
  assert.equal(state.canvas.workflow.skills[0].data.nodeId,'literal payload');
  assert.deepEqual(state.canvas.workflow.skills[1].data.params.nodes,['keep']);
  assert.equal(state.canvas.workflow.connections[0].from.skillId,'file_1');
  assert.equal(state.canvas.workflow.connections[0].to.skillId,'analysis_1');
  assert.equal(state.canvas.viewport.scale,0.8);
  assert.equal(state.skillGraph.graph.skills[0].skillId,'analysis_1');
  assert.equal(state.skillGraph.graph.skills[0].settings.nodes,'user-data');
  assert.equal(state.skillRuns[0].skills[0].semanticFingerprint,'legacy-fingerprint');
  assert.equal(state.skillRuns[0].skills[0].outputs.text.nodeId,'opaque output');
  assert.equal(state.skillRuns[0].metadata.nodes,'user metadata');
  assert.equal(state.messages[0].text,'unchanged');
  assert.deepEqual(state.composerDraftParts,[{type:'text',text:'hello'}]);
  assert.equal('pointerGraph' in state,false);
  assert.equal('pointerRuns' in state,false);
});

test('canonical output is idempotent and fresh-cloned on repeated import',()=>{
  const first=migrateWorkspaceToSkills(legacyWorkspace());
  const second=migrateWorkspaceToSkills(first);
  assert.deepEqual(first,second);
  assert.notStrictEqual(first.conversations[0],second.conversations[0]);
});

test('empty canvas is valid and unrelated function assets remain untouched',()=>{
  const raw=legacyWorkspace();
  raw.conversations[0].state.canvas.workflow={nodes:[],connections:[]};
  raw.conversations[0].state.savedFunction={nodeId:'function payload'};
  raw.conversations[0].state.pointerGraph=null;
  raw.conversations[0].state.pointerRuns=[];
  const result=migrateWorkspaceToSkills(raw);
  assert.deepEqual(result.conversations[0].state.canvas.workflow.skills,[]);
  assert.deepEqual(result.conversations[0].state.savedFunction,raw.conversations[0].state.savedFunction);
});

test('mixed old/new persisted field names are errors; original snapshot stays untouched',()=>{
  const raw=legacyWorkspace();
  raw.conversations[0].state.skillGraph={};
  const before=structuredClone(raw);
  assert.throws(()=>migrateWorkspaceToSkills(raw),isError('MIXED_SKILL_WORKSPACE'));
  assert.deepEqual(raw,before);
  delete raw.conversations[0].state.skillGraph;
  raw.conversations[0].state.canvas.workflow.skills=[];
  assert.throws(()=>migrateWorkspaceToSkills(raw),isError('MIXED_SKILL_WORKSPACE'));
  delete raw.conversations[0].state.canvas.workflow.skills;
  raw.skillDefinitions=[];
  assert.throws(()=>migrateWorkspaceToSkills(raw),isError('MIXED_SKILL_WORKSPACE'));
});

test('malformed canvas endpoints or absent IDs fail closed',()=>{
  const raw=legacyWorkspace();
  raw.conversations[0].state.canvas.workflow.connections[0].from.node='';
  assert.throws(()=>migrateWorkspaceToSkills(raw),isError('INVALID_SKILL_WORKSPACE_ID'));
  const invalid=legacyWorkspace();delete invalid.conversations[0].state.canvas.workflow.nodes[0].id;
  assert.throws(()=>migrateWorkspaceToSkills(invalid),isError('INVALID_SKILL_WORKSPACE_ID'));
});

test('unknown future workspace format never downconverts silently',()=>{
  const raw=legacyWorkspace();raw.schemaVersion=40;
  assert.throws(()=>migrateWorkspaceToSkills(raw),isError('UNSUPPORTED_SKILL_WORKSPACE_VERSION'));
});
