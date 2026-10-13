// Transitional Skill v2 graph authority: public contract is canonical Skill,
// while the proven legacy kernel still handles validation and graph mutations.
// This adapter can be removed after the kernel itself is renamed and verified.
import {MemoryGraphRepository,computeScope} from './ovllPointerGraphCore.mjs';
import {
  SkillSchemaError,normalizeSkillSnapshot,normalizeSkillPatch
} from './ovllSkillCodec.mjs';

const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const clone=value=>structuredClone(value);
const error=(code,path)=>{throw new SkillSchemaError(code,path)};

function legacyGraph(graph){
  if(!graph||!Array.isArray(graph.skills)||!Array.isArray(graph.connections))
    error('INVALID_SKILL_SCHEMA','/graph');
  const next=clone(graph);
  next.nodes=next.skills.map(({skillId,skillDefinitionRef,...other})=>({
    ...other,nodeId:skillId,definitionRef:skillDefinitionRef
  }));
  delete next.skills;
  next.connections=next.connections.map(link=>({
    ...link,
    from:{...link.from,nodeId:link.from.skillId},
    to:{...link.to,nodeId:link.to.skillId}
  }));
  for(const link of next.connections){
    delete link.from.skillId;
    delete link.to.skillId;
  }
  return next;
}
function legacySnapshot(value){
  const snapshot=normalizeSkillSnapshot(value,{source:'skill'});
  const copyOfSnapshot=clone(snapshot);
  copyOfSnapshot.graph=legacyGraph(snapshot.graph);
  copyOfSnapshot.definitions=copyOfSnapshot.skillDefinitions;
  delete copyOfSnapshot.skillDefinitions;
  return copyOfSnapshot;
}
function toLegacySelector(value,path){
  if(!value||typeof value!=='object')error('INVALID_SKILL_SELECTOR',path);
  if(own(value,'nodeId')||own(value,'localNodeKey'))
    error('UNEXPECTED_LEGACY_SCHEMA',path);
  const selector=clone(value);
  if(own(selector,'skillId')){selector.nodeId=selector.skillId;delete selector.skillId;}
  if(own(selector,'localSkillKey')){
    selector.localNodeKey=selector.localSkillKey;delete selector.localSkillKey;
  }
  return selector;
}
function toLegacyPatch(patch){
  if(!patch||typeof patch!=='object'||!Array.isArray(patch.operations))
    error('INVALID_SKILL_PATCH','/');
  // New Skill endpoints must not accept Node-shaped patch data.
  if(own(patch,'definitions'))error('UNEXPECTED_LEGACY_SCHEMA','/');
  for(const [i,op] of patch.operations.entries()){
    const path='/operations/'+i;
    if(!op||typeof op!=='object')error('INVALID_SKILL_OPERATION',path);
    for(const field of ['nodeId','localNodeKey','nodeRef','definitionRef']){
      if(own(op,field))error('UNEXPECTED_LEGACY_SCHEMA',path+'/'+field);
    }
    for(const edge of ['from','to']){
      if(op[edge]&&own(op[edge],'node'))
        error('UNEXPECTED_LEGACY_SCHEMA',path+'/'+edge+'/node');
    }
    if(typeof op.op==='string'&&
      (op.op.startsWith('node.')||op.op.startsWith('definition.')))
      error('UNEXPECTED_LEGACY_SCHEMA',path+'/op');
  }
  const normalized=normalizeSkillPatch(patch,{source:'skill'});
  const next=clone(normalized);
  next.definitions=next.skillDefinitions??[];
  delete next.skillDefinitions;
  const names={
    'skill.add':'node.add',
    'skill.update':'node.update',
    'skill.delete':'node.delete',
    'skill.appearance':'definition.appearance',
    'skill.definition.delete':'definition.delete'
  };
  for(const [i,op] of next.operations.entries()){
    const path='/operations/'+i;
    if(!own(names,op.op)&&!['link.add','link.remove'].includes(op.op))
      error('UNSUPPORTED_SKILL_PATCH_OPERATION',path+'/op');
    op.op=names[op.op]||op.op;
    for(const [newName,legacyName] of [
      ['skillId','nodeId'],['localSkillKey','localNodeKey'],
      ['skillDefinitionRef','definitionRef']
    ]){
      if(own(op,newName)){op[legacyName]=op[newName];delete op[newName];}
    }
    if(own(op,'skillRef')){
      op.nodeRef=toLegacySelector(op.skillRef,path+'/skillRef');
      delete op.skillRef;
    }
    if(op.op==='link.add'){
      for(const edge of ['from','to']){
        if(!op[edge]||!op[edge].skill)
          error('INVALID_SKILL_ENDPOINT',path+'/'+edge);
        op[edge].node=toLegacySelector(op[edge].skill,path+'/'+edge+'/skill');
        delete op[edge].skill;
      }
    }
  }
  return next;
}
function skillRefs(refs){
  const result={};
  for(const [key,value] of Object.entries(refs)){
    result[key.startsWith('node:')?'skill:'+key.slice(5):key]=value;
  }
  return result;
}
export function computeSkillScope(graph,targets,mode='closed'){
  return computeScope(legacyGraph(graph),targets,mode);
}
export class SkillGraphRepository {
  #legacy=new MemoryGraphRepository();
  create(workspaceId,graphId){
    return normalizeSkillSnapshot(this.#legacy.create(workspaceId,graphId));
  }
  get(workspaceId,graphId){
    return normalizeSkillSnapshot(this.#legacy.get(workspaceId,graphId));
  }
  getRevision(workspaceId,graphId,revision){
    return normalizeSkillSnapshot(this.#legacy.getRevision(workspaceId,graphId,revision));
  }
  restore(workspaceId,graphId,snapshot){
    this.#legacy.restore(workspaceId,graphId,legacySnapshot(snapshot));
  }
  apply(workspaceId,patch,ids){
    const result=this.#legacy.apply(workspaceId,toLegacyPatch(patch),ids);
    return {...result,createdRefs:skillRefs(result.createdRefs)};
  }
}

// Read-only legacy evidence validation must use the same field adapter as graph execution.
export {legacySnapshot as toLegacySkillSnapshot,toLegacyPatch as toLegacySkillPatch};
