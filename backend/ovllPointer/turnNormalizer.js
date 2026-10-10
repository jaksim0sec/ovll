import {iconSvg} from './nodeCatalog.js';
import {PATCH_OPERATION_CONTRACTS,PATCH_OPERATION_KINDS} from './validation.js';
// Converts only unambiguous, non-semantic ModelTurn omissions into the wire contract.
// Draft node keys are local graph-patch handles, not persistent identities.
// This module never invents nodes, links, definitions, run targets or effects.
const isKey=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(value);
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normalizePresentation=value=>{
  if(!isObject(value)||typeof value.iconKey!=='string')return value;
  const key=value.iconKey.trim();
  return {...value,iconKey:Object.hasOwn(iconSvg,key)?key:'custom'};
};
// Only omit transport boilerplate for ordinary model tasks; never invent tool capabilities.
function normalizeDefinition(d){
  if(!isObject(d))return d;
  const draft={...d,...(d.presentation===undefined?{}:{presentation:normalizePresentation(d.presentation)})};
  if(d.supersedes!==undefined||
    d.executorKind!==undefined&&d.executorKind!=='model_task')return draft;
  const port=(value)=>isObject(value)&&typeof value.name==='string'?{
    ...value,role:value.role??value.name,representation:value.representation??'json'
  }:value;
  const inputs=Array.isArray(d.inputs)?d.inputs.map(port):
    d.inputs===undefined?[{name:'in',role:'입력',representation:'json',required:false}]:d.inputs;
  const outputs=Array.isArray(d.outputs)?d.outputs.map(port):
    d.outputs===undefined?[{name:'result',role:'결과',representation:'json',required:false}]:d.outputs;
  return {...draft,executorKind:d.executorKind??'model_task',inputs,outputs};
}
function patchOf(action){
  return action?.kind==='ir.applyPatch'&&isObject(action.args?.patch)?action.args.patch:null;
}
function localRefs(patch,actionKey,actions){
  const refs=[];
  for(const op of patch.operations||[]){
    if(op?.op!=='link.add')continue;
    for(const endpoint of [op.from,op.to]){
      if(isKey(endpoint?.node?.localNodeKey))refs.push(endpoint.node.localNodeKey);
    }
  }
  for(const action of actions){
    if(action?.kind!=='run.start'||!(action.dependsOn||[]).includes(actionKey))continue;
    for(const target of action.args?.targets||[]){
      if(target?.fromAction===actionKey&&isKey(target.localNodeKey))
        refs.push(target.localNodeKey);
    }
  }
  return refs;
}
function allocateKeys(patch,actionKey,actions){
  if(!Array.isArray(patch.operations))return patch;
  const adds=patch.operations.filter(op=>op?.op==='node.add');
  const unnamed=adds.filter(op=>op.localNodeKey===undefined);
  if(!unnamed.length)return patch;
  // Never turn an invalid/unknown explicit key into a different node.
  if(adds.some(op=>op.localNodeKey!==undefined&&!isKey(op.localNodeKey)))return patch;
  const used=new Set(adds.map(op=>op.localNodeKey).filter(isKey));
  if(used.size!==adds.length-unnamed.length)return patch;
  const dangling=[...new Set(localRefs(patch,actionKey,actions).filter(key=>!used.has(key)))];
  // Several unresolved references cannot be attributed to unnamed operations.
  if(dangling.length>1||dangling.length===1&&unnamed.length!==1)return patch;
  if(dangling.length&&!isKey(dangling[0]))return patch;
  const assigned=new Map();
  let seq=1;
  for(const op of unnamed){
    let key;
    if(dangling.length){key=dangling[0];dangling.length=0;}
    else{
      do{key='node'+seq++;}while(used.has(key));
    }
    used.add(key);
    assigned.set(op,key);
  }
  return {...patch,operations:patch.operations.map(op=>assigned.has(op)?
    {...op,localNodeKey:assigned.get(op)}:op)};
}

