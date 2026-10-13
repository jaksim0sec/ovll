// Only historic Node-v1 fingerprints are validated here. Skill-v2 evidence
// will use its own explicit semantic contract. Never recompute an old hash
// using newly renamed keys or treat untagged/new evidence as legacy proof.
import {toLegacySkillSnapshot} from './ovllSkillGraph.mjs';
import {nodeSemanticFingerprint,isCurrentNodeResult} from './ovllPointerResults.mjs';

const id=x=>typeof x==='string'&&x.length>0;

export function legacySkillEvidenceFingerprint(skillSnapshot,skillId,options={}){
  if(!id(skillId))throw new TypeError('INVALID_SKILL_ID');
  const original=toLegacySkillSnapshot(skillSnapshot);
  return nodeSemanticFingerprint(original,skillId,options);
}
export function verifyLegacySkillEvidence(skillSnapshot,skillId,legacyResult,options={}){
  // This API deliberately requires the *original* old result shape. A result
  // migrated to Skill v2 needs a separate, provenance-preserving ingress.
  if(!id(skillId)||!legacyResult||typeof legacyResult!=='object'||
    'skillId' in legacyResult||legacyResult.nodeId!==skillId)
    return false;
  try{
    const original=toLegacySkillSnapshot(skillSnapshot);
    return isCurrentNodeResult(original,skillId,legacyResult,options);
  }catch{return false}
}
