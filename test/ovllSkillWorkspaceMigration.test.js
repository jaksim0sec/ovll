import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {migrateWorkspaceToSkills} from '../front/js/ovllSkillWorkspaceMigration.mjs';
const source=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
for(const file of ['workspace-node-v9.json','workspace-skill-v10.json'])test('one-way workspace import preserves topology, references and opaque content: '+file,()=>{
 const old=source(file),before=structuredClone(old),value=migrateWorkspaceToSkills(old),state=value.conversations[0].state;
 assert.equal(value.schemaVersion,11);assert.equal(value.storageRevision,2);
 assert.equal(state.canvas.workflow.skillNodes[0].id,'n_saved');
 assert.equal(state.skillGraph.graph.skillNodes[0].skillNodeId,'n_saved');
 assert.equal(state.skillRuns[0].skillNodes[0].skillNodeId,'n_saved');
 assert.equal(state.composerDraftParts[0].reference.skillNodeId,'n_saved');
 assert.deepEqual(state.skillGraph.graph.skillNodes[0].settings.payload,{nodeId:'opaque',skills:['opaque']});
 assert.deepEqual(old,before);assert.deepEqual(migrateWorkspaceToSkills(value),value);
});
test('mixed historical/native names and malformed IDs or endpoints fail without mutation',()=>{
 const old=source('workspace-node-v9.json'),before=structuredClone(old);
 old.conversations[0].state.skillGraph={};assert.throws(()=>migrateWorkspaceToSkills(old));
 assert.deepEqual(before.conversations[0].state.pointerGraph.graph.nodes[0].nodeId,'n_saved');
 const broken=source('workspace-node-v9.json');broken.conversations[0].state.canvas.workflow.nodes[0].id='';assert.throws(()=>migrateWorkspaceToSkills(broken));
 const end=source('workspace-node-v9.json');end.conversations[0].state.canvas.workflow.connections=[{from:{node:'n_saved'},to:{node:'n_saved',port:'x'}}];assert.throws(()=>migrateWorkspaceToSkills(end));
});
test('future workspace formats are never guessed or downconverted',()=>{const value=source('workspace-node-v9.json');value.schemaVersion=99;assert.throws(()=>migrateWorkspaceToSkills(value));});
test('real historical run snapshots, output bindings and coverage use the native contract after import',()=>{
 for(const file of ['workspace-node-v9.json','workspace-skill-v10.json']){
  const old=source(file),run=(old.conversations[0].state.pointerRuns||old.conversations[0].state.skillRuns)[0];
  run.snapshot=source('workspace-node-v9.json').conversations[0].state.pointerGraph;
  run.outputMap={words:{nodeId:'n_saved',port:'result'}};
  run.coverage={targets:[{nodeId:'n_saved',status:'success'}],complete:true};
  const migrated=migrateWorkspaceToSkills(old).conversations[0].state.skillRuns[0];
  assert.ok(Array.isArray(migrated.snapshot.graph.skillNodes),'embedded run snapshot uses the native contract');
  assert.equal(migrated.snapshot.graph.skillNodes[0].skillNodeId,'n_saved');
  assert.equal('definitions' in migrated.snapshot,false);
  assert.equal(migrated.outputMap.words.skillNodeId,'n_saved');
  assert.equal(migrated.coverage.targets[0].skillNodeId,'n_saved');
  assert.equal(migrated.skillNodes[0].outputs.values.result.inline,'猫');
 }
});
