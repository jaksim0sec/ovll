(function(global){
"use strict";
const KEY="ovll:pointer:functions:v1";
const clone=v=>JSON.parse(JSON.stringify(v));
function read(){
  try{const a=JSON.parse(global.localStorage.getItem(KEY)||global.localStorage.getItem('ovll:vnext:functions:v1')||"[]");
    return Array.isArray(a)?a.filter(x=>x&&x.id&&x.snapshot?.graph&&Array.isArray(x.targets)).slice(-30):[];}
  catch{return [];}
}
function exposedInputs(snapshot,targets){
  const scope=new Set(targets),queue=[...targets];
  while(queue.length){const id=queue.shift();for(const l of snapshot.graph.connections||[])
    if(l.to.nodeId===id&&!scope.has(l.from.nodeId)){scope.add(l.from.nodeId);queue.push(l.from.nodeId);}}
  const exposed=[];
  for(const node of snapshot.graph.nodes.filter(n=>scope.has(n.nodeId))){
    const def=snapshot.definitions.find(d=>d.definitionId===node.definitionRef?.definitionId&&d.version===node.definitionRef?.version);
    if(def?.executorKind==='tool_task'&&def.requiredCapabilities?.length===1&&def.requiredCapabilities[0]==='file.read_local')
      exposed.push({name:node.nodeId+':file',role:'입력 파일',representation:'json',required:true,nodeId:node.nodeId,port:'file',kind:'file'});
    for(const port of def?.inputs||[])if(!(snapshot.graph.connections||[]).some(l=>l.kind==='data'&&l.to.nodeId===node.nodeId&&l.to.port===port.name))
      exposed.push({...port,name:node.nodeId+':'+port.name,nodeId:node.nodeId,port:port.name});
  }
  return exposed;
}
function save({purpose,snapshot,targets,inputs=[],outputs=[],invariants=[],inputMap,presentation}={}){
  if(typeof purpose!=="string"||!purpose.trim()||purpose.length>2400||
    !snapshot?.graph?.graphId||!Number.isInteger(snapshot.graph.revision)||
    !Array.isArray(snapshot.graph.nodes)||!Array.isArray(snapshot.definitions)||
    !Array.isArray(targets)||!targets.length||targets.some(id=>
      !snapshot.graph.nodes.some(n=>n.nodeId===id))||JSON.stringify(snapshot).length>50000)
    throw new Error("INVALID_LOCAL_FUNCTION");
  const exposed=exposedInputs(snapshot,targets);
  if(!inputs.length)inputs=exposed.map(({nodeId,port,kind,...rest})=>rest);
  const mapping={};
  for(const input of inputs){
    const candidates=exposed.filter(p=>p.name===input.name||p.port===input.name);
    const target=inputMap?.[input.name]||(candidates.length===1?{nodeId:candidates[0].nodeId,port:candidates[0].port,...(candidates[0].kind?{kind:candidates[0].kind}:{})}:null);
    if(!target||!exposed.some(p=>p.nodeId===target.nodeId&&p.port===target.port&&p.representation===input.representation))
      throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    const actual=exposed.find(p=>p.nodeId===target.nodeId&&p.port===target.port);
    if(target.kind!==undefined&&target.kind!==(actual.kind||'input'))throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    mapping[input.name]={...target,kind:actual.kind||'input'};
  }
  if(!outputs.length)outputs=snapshot.graph.nodes.filter(n=>targets.includes(n.nodeId)).flatMap(n=>{
    const d=snapshot.definitions.find(d=>d.definitionId===n.definitionRef?.definitionId&&d.version===n.definitionRef?.version);
    return (d?.outputs||[]).map(p=>({...p,name:n.nodeId+':'+p.name}));});
  const a=read();if(a.length>=30)throw new Error("LOCAL_FUNCTION_LIMIT");
  const item={id:"fn_"+global.crypto.randomUUID().replace(/-/g,""),version:1,purpose:purpose.trim(),
    snapshot:clone(snapshot),targets:[...new Set(targets)],inputs:clone(inputs),inputMap:clone(mapping),outputs:clone(outputs),
    invariants:clone(invariants),verificationStatus:"draft",createdAt:Date.now(),
    ...(presentation&&typeof presentation==="object"?{presentation:clone(presentation)}:{})};
  global.localStorage.setItem(KEY,JSON.stringify([...a,item]));
  return clone(item);
}
const list=()=>clone(read().map(({snapshot,...rest})=>rest));
function remove(id){const all=read(),remaining=all.filter(item=>item.id!==id);
  if(remaining.length===all.length)return false;
  global.localStorage.setItem(KEY,JSON.stringify(remaining));return true;}
const get=id=>{const x=read().find(a=>a.id===id);return x?clone(x):null;};
function saveDraft(draft,snapshot){
  if(draft?.procedure?.kind==='model_task'){
    const suffix=global.crypto.randomUUID().replace(/-/g,''),definitionId='d_fn_'+suffix,nodeId='n_fn_'+suffix;
    snapshot={graph:{graphId:'g_fn_'+suffix,revision:1,nodes:[{nodeId,definitionRef:{definitionId,version:1},settings:{},inputBindings:{}}],connections:[]},
      definitions:[{definitionId,version:1,purpose:draft.purpose,instruction:draft.procedure.instruction,
        executorKind:'model_task',inputs:clone(draft.inputs),outputs:clone(draft.outputs),requiredCapabilities:['model_task']}]};
    return save({...draft,snapshot,targets:[nodeId]});
  }
  if(draft?.procedure?.kind!=='graph'||draft.procedure.graphRef?.graphId!==snapshot?.graph?.graphId||
    draft.procedure.graphRef.revision!==snapshot.graph.revision)throw new Error('LOCAL_FUNCTION_GRAPH_MISMATCH');
  const targets=snapshot.graph.nodes.filter(n=>!snapshot.graph.connections.some(l=>l.from.nodeId===n.nodeId)).map(n=>n.nodeId);
  return save({...draft,snapshot,targets});
}
function bind(fn,bindings={}){
  if(!fn?.snapshot?.graph)throw new Error('LOCAL_FUNCTION_NOT_FOUND');
  const snapshot=clone(fn.snapshot),inputs=fn.inputs||[],mapping=fn.inputMap||{};
  const legacy=fn.inputMap===undefined?exposedInputs(snapshot,fn.targets):[];
  for(const name of Object.keys(bindings))if(!inputs.some(p=>p.name===name))throw new Error('UNKNOWN_FUNCTION_INPUT');
  for(const input of inputs){
    const candidates=legacy.filter(p=>(p.name===input.name||p.port===input.name)&&p.representation===input.representation);
    const target=mapping[input.name]||(candidates.length===1?candidates[0]:null);
    const node=snapshot.graph.nodes.find(n=>n.nodeId===target?.nodeId);
    if(!node)throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    if(!Object.prototype.hasOwnProperty.call(bindings,input.name)){
      if(input.required===true)throw new Error('FUNCTION_INPUT_REQUIRED');
      if(target.kind==='file'){node.settings={...(node.settings||{})};delete node.settings.file;}
      else {node.inputBindings={...(node.inputBindings||{})};delete node.inputBindings[target.port];}
      continue;
    }
    const value=bindings[input.name],rep=input.representation;
    if(target.kind==='file'){
      if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string')throw new Error('FUNCTION_INPUT_TYPE_MISMATCH');
      node.settings={...(node.settings||{}),file:clone(value)};continue;
    }
    if(['text','structured_text','document'].includes(rep)&&typeof value!=='string'||rep==='boolean'&&typeof value!=='boolean'||rep==='number'&&typeof value!=='number')
      throw new Error('FUNCTION_INPUT_TYPE_MISMATCH');
    node.inputBindings={...(node.inputBindings||{}),[target.port]:clone(value)};
  }
  return {snapshot,targets:clone(fn.targets),requestText:fn.purpose,invariants:clone(fn.invariants||[])};
}
global.OvllPointerFunctions=Object.freeze({save,saveDraft,list,get,bind,remove,storageKey:KEY});
})(window);
