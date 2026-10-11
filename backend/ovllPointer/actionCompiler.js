import {MemoryGraphRepository,KernelError} from './graph.js';
import {createContractValidation} from './validation.js';
import {withPointerCatalog} from './nodeCatalog.js';
export const ACTION_PLAN_CONTRACT='action-plan.v1';
export const SEMANTIC_ACTION_FIELDS=Object.freeze({
 'node.define':['alias','purpose','instruction','executorKind','inputs','outputs','requiredCapabilities','procedureRef','presentation','name','createInstance','request','settings','instanceInputs'],
 'definition.revise':['alias','supersedes','purpose','instruction','executorKind','inputs','outputs','requiredCapabilities','procedureRef','presentation'],
 'node.add':['alias','definition','request','settings','inputs'],
 'node.update':['target','definition','request','settings','inputs'],
 'node.delete':['target','removeIncidentLinks'],
 'definition.appearance':['definition','presentation'],
 'definition.delete':['definition'],
 'link.add':['kind','from','to'],
 'link.remove':['linkId'],
 'execute':['target','targets','damMode','inputs'],
 'function.save':['function','baseFunctionRef'],
 'question.ask':['question']
});
const validation=createContractValidation();
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(x);
const aliasKey=x=>typeof x==='string'&&x.length>0&&x.length<=160&&x.trim()===x&&!/[\u0000-\u001f]/.test(x);
const copy=x=>structuredClone(x);
const own=(o,k)=>Object.hasOwn(o,k);
function fail(code,path='/',extra={}){
 const error=new KernelError(code,code,422);
 error.validationIssues=[{path,rule:code.toLowerCase().replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),...extra}];
 throw error;
}
function fields(value,allowed,code,path){
 if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail(code,path);
}
export function isActionPlan(value){return object(value)&&own(value,'contract');}
export function compileActionPlan(plan,{snapshot,capabilities=[],executionAuthorization,savedFunctions=[],createdNodeIds={},continuation,actionKeyPrefix='a'}={}){
 fields(plan,['contract','message','actions','needs','executionIntent'],'INVALID_ACTION_PLAN','/');
 if(plan.contract!==ACTION_PLAN_CONTRACT)fail('UNKNOWN_ACTION_PLAN_CONTRACT','/contract');
 if(plan.actions!==undefined&&(!Array.isArray(plan.actions)||plan.actions.length>256))fail('INVALID_ACTION_PLAN','/actions');
 if(plan.needs?.length&&plan.actions?.length)fail('NEEDS_ACTION_BARRIER','/needs');
 for(const [index,a] of (plan.actions||[]).entries()){
  if(!object(a)||!own(SEMANTIC_ACTION_FIELDS,a.action))fail('UNSUPPORTED_SEMANTIC_ACTION','/actions/'+index+'/action');
  fields(a,['action',...SEMANTIC_ACTION_FIELDS[a.action]],'INVALID_ACTION_FIELDS','/actions/'+index);
 }
 const source=withPointerCatalog(snapshot),graph=source.graph;
 if(!graph)fail('GRAPH_CONTEXT_REQUIRED');
 const supported=new Set(capabilities),actions=[],nodeAliases=new Map(),definitionAliases=new Map();
 const nodeAdds=new Map(),previewNodeIds=new Map();let patch=null,seq=0,currentPath='/',effectStarted=false,previewSeq=0;
 const previewIdentities=new Set([...source.definitions.map(d=>d.definitionId),...graph.nodes.map(n=>n.nodeId),...graph.connections.map(l=>l.id)]);
 const previewId=()=>{
  let suffix;do{suffix='compiler_preview_'+(++previewSeq);}while(['n_','d_','l_'].some(prefix=>previewIdentities.has(prefix+suffix)));
  for(const prefix of ['n_','d_','l_'])previewIdentities.add(prefix+suffix);
  return suffix;
 };
 const preview=new MemoryGraphRepository();preview.restore('compiler',graph.graphId,source);
 const turn={...(plan.message===undefined?{}:{message:plan.message}),
  ...(plan.executionIntent===undefined?{}:{executionIntent:plan.executionIntent}),
  ...(plan.needs?.length?{needs:copy(plan.needs)}:{})};
 const state=()=>preview.get('compiler',graph.graphId);
 const checkSupport=kind=>{if(!supported.has(kind))fail('UNSUPPORTED_ACTION',currentPath);};
 const emit=(kind,args)=>{
  checkSupport(kind);const localKey=actionKeyPrefix+(++seq);
  const action={localKey,kind,args,...(actions.length?{dependsOn:[actions.at(-1).localKey]}:{})};
  actions.push(action);return action;
 };
 const ensurePatch=()=>{
  if(effectStarted)fail('GRAPH_EDIT_AFTER_EFFECT',currentPath);
  checkSupport('ir.applyPatch');
  patch??={graphId:graph.graphId,expectedGraphRevision:graph.revision,definitions:[],operations:[]};
  return patch;
 };
 const selector=(s,kinds)=>{
  const permitted=s?.kind==='created'?['kind','alias']:s?.kind==='builtin'?['kind','type']:['kind',kinds==='node'?'nodeId':'definitionId',...(kinds==='node'?[]:['version'])];
  fields(s,permitted,'INVALID_SELECTOR',currentPath);
  if(s.kind==='created'&&!aliasKey(s.alias)||s.kind==='existing'&&!key(kinds==='node'?s.nodeId:s.definitionId)||s.kind==='builtin'&&(kinds==='node'||!key(s.type))||!['created','existing','builtin'].includes(s.kind))fail('INVALID_SELECTOR',currentPath);
 };
 const definitionRef=s=>{
  selector(s,'definition');
  if(s.kind==='created'){
   const localDefinitionKey=definitionAliases.get(s.alias);if(!localDefinitionKey)fail('UNKNOWN_DEFINITION_ALIAS',currentPath);
   return {localDefinitionKey};
  }
  const id=s.kind==='builtin'?'builtin:'+s.type:s.definitionId;
  const found=source.definitions.filter(d=>d.definitionId===id&&(s.version===undefined||d.version===s.version));
  if(!found.length)fail('UNKNOWN_DEFINITION',currentPath);
  if(found.length!==1)fail('AMBIGUOUS_DEFINITION_VERSION',currentPath);
  return {definitionId:id,version:found[0].version};
 };
 const nodeRef=s=>{
  selector(s,'node');
  if(s.kind==='created'){
   if(own(createdNodeIds,s.alias)){
    const nodeId=createdNodeIds[s.alias];if(!key(nodeId)||!graph.nodes.some(n=>n.nodeId===nodeId))fail('UNKNOWN_NODE',currentPath);
    return {nodeId};
   }
   const localNodeKey=nodeAliases.get(s.alias);if(!localNodeKey)fail('UNKNOWN_NODE_ALIAS',currentPath);
   return {localNodeKey};
  }
  if(!graph.nodes.some(n=>n.nodeId===s.nodeId)||patch?.operations.some(o=>o.op==='node.delete'&&o.nodeId===s.nodeId))fail('UNKNOWN_NODE',currentPath);
  return {nodeId:s.nodeId};
 };
 const declare=(map,alias,prefix)=>{
  if(!aliasKey(alias))fail('INVALID_ALIAS',currentPath);
  if(map.has(alias))fail('DUPLICATE_ALIAS',currentPath);
  const result=prefix+(map.size+1);map.set(alias,result);return result;
 };
 const settings=(a,base={})=>{
  if(a.settings!==undefined&&!object(a.settings))fail('INVALID_SETTINGS',currentPath);
  if(a.request!==undefined&&(typeof a.request!=='string'||a.settings?.request!==undefined&&a.settings.request!==a.request))fail('CONFLICTING_REQUEST',currentPath);
  return {...copy(base),...copy(a.settings||{}),...(a.request===undefined?{}:{request:a.request})};
 };
 const addNode=(a,ref,bindings)=>{
  const p=ensurePatch(),localNodeKey=declare(nodeAliases,a.alias,'n');
  const op={op:'node.add',localNodeKey,definitionRef:ref,
   ...(a.settings!==undefined||a.request!==undefined?{settings:settings(a)}:{}),
   ...(bindings===undefined?{}:{inputBindings:copy(bindings)})};
  p.operations.push(op);nodeAdds.set(localNodeKey,op);
 };
 const flush=()=>{
  if(!patch)return;
  const action=emit('ir.applyPatch',{patch});
  if(!validation.validateTurn({actions:[action]}))fail('INVALID_COMPILED_TURN',currentPath);
  try{
   const applied=preview.apply('compiler',patch,previewId);
   for(const op of patch.operations.filter(o=>o.op==='node.add'))previewNodeIds.set(op.localNodeKey,applied.createdRefs['node:'+op.localNodeKey]);
  }
  catch(error){error.validationIssues=[{path:currentPath,rule:error.code.toLowerCase().replace(/_([a-z])/g,(_,c)=>c.toUpperCase())}];throw error;}
  patch=null;
 };
 const runTarget=s=>{
  const ref=nodeRef(s);
  if(ref.nodeId)return ref;
  const producer=actions.find(a=>a.kind==='ir.applyPatch'&&a.args.patch.operations.some(o=>o.op==='node.add'&&o.localNodeKey===ref.localNodeKey));
  if(!producer)fail('UNKNOWN_NODE_ALIAS',currentPath);
  return {fromAction:producer.localKey,localNodeKey:ref.localNodeKey};
 };
 for(const [index,a] of (plan.actions||[]).entries()){
  currentPath='/actions/'+index;
  if(['node.define','definition.revise'].includes(a.action)){
   const p=ensurePatch(),localKey=declare(definitionAliases,a.alias,'d'),draft={localKey};
   for(const field of ['purpose','instruction','executorKind','inputs','outputs','requiredCapabilities','procedureRef','presentation'])if(own(a,field))draft[field]=copy(a[field]);
   if(a.name!==undefined){
    if(draft.presentation?.name!==undefined&&draft.presentation.name!==a.name)fail('CONFLICTING_PRESENTATION',currentPath);
    draft.presentation={...(draft.presentation||{}),name:a.name};
   }
   if(a.action==='definition.revise'){
    draft.supersedes=definitionRef(a.supersedes);if(draft.supersedes.localDefinitionKey)fail('INVALID_SELECTOR',currentPath);
   }
   if(a.createInstance!==undefined&&typeof a.createInstance!=='boolean')fail('INVALID_ACTION_FIELDS',currentPath);
   if(a.createInstance!==true&&['request','settings','instanceInputs'].some(k=>own(a,k)))fail('INSTANCE_REQUIRED',currentPath);
   p.definitions.push(draft);
   if(a.createInstance===true)addNode(a,{localDefinitionKey:localKey},a.instanceInputs);
  }else if(a.action==='node.add')addNode(a,definitionRef(a.definition),a.inputs);
  else if(a.action==='node.update'){
   const p=ensurePatch(),ref=nodeRef(a.target);
   const pending=ref.localNodeKey?nodeAdds.get(ref.localNodeKey):null;
   const earlier=p.operations.filter(o=>o.op==='node.update'&&o.nodeId===ref.nodeId&&own(o,'settings')).at(-1);
   const base=pending||earlier||graph.nodes.find(n=>n.nodeId===ref.nodeId);
   const changes={...(a.definition===undefined?{}:{definitionRef:definitionRef(a.definition)}),
    ...(a.settings!==undefined||a.request!==undefined?{settings:settings(a,base?.settings)}:{}),
    ...(a.inputs===undefined?{}:{inputBindings:copy(a.inputs)})};
   if(!Object.keys(changes).length)fail('EMPTY_NODE_UPDATE',currentPath);
   if(pending)Object.assign(pending,changes);else p.operations.push({op:'node.update',nodeId:ref.nodeId,...changes});
  }else if(a.action==='node.delete'){
   const p=ensurePatch(),ref=nodeRef(a.target);
   if(!ref.nodeId)fail('PERSISTENT_NODE_REQUIRED',currentPath);
   if(a.removeIncidentLinks!==undefined&&typeof a.removeIncidentLinks!=='boolean')fail('INVALID_ACTION_FIELDS',currentPath);
   if(a.removeIncidentLinks===true){
    if(p.operations.some(o=>o.op==='link.add'&&[o.from.node.nodeId,o.to.node.nodeId].includes(ref.nodeId)))fail('CONFLICTING_NODE_DELETE',currentPath);
    for(const link of graph.connections.filter(l=>l.from.nodeId===ref.nodeId||l.to.nodeId===ref.nodeId))
     if(!p.operations.some(o=>o.op==='link.remove'&&o.linkId===link.id))p.operations.push({op:'link.remove',linkId:link.id});
   }
   p.operations.push({op:'node.delete',nodeId:ref.nodeId});
  }else if(a.action.startsWith('definition.')){
   const p=ensurePatch(),ref=definitionRef(a.definition);if(ref.localDefinitionKey)fail('PERSISTENT_DEFINITION_REQUIRED',currentPath);
   p.operations.push({op:a.action,definitionRef:ref,...(a.action==='definition.appearance'?{presentation:copy(a.presentation)}:{})});
  }else if(a.action==='link.add'){
   const p=ensurePatch(),endpoint=e=>{fields(e,['node','port'],'INVALID_ENDPOINT',currentPath);return {node:nodeRef(e.node),port:e.port};};
   p.operations.push({op:'link.add',localLinkKey:'l'+(p.operations.length+1),kind:a.kind,from:endpoint(a.from),to:endpoint(a.to)});
  }else if(a.action==='link.remove'){
   const p=ensurePatch();if(!graph.connections.some(l=>l.id===a.linkId))fail('UNKNOWN_LINK',currentPath);
   p.operations.push({op:'link.remove',linkId:a.linkId});
  }else{
   if(a.action==='execute'){
    if(executionAuthorization!=='requested')fail('EXECUTION_NOT_AUTHORIZED',currentPath);
    if(plan.executionIntent!=='requested')fail('EXPLICIT_EXECUTION_REQUIRED','/executionIntent');
   }
   flush();effectStarted=true;
   if(a.action==='execute'){
    if(a.target?.kind==='function'){
     fields(a.target,['kind','ref'],'INVALID_SELECTOR',currentPath);
     if(a.targets!==undefined||a.damMode!==undefined)fail('INVALID_ACTION_FIELDS',currentPath);
     const ref=a.target.ref;
     const candidates=savedFunctions.filter(f=>typeof ref==='string'?f.id===ref:(f.id===(ref?.id||ref?.functionId)&&f.version===ref.version));
     if(candidates.length!==1)fail(candidates.length?'AMBIGUOUS_FUNCTION':'UNKNOWN_FUNCTION',currentPath);
     const fn=candidates[0],inputs=a.inputs??{};
     if(fn.inputsTotal!==undefined&&fn.inputsTotal!==(fn.inputs?.length||0))fail('FUNCTION_CONTRACT_READ_REQUIRED',currentPath);
     if(!object(inputs))fail('INVALID_FUNCTION_INPUT',currentPath);
     if(Object.keys(inputs).some(name=>!fn.inputs?.some(p=>p.name===name)))fail('UNKNOWN_FUNCTION_INPUT',currentPath);
     if(fn.inputs?.some(p=>p.required===true&&!own(inputs,p.name)))fail('FUNCTION_INPUT_REQUIRED',currentPath);
     emit('function.run',{functionRef:copy(ref),inputBindings:copy(inputs)});
    }else{
     if(a.inputs!==undefined||own(a,'target')===own(a,'targets'))fail('INVALID_ACTION_FIELDS',currentPath);
     const targets=a.targets??[a.target];if(!Array.isArray(targets)||!targets.length)fail('INVALID_TARGETS',currentPath);
     const resolved=targets.map(runTarget);
     for(const target of resolved)if(target.nodeId&&!state().graph.nodes.some(n=>n.nodeId===target.nodeId))fail('UNKNOWN_NODE',currentPath);
     emit('run.start',{targets:resolved,damMode:a.damMode??'closed'});
    }
   }else if(a.action==='function.save'){
    const fn=copy(a.function);
    if(!object(fn))fail('INVALID_FUNCTION_DRAFT',currentPath);
    if(fn.procedure?.kind==='graph'){
     fields(fn.procedure,['kind','graphRef'],'INVALID_FUNCTION_DRAFT',currentPath);
     fn.procedure.graphRef??={graphId:graph.graphId,revision:state().graph.revision};
    }
    let requiresState=false;
    for(const name of ['inputMap','outputMap'])if(fn[name]!==undefined){
     if(!object(fn[name]))fail('INVALID_FUNCTION_DRAFT',currentPath+'/'+name);
     for(const [port,target] of Object.entries(fn[name])){
      if(!object(target))fail('INVALID_FUNCTION_DRAFT',currentPath+'/'+name);
      if(own(target,'node')){
       fields(target,['node','port',...(name==='inputMap'?['kind']:[])],'INVALID_FUNCTION_DRAFT',currentPath+'/'+name);
       const ref=nodeRef(target.node);
       if(ref.localNodeKey)requiresState=true;
       fn[name][port]={nodeId:ref.nodeId||previewNodeIds.get(ref.localNodeKey),port:target.port,...(target.kind===undefined?{}:{kind:target.kind})};
      }
     }
    }
    if(!validation.validate('FunctionDraft',fn))fail('INVALID_FUNCTION_DRAFT',currentPath+'/function');
    if(requiresState){
     if(!continuation)fail('CREATED_FUNCTION_MAP_REQUIRES_STATE',currentPath);
     continuation.plan={contract:ACTION_PLAN_CONTRACT,actions:copy(plan.actions.slice(index)),...(plan.executionIntent===undefined?{}:{executionIntent:plan.executionIntent})};
     continuation.aliasTargets=Object.fromEntries([...nodeAliases].map(([alias,localNodeKey])=>{
      const producer=actions.find(x=>x.kind==='ir.applyPatch'&&x.args.patch.operations.some(o=>o.op==='node.add'&&o.localNodeKey===localNodeKey));
      return [alias,{fromAction:producer.localKey,localNodeKey}];
     }));
     break;
    }
    emit('function.save',{function:fn,...(a.baseFunctionRef===undefined?{}:{baseFunctionRef:copy(a.baseFunctionRef)})});
   }else{
    const {action,...args}=a;emit('question.ask',copy(args));
   }
  }
 }
 currentPath='/actions';flush();
 if(actions.length)turn.actions=actions;
 if(!validation.validateTurn(turn))fail('INVALID_COMPILED_TURN');
 return turn;
}
