import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSkillSnapshot,normalizeSkillPatch,normalizeSkillRun,assertCanonicalSkillSnapshot,SkillSchemaError} from '../front/js/ovllSkillCodec.mjs';

const legacy=()=>({graph:{graphId:'g_1',revision:4,nodes:[
  {nodeId:'n_1',definitionRef:{definitionId:'builtin:write',version:1},
    settings:{nodeId:'user-data',nodes:['untouched']},inputBindings:{in:{inline:{nodeId:'user-value'}}}}
],connections:[{id:'link_1',kind:'data',from:{nodeId:'n_1',port:'out'},to:{nodeId:'n_2',port:'in'}}]},
 definitions:[{definitionId:'builtin:write',version:1,purpose:'Write'}]});
const error=(code,path)=>e=>e instanceof SkillSchemaError&&e.code===code&&(!path||e.path===path);

test('legacy graph converts only structural fields and keeps original values',()=>{
 const original=legacy(),unchanged=structuredClone(original),value=normalizeSkillSnapshot(original);
 assert.deepEqual(original,unchanged);
 assert.equal(value.graph.skills[0].skillId,'n_1');
 assert.equal(value.graph.skills[0].skillDefinitionRef.definitionId,'builtin:write');
 assert.equal(value.graph.skills[0].settings.nodeId,'user-data');
 assert.equal(value.graph.skills[0].settings.nodes[0],'untouched');
 assert.equal(value.graph.skills[0].inputBindings.in.inline.nodeId,'user-value');
 assert.equal(value.graph.connections[0].from.skillId,'n_1');
 assert.equal(value.graph.connections[0].from.port,'out');
 assert.equal(value.graph.connections[0].to.skillId,'n_2');
 assert.deepEqual(value.skillDefinitions,original.definitions);
 assert.equal(value.graph.revision,4);
 assert.equal('nodes' in value.graph,false);
 assert.equal('definitions' in value,false);
 assert.equal(assertCanonicalSkillSnapshot(value),true);
});

test('Skill graph normalizer is idempotent and deep-cloned',()=>{
 const first=normalizeSkillSnapshot(legacy()),second=normalizeSkillSnapshot(first);
 assert.deepEqual(first,second);assert.notStrictEqual(first,second);
 assert.notStrictEqual(first.graph.skills[0],second.graph.skills[0]);
});

test('mixed legacy and canonical snapshots reject instead of choosing fields',()=>{
 let value=legacy();value.graph.skills=[];
 assert.throws(()=>normalizeSkillSnapshot(value),error('MIXED_SKILL_SCHEMA','/graph'));
 value=legacy();value.skillDefinitions=[];
 assert.throws(()=>normalizeSkillSnapshot(value),error('MIXED_SKILL_SCHEMA','/'));
 value=legacy();delete value.graph.nodes;value.graph.skills=[];
 assert.throws(()=>normalizeSkillSnapshot(value),error('MIXED_SKILL_SCHEMA','/'));
 value=legacy();value.graph.nodes[0].skillId='n_1';
 assert.throws(()=>normalizeSkillSnapshot(value),error('MIXED_SKILL_SCHEMA','/graph/nodes/0'));
 value=legacy();value.graph.connections[0].from.skillId='n_1';
 assert.throws(()=>normalizeSkillSnapshot(value),error('MIXED_SKILL_SCHEMA','/graph/connections/0/from'));
});

test('invalid identifiers and too large snapshots reject without mutation',()=>{
 let value=legacy();value.graph.nodes[0].nodeId='';
 assert.throws(()=>normalizeSkillSnapshot(value),error('INVALID_SKILL_ID','/graph/nodes/0/nodeId'));
 value=legacy();value.graph.connections[0].to.nodeId=42;
 assert.throws(()=>normalizeSkillSnapshot(value),error('INVALID_SKILL_ID','/graph/connections/0/to/nodeId'));
 value=legacy();value.graph.nodes=Array.from({length:65},(_,i)=>({...value.graph.nodes[0],nodeId:'old_'+i}));
 assert.throws(()=>normalizeSkillSnapshot(value),error('SKILL_SNAPSHOT_TOO_LARGE','/graph'));
 assert.equal(value.graph.nodes.length,65);
});

