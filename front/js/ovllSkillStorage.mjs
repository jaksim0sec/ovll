import {
  normalizeSkillSnapshot,
  normalizeSkillRun
} from './ovllSkillCodec.mjs';

// This storage boundary is deliberately independent of WorkspaceStore until
// the browser graph/canvas consumers have been upgraded to Skill v2.
// The legacy storage key is never written or removed here.
export const LEGACY_WORKSPACE_KEY='ovll:workspace:v1';
export const SKILL_WORKSPACE_KEY='ovll:workspace:skill:v2';
export const SKILL_WORKSPACE_VERSION=10;

export class SkillStorageError extends Error {
  constructor(code,message=code){
    super(message);
    this.name='SkillStorageError';
    this.code=code;
  }
}

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const copy=value=>structuredClone(value);
const reject=(code)=>{throw new SkillStorageError(code);};

export function normalizeSkillWorkspace(workspace){
  if(!record(workspace)||!record(workspace.workspace)||
    typeof workspace.workspace.id!=='string'||
    !Array.isArray(workspace.conversations)||
    workspace.conversations.length===0||
    !Number.isSafeInteger(workspace.storageRevision)||
    workspace.storageRevision<0)
    reject('INVALID_SKILL_WORKSPACE');

  const result=copy(workspace);
  const oldDefs=owns(result,'pointerDefinitions');
  const newDefs=owns(result,'skillDefinitions');
  if(oldDefs&&newDefs)reject('MIXED_SKILL_WORKSPACE');

  const version=Number.isInteger(result.schemaVersion)?result.schemaVersion:0;
  if(version<0||version>SKILL_WORKSPACE_VERSION)
    reject('UNSUPPORTED_SKILL_WORKSPACE_VERSION');
  if(version===SKILL_WORKSPACE_VERSION){
    if(oldDefs||!newDefs)reject('INVALID_SKILL_WORKSPACE');
  }else if(newDefs){
    reject('MIXED_SKILL_WORKSPACE');
  }

  if(oldDefs){
    result.skillDefinitions=result.pointerDefinitions;
    delete result.pointerDefinitions;
  }else if(!newDefs){
    result.skillDefinitions=[];
  }
  if(!Array.isArray(result.skillDefinitions))
    reject('INVALID_SKILL_DEFINITIONS');

  for(let i=0;i<result.conversations.length;i++){
    const conversation=result.conversations[i];
    if(!record(conversation)||typeof conversation.id!=='string'||!record(conversation.state))
      reject('INVALID_SKILL_CONVERSATION');
    const state=conversation.state;
    // Pointer and canvas workflows are historically separate structures.
    // Canvas workflow fields remain opaque until their own UI/runtime migration.
    if(state.pointerGraph!==undefined&&state.pointerGraph!==null){
      state.pointerGraph=normalizeSkillSnapshot(state.pointerGraph,
        {source:version===SKILL_WORKSPACE_VERSION?'skill':'legacy'});
    }
    if(state.pointerRuns!==undefined){
      if(!Array.isArray(state.pointerRuns)||state.pointerRuns.length>12)
        reject('INVALID_SKILL_RUNS');
      state.pointerRuns=state.pointerRuns.map(run=>normalizeSkillRun(run,
        {source:version===SKILL_WORKSPACE_VERSION?'skill':'legacy'}));
    }
  }
  result.schemaVersion=SKILL_WORKSPACE_VERSION;
  return result;
}

function readJSON(storage,key){
  const raw=storage.getItem(key);
  return raw===null||raw===undefined?null:JSON.parse(raw);
}
function verifyWritten(storage,key,payload){
  const saved=storage.getItem(key);
  if(saved!==payload)
    reject('SKILL_WORKSPACE_WRITE_UNVERIFIED');
}

export function readSkillWorkspace(storage,{migrate=true}={}){
  if(!storage||typeof storage.getItem!=='function')
    reject('SKILL_STORAGE_UNAVAILABLE');
  let newError=null;
  let existing=null;
  try{
    existing=readJSON(storage,SKILL_WORKSPACE_KEY);
    if(existing!==null){
      return {source:'skill-v2',snapshot:normalizeSkillWorkspace(existing)};
    }
  }catch(error){
    newError=error;
  }

  let legacy;
  try{
    legacy=readJSON(storage,LEGACY_WORKSPACE_KEY);
    if(legacy===null){
      if(newError)throw newError;
      return {source:'empty',snapshot:null};
    }
    const snapshot=normalizeSkillWorkspace(legacy);
    // Never overwrite a malformed new record automatically; the original
    // source stays available for recovery and diagnostics.
    if(newError||!migrate)
      return {source:'legacy-readonly',snapshot,
        ...(newError?{warning:'INVALID_NEW_SKILL_STORAGE'}:{})};
    const payload=JSON.stringify(snapshot);
    try{
      storage.setItem(SKILL_WORKSPACE_KEY,payload);
      verifyWritten(storage,SKILL_WORKSPACE_KEY,payload);
    }catch(error){
      return {source:'legacy-readonly',snapshot,
        warning:error?.code||error?.name||'SKILL_WORKSPACE_WRITE_FAILED'};
    }
    return {source:'migrated',snapshot};
  }catch(error){
    if(error instanceof SkillStorageError)throw error;
    throw new SkillStorageError('SKILL_WORKSPACE_READ_FAILED',error?.message);
  }
}

export function saveSkillWorkspace(storage,next,{expectedRevision}={}){
  if(!storage||typeof storage.getItem!=='function'||typeof storage.setItem!=='function')
    reject('SKILL_STORAGE_UNAVAILABLE');
  const candidate=normalizeSkillWorkspace(next);
  const raw=storage.getItem(SKILL_WORKSPACE_KEY);
  if(raw===null)reject('SKILL_WORKSPACE_NOT_INITIALIZED');
  let saved;
  try{
    saved=normalizeSkillWorkspace(JSON.parse(raw));
  }catch{
    reject('INVALID_EXISTING_SKILL_WORKSPACE');
  }
  if(!Number.isSafeInteger(expectedRevision)||saved.storageRevision!==expectedRevision)
    reject('SKILL_WORKSPACE_REVISION_CONFLICT');
  candidate.storageRevision=expectedRevision+1;
  const payload=JSON.stringify(candidate);
  storage.setItem(SKILL_WORKSPACE_KEY,payload);
  verifyWritten(storage,SKILL_WORKSPACE_KEY,payload);
  return candidate;
}