const GRAPH_PATCH_FIELDS=new Set(['graphId','expectedGraphRevision','definitions','operations','adoption','expectedPlanEpoch','runRef']);
function flatGraphPatch(a){
  return isObject(a)&&Object.keys(a).every(k=>GRAPH_PATCH_FIELDS.has(k))&&
    typeof a.graphId==='string'&&Number.isInteger(a.expectedGraphRevision)&&
    (Array.isArray(a.operations)||Array.isArray(a.definitions));
}
export function modelTurnShape(value){
  if(!isObject(value))return {kind:'other'};
  const fields=(o,known)=>isObject(o)?{
    keys:Object.keys(o).filter(k=>known.includes(k)).sort(),
    unknown:Object.keys(o).filter(k=>!known.includes(k)).length
  }:{kind:Array.isArray(o)?'array':typeof o};
  return {totalActions:Array.isArray(value.actions)?value.actions.length:0,
    actions:Array.isArray(value.actions)?value.actions.slice(0,8).map(a=>{
      const args=a?.args,patch=isObject(args?.patch)?args.patch:flatGraphPatch(args)?args:null;
      return {kind:['ir.applyPatch','run.start','function.run','function.save','run.retry','run.cancel','run.revise','question.ask','task.complete'].includes(a?.kind)?a.kind:'unknown',
        action:fields(a,['localKey','kind','args','argsJson','dependsOn']),
        args:fields(args,['patch','graphId','expectedGraphRevision','definitions','operations','targets','damMode','functionRef','inputBindings']),
        ...(patch?{patch:fields(patch,['graphId','expectedGraphRevision','definitions','operations','adoption','expectedPlanEpoch','runRef']),
          definitions:Array.isArray(patch.definitions)?patch.definitions.slice(0,6).map(d=>fields(d,['localKey','purpose','instruction','executorKind','inputs','outputs','presentation','supersedes'])):[],
          operations:Array.isArray(patch.operations)?patch.operations.slice(0,10).map(op=>({kind:Object.hasOwn(PATCH_OPERATION_CONTRACTS,op?.op)?op.op:'unknown',
            fields:fields(op,['op','localNodeKey','localLinkKey','kind','definitionRef','settings','from','to','presentation','inputBindings','nodeRef'])})):[]
        }:{}),
        targets:Array.isArray(args?.targets)?args.targets.slice(0,8).map(t=>fields(t,['nodeId','fromAction','localNodeKey'])):[],
        dependsOnCount:Array.isArray(a?.dependsOn)?a.dependsOn.length:0};
    }):[]};
}

