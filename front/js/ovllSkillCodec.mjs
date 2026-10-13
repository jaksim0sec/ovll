// Canonical Skill v2 boundary. Domain metadata is converted; user data is opaque.
export class SkillSchemaError extends Error {
  constructor(code,path) {
    super(code+' at '+path);
    this.name='SkillSchemaError';
    this.code=code;
    this.path=path;
  }
}

const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const copy=value=>structuredClone(value);
const fail=(code,path)=>{throw new SkillSchemaError(code,path);};
const id=value=>typeof value==='string'&&value.length>0&&value.length<=160;

function alias(record,oldName,newName,path,{required=false}={}) {
  if(!isRecord(record))fail('INVALID_SKILL_SCHEMA',path);
  if(own(record,oldName)&&own(record,newName))fail('MIXED_SKILL_SCHEMA',path);
  if(own(record,oldName)){
    record[newName]=record[oldName];
    delete record[oldName];
  }
  if(required&&!own(record,newName))fail('INVALID_SKILL_SCHEMA',path+'/'+newName);
}
function refVersion(value,path) {
  if(!isRecord(value)||!id(value.definitionId)||
    !Number.isInteger(value.version)||value.version<1)
    fail('INVALID_SKILL_DEFINITION_REF',path);
}
function identity(item,path,source='auto'){
  if(!isRecord(item))fail('INVALID_SKILL_SCHEMA',path);
  const old=own(item,'nodeId');
  if(source==='skill'&&old&&!own(item,'skillId'))fail('UNEXPECTED_LEGACY_SCHEMA',path);
  alias(item,'nodeId','skillId',path,{required:true});
  if(!id(item.skillId))fail('INVALID_SKILL_ID',path+'/'+(old?'nodeId':'skillId'));
  if(source==='skill'&&own(item,'definitionRef')&&!own(item,'skillDefinitionRef'))
    fail('UNEXPECTED_LEGACY_SCHEMA',path);
  alias(item,'definitionRef','skillDefinitionRef',path,{required:true});
  refVersion(item.skillDefinitionRef,path+'/skillDefinitionRef');
}
function connectionEnd(end,path,source='auto'){
  if(!isRecord(end))fail('INVALID_SKILL_CONNECTION',path);
  const old=own(end,'nodeId');
  if(source==='skill'&&old&&!own(end,'skillId'))fail('UNEXPECTED_LEGACY_SCHEMA',path);
  alias(end,'nodeId','skillId',path,{required:true});
  if(!id(end.skillId))fail('INVALID_SKILL_ID',path+'/'+(old?'nodeId':'skillId'));
  if(typeof end.port!=='string'||!end.port)
    fail('INVALID_SKILL_CONNECTION',path+'/port');
}
function shape(value,path,oldKey,newKey){
  if(!isRecord(value))fail('INVALID_SKILL_SNAPSHOT',path);
  if(own(value,oldKey)&&own(value,newKey))fail('MIXED_SKILL_SCHEMA',path);
}
function sourceRule(oldExists,newExists,source,path){
  if(!['auto','legacy','skill'].includes(source))fail('INVALID_SKILL_SCHEMA_SOURCE',path);
  if(source==='legacy'&&newExists)fail('UNEXPECTED_SKILL_SCHEMA',path);
  if(source==='skill'&&oldExists)fail('UNEXPECTED_LEGACY_SCHEMA',path);
}
function definition(value,path){
  if(!isRecord(value)||!id(value.definitionId)||
     !Number.isInteger(value.version)||value.version<1)
    fail('INVALID_SKILL_DEFINITION',path);
}

