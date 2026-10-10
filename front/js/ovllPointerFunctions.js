(function(global){
"use strict";
const KEY="ovll:pointer:functions:v1";
const clone=v=>JSON.parse(JSON.stringify(v));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function normalizeColor(value){
  const hex=String(value||'').trim();
  if(!/^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(hex))return null;
  return (hex.length===4?'#'+[...hex.slice(1)].map(c=>c+c).join(''):hex).toLowerCase();
}
function latest(items){
  const current=new Map();
  for(const item of items)if(!current.has(item.id)||(item.version||1)>(current.get(item.id).version||1))current.set(item.id,item);
  return [...current.values()];
}
function extractSnapshot(snapshot,targets){
  const scope=new Set(targets),queue=[...targets];
  while(queue.length){const id=queue.shift();for(const link of snapshot.graph.connections||[])
    if(link.to.nodeId===id&&!scope.has(link.from.nodeId)){scope.add(link.from.nodeId);queue.push(link.from.nodeId);}}
  const result=clone(snapshot);
  result.graph.nodes=result.graph.nodes.filter(n=>scope.has(n.nodeId));
  result.graph.connections=(result.graph.connections||[]).filter(l=>scope.has(l.from.nodeId)&&scope.has(l.to.nodeId));
  result.definitions=result.definitions.filter(d=>result.graph.nodes.some(n=>n.definitionRef?.definitionId===d.definitionId&&n.definitionRef?.version===d.version));
  return result;
}
function read(){
  try{const a=JSON.parse(global.localStorage.getItem(KEY)||global.localStorage.getItem('ovll:vnext:functions:v1')||"[]");
    return Array.isArray(a)?a.filter(x=>x&&x.id&&x.snapshot?.graph&&Array.isArray(x.targets)):[];}
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
function save(options={}){
  const all=read(),baseRef=options.baseFunctionRef;
  const baseId=baseRef?.id||baseRef?.functionId;
  const base=baseRef?all.find(f=>f.id===baseId&&f.version===baseRef.version):null;
  if(baseRef&&!base)throw new Error('LOCAL_FUNCTION_NOT_FOUND');
  if(base&&latest(all).find(f=>f.id===base.id)?.version!==base.version)throw new Error('FUNCTION_VERSION_CONFLICT');
  const inherited=key=>own(options,key)?options[key]:base?.[key];
  let purpose=inherited('purpose'),snapshot=inherited('snapshot'),targets=inherited('targets');
  let inputs=inherited('inputs'),outputs=inherited('outputs'),invariants=inherited('invariants')||[];
  if(base&&inputs===undefined)inputs=[];
  const inputMap=inherited('inputMap'),presentation=inherited('presentation');
  let fixedInputs=inherited('fixedInputs')||{};
  if(typeof purpose!=="string"||!purpose.trim()||purpose.length>2400||
    !snapshot?.graph?.graphId||!Number.isInteger(snapshot.graph.revision)||
    !Array.isArray(snapshot.graph.nodes)||!Array.isArray(snapshot.definitions)||
    !Array.isArray(targets)||!targets.length||targets.some(id=>
      !snapshot.graph.nodes.some(n=>n.nodeId===id)))throw new Error("INVALID_LOCAL_FUNCTION");
  snapshot=extractSnapshot(snapshot,targets);
  if(JSON.stringify(snapshot).length>50000)throw new Error('INVALID_LOCAL_FUNCTION');
  const exposed=exposedInputs(snapshot,targets);
  // Legacy no-input functions treated every remembered binding as a constant.
  // Make those values explicit on revision instead of silently changing their contract.
  if(base&&!base.contractVersion&&!(base.inputs||[]).length&&!own(options,'fixedInputs')&&!(inputs||[]).length){
    fixedInputs={};
    for(const port of exposed){
      const node=base.snapshot.graph.nodes.find(n=>n.nodeId===port.nodeId);
      const value=port.kind==='file'?node?.settings?.file:node?.inputBindings?.[port.port];
      if(value!==undefined)fixedInputs[port.name]=clone(value);
    }
  }
  if(inputs===undefined)inputs=exposed.map(({nodeId,port,kind,...rest})=>rest);
  if(!Array.isArray(inputs)||!Array.isArray(invariants)||outputs!==undefined&&!Array.isArray(outputs)||
    !fixedInputs||typeof fixedInputs!=='object'||Array.isArray(fixedInputs))throw new Error('INVALID_LOCAL_FUNCTION');
  const mapping=Object.create(null),destinations=new Set();
  for(const input of inputs){
    if(!input||typeof input.name!=='string'||!input.name||own(mapping,input.name))throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    const candidates=exposed.filter(p=>p.name===input.name||p.port===input.name);
    const target=inputMap?.[input.name]||(candidates.length===1?{nodeId:candidates[0].nodeId,port:candidates[0].port,...(candidates[0].kind?{kind:candidates[0].kind}:{})}:null);
    if(!target||!exposed.some(p=>p.nodeId===target.nodeId&&p.port===target.port&&p.representation===input.representation))
      throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    const actual=exposed.find(p=>p.nodeId===target.nodeId&&p.port===target.port);
    const destination=actual.name;
    if(destinations.has(destination)||target.kind!==undefined&&target.kind!==(actual.kind||'input'))throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    destinations.add(destination);
    mapping[input.name]={nodeId:target.nodeId,port:target.port,kind:actual.kind||'input'};
  }
  for(const name of Object.keys(fixedInputs)){
    if(!exposed.some(p=>p.name===name))throw new Error('FUNCTION_FIXED_INPUT_MAPPING_REQUIRED');
    if(destinations.has(name))throw new Error('FUNCTION_FIXED_INPUT_CONFLICT');
    validateValue(exposed.find(p=>p.name===name),fixedInputs[name]);
  }
  if(outputs===undefined||!outputs.length)outputs=snapshot.graph.nodes.filter(n=>targets.includes(n.nodeId)).flatMap(n=>{
    const d=snapshot.definitions.find(d=>d.definitionId===n.definitionRef?.definitionId&&d.version===n.definitionRef?.version);
    return (d?.outputs||[]).map(p=>({...p,name:n.nodeId+':'+p.name}));});
  if(!base&&latest(all).length>=30)throw new Error("LOCAL_FUNCTION_LIMIT");
  let appearance;
  if(presentation&&typeof presentation==='object'){
    appearance=clone({...base?.presentation,...presentation});
    if(own(appearance,'color')){
      appearance.color=normalizeColor(appearance.color);
      if(!appearance.color)throw new Error('INVALID_FUNCTION_COLOR');
    }
    // Only icon keys are persisted; server-owned paths supply the rendered SVG.
    delete appearance.icon;delete appearance.svg;delete appearance.iconSvg;
    if(appearance.iconKey!==undefined&&!/^[a-z][a-z0-9_-]{0,63}$/i.test(appearance.iconKey))throw new Error('INVALID_FUNCTION_ICON');
    if(Array.isArray(appearance.view))appearance.view=appearance.view.filter(n=>snapshot.graph.nodes.some(node=>node.nodeId===n.id));
  }
  const item={id:base?.id||"fn_"+global.crypto.randomUUID().replace(/-/g,""),version:base?base.version+1:1,purpose:purpose.trim(),
    snapshot,targets:[...new Set(targets)],inputs:clone(inputs),inputMap:clone(mapping),outputs:clone(outputs),
    invariants:clone(invariants),fixedInputs:clone(fixedInputs),contractVersion:2,verificationStatus:"draft",createdAt:Date.now(),
    ...(appearance?{presentation:appearance}:{})};
  global.localStorage.setItem(KEY,JSON.stringify([...all,item]));
  return clone(item);
}
const list=()=>clone(latest(read()).map(({snapshot,...rest})=>rest));
function remove(id){const all=read(),remaining=all.filter(item=>item.id!==id);
  if(remaining.length===all.length)return false;
  global.localStorage.setItem(KEY,JSON.stringify(remaining));return true;}
const get=(id,version)=>{const items=read(),x=version===undefined?latest(items).find(a=>a.id===id):items.find(a=>a.id===id&&a.version===version);return x?clone(x):null;};
function validateValue(input,value){
  if(input.kind==='file'){
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.name!=='string')throw new Error('FUNCTION_INPUT_TYPE_MISMATCH');
    return;
  }
  const rep=input.representation;
  if(['text','structured_text','document'].includes(rep)&&typeof value!=='string'||rep==='boolean'&&typeof value!=='boolean'||
    rep==='number'&&(typeof value!=='number'||!Number.isFinite(value))||value===undefined)throw new Error('FUNCTION_INPUT_TYPE_MISMATCH');
}
function assignValue(node,target,value){
  if(target.kind==='file'){
    node.settings={...(node.settings||{})};
    if(value===undefined)delete node.settings.file;else node.settings.file=clone(value);
  }else{
    node.inputBindings={...(node.inputBindings||{})};
    if(value===undefined)delete node.inputBindings[target.port];else node.inputBindings[target.port]=clone(value);
  }
}
function saveDraft(draft,snapshot,options={}){
  draft={...draft,...(options.baseFunctionRef?{baseFunctionRef:options.baseFunctionRef}:{})};
  if(draft?.procedure?.kind==='model_task'){
    const baseRef=draft.baseFunctionRef,base=baseRef?get(baseRef.id||baseRef.functionId,baseRef.version):null;
    const oldNode=base?.snapshot?.graph?.nodes?.length===1?base.snapshot.graph.nodes[0]:null;
    const oldDefinition=oldNode&&base.snapshot.definitions.find(d=>d.definitionId===oldNode.definitionRef?.definitionId&&d.version===oldNode.definitionRef?.version);
    const suffix=global.crypto.randomUUID().replace(/-/g,''),definitionId=oldDefinition?.definitionId||'d_fn_'+suffix,nodeId=oldNode?.nodeId||'n_fn_'+suffix;
    const version=oldDefinition?oldDefinition.version+1:1;
    snapshot={graph:{graphId:base?.snapshot?.graph?.graphId||'g_fn_'+suffix,revision:base?base.snapshot.graph.revision+1:1,nodes:[{nodeId,definitionRef:{definitionId,version},settings:{},inputBindings:{}}],connections:[]},
      definitions:[{definitionId,version,purpose:draft.purpose||base?.purpose,instruction:draft.procedure.instruction,
        executorKind:'model_task',inputs:clone(draft.inputs||oldDefinition?.inputs||[]),outputs:clone(draft.outputs||oldDefinition?.outputs||[]),requiredCapabilities:['model_task']}]};
    return save({...draft,snapshot,targets:[nodeId]});
  }
  if(draft?.procedure?.kind!=='graph'||draft.procedure.graphRef?.graphId!==snapshot?.graph?.graphId||
    draft.procedure.graphRef.revision!==snapshot.graph.revision)throw new Error('LOCAL_FUNCTION_GRAPH_MISMATCH');
  const sinks=snapshot.graph.nodes.filter(n=>!snapshot.graph.connections.some(l=>l.from.nodeId===n.nodeId)).map(n=>n.nodeId);
  const baseRef=draft.baseFunctionRef,base=baseRef?get(baseRef.id||baseRef.functionId,baseRef.version):null;
  const targets=options.targets||base?.targets||(sinks.length===1?sinks:null);
  if(!targets?.length)throw new Error('FUNCTION_TARGET_SELECTION_REQUIRED');
  return save({...draft,snapshot,targets});
}
function bind(fn,bindings={}){
  if(!fn?.snapshot?.graph)throw new Error('LOCAL_FUNCTION_NOT_FOUND');
  const snapshot=extractSnapshot(fn.snapshot,fn.targets),inputs=fn.inputs||[],mapping=fn.inputMap||{};
  if(fn.contractVersion>=2||inputs.length){
    for(const node of snapshot.graph.nodes)node.inputBindings={};
    const free=exposedInputs(snapshot,fn.targets);
    for(const target of free){
      const node=snapshot.graph.nodes.find(n=>n.nodeId===target.nodeId);
      assignValue(node,target,undefined);
      if(own(fn.fixedInputs||{},target.name)){
        validateValue(target,fn.fixedInputs[target.name]);assignValue(node,target,fn.fixedInputs[target.name]);
      }
    }
  }
  const legacy=fn.inputMap===undefined?exposedInputs(snapshot,fn.targets):[];
  for(const name of Object.keys(bindings))if(!inputs.some(p=>p.name===name))throw new Error('UNKNOWN_FUNCTION_INPUT');
  for(const input of inputs){
    const candidates=legacy.filter(p=>(p.name===input.name||p.port===input.name)&&p.representation===input.representation);
    const target=mapping[input.name]||(candidates.length===1?candidates[0]:null);
    const node=snapshot.graph.nodes.find(n=>n.nodeId===target?.nodeId);
    if(!node)throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    if(!Object.prototype.hasOwnProperty.call(bindings,input.name)){
      if(input.required===true)throw new Error('FUNCTION_INPUT_REQUIRED');
      assignValue(node,target,undefined);
      continue;
    }
    const value=bindings[input.name];
    validateValue({...input,kind:target.kind},value);
    assignValue(node,target,value);
  }
  return {snapshot,targets:clone(fn.targets),requestText:fn.purpose,invariants:clone(fn.invariants||[])};
}
global.OvllPointerFunctions=Object.freeze({save,saveDraft,list,get,bind,remove,normalizeColor,storageKey:KEY});
})(window);
