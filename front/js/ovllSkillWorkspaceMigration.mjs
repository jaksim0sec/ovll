import {validateSkillSnapshot,validateSkillRun} from './ovllSkillCodec.mjs';

// One-way import, used before a historical workspace enters the native runtime.
// User settings, bindings, output values and source text are deliberately opaque.
export class SkillWorkspaceMigrationError extends Error {
  constructor(code,path,reason){super(code+' at '+path);this.name='SkillWorkspaceMigrationError';this.code=code;this.path=path;if(reason)this.cause=reason;}
}
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const fail=(code,path)=>{throw new SkillWorkspaceMigrationError(code,path)};
function rename(value,previous,next,path){
  if(own(value,previous)&&own(value,next))fail('MIXED_SKILL_WORKSPACE',path);
  if(own(value,previous)){value[next]=value[previous];delete value[previous];}
}
function referenceParts(parts){
  if(!Array.isArray(parts))return;
  for(const part of parts){
    const ref=part?.reference;
    if(record(ref)&&ref.kind==='skill-canvas')rename(ref,'skillId','skillNodeId','/reference');
  }
}
function graphSnapshot(snapshot,version,check=true){
  if(snapshot==null)return snapshot;
  if(!record(snapshot)||!record(snapshot.graph))fail('INVALID_SKILL_WORKSPACE','/graph');
  if(version<10){rename(snapshot,'definitions','skillDefinitions','/');rename(snapshot.graph,'nodes','skillNodes','/graph');}
  else rename(snapshot.graph,'skills','skillNodes','/graph');
  for(const item of snapshot.graph.skillNodes||[]){
    rename(item,version<10?'nodeId':'skillId','skillNodeId','/graph/skillNodes');
    if(version<10)rename(item,'definitionRef','skillDefinitionRef','/graph/skillNodes');
  }
  for(const link of snapshot.graph.connections||[])for(const side of ['from','to'])
    rename(link[side],version<10?'nodeId':'skillId','skillNodeId','/graph/connections');
  return check?validateSkillSnapshot(snapshot):snapshot;
}
function runSnapshot(run,version){
  if(run.snapshot!=null){
    const graph=run.snapshot?.graph;
    const savedVersion=record(graph)&&own(graph,'nodes')?9:record(graph)&&own(graph,'skills')?10:11;
    run.snapshot=savedVersion===11?validateSkillSnapshot(run.snapshot):graphSnapshot(run.snapshot,savedVersion);
  }
  for(const target of [...Object.values(run.outputMap||{}),...(run.coverage?.targets||[])]){
    if(!record(target))continue;
    rename(target,'nodeId','skillNodeId','/run/binding');rename(target,'skillId','skillNodeId','/run/binding');
  }
  rename(run,version<10?'nodes':'skills','skillNodes','/run');
  for(const item of run.skillNodes||[]){
    rename(item,version<10?'nodeId':'skillId','skillNodeId','/run/skillNodes');
    for(const input of item.semanticContext?.inputArtifacts||[])rename(input,'sourceNodeId','sourceSkillNodeId','/run/inputArtifacts');
  }
  return validateSkillRun(run);
}
function canvasSnapshot(canvas,version){
  if(canvas==null)return;
  const workflow=record(canvas.workflow)?canvas.workflow:canvas;
  rename(workflow,version<10?'nodes':'skills','skillNodes','/canvas');
  if(!Array.isArray(workflow.skillNodes)||!Array.isArray(workflow.connections))fail('INVALID_SKILL_WORKSPACE','/canvas');
  const seen=new Set();
  for(const item of workflow.skillNodes){
    if(version===10)rename(item,'skillId','id','/canvas/skillNodes');
    if(typeof item?.id!=='string'||!item.id||seen.has(item.id))fail('INVALID_SKILL_WORKSPACE_ID','/canvas/skillNodes');
    seen.add(item.id);
    if(record(item.data?.pointer)){
      rename(item.data.pointer,'nodeId','skillNodeId','/canvas/pointer');
      rename(item.data.pointer,'definitionRef','skillDefinitionRef','/canvas/pointer');
    }
    if(record(item.data)&&own(item.data,'sourceNodeId'))rename(item.data,'sourceNodeId','sourceSkillNodeId','/canvas/skillNodes/data');
  }
  for(const link of workflow.connections)for(const side of ['from','to']){
    const end=link?.[side];
    if(!record(end))fail('INVALID_SKILL_WORKSPACE','/canvas/connections');
    if(version<10){rename(end,'node','skillNode','/canvas/connections');rename(end,'nodeId','skillNode','/canvas/connections');}
    else rename(end,'skillId','skillNode','/canvas/connections');
    if(typeof end.skillNode!=='string'||!end.skillNode||typeof end.port!=='string'||!end.port)
      fail('INVALID_SKILL_WORKSPACE','/canvas/connections');
  }
}
export function migrateWorkspaceToSkills(snapshot){
  if(!record(snapshot)||!Number.isInteger(snapshot.schemaVersion)||snapshot.schemaVersion<1||snapshot.schemaVersion>11||!Array.isArray(snapshot.conversations))
    fail('UNSUPPORTED_SKILL_WORKSPACE_VERSION','/');
  const output=structuredClone(snapshot),version=output.schemaVersion;
  if(version<11){
    rename(output,'pointerDefinitions','skillDefinitions','/');
    for(const entry of output.conversations){
      const state=entry?.state;if(!record(state))fail('INVALID_SKILL_WORKSPACE','/conversations/state');
      if(version<10){
        rename(state,'vnextGraph','pointerGraph','/state');rename(state,'vnextRuns','pointerRuns','/state');
        rename(state,'pointerGraph','skillGraph','/state');rename(state,'pointerRuns','skillRuns','/state');
      }
      if(state.canvas)canvasSnapshot(state.canvas,version);
      if(state.skillGraph!=null)state.skillGraph=graphSnapshot(state.skillGraph,version);
      if(state.skillRuns!==undefined){
        if(!Array.isArray(state.skillRuns))fail('INVALID_SKILL_WORKSPACE','/state/skillRuns');
        state.skillRuns=state.skillRuns.map(run=>runSnapshot(run,version));
      }
      referenceParts(state.composerDraftParts);
      for(const message of state.messages||[])referenceParts(message.parts);
    }
    output.schemaVersion=11;
  }
  if(own(output,'pointerDefinitions')||!Array.isArray(output.conversations))fail('INVALID_SKILL_WORKSPACE','/');
  if(output.conversations.length>512)fail('SKILL_WORKSPACE_TOO_LARGE','/conversations');
  for(const entry of output.conversations){
    const state=entry?.state;if(!record(state)||own(state,'pointerGraph')||own(state,'pointerRuns'))fail('INVALID_SKILL_WORKSPACE','/state');
    if(state.skillGraph!=null)validateSkillSnapshot(state.skillGraph);
    if(state.skillRuns!==undefined){if(!Array.isArray(state.skillRuns))fail('INVALID_SKILL_WORKSPACE','/state/skillRuns');state.skillRuns.forEach(validateSkillRun);}
    const workflow=state.canvas?.workflow||state.canvas;
    if(workflow){
      if(own(workflow,'nodes')||own(workflow,'skills')||!Array.isArray(workflow.skillNodes)||!Array.isArray(workflow.connections))fail('INVALID_SKILL_WORKSPACE','/canvas');
      if(workflow.skillNodes.length>256||workflow.connections.length>1024)fail('SKILL_WORKSPACE_TOO_LARGE','/canvas');
      const seen=new Set();
      for(const item of workflow.skillNodes){if(!record(item)||typeof item.id!=='string'||!item.id||seen.has(item.id))fail('INVALID_SKILL_WORKSPACE_ID','/canvas');seen.add(item.id);}
      for(const link of workflow.connections)for(const side of ['from','to']){const end=link?.[side];if(!record(end)||own(end,'node')||own(end,'nodeId')||own(end,'skillId')||typeof end.skillNode!=='string'||!end.skillNode||typeof end.port!=='string'||!end.port)fail('INVALID_SKILL_WORKSPACE','/canvas/connections');}
    }
  }
  return output;
}