export function normalizeSkillSnapshot(value,{source='auto'}={}){
  if(!isRecord(value)||!isRecord(value.graph))fail('INVALID_SKILL_SNAPSHOT','/');
  const output=copy(value),graph=output.graph;
  shape(output,'/','definitions','skillDefinitions');
  shape(graph,'/graph','nodes','skills');
  const old=own(output,'definitions')||own(graph,'nodes');
  const current=own(output,'skillDefinitions')||own(graph,'skills');
  if(old&&current){
    if(!(own(output,'definitions')&&own(graph,'nodes'))&&
       !(own(output,'skillDefinitions')&&own(graph,'skills')))
      fail('MIXED_SKILL_SCHEMA','/');
  }
  sourceRule(old,current,source,'/');
  if(!own(output,'definitions')&&!own(output,'skillDefinitions'))
    fail('INVALID_SKILL_SNAPSHOT','/skillDefinitions');
  if(!own(graph,'nodes')&&!own(graph,'skills'))
    fail('INVALID_SKILL_SNAPSHOT','/graph/skills');
  alias(output,'definitions','skillDefinitions','/');
  alias(graph,'nodes','skills','/graph');
  if(!Array.isArray(graph.skills)||!Array.isArray(output.skillDefinitions)||
    !Array.isArray(graph.connections)||!id(graph.graphId)||
    !Number.isInteger(graph.revision)||graph.revision<0)
    fail('INVALID_SKILL_SNAPSHOT','/graph');
  if(graph.skills.length>64||output.skillDefinitions.length>128||
    graph.connections.length>128)fail('SKILL_SNAPSHOT_TOO_LARGE','/graph');
  const seen=new Set();
  graph.skills.forEach((skill,i)=>{
    const p='/graph/'+(own(value.graph,'nodes')?'nodes':'skills')+'/'+i;
    identity(skill,p,source);
    if(seen.has(skill.skillId))fail('DUPLICATE_SKILL_ID','/graph/skills/'+i);
    seen.add(skill.skillId);
  });
  output.skillDefinitions.forEach((d,i)=>definition(d,'/skillDefinitions/'+i));
  graph.connections.forEach((link,i)=>{
    const p='/graph/connections/'+i;
    if(!isRecord(link))fail('INVALID_SKILL_CONNECTION',p);
    connectionEnd(link.from,p+'/from',source);
    connectionEnd(link.to,p+'/to',source);
  });
  return output;
}
export function assertCanonicalSkillSnapshot(value){
  normalizeSkillSnapshot(value,{source:'skill'});
  return true;
}
function selector(value,path){
  if(!isRecord(value))fail('INVALID_SKILL_SELECTOR',path);
  alias(value,'nodeId','skillId',path);
  alias(value,'localNodeKey','localSkillKey',path);
  if((own(value,'skillId')&&!id(value.skillId))||
    (own(value,'localSkillKey')&&!id(value.localSkillKey)))
    fail('INVALID_SKILL_ID',path);
  if(Number(own(value,'skillId'))+Number(own(value,'localSkillKey'))!==1)
    fail('INVALID_SKILL_SELECTOR',path);
}
function patchEndpoint(end,path){
  if(!isRecord(end))fail('INVALID_SKILL_ENDPOINT',path);
  alias(end,'node','skill',path,{required:true});
  if(!isRecord(end.skill))fail('INVALID_SKILL_ENDPOINT',path+'/skill');
  selector(end.skill,path+'/skill');
}
const renamedActions=Object.freeze({
  'node.add':'skill.add','node.update':'skill.update','node.delete':'skill.delete',
  'node.define':'skill.define','definition.revise':'skill.revise',
  'definition.appearance':'skill.appearance',
  'definition.delete':'skill.definition.delete'
});
const patchKinds=new Set([...Object.values(renamedActions),
  'link.add','link.remove','definition.add']);
export function normalizeSkillPatch(value,{source='auto'}={}){
  if(!isRecord(value)||!Array.isArray(value.operations))
    fail('INVALID_SKILL_PATCH','/');
  const output=copy(value);
  shape(output,'/','definitions','skillDefinitions');
  sourceRule(own(output,'definitions'),own(output,'skillDefinitions'),source,'/');
  alias(output,'definitions','skillDefinitions','/');
  if(output.skillDefinitions!==undefined&&!Array.isArray(output.skillDefinitions))
    fail('INVALID_SKILL_PATCH','/skillDefinitions');
  output.operations.forEach((op,i)=>{
    const p='/operations/'+i;
    if(!isRecord(op)||typeof op.op!=='string')
      fail('INVALID_SKILL_OPERATION',p);
    if(own(renamedActions,op.op))op.op=renamedActions[op.op];
    else if(!patchKinds.has(op.op))fail('INVALID_SKILL_OPERATION',p+'/op');
    alias(op,'nodeId','skillId',p);
    alias(op,'localNodeKey','localSkillKey',p);
    alias(op,'nodeRef','skillRef',p);
    alias(op,'definitionRef','skillDefinitionRef',p);
    if(op.skillId!==undefined&&!id(op.skillId))fail('INVALID_SKILL_ID',p+'/skillId');
    if(op.localSkillKey!==undefined&&!id(op.localSkillKey))fail('INVALID_SKILL_ID',p+'/localSkillKey');
    if(op.skillRef!==undefined)selector(op.skillRef,p+'/skillRef');
    if(op.skillDefinitionRef!==undefined&&own(op.skillDefinitionRef,'definitionId'))
      refVersion(op.skillDefinitionRef,p+'/skillDefinitionRef');
    if(op.op==='link.add')for(const end of ['from','to'])
      patchEndpoint(op[end],p+'/'+end);
  });
  return output;
}
export function normalizeSkillRun(value,{source='auto'}={}){
  if(!isRecord(value))fail('INVALID_SKILL_RUN','/');
  const output=copy(value);
  shape(output,'/','nodes','skills');
  sourceRule(own(output,'nodes'),own(output,'skills'),source,'/');
  alias(output,'nodes','skills','/');
  if(!Array.isArray(output.skills))fail('INVALID_SKILL_RUN','/skills');
  output.skills.forEach((row,i)=>{
    const p='/skills/'+i;
    if(!isRecord(row))fail('INVALID_SKILL_RUN',p);
    if(source==='skill'&&own(row,'nodeId')&&!own(row,'skillId'))
      fail('UNEXPECTED_LEGACY_SCHEMA',p);
    alias(row,'nodeId','skillId',p,{required:true});
    if(!id(row.skillId))fail('INVALID_SKILL_ID',p+'/skillId');
  });
  return output;
}
