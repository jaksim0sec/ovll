// Server-validated context only; never trust client allowlists or names.
import {segmentSkillReferences,serializeSkillReference} from '../../front/js/ovllSkillReferences.mjs';
import {createSkillReferenceResolver} from '../../front/js/ovllSkillReferenceResolver.mjs';
import {assertCanonicalSkillSnapshot} from '../../front/js/ovllSkillCodec.mjs';

function readable(ref,label,token){
  if(ref.kind==='skill-definition')return '정의된 스킬 "'+label+'" (definitionId='+ref.definitionId+
    (ref.version===undefined?'':', version='+ref.version)+', reference='+token+')';
  if(ref.kind==='skill-canvas')return '캔버스 스킬 #'+ref.skillId+' "'+label+
    '" (graphId='+ref.graphId+', reference='+token+')';
  return '저장 함수 "'+label+'" (functionId='+ref.functionId+
    (ref.version===undefined?'':', version='+ref.version)+', reference='+token+')';
}
export function formatSkillPrompt(value,{snapshot,savedFunctions=[],activeGraphId}={}){
  const text=String(value??''),parts=segmentSkillReferences(text);
  if(!parts.some(part=>part.type==='candidate'))return {requestText:text,issues:[]};
  if(!snapshot?.graph)return {requestText:text,
    issues:parts.filter(p=>p.type==='candidate').map(p=>({code:'SKILL_REFERENCE_CONTEXT_MISSING',token:p.token}))};
  assertCanonicalSkillSnapshot(snapshot);
  if(activeGraphId!==undefined&&activeGraphId!==snapshot.graph.graphId)
    throw new TypeError('INVALID_SKILL_REFERENCE_GRAPH_SCOPE');
  const resolver=createSkillReferenceResolver({
    getSkillDefinitions:()=>snapshot.skillDefinitions,
    getCanvasGraph:()=>snapshot.graph,
    getFunctions:()=>Array.isArray(savedFunctions)?savedFunctions:[],
    getCurrentScope:()=>({graphId:snapshot.graph.graphId})
  });
  const issues=[],pieces=[];
  for(const part of parts){
    if(part.type!=='candidate'){pieces.push(part.text);continue}
    const item=resolver.resolve(part.reference);
    if(!item){
      issues.push({code:'SKILL_REFERENCE_UNAVAILABLE',token:part.token});
      pieces.push(part.token);
      continue;
    }
    pieces.push(readable(item.reference,item.label,serializeSkillReference(item.reference)));
  }
  return {requestText:pieces.join(''),issues};
}
