import {serializeSkillReference,parseSkillReference} from './ovllSkillReferences.mjs';
// Pure, in-memory reference lookup. Parsing a token never confers access.
// The caller must provide ONLY definitions/functions visible in its scope.
// Backend prompting must reconstruct permissions from server-side state.
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=160;
const validVersion=x=>Number.isSafeInteger(x)&&x>0;
const label=x=>String(x?.presentation?.name||x?.name||x?.title||x?.purpose||'').trim();

function defsFrom(input) {
  if(Array.isArray(input))return input.filter(record);
  if(!record(input))return [];
  return Object.entries(input).filter(([,value])=>record(value))
    .map(([key,value])=>({definitionId:value.definitionId||key,...value}));
}
const functionId=x=>x?.functionId||x?.id;
const sameVersion=(a,b)=>a===b&&validVersion(a);

export function createSkillReferenceResolver({
  getSkillDefinitions=()=>[],getCanvasGraph=()=>null,
  getFunctions=()=>[],getCurrentScope=()=>null
}={}) {
  function definitions(){return defsFrom(getSkillDefinitions());}
  function functions(){const list=getFunctions();return Array.isArray(list)?list.filter(record):[];}
  function getScope(){const scope=getCurrentScope();return record(scope)?scope:null;}
  function canvas(){
    const scope=getScope(),source=getCanvasGraph();
    const graph=record(source?.graph)?source.graph:source;
    if(!validId(scope?.graphId)||!record(graph)||graph.graphId!==scope.graphId||
      !Array.isArray(graph.skills))return null;
    return graph;
  }
  function resolve(value) {
    if(!record(value))return null;
    // Only known, canonical reference fields can cross the rendering boundary.
    // Do not retain caller-provided names, icons, admin flags or metadata.
    let reference;
    try{reference=parseSkillReference(serializeSkillReference(value))}
    catch{return null}
    if(!reference)return null;
    let definition=null,recordItem=null,kind=reference.kind,scope=null;
    if(kind==='skill-definition'){
      if(!validId(reference.definitionId))return null;
      const candidates=definitions().filter(d=>d.definitionId===reference.definitionId&&
        validVersion(d.version)&&
        (reference.version===undefined||sameVersion(d.version,reference.version)));
      if(candidates.length!==1)return null;
      definition=candidates[0];
    }else if(kind==='skill-canvas'){
      if(!validId(reference.graphId)||!validId(reference.skillId))return null;
      const graph=canvas();
      if(!graph||graph.graphId!==reference.graphId)return null;
      const items=graph.skills.filter(item=>item?.skillId===reference.skillId);
      if(items.length!==1)return null;
      recordItem=items[0];scope=graph.graphId;
      const dr=recordItem.skillDefinitionRef;
      if(!validId(dr?.definitionId)||!validVersion(dr?.version))return null;
      const defMatches=definitions().filter(item=>item.definitionId===dr.definitionId&&
        sameVersion(item.version,dr.version));
      if(defMatches.length!==1)return null;
      definition=defMatches[0];
    }else if(kind==='function'){
      if(!validId(reference.functionId))return null;
      const candidates=functions().filter(item=>functionId(item)===reference.functionId&&
        (reference.version===undefined||
          sameVersion(item.version,reference.version)));
      if(candidates.length!==1)return null;
      recordItem=candidates[0];
    }else return null;
    const name=label(recordItem)||label(definition);
    if(!name&&!recordItem)return null;
    return Object.freeze({
      kind,reference,
      label:name||'캔버스 스킬 #'+reference.skillId,
      iconKey:recordItem?.presentation?.iconKey||recordItem?.iconKey||
        definition?.presentation?.iconKey||definition?.iconKey||null,
      color:recordItem?.presentation?.color||recordItem?.color||
        definition?.presentation?.color||definition?.color||null,
      scope,disabled:false
    });
  }
  function allowedReferences(){
    const result=[];
    for(const def of definitions()){
      if(!validId(def.definitionId)||!validVersion(def.version))continue;
      const ref={kind:'skill-definition',definitionId:def.definitionId,version:def.version};
      if(resolve(ref))result.push(ref);
    }
    const graph=canvas();
    if(graph){
      for(const skill of graph.skills){
        if(!validId(skill?.skillId))continue;
        const ref={kind:'skill-canvas',graphId:graph.graphId,skillId:skill.skillId};
        if(resolve(ref))result.push(ref);
      }
    }
    for(const fn of functions()){
      const id=functionId(fn);
      if(!validId(id))continue;
      const ref={kind:'function',functionId:id};
      if(validVersion(fn.version))ref.version=fn.version;
      if(resolve(ref))result.push(ref);
    }
    return result;
  }
  return Object.freeze({resolve,allowedReferences});
}