// Saved assets have independent storage; migrate only their domain metadata.
export function migrateSavedFunctions(items){
  if(!Array.isArray(items))fail('INVALID_SAVED_FUNCTIONS','/');
  const output=structuredClone(items);
  for(const fn of output){
    if(!record(fn)||!record(fn.snapshot?.graph))fail('INVALID_SAVED_FUNCTIONS','/snapshot');
    const graph=fn.snapshot.graph,version=own(graph,'nodes')?9:own(graph,'skills')?10:11;
    fn.snapshot=version===11?fn.snapshot:graphSnapshot(fn.snapshot,version,false);
    for(const map of ['inputMap','outputMap'])for(const target of Object.values(fn[map]||{})){
      if(!record(target))continue;
      rename(target,'nodeId','skillNodeId','/'+map);rename(target,'skillId','skillNodeId','/'+map);
      rename(target,'node','skillNode','/'+map);rename(target,'skill','skillNode','/'+map);
      if(record(target.skillNode)){rename(target.skillNode,'nodeId','skillNodeId','/'+map);rename(target.skillNode,'skillId','skillNodeId','/'+map);}
    }
  }
  return output;
}
export function migrateCustomSkills(envelope){
  if(!record(envelope)||!Array.isArray(envelope.records)||envelope.schemaVersion>3)fail('INVALID_CUSTOM_SKILLS','/');
  const output=structuredClone(envelope);
  if(output.schemaVersion!==3)for(const skill of output.records){
    if(!record(skill))fail('INVALID_CUSTOM_SKILLS','/records');
    if(skill.workflow)canvasSnapshot(skill.workflow,9);
    if(record(skill.boundary)){
      rename(skill.boundary,'entryNodeIds','entrySkillNodeIds','/boundary');
      rename(skill.boundary,'exitNodeId','exitSkillNodeId','/boundary');
    }
  }
  output.schemaVersion=3;
  return output;
}
