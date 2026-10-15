// One native domain contract. Historical shapes are accepted only by workspace import.
export class SkillSchemaError extends Error {
  constructor(code,path){super(code+' at '+path);this.name='SkillSchemaError';this.code=code;this.path=path;}
}
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const fail=(code,path)=>{throw new SkillSchemaError(code,path)};
const id=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const rejectFields=(x,keys,path)=>{if(keys.some(k=>own(x,k)))fail('UNEXPECTED_LEGACY_SCHEMA',path)};
function ref(value,path){
  if(!record(value)||!id(value.definitionId)||!Number.isInteger(value.version)||value.version<1)
    fail('INVALID_SKILL_DEFINITION_REF',path);
}
export function validateSkillSnapshot(value){
  if(!record(value)||!record(value.graph))fail('INVALID_SKILL_SNAPSHOT','/');
  const graph=value.graph;
  rejectFields(value,['definitions'],'/');rejectFields(graph,['nodes','skills'],'/graph');
  if(!Array.isArray(value.skillDefinitions)||!Array.isArray(graph.skillNodes)||
    !Array.isArray(graph.connections)||!id(graph.graphId)||!Number.isInteger(graph.revision)||graph.revision<0)
    fail('INVALID_SKILL_SNAPSHOT','/graph');
  if(graph.skillNodes.length>64||value.skillDefinitions.length>128||graph.connections.length>128)
    fail('SKILL_SNAPSHOT_TOO_LARGE','/graph');
  const seen=new Set();
  graph.skillNodes.forEach((item,i)=>{
    const path='/graph/skillNodes/'+i;
    if(!record(item)||!id(item.skillNodeId))fail('INVALID_SKILL_NODE_ID',path);
    rejectFields(item,['nodeId','skillId','definitionRef'],path);
    if(seen.has(item.skillNodeId))fail('DUPLICATE_SKILL_NODE_ID',path);
    seen.add(item.skillNodeId);ref(item.skillDefinitionRef,path+'/skillDefinitionRef');
  });
  value.skillDefinitions.forEach((item,i)=>ref(item,'/skillDefinitions/'+i));
  graph.connections.forEach((link,i)=>{
    for(const side of ['from','to']){
      const endpoint=link?.[side],path='/graph/connections/'+i+'/'+side;
      if(!record(endpoint)||!id(endpoint.skillNodeId)||typeof endpoint.port!=='string'||!endpoint.port)
        fail('INVALID_SKILL_CONNECTION',path);
      rejectFields(endpoint,['nodeId','skillId'],path);
    }
  });
  return structuredClone(value);
}
export function assertCanonicalSkillSnapshot(value){validateSkillSnapshot(value);return true;}
function selector(value,path){
  if(!record(value))fail('INVALID_SKILL_SELECTOR',path);
  rejectFields(value,['nodeId','skillId','localNodeKey','localSkillKey'],path);
  if(Number(own(value,'skillNodeId'))+Number(own(value,'localSkillNodeKey'))!==1||
    own(value,'skillNodeId')&&!id(value.skillNodeId)||
    own(value,'localSkillNodeKey')&&!id(value.localSkillNodeKey))fail('INVALID_SKILL_SELECTOR',path);
}
export function validateSkillPatch(value){
  if(!record(value)||!Array.isArray(value.operations)||!Array.isArray(value.skillDefinitions))
    fail('INVALID_SKILL_PATCH','/');
  rejectFields(value,['definitions'],'/');
  const kinds=new Set(['skillNode.add','skillNode.update','skillNode.delete','skill.appearance','skill.delete','link.add','link.remove']);
  value.operations.forEach((op,i)=>{
    const path='/operations/'+i;
    if(!record(op)||!kinds.has(op.op))fail('INVALID_SKILL_OPERATION',path);
    rejectFields(op,['nodeId','skillId','nodeRef','skillRef','localNodeKey','localSkillKey','definitionRef'],path);
    if(op.skillNodeId!==undefined&&!id(op.skillNodeId))fail('INVALID_SKILL_NODE_ID',path);
    if(op.localSkillNodeKey!==undefined&&!id(op.localSkillNodeKey))fail('INVALID_SKILL_NODE_ID',path);
    if(op.skillNodeRef!==undefined)selector(op.skillNodeRef,path+'/skillNodeRef');
    if(op.skillDefinitionRef?.definitionId!==undefined)ref(op.skillDefinitionRef,path+'/skillDefinitionRef');
    if(op.op==='link.add')for(const side of ['from','to']){
      const end=op[side];
      if(!record(end)||typeof end.port!=='string'||!end.port)fail('INVALID_SKILL_ENDPOINT',path+'/'+side);
      rejectFields(end,['node','skill'],path+'/'+side);selector(end.skillNode,path+'/'+side+'/skillNode');
    }
  });
  return structuredClone(value);
}
export function validateSkillRun(value){
  if(!record(value)||!Array.isArray(value.skillNodes))fail('INVALID_SKILL_RUN','/');
  rejectFields(value,['nodes','skills'],'/');
  value.skillNodes.forEach((item,i)=>{
    const path='/skillNodes/'+i;
    if(!record(item)||!id(item.skillNodeId))fail('INVALID_SKILL_RUN',path);
    rejectFields(item,['nodeId','skillId'],path);
  });
  return structuredClone(value);
}