test('canonical graph validation rejects embedded legacy aliases',()=>{
 const a=normalizeSkillSnapshot(legacy());a.graph.skills[0].nodeId='extra';
 assert.throws(()=>assertCanonicalSkillSnapshot(a),error('MIXED_SKILL_SCHEMA','/graph/skills/0'));
 delete a.graph.skills[0].nodeId;a.graph.connections[0].from.nodeId='extra';
 assert.throws(()=>assertCanonicalSkillSnapshot(a),error('MIXED_SKILL_SCHEMA','/graph/connections/0/from'));
 delete a.graph.connections[0].from.nodeId;delete a.graph.skills[0].skillId;
 a.graph.skills[0].nodeId='old';
 assert.throws(()=>assertCanonicalSkillSnapshot(a),error('UNEXPECTED_LEGACY_SCHEMA','/graph/skills/0'));
});

test('Patch converter changes only operations, selectors and definition references',()=>{
 const before={graphId:'g_1',expectedGraphRevision:4,definitions:[],operations:[
  {op:'node.add',localNodeKey:'tmp',definitionRef:{definitionId:'builtin:write',version:1},settings:{nodeId:'keep'}},
  {op:'node.update',nodeId:'n_1',settings:{nodes:'keep'}},
  {op:'link.add',kind:'data',from:{node:{localNodeKey:'tmp'},port:'out'},to:{node:{nodeId:'n_1'},port:'in'}},
  {op:'node.delete',nodeRef:{nodeId:'n_9'}}
 ]};
 const saved=structuredClone(before),after=normalizeSkillPatch(before);
 assert.deepEqual(before,saved);assert.deepEqual(normalizeSkillPatch(after),after);
 assert.equal(after.operations[0].op,'skill.add');
 assert.equal(after.operations[0].localSkillKey,'tmp');
 assert.equal(after.operations[0].settings.nodeId,'keep');
 assert.equal(after.operations[0].skillDefinitionRef.version,1);
 assert.equal(after.operations[1].skillId,'n_1');
 assert.equal(after.operations[1].settings.nodes,'keep');
 assert.equal(after.operations[2].from.skill.localSkillKey,'tmp');
 assert.equal(after.operations[2].to.skill.skillId,'n_1');
 assert.equal(after.operations[3].skillRef.skillId,'n_9');
 assert.deepEqual(after.skillDefinitions,[]);
});

test('Patch converter rejects mixed selectors and unsupported operations',()=>{
 const patch={graphId:'g',operations:[{op:'node.delete',nodeId:'old',skillId:'new'}]};
 assert.throws(()=>normalizeSkillPatch(patch),error('MIXED_SKILL_SCHEMA'));
 assert.throws(()=>normalizeSkillPatch({graphId:'g',operations:[{op:'node.unknown'}]}),
   error('INVALID_SKILL_OPERATION'));
});

test('Run converter preserves opaque fingerprints, targets and output content',()=>{
 const old={runId:'r',nodes:[{nodeId:'n_1',status:'success',semanticFingerprint:'sha',
  outputs:{result:{inline:{nodeId:'ordinary-payload'}}}}],
  targets:['n_1'],deliverableTargets:['n_1'],metadata:{nodeId:'ordinary-data'}};
 const now=normalizeSkillRun(old);
 assert.equal(now.skills[0].skillId,'n_1');
 assert.equal(now.skills[0].semanticFingerprint,'sha');
 assert.equal(now.skills[0].outputs.result.inline.nodeId,'ordinary-payload');
 assert.deepEqual(now.targets,['n_1']);
 assert.deepEqual(now.deliverableTargets,['n_1']);
 assert.deepEqual(now.metadata,old.metadata);
 assert.deepEqual(normalizeSkillRun(now),now);
});
