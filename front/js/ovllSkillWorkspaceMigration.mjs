import {normalizeSkillSnapshot,normalizeSkillRun,SkillSchemaError} from './ovllSkillCodec.mjs';

// Pure v1 -> Skill v2 workspace conversion. This module deliberately DOES NOT
// touch localStorage or the currently running Node-v1 UI/runtime.
export class SkillWorkspaceMigrationError extends Error {
  constructor(code,path,reason=null) {
    super(code+' at '+path);
    this.name='SkillWorkspaceMigrationError';
    this.code=code;
    this.path=path;
    if(reason)this.cause=reason;
  }
}
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,key)=>Object.prototype.hasOwnProperty.call(x,key);
const copy=x=>structuredClone(x);
const fail=(code,path,reason)=>{throw new SkillWorkspaceMigrationError(code,path,reason)};
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=160;

function alias(obj,previous,next,path) {
  if(own(obj,previous)&&own(obj,next))fail('MIXED_SKILL_WORKSPACE',path);
  if(own(obj,previous)){
    obj[next]=obj[previous];
    delete obj[previous];
  }
}
function convertCanvas(canvas,path) {
  if(!record(canvas))fail('INVALID_SKILL_WORKSPACE',path);
  const workflow=record(canvas.workflow)?canvas.workflow:canvas;
  if(own(workflow,'nodes')&&own(workflow,'skills'))
    fail('MIXED_SKILL_WORKSPACE',path+'/workflow');
  alias(workflow,'nodes','skills',path+'/workflow');
  if(!Array.isArray(workflow.skills)||!Array.isArray(workflow.connections))
    fail('INVALID_SKILL_WORKSPACE',path+'/workflow');
  if(workflow.skills.length>256||workflow.connections.length>1024)
    fail('SKILL_WORKSPACE_TOO_LARGE',path+'/workflow');
  const seen=new Set();
  workflow.skills.forEach((skill,i)=>{
    const p=path+'/workflow/skills/'+i;
    if(!record(skill))fail('INVALID_SKILL_WORKSPACE',p);
    alias(skill,'id','skillId',p);
    if(!validId(skill.skillId))fail('INVALID_SKILL_WORKSPACE_ID',p+'/skillId');
    if(seen.has(skill.skillId))fail('DUPLICATE_SKILL_ID',p);
    seen.add(skill.skillId);
  });
  workflow.connections.forEach((connection,i)=>{
    const p=path+'/workflow/connections/'+i;
    if(!record(connection))fail('INVALID_SKILL_WORKSPACE',p);
    for(const key of ['from','to']){
      const end=connection[key],ep=p+'/'+key;
      if(!record(end))fail('INVALID_SKILL_WORKSPACE',ep);
      alias(end,'node','skillId',ep);
      alias(end,'nodeId','skillId',ep);
      if(!validId(end.skillId))fail('INVALID_SKILL_WORKSPACE_ID',ep+'/skillId');
      if(typeof end.port!=='string'||!end.port)
        fail('INVALID_SKILL_WORKSPACE',ep+'/port');
    }
  });
}
function convertConversation(conversation,index) {
  const path='/conversations/'+index;
  if(!record(conversation)||!record(conversation.state))
    fail('INVALID_SKILL_WORKSPACE',path+'/state');
  const s=conversation.state;
  if(own(s,'canvas')&&s.canvas!==null)convertCanvas(s.canvas,path+'/state/canvas');
  for(const [oldKey,newKey] of [
    ['pointerGraph','skillGraph'],['pointerRuns','skillRuns']
  ]){
    if(own(s,oldKey)&&own(s,newKey))
      fail('MIXED_SKILL_WORKSPACE',path+'/state');
    if(own(s,oldKey)){
      const item=s[oldKey];
      try{
        s[newKey]=item==null?item:oldKey==='pointerGraph'
          ?normalizeSkillSnapshot(item)
          :Array.isArray(item)?item.map(x=>normalizeSkillRun(x)):(()=>{throw new TypeError('Run list expected')})();
      }catch(error){
        if(error instanceof SkillSchemaError&&error.code==='MIXED_SKILL_SCHEMA')
          fail('MIXED_SKILL_WORKSPACE',path+'/state/'+oldKey,error);
        fail('INVALID_SKILL_WORKSPACE',path+'/state/'+oldKey,error);
      }
      delete s[oldKey];
    }
  }
  if(s.skillGraph!==null&&s.skillGraph!==undefined){
    try{s.skillGraph=normalizeSkillSnapshot(s.skillGraph,{source:'skill'})}
    catch(error){fail('INVALID_SKILL_WORKSPACE',path+'/state/skillGraph',error)}
  }
  if(s.skillRuns!==undefined){
    if(!Array.isArray(s.skillRuns))fail('INVALID_SKILL_WORKSPACE',path+'/state/skillRuns');
    try{s.skillRuns=s.skillRuns.map(x=>normalizeSkillRun(x,{source:'skill'}))}
    catch(error){fail('INVALID_SKILL_WORKSPACE',path+'/state/skillRuns',error)}
  }
}

/**
 * Returns a NEW v2-shaped object. Caller validates runtime readiness and
 * explicit write safety before it ever persists this result under a new key.
 */
export function migrateWorkspaceToSkills(snapshot) {
  if(!record(snapshot)||!Number.isInteger(snapshot.schemaVersion))
    fail('INVALID_SKILL_WORKSPACE','/');
  if(snapshot.schemaVersion>10||snapshot.schemaVersion<1)
    fail('UNSUPPORTED_SKILL_WORKSPACE_VERSION','/schemaVersion');
  const output=copy(snapshot);
  if(own(output,'pointerDefinitions')&&own(output,'skillDefinitions'))
    fail('MIXED_SKILL_WORKSPACE','/');
  alias(output,'pointerDefinitions','skillDefinitions','/');
  if(output.skillDefinitions!==undefined&&!Array.isArray(output.skillDefinitions))
    fail('INVALID_SKILL_WORKSPACE','/skillDefinitions');
  if(!Array.isArray(output.conversations)||output.conversations.length>512)
    fail('INVALID_SKILL_WORKSPACE','/conversations');
  output.conversations.forEach(convertConversation);
  output.schemaVersion=10;
  return output;
}
