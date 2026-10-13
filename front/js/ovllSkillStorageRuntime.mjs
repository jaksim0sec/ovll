// Explicit Skill v2 persistent-storage boundary. The legacy graph engine is
// isolated behind this adapter until the runtime is independently migrated.
import {migrateWorkspaceToSkills} from './ovllSkillWorkspaceMigration.mjs';
import {normalizeSkillSnapshot,normalizeSkillRun} from './ovllSkillCodec.mjs';
import {LEGACY_WORKSPACE_KEY,SKILL_WORKSPACE_KEY,SkillStorageBridgeError}
  from './ovllSkillStorageBridge.mjs';

export const storageKey=SKILL_WORKSPACE_KEY;
export const schemaVersion=10;
const clone=value=>structuredClone(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const validObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(code)=>{throw new SkillStorageBridgeError(code)};
function decode(raw,code){
  try{
    const value=JSON.parse(raw);
    if(!validObject(value))fail(code);
    return value;
  }catch{fail(code)}
}
function readKey(storage,key){
  try{return storage.getItem(key)}
  catch{fail('SKILL_STORAGE_READ_FAILED')}
}
function checkCanonical(value){
  if(!validObject(value)||value.schemaVersion!==10||
    own(value,'pointerDefinitions')||!Array.isArray(value.conversations))
    fail('SKILL_STORAGE_EXISTING_INVALID');
  for(const entry of value.conversations){
    if(!validObject(entry)||!validObject(entry.state))
      fail('SKILL_STORAGE_EXISTING_INVALID');
    const s=entry.state;
    if(own(s,'pointerGraph')||own(s,'pointerRuns')||
      own(s.canvas?.workflow||{},'nodes'))fail('SKILL_STORAGE_EXISTING_INVALID');
    if(s.skillGraph!=null)normalizeSkillSnapshot(s.skillGraph,{source:'skill'});
    if(s.skillRuns!==undefined){
      if(!Array.isArray(s.skillRuns))fail('SKILL_STORAGE_EXISTING_INVALID');
      for(const run of s.skillRuns)normalizeSkillRun(run,{source:'skill'});
    }
  }
  // Checks canvas references and mixed nested fields, not just the v2 version.
  migrateWorkspaceToSkills(value);
  if(!Number.isSafeInteger(value.storageRevision)||value.storageRevision<0)
    fail('SKILL_STORAGE_EXISTING_INVALID');
  return value;
}
function legacyCanvas(canvas){
  if(!canvas)return;
  const workflow=validObject(canvas.workflow)?canvas.workflow:canvas;
  if(!Array.isArray(workflow.skills)||!Array.isArray(workflow.connections)||
    own(workflow,'nodes'))fail('SKILL_STORAGE_EXISTING_INVALID');
  workflow.nodes=workflow.skills.map(skill=>{
    if(!validObject(skill)||own(skill,'id')||typeof skill.skillId!=='string')
      fail('SKILL_STORAGE_EXISTING_INVALID');
    const {skillId,...other}=skill;
    return {...other,id:skillId};
  });
  delete workflow.skills;
  for(const link of workflow.connections){
    for(const end of ['from','to']){
      const endpoint=link[end];
      if(!validObject(endpoint)||own(endpoint,'node')||own(endpoint,'nodeId')||
        typeof endpoint.skillId!=='string')fail('SKILL_STORAGE_EXISTING_INVALID');
      endpoint.node=endpoint.skillId;
      delete endpoint.skillId;
    }
  }
}
function legacyGraph(value){
  if(value==null)return value;
  const normalized=normalizeSkillSnapshot(value,{source:'skill'});
  const graph=normalized.graph;
  graph.nodes=graph.skills.map(skill=>{
    const {skillId,skillDefinitionRef,...other}=skill;
    return {...other,nodeId:skillId,definitionRef:skillDefinitionRef};
  });
  delete graph.skills;
  for(const link of graph.connections)for(const end of ['from','to']){
    link[end].nodeId=link[end].skillId;delete link[end].skillId;
  }
  normalized.definitions=normalized.skillDefinitions;
  delete normalized.skillDefinitions;
  return normalized;
}
function legacyRun(value){
  const normalized=normalizeSkillRun(value,{source:'skill'});
  normalized.nodes=normalized.skills.map(row=>{
    const {skillId,...other}=row;
    return {...other,nodeId:skillId};
  });
  delete normalized.skills;
  return normalized;
}
export function runtimeWorkspace(canonical){
  checkCanonical(canonical);
  const output=clone(canonical);
  if(own(output,'skillDefinitions')){
    output.pointerDefinitions=output.skillDefinitions;delete output.skillDefinitions;
  }
  for(const entry of output.conversations){
    const s=entry.state;
    if(s.canvas)legacyCanvas(s.canvas);
    if(own(s,'skillGraph')){s.pointerGraph=legacyGraph(s.skillGraph);delete s.skillGraph}
    if(own(s,'skillRuns')){
      s.pointerRuns=s.skillRuns.map(legacyRun);delete s.skillRuns;
    }
  }
  output.schemaVersion=9; // Internal legacy adapter only, never written to v2.
  return output;
}
export function canonicalWorkspace(workspace){
  let output;
  try{output=migrateWorkspaceToSkills(workspace)}
  catch{fail('INVALID_SKILL_WORKSPACE')}
  checkCanonical(output);
  return output;
}
export function read(storage){
  const rawV2=readKey(storage,SKILL_WORKSPACE_KEY);
  const rawLegacy=readKey(storage,LEGACY_WORKSPACE_KEY);
  if(rawV2===null){
    if(rawLegacy===null)return null;
    const original=decode(rawLegacy,'SKILL_STORAGE_LEGACY_INVALID');
    if(original.schemaVersion>=10)fail('SKILL_STORAGE_LEGACY_INVALID');
    canonicalWorkspace(original); // Reject invalid old graphs, never silently reset.
    return original;
  }
  let value;
  try{value=checkCanonical(decode(rawV2,'SKILL_STORAGE_EXISTING_INVALID'))}
  catch{fail('SKILL_STORAGE_EXISTING_INVALID')}
  if(rawLegacy!==null){
    const original=decode(rawLegacy,'SKILL_STORAGE_LEGACY_INVALID');
    if(!Number.isSafeInteger(original.storageRevision))fail('SKILL_STORAGE_LEGACY_INVALID');
    if(original.storageRevision>value.storageRevision)fail('SKILL_STORAGE_STALE_SOURCE');
  }
  return runtimeWorkspace(value);
}
export function write(storage,runtime,{expectedRevision}={}){
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)
    fail('SKILL_STORAGE_EXPECTED_REVISION_REQUIRED');
  const rawV2=readKey(storage,SKILL_WORKSPACE_KEY);
  const rawLegacy=readKey(storage,LEGACY_WORKSPACE_KEY);
  let previous=0;
  if(rawV2!==null){
    let stored;
    try{stored=checkCanonical(decode(rawV2,'SKILL_STORAGE_EXISTING_INVALID'))}
    catch{fail('SKILL_STORAGE_EXISTING_INVALID')}
    previous=stored.storageRevision;
  }else if(rawLegacy!==null){
    const original=decode(rawLegacy,'SKILL_STORAGE_LEGACY_INVALID');
    if(!Number.isSafeInteger(original.storageRevision))fail('SKILL_STORAGE_LEGACY_INVALID');
    previous=original.storageRevision;
  }
  if(previous!==expectedRevision)fail('WORKSPACE_REVISION_CONFLICT');
  if(rawV2!==null&&rawLegacy!==null){
    const old=decode(rawLegacy,'SKILL_STORAGE_LEGACY_INVALID');
    if(old.storageRevision>previous)fail('SKILL_STORAGE_STALE_SOURCE');
  }
  const next=canonicalWorkspace(runtime);
  if(next.storageRevision!==expectedRevision+1)fail('SKILL_STORAGE_REVISION_MISMATCH');
  const serialized=JSON.stringify(next);
  // Recheck both old and new snapshots against tabs that wrote while converting.
  if(readKey(storage,SKILL_WORKSPACE_KEY)!==rawV2||
    readKey(storage,LEGACY_WORKSPACE_KEY)!==rawLegacy)fail('WORKSPACE_REVISION_CONFLICT');
  try{storage.setItem(SKILL_WORKSPACE_KEY,serialized)}
  catch{fail('SKILL_STORAGE_WRITE_FAILED')}
  if(readKey(storage,SKILL_WORKSPACE_KEY)!==serialized)fail('SKILL_STORAGE_VERIFY_FAILED');
  return next.storageRevision;
}