export function normalizeModelTurn(value,{normalizations=[]}={}){
  if(!isObject(value))return value;
  const turn={...value};
  for(const key of ['actions','needs'])
    if(Array.isArray(turn[key])&&turn[key].length===0)delete turn[key];
  for(const key of ['message','actions','needs','outputs'])
    if(turn[key]===null)delete turn[key];
  if(turn.message===''&&Object.keys(turn).length>1)delete turn.message;
  if(!Array.isArray(turn.actions))return turn;
  const actions=turn.actions;
  turn.actions=actions.map((action,index)=>{
    let updated=action;
    if(action?.kind==='ir.applyPatch'&&isObject(action.args)&&
      !Object.hasOwn(action.args,'patch')&&flatGraphPatch(action.args)){
      updated={...action,args:{patch:action.args}};
      normalizations.push('wrapPatch@'+index);
    }
    const source=patchOf(updated);
    if(!source)return updated;
    let patch={...source};
    if(Array.isArray(patch.definitions))
      patch.definitions=patch.definitions.map(normalizeDefinition);
    if(Array.isArray(patch.operations))patch.operations=patch.operations.map(op=>
      op?.op==='definition.appearance'&&op.presentation!==undefined?
        {...op,presentation:normalizePresentation(op.presentation)}:op);
    if(Array.isArray(patch.operations)&&patch.definitions===undefined)patch.definitions=[];
    if(Array.isArray(patch.definitions)&&patch.operations===undefined)patch.operations=[];
    // A model may express a cosmetic-only revision as a partial definition.
    // Convert that unambiguous case without inventing execution or semantic edits.
    if(patch.definitions?.length===1&&Array.isArray(patch.operations)&&!patch.operations.length){
      const d=patch.definitions[0];
      if(isObject(d)&&isKey(d.localKey)&&isObject(d.supersedes)&&
        isObject(d.presentation)&&Object.keys(d.presentation).length&&
        Object.keys(d).every(k=>['localKey','supersedes','presentation'].includes(k))){
        patch={...patch,definitions:[],operations:[{
          op:'definition.appearance',definitionRef:d.supersedes,presentation:d.presentation
        }]};
      }
    }
    patch=allocateKeys(patch,action.localKey,actions);
    return {...updated,args:{...updated.args,patch}};
  });
  const validKeys=turn.actions.every(a=>isKey(a?.localKey))&&
    new Set(turn.actions.map(a=>a.localKey)).size===turn.actions.length;
  const actionsByKey=new Map(validKeys?turn.actions.map(a=>[a.localKey,a]):[]);
  const patches=new Map(turn.actions.filter(action=>patchOf(action))
    .map(action=>[action.localKey,action.args.patch]));
  // A missing dependency may only be restored for an explicitly referenced
  // unique producer. Never repair an unknown/ambiguous producer or a cycle.
  const canDepend=(producer,consumer)=>{
    if(!validKeys||producer===consumer||!actionsByKey.has(producer))return false;
    const stack=[producer],visited=new Set();
    while(stack.length){
      const key=stack.pop();
      if(key===consumer)return false;
      if(visited.has(key))continue;
      visited.add(key);
      const current=actionsByKey.get(key);
      if(!current||current.dependsOn!==undefined&&
        (!Array.isArray(current.dependsOn)||current.dependsOn.some(d=>!isKey(d))))return false;
      stack.push(...(current.dependsOn||[]));
    }
    return true;
  };
  turn.actions=turn.actions.map((action,index)=>{
    if(action?.kind!=='run.start'||!Array.isArray(action.args?.targets))return action;
    const depsValid=action.dependsOn===undefined||
      Array.isArray(action.dependsOn)&&action.dependsOn.every(isKey);
    if(!depsValid)return action;
    const deps=Array.isArray(action.dependsOn)?[...action.dependsOn]:[];
    let targetFixed=false,depFixed=false;
    const targets=action.args.targets.map(target=>{
      if(!isObject(target)||!isKey(target.fromAction)||target.nodeId!==undefined)return target;
      const added=patches.get(target.fromAction)?.operations?.filter(op=>op?.op==='node.add');
      if(added?.length!==1||!isKey(added[0].localNodeKey))return target;
      const key=added[0].localNodeKey;
      if(target.localNodeKey!==undefined&&target.localNodeKey!==key)return target;
      if(!deps.includes(target.fromAction)){
        if(!canDepend(target.fromAction,action.localKey))return target;
        deps.push(target.fromAction);
        depFixed=true;
      }
      if(target.localNodeKey!==undefined)return target;
      targetFixed=true;
      return {...target,localNodeKey:key};
    });
    if(targetFixed)normalizations.push('targetKey@'+index);
    if(depFixed)normalizations.push('dependsOn@'+index);
    return {...action,...(depFixed?{dependsOn:deps}:{}),args:{...action.args,targets}};
  });
  return turn;
}
// AJV oneOf reports errors for branches that were not intended by the model.
// Report a missing temporary key only when its actual operation or target lacks it.
export function diagnoseModelTurn(value,issues=[]){
  const roots=[];
  for(const [i,action] of (Array.isArray(value?.actions)?value.actions:[]).entries()){
    if(action?.kind!=='ir.applyPatch'||isObject(action.args?.patch))continue;
    roots.push({path:'/actions/'+i+'/args',
      rule:action.args?.patch===undefined?'required':'invalid',
      ...(action.args?.patch===undefined?{missing:'patch'}:{})});
  }
  if(roots.length)return roots.slice(0,4);
  const detected=[];
  for(const [i,action] of (Array.isArray(value?.actions)?value.actions:[]).entries()){
    const base='/actions/'+i+'/args/';
    const patch=patchOf(action);
    if(patch&&Array.isArray(patch.definitions)){
      const used=new Set();
      for(const [j,def] of patch.definitions.entries()){
        const prefix=base+'patch/definitions/'+j+'/';
        if(!isObject(def))continue;
        if(def.localKey===undefined)
          detected.push({path:prefix+'localKey',rule:'required',missing:'localKey'});
        else if(!isKey(def.localKey))
          detected.push({path:prefix+'localKey',rule:'invalid'});
        else if(used.has(def.localKey))
          detected.push({path:prefix+'localKey',rule:'duplicate'});
        else used.add(def.localKey);
        for(const field of ['purpose','instruction']){
          if(def[field]===undefined)
            detected.push({path:prefix+field,rule:'required',missing:field});
        }
      }
    }
    if(patch&&Array.isArray(patch.operations)){
      for(const [j,op] of patch.operations.entries()){
        const prefix=base+'patch/operations/'+j+'/';
        if(!isObject(op)||typeof op.op!=='string'||
          !Object.hasOwn(PATCH_OPERATION_CONTRACTS,op.op)){
          detected.push({path:prefix+'op',rule:'invalidOperation',
            allowed:PATCH_OPERATION_KINDS});
          continue;
        }
        const contract=PATCH_OPERATION_CONTRACTS[op.op];
        for(const name of contract.required)if(!Object.hasOwn(op,name))
          detected.push({path:prefix+name,rule:'required',missing:name});
        for(const name of Object.keys(op))if(!contract.fields.includes(name))
          detected.push({path:prefix+name,rule:'additionalProperties'});
        if(op?.op==='node.add'&&!isKey(op.localNodeKey))
          detected.push(op.localNodeKey===undefined?
            {path:prefix+'localNodeKey',rule:'required',missing:'localNodeKey'}:
            {path:prefix+'localNodeKey',rule:'invalid'});
        if(op?.op==='link.add'){
          for(const side of ['from','to']){
            const node=op[side]?.node;
            if(isObject(node)&&!isKey(node.nodeId)&&!isKey(node.localNodeKey))
              detected.push({path:prefix+side+'/node',rule:'oneOf'});
          }
        }
      }
    }
    if(action?.kind==='run.start'&&Array.isArray(action.args?.targets)){
      for(const [j,target] of action.args.targets.entries()){
        if(isObject(target)&&isKey(target.fromAction)&&!isKey(target.localNodeKey))
          detected.push(target.localNodeKey===undefined?
            {path:base+'targets/'+j+'/localNodeKey',rule:'required',missing:'localNodeKey'}:
            {path:base+'targets/'+j+'/localNodeKey',rule:'invalid'});
      }
    }
  }
  if(detected.length)return detected.slice(0,4);
  const trustworthy=issues.filter(e=>e&&
    !['localNodeKey','nodeId'].includes(e.missing)&&e.rule!=='oneOf');
  return trustworthy.length?trustworthy.slice(0,4):
    [{path:'/',rule:'schemaMismatch'}];
}
