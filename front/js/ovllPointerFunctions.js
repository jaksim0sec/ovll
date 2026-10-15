(function(global){
"use strict";
const KEY="ovll:pointer:functions:v2";
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
    if(link.to.skillNodeId===id&&!scope.has(link.from.skillNodeId)){scope.add(link.from.skillNodeId);queue.push(link.from.skillNodeId);}}
  const result=clone(snapshot);
  result.graph.skillNodes=result.graph.skillNodes.filter(n=>scope.has(n.skillNodeId));
  result.graph.connections=(result.graph.connections||[]).filter(l=>scope.has(l.from.skillNodeId)&&scope.has(l.to.skillNodeId));
  result.skillDefinitions=result.skillDefinitions.filter(d=>result.graph.skillNodes.some(n=>n.skillDefinitionRef?.definitionId===d.definitionId&&n.skillDefinitionRef?.version===d.version));
  return result;
}
function read(){
  const raw=global.localStorage.getItem(KEY);
  if(raw!==null){
    const items=JSON.parse(raw);
    if(!Array.isArray(items))throw new Error('INVALID_SAVED_FUNCTIONS');
    return items.filter(x=>x&&x.id&&x.snapshot?.graph&&Array.isArray(x.targets));
  }
  const old=global.localStorage.getItem('ovll:pointer:functions:v1')||global.localStorage.getItem('ovll:vnext:functions:v1');
  if(!old)return [];
  const migrate=global.OvllSkillStorageRuntime?.migrateSavedFunctions;
  if(typeof migrate!=='function')throw new Error('SKILL_IMPORT_UNAVAILABLE');
  const imported=migrate(JSON.parse(old));
  global.localStorage.setItem(KEY,JSON.stringify(imported));
  return imported;
}
function exposedInputs(snapshot,targets){
  const scope=new Set(targets),queue=[...targets];
  while(queue.length){const id=queue.shift();for(const l of snapshot.graph.connections||[])
    if(l.to.skillNodeId===id&&!scope.has(l.from.skillNodeId)){scope.add(l.from.skillNodeId);queue.push(l.from.skillNodeId);}}
  const exposed=[];
  for(const skillNode of snapshot.graph.skillNodes.filter(n=>scope.has(n.skillNodeId))){
    const def=snapshot.skillDefinitions.find(d=>d.definitionId===skillNode.skillDefinitionRef?.definitionId&&d.version===skillNode.skillDefinitionRef?.version);
    if(def?.executorKind==='tool_task'&&def.requiredCapabilities?.length===1&&def.requiredCapabilities[0]==='file.read_local')
      exposed.push({name:skillNode.skillNodeId+':file',role:'입력 파일',representation:'json',required:true,skillNodeId:skillNode.skillNodeId,port:'file',kind:'file'});
    for(const port of def?.inputs||[])if(!(snapshot.graph.connections||[]).some(l=>l.kind==='data'&&l.to.skillNodeId===skillNode.skillNodeId&&l.to.port===port.name))
      exposed.push({...port,name:skillNode.skillNodeId+':'+port.name,skillNodeId:skillNode.skillNodeId,port:port.name});
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
  const outputMap=own(options,'outputMap')?options.outputMap:
    own(options,'outputs')&&base&&JSON.stringify(options.outputs)!==JSON.stringify(base.outputs)?undefined:base?.outputMap;
  let fixedInputs=inherited('fixedInputs')||{};
  if(typeof purpose!=="string"||!purpose.trim()||purpose.length>2400||
    !snapshot?.graph?.graphId||!Number.isInteger(snapshot.graph.revision)||
    !Array.isArray(snapshot.graph.skillNodes)||!Array.isArray(snapshot.skillDefinitions)||
    !Array.isArray(targets)||!targets.length||targets.some(id=>
      !snapshot.graph.skillNodes.some(n=>n.skillNodeId===id)))throw new Error("INVALID_LOCAL_FUNCTION");
  snapshot=extractSnapshot(snapshot,targets);
  if(JSON.stringify(snapshot).length>50000)throw new Error('INVALID_LOCAL_FUNCTION');
  const exposed=exposedInputs(snapshot,targets);
  // Legacy no-input functions treated every remembered binding as a constant.
  // Make those values explicit on revision instead of silently changing their contract.
  if(base&&!base.contractVersion&&!(base.inputs||[]).length&&!own(options,'fixedInputs')&&!(inputs||[]).length){
    fixedInputs={};
    for(const port of exposed){
      const skillNode=base.snapshot.graph.skillNodes.find(n=>n.skillNodeId===port.skillNodeId);
      const value=port.kind==='file'?skillNode?.settings?.file:skillNode?.inputBindings?.[port.port];
      if(value!==undefined)fixedInputs[port.name]=clone(value);
    }
  }
  if(inputs===undefined)inputs=exposed.map(({skillNodeId,port,kind,...rest})=>rest);
  if(!Array.isArray(inputs)||!Array.isArray(invariants)||outputs!==undefined&&!Array.isArray(outputs)||
    !fixedInputs||typeof fixedInputs!=='object'||Array.isArray(fixedInputs))throw new Error('INVALID_LOCAL_FUNCTION');
  const mapping=Object.create(null),destinations=new Set();
  for(const input of inputs){
    if(!input||typeof input.name!=='string'||!input.name||own(mapping,input.name))throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    const candidates=exposed.filter(p=>p.name===input.name||p.port===input.name);
    const target=inputMap?.[input.name]||(candidates.length===1?{skillNodeId:candidates[0].skillNodeId,port:candidates[0].port,...(candidates[0].kind?{kind:candidates[0].kind}:{})}:null);
    if(!target||!exposed.some(p=>p.skillNodeId===target.skillNodeId&&p.port===target.port&&p.representation===input.representation))
      throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    const actual=exposed.find(p=>p.skillNodeId===target.skillNodeId&&p.port===target.port);
    const destination=actual.name;
    if(destinations.has(destination)||target.kind!==undefined&&target.kind!==(actual.kind||'input'))throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    destinations.add(destination);
    mapping[input.name]={skillNodeId:target.skillNodeId,port:target.port,kind:actual.kind||'input'};
  }
  for(const name of Object.keys(fixedInputs)){
    if(!exposed.some(p=>p.name===name))throw new Error('FUNCTION_FIXED_INPUT_MAPPING_REQUIRED');
    if(destinations.has(name))throw new Error('FUNCTION_FIXED_INPUT_CONFLICT');
    validateValue(exposed.find(p=>p.name===name),fixedInputs[name]);
  }
  // A persisted function cannot advertise a required underlying port as optional.
  // The contract must supply it afresh or explicitly pin its value.
  for(const required of exposed.filter(p=>p.required===true)){
    if(own(fixedInputs,required.name))continue;
    const mapped=inputs.find(input=>{
      const target=mapping[input.name];
      return target?.skillNodeId===required.skillNodeId&&target.port===required.port;
    });
    if(!mapped||mapped.required!==true)throw new Error('FUNCTION_REQUIRED_INPUT_CONTRACT');
  }
  const availableOutputs=snapshot.graph.skillNodes.flatMap(skillNode=>{
    const definition=snapshot.skillDefinitions.find(d=>d.definitionId===skillNode.skillDefinitionRef?.definitionId&&
      d.version===skillNode.skillDefinitionRef?.version);
    return (definition?.outputs||[]).map(port=>({
      skillNodeId:skillNode.skillNodeId,port:port.name,representation:port.representation,
      qualifiedName:skillNode.skillNodeId+':'+port.name,target:targets.includes(skillNode.skillNodeId),
      definitionPort:port
    }));
  });
  if(outputs===undefined||!outputs.length)
    outputs=availableOutputs.filter(p=>p.target).map(p=>({...p.definitionPort,name:p.qualifiedName}));
  if(outputMap!==undefined&&(!outputMap||typeof outputMap!=='object'||Array.isArray(outputMap)||
    Object.keys(outputMap).some(name=>!outputs.some(port=>port?.name===name))))
    throw new Error('FUNCTION_OUTPUT_MAPPING_REQUIRED');
  const resolvedOutputMap=Object.create(null),assignedOutputs=new Set();
  for(const output of outputs){
    if(!output||typeof output.name!=='string'||!output.name||
      typeof output.representation!=='string'||own(resolvedOutputMap,output.name))
      throw new Error('FUNCTION_OUTPUT_MAPPING_REQUIRED');
    const requested=outputMap&&own(outputMap,output.name)?outputMap[output.name]:null;
    let possibilities;
    if(requested){
      possibilities=availableOutputs.filter(p=>p.skillNodeId===requested.skillNodeId&&p.port===requested.port);
    }else{
      possibilities=availableOutputs.filter(p=>p.qualifiedName===output.name);
      if(!possibilities.length){
        possibilities=availableOutputs.filter(p=>p.port===output.name&&
          p.representation===output.representation);
        if(possibilities.length>1){
          const selected=possibilities.filter(p=>p.target);
          if(selected.length===1)possibilities=selected;
        }
      }
      if(!possibilities.length)possibilities=availableOutputs.filter(p=>p.target&&
        p.representation===output.representation);
    }
    if(possibilities.length!==1||possibilities[0].representation!==output.representation||
      assignedOutputs.has(possibilities[0].qualifiedName))
      throw new Error('FUNCTION_OUTPUT_MAPPING_REQUIRED');
    const match=possibilities[0];
    assignedOutputs.add(match.qualifiedName);
    resolvedOutputMap[output.name]={skillNodeId:match.skillNodeId,port:match.port};
  }
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
    if(Array.isArray(appearance.view))appearance.view=appearance.view.filter(n=>snapshot.graph.skillNodes.some(skillNode=>skillNode.skillNodeId===n.id));
  }
  const item={id:base?.id||"fn_"+global.crypto.randomUUID().replace(/-/g,""),version:base?base.version+1:1,purpose:purpose.trim(),
    snapshot,targets:[...new Set(targets)],inputs:clone(inputs),inputMap:clone(mapping),outputs:clone(outputs),outputMap:clone(resolvedOutputMap),
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
  if(rep==='object'&&(value===null||typeof value!=='object'||Array.isArray(value))||
    rep==='array'&&!Array.isArray(value))throw new Error('FUNCTION_INPUT_TYPE_MISMATCH');
  if(['text','structured_text','document'].includes(rep)&&typeof value!=='string'||rep==='boolean'&&typeof value!=='boolean'||
    rep==='number'&&(typeof value!=='number'||!Number.isFinite(value))||value===undefined)throw new Error('FUNCTION_INPUT_TYPE_MISMATCH');
}
function assignValue(skillNode,target,value){
  if(target.kind==='file'){
    skillNode.settings={...(skillNode.settings||{})};
    if(value===undefined)delete skillNode.settings.file;else skillNode.settings.file=clone(value);
  }else{
    skillNode.inputBindings={...(skillNode.inputBindings||{})};
    if(value===undefined)delete skillNode.inputBindings[target.port];else skillNode.inputBindings[target.port]=clone(value);
  }
}
function saveDraft(draft,snapshot,options={}){
  draft={...draft,...(options.baseFunctionRef?{baseFunctionRef:options.baseFunctionRef}:{})};
  if(typeof draft.baseFunctionRef==='string'){
    const base=get(draft.baseFunctionRef);draft.baseFunctionRef={id:base.id,version:base.version};
  }
  if(draft?.procedure?.kind==='model_task'){
    const baseRef=draft.baseFunctionRef,base=baseRef?get(baseRef.id||baseRef.functionId,baseRef.version):null;
    const oldSkillNode=base?.snapshot?.graph?.skillNodes?.length===1?base.snapshot.graph.skillNodes[0]:null;
    const oldDefinition=oldSkillNode&&base.snapshot.skillDefinitions.find(d=>d.definitionId===oldSkillNode.skillDefinitionRef?.definitionId&&d.version===oldSkillNode.skillDefinitionRef?.version);
    const suffix=global.crypto.randomUUID().replace(/-/g,''),definitionId=oldDefinition?.definitionId||'d_fn_'+suffix,skillNodeId=oldSkillNode?.skillNodeId||'n_fn_'+suffix;
    const version=oldDefinition?oldDefinition.version+1:1;
    snapshot={graph:{graphId:base?.snapshot?.graph?.graphId||'g_fn_'+suffix,revision:base?base.snapshot.graph.revision+1:1,skillNodes:[{skillNodeId,skillDefinitionRef:{definitionId,version},settings:{},inputBindings:{}}],connections:[]},
      skillDefinitions:[{definitionId,version,purpose:draft.purpose||base?.purpose,instruction:draft.procedure.instruction,
        executorKind:'model_task',inputs:clone(draft.inputs||oldDefinition?.inputs||[]),outputs:clone(draft.outputs||oldDefinition?.outputs||[]),requiredCapabilities:['model_task']}]};
    return save({...draft,snapshot,targets:[skillNodeId]});
  }
  if(draft?.procedure?.kind!=='graph'||draft.procedure.graphRef?.graphId!==snapshot?.graph?.graphId||
    draft.procedure.graphRef.revision!==snapshot.graph.revision)throw new Error('LOCAL_FUNCTION_GRAPH_MISMATCH');
  const sinks=snapshot.graph.skillNodes.filter(n=>!snapshot.graph.connections.some(l=>l.from.skillNodeId===n.skillNodeId)).map(n=>n.skillNodeId);
  const baseRef=draft.baseFunctionRef,base=baseRef?get(baseRef.id||baseRef.functionId,baseRef.version):null;
  const mapped=draft.outputs?.length&&draft.outputs.every(p=>draft.outputMap?.[p.name]?.skillNodeId)?
    [...new Set(draft.outputs.map(p=>draft.outputMap[p.name].skillNodeId))]:null;
  const targets=mapped||options.targets||base?.targets||(sinks.length===1?sinks:null);
  if(!targets?.length)throw new Error('FUNCTION_TARGET_SELECTION_REQUIRED');
  return save({...draft,snapshot,targets});
}
function bind(fn,bindings={}){
  if(!fn?.snapshot?.graph)throw new Error('LOCAL_FUNCTION_NOT_FOUND');
  const snapshot=extractSnapshot(fn.snapshot,fn.targets),inputs=fn.inputs||[],mapping=fn.inputMap||{};
  if(fn.outputMap!==undefined){
    if(!fn.outputMap||typeof fn.outputMap!=='object'||Array.isArray(fn.outputMap)||
      Object.keys(fn.outputMap).length!==(fn.outputs||[]).length)
      throw new Error('FUNCTION_OUTPUT_MAPPING_REQUIRED');
    const destinations=new Set();
    for(const output of fn.outputs||[]){
      const target=fn.outputMap[output.name],skillNode=snapshot.graph.skillNodes.find(n=>n.skillNodeId===target?.skillNodeId);
      const definition=skillNode&&snapshot.skillDefinitions.find(d=>d.definitionId===skillNode.skillDefinitionRef?.definitionId&&d.version===skillNode.skillDefinitionRef?.version);
      if(!target||Object.keys(target).length!==2||!own(target,'skillNodeId')||!own(target,'port')||
        !definition?.outputs?.some(p=>p.name===target.port&&p.representation===output.representation)||
        destinations.has(target.skillNodeId+':'+target.port))throw new Error('FUNCTION_OUTPUT_MAPPING_REQUIRED');
      destinations.add(target.skillNodeId+':'+target.port);
    }
  }
  if(fn.contractVersion>=2||inputs.length){
    for(const skillNode of snapshot.graph.skillNodes)skillNode.inputBindings={};
    const free=exposedInputs(snapshot,fn.targets);
    for(const target of free){
      const skillNode=snapshot.graph.skillNodes.find(n=>n.skillNodeId===target.skillNodeId);
      assignValue(skillNode,target,undefined);
      if(own(fn.fixedInputs||{},target.name)){
        validateValue(target,fn.fixedInputs[target.name]);assignValue(skillNode,target,fn.fixedInputs[target.name]);
      }
    }
  }
  const legacy=fn.inputMap===undefined?exposedInputs(snapshot,fn.targets):[];
  for(const name of Object.keys(bindings))if(!inputs.some(p=>p.name===name))throw new Error('UNKNOWN_FUNCTION_INPUT');
  for(const input of inputs){
    const candidates=legacy.filter(p=>(p.name===input.name||p.port===input.name)&&p.representation===input.representation);
    const target=mapping[input.name]||(candidates.length===1?candidates[0]:null);
    const skillNode=snapshot.graph.skillNodes.find(n=>n.skillNodeId===target?.skillNodeId);
    if(!skillNode)throw new Error('FUNCTION_INPUT_MAPPING_REQUIRED');
    if(!Object.prototype.hasOwnProperty.call(bindings,input.name)){
      if(input.required===true)throw new Error('FUNCTION_INPUT_REQUIRED');
      assignValue(skillNode,target,undefined);
      continue;
    }
    const value=bindings[input.name];
    validateValue({...input,kind:target.kind},value);
    assignValue(skillNode,target,value);
  }
  return {snapshot,targets:clone(fn.targets),requestText:fn.purpose,invariants:clone(fn.invariants||[]),
    ...(fn.outputMap!==undefined?{outputMap:clone(fn.outputMap),
      requiredOutputs:(fn.outputs||[]).filter(output=>output.required===true).map(output=>output.name)}:{})};
}
global.OvllPointerFunctions=Object.freeze({save,saveDraft,list,get,bind,remove,normalizeColor,storageKey:KEY});
})(window);
