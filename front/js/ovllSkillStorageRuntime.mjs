import {migrateWorkspaceToSkills} from './ovllSkillWorkspaceMigration.mjs';
export const LEGACY_WORKSPACE_KEY='ovll:workspace:v1';
export const PREVIOUS_SKILL_WORKSPACE_KEY='ovll:workspace:skill:v2';
export const SKILL_WORKSPACE_KEY='ovll:workspace:skill:v3';
export const storageKey=SKILL_WORKSPACE_KEY;
export const schemaVersion=11;
export class SkillStorageError extends Error{constructor(code){super(code);this.name='SkillStorageError';this.code=code;}}
const fail=code=>{throw new SkillStorageError(code)};
const sources=[LEGACY_WORKSPACE_KEY,PREVIOUS_SKILL_WORKSPACE_KEY,SKILL_WORKSPACE_KEY];
function rawSources(storage){try{return sources.map(key=>storage.getItem(key));}catch{fail('SKILL_STORAGE_READ_FAILED');}}
function parse(raw,current=false){
  try{
    const value=JSON.parse(raw);
    if(!Number.isSafeInteger(value?.storageRevision)||value.storageRevision<0||current&&value.schemaVersion!==schemaVersion)
      fail('SKILL_STORAGE_EXISTING_INVALID');
    return migrateWorkspaceToSkills(value);
  }catch{fail(current?'SKILL_STORAGE_EXISTING_INVALID':'SKILL_STORAGE_LEGACY_INVALID');}
}
function select(raw){
  let selected=null;
  for(let i=0;i<raw.length;i++)if(raw[i]!==null){
    const value=parse(raw[i],i===2);
    if(selected&&value.storageRevision<selected.storageRevision)fail('SKILL_STORAGE_STALE_SOURCE');
    selected=value;
  }
  return selected;
}
export function importWorkspace(value){return migrateWorkspaceToSkills(value);}
export function read(storage){return select(rawSources(storage));}
export function write(storage,value,{expectedRevision}={}){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('SKILL_STORAGE_EXPECTED_REVISION_REQUIRED');
  const before=rawSources(storage),previous=select(before);
  if((previous?.storageRevision??0)!==expectedRevision)fail('WORKSPACE_REVISION_CONFLICT');
  if(value?.schemaVersion!==schemaVersion)fail('INVALID_SKILL_WORKSPACE');
  let next;try{next=migrateWorkspaceToSkills(value);}catch{fail('INVALID_SKILL_WORKSPACE');}
  if(next.storageRevision!==expectedRevision+1)fail('SKILL_STORAGE_REVISION_MISMATCH');
  const serialized=JSON.stringify(next);
  if(rawSources(storage).some((raw,i)=>raw!==before[i]))fail('WORKSPACE_REVISION_CONFLICT');
  try{storage.setItem(storageKey,serialized);}catch{fail('SKILL_STORAGE_WRITE_FAILED');}
  if(rawSources(storage)[2]!==serialized)fail('SKILL_STORAGE_VERIFY_FAILED');
  return next.storageRevision;
}
export {migrateSavedFunctions,migrateCustomSkills} from './ovllSkillWorkspaceMigration.mjs';
