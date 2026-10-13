import {migrateWorkspaceToSkills} from './ovllSkillWorkspaceMigration.mjs';

export const LEGACY_WORKSPACE_KEY='ovll:workspace:v1';
export const SKILL_WORKSPACE_KEY='ovll:workspace:skill:v2';

export class SkillStorageBridgeError extends Error {
  constructor(code,reason=null) {
    super(code);
    this.name='SkillStorageBridgeError';
    this.code=code;
    if(reason)this.cause=reason;
  }
}
const fail=(code,reason)=>{throw new SkillStorageBridgeError(code,reason)};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

function decode(raw,code) {
  try {
    const value=JSON.parse(raw);
    if(!object(value))fail(code);
    return value;
  } catch(error) {
    if(error instanceof SkillStorageBridgeError)throw error;
    fail(code,error);
  }
}

/**
 * Stages a COPY of the existing workspace without selecting it for runtime
 * or modifying the original v1 storage key. Safe to retry. Caller must not
 * switch reads to the v2 key until the rest of the Skill runtime is ready.
 */
export function stageSkillWorkspaceCopy(storage) {
  if(!storage||typeof storage.getItem!=='function'||
    typeof storage.setItem!=='function')fail('SKILL_STORAGE_UNAVAILABLE');
  let original;
  try{original=storage.getItem(LEGACY_WORKSPACE_KEY)}
  catch(error){fail('SKILL_STORAGE_READ_FAILED',error)}
  if(original==null)return {status:'no-source'};

  const existingLegacy=decode(original,'SKILL_STORAGE_LEGACY_INVALID');
  if(!Number.isInteger(existingLegacy.storageRevision)||
     existingLegacy.storageRevision<0)
    fail('SKILL_STORAGE_LEGACY_INVALID');

  let existing;
  try{existing=storage.getItem(SKILL_WORKSPACE_KEY)}
  catch(error){fail('SKILL_STORAGE_READ_FAILED',error)}
  if(existing!==null){
    let canonical;
    try{
      const stored=decode(existing,'SKILL_STORAGE_EXISTING_INVALID');
      // The new key MUST already contain canonical v2, not a v1 payload
      // which could be made to look valid by running the converter again.
      if(stored.schemaVersion!==10||'pointerDefinitions' in stored||
        stored.conversations?.some(item=>item?.state&&
          ('pointerGraph' in item.state||'pointerRuns' in item.state||
           'nodes' in (item.state.canvas?.workflow||{}))))
        fail('SKILL_STORAGE_EXISTING_INVALID');
      canonical=migrateWorkspaceToSkills(stored);
      if(!Array.isArray(canonical.conversations))
        fail('SKILL_STORAGE_EXISTING_INVALID');
    }catch(error){fail('SKILL_STORAGE_EXISTING_INVALID',error)}
    if((canonical.storageRevision??-1)<existingLegacy.storageRevision)
      fail('SKILL_STORAGE_STALE_SOURCE');
    return {status:'already-staged',revision:canonical.storageRevision};
  }

  let canonical,serialized;
  try {
    canonical=migrateWorkspaceToSkills(existingLegacy);
    serialized=JSON.stringify(canonical);
    if(!serialized||JSON.parse(serialized).schemaVersion!==10)
      fail('SKILL_STORAGE_VERIFY_FAILED');
  }catch(error){
    if(error instanceof SkillStorageBridgeError)throw error;
    fail('SKILL_STORAGE_LEGACY_INVALID',error);
  }

  // V1 may have changed while converting (e.g. another tab). Never
  // materialize a v2 copy of a stale snapshot.
  let latest;
  try{latest=storage.getItem(LEGACY_WORKSPACE_KEY)}
  catch(error){fail('SKILL_STORAGE_READ_FAILED',error)}
  if(latest!==original)fail('SKILL_STORAGE_STALE_SOURCE');

  try{storage.setItem(SKILL_WORKSPACE_KEY,serialized)}
  catch(error){fail('SKILL_STORAGE_WRITE_FAILED',error)}
  let saved;
  try{saved=storage.getItem(SKILL_WORKSPACE_KEY)}
  catch(error){fail('SKILL_STORAGE_VERIFY_FAILED',error)}
  if(saved!==serialized)fail('SKILL_STORAGE_VERIFY_FAILED');

  return {status:'staged',revision:canonical.storageRevision};
}
