import test from 'node:test';
import assert from 'node:assert/strict';
import {
  legacySkillEvidenceFingerprint,verifyLegacySkillEvidence
} from '../front/js/ovllSkillEvidence.mjs';
import {nodeSemanticFingerprint} from '../front/js/ovllPointerResults.mjs';
import {normalizeSkillSnapshot} from '../front/js/ovllSkillCodec.mjs';

const definition={definitionId:'builtin:research',version:1,purpose:'Research',
 instruction:'Research from inputs',executorKind:'model_task',inputs:[],
 outputs:[{name:'result',representation:'text'}]};
function old(){
 return {definitions:[structuredClone(definition)],graph:{
  graphId:'g',revision:3,nodes:[{
    nodeId:'n_old',definitionRef:{definitionId:'builtin:research',version:1},
    settings:{request:'Original request'},inputBindings:{}
  }],connections:[]}};
}
const produced={status:'produced',values:{result:{inline:'Original answer'}}};

test('legacy semantic fingerprint is byte-identical through Skill v2 graph naming',()=>{
 const before=old(),canonical=normalizeSkillSnapshot(before),options={requestText:'Example'};
 const fp=nodeSemanticFingerprint(before,'n_old',options);
 assert.equal(legacySkillEvidenceFingerprint(canonical,'n_old',options),fp);
 assert.deepEqual(before,old());
});

test('genuine legacy success remains valid after importing a Skill v2 graph',()=>{
 const snapshot=normalizeSkillSnapshot(old()),semanticContext={requestText:'Example'};
 const row={nodeId:'n_old',status:'success',
  semanticFingerprint:legacySkillEvidenceFingerprint(snapshot,'n_old',semanticContext),
  semanticContext,outputs:structuredClone(produced)};
 assert.equal(verifyLegacySkillEvidence(snapshot,'n_old',row),true);
});

test('changed Skill settings or definition instructions invalidate old fingerprint',()=>{
 const snapshot=normalizeSkillSnapshot(old()),semanticContext={};
 const row={nodeId:'n_old',status:'success',
  semanticFingerprint:legacySkillEvidenceFingerprint(snapshot,'n_old',semanticContext),
  semanticContext,outputs:structuredClone(produced)};
 const changed=structuredClone(snapshot);
 changed.graph.skills[0].settings.request='Different request';
 assert.equal(verifyLegacySkillEvidence(changed,'n_old',row),false);
 const other=structuredClone(snapshot);
 other.skillDefinitions[0].instruction='Completely different behavior';
 assert.equal(verifyLegacySkillEvidence(other,'n_old',row),false);
});

test('forged result status, ID, output representation and mismatched context reject',()=>{
 const snapshot=normalizeSkillSnapshot(old()),semanticContext={requestText:'First'};
 const row={nodeId:'n_old',status:'success',
  semanticFingerprint:legacySkillEvidenceFingerprint(snapshot,'n_old',semanticContext),
  semanticContext,outputs:structuredClone(produced)};
 assert.equal(verifyLegacySkillEvidence(snapshot,'missing',row),false);
 assert.equal(verifyLegacySkillEvidence(snapshot,'n_old',{...row,status:'waiting'}),false);
 assert.equal(verifyLegacySkillEvidence(snapshot,'n_old',{...row,semanticFingerprint:'fake'}),false);
 assert.equal(verifyLegacySkillEvidence(snapshot,'n_old',{...row,outputs:{status:'produced',values:{result:{inline:{invalid:'object'}}}}}),false);
 assert.equal(verifyLegacySkillEvidence(snapshot,'n_old',row,{requestText:'Changed'}),false);
});

test('Skill-v2 shaped rows cannot impersonate original Node-v1 evidence',()=>{
 const snap=normalizeSkillSnapshot(old());
 const row={skillId:'n_old',status:'success',
  semanticFingerprint:legacySkillEvidenceFingerprint(snap,'n_old'),outputs:structuredClone(produced)};
 assert.equal(verifyLegacySkillEvidence(snap,'n_old',row),false);
 assert.equal(verifyLegacySkillEvidence(snap,'n_old',{...row,nodeId:'n_old'}),false);
});

test('legacy verifier fails closed on malformed or mixed-format graphs',()=>{
 const source=normalizeSkillSnapshot(old());
 const malformed=structuredClone(source);
 malformed.graph.nodes=malformed.graph.skills;
 assert.equal(verifyLegacySkillEvidence(malformed,'n_old',{nodeId:'n_old',status:'success',semanticFingerprint:'xyz'}),false);
 assert.throws(()=>legacySkillEvidenceFingerprint(malformed,'n_old'));
});
