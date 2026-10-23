import {randomUUID} from 'node:crypto';
import {getActionDescriptor} from '../engine/actionDescriptors.js';

/** Beta-only authoritative memory port. Effects are atomic within one Node process. */
export function createMemoryActionStore({createId=prefix=>prefix+'-'+randomUUID()}={}){
 const rooms=new Map(),copy=v=>structuredClone(v);
 const empty=()=>({revision:0,skills:[],blocks:[],links:[]});
 const checkScope=scope=>{
  if(typeof scope!=='string'||!scope)throw new TypeError('Room scope required');
  if(!rooms.has(scope))rooms.set(scope,{state:empty(),operations:new Map()});
  return rooms.get(scope);
 };
 const signature=({requestId,action,args,expectedRevision})=>JSON.stringify({requestId,action,args,expectedRevision});
 function read({scope}={}){return copy(checkScope(scope).state);}
 function getOperation({scope,operationId}={}){
  const row=checkScope(scope).operations.get(operationId);
  return row?copy(row.outcome):null;
 }
 function apply({scope,requestId,operationId,action,args,expectedRevision}={}){
  if(typeof requestId!=='string'||!requestId||typeof operationId!=='string'||!operationId||
    !Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new TypeError('Invalid action operation');
  const room=checkScope(scope),stamp=signature({requestId,action,args,expectedRevision});
  const previous=room.operations.get(operationId);
  if(previous){
   if(previous.signature!==stamp)throw Object.assign(new Error('Operation ID already used'),{code:'OPERATION_ID_REUSED'});
   return copy(previous.outcome);
  }
  const descriptor=getActionDescriptor(action);
  if(!descriptor)throw Object.assign(new Error('Action is not implemented'),{code:'UNSUPPORTED_ACTION'});
  if(room.state.revision!==expectedRevision)return {status:'conflict',operationId,revision:room.state.revision};
  const data=descriptor.validateArgs(args,room.state);
  const next=copy(room.state);
  let artifact,changeSet;
  if(action==='skillDefine.defineDirect'){
   artifact={...data,id:createId('skill'),revision:1};
   if(typeof artifact.id!=='string'||!artifact.id||next.skills.some(s=>s.id===artifact.id))throw new Error('Invalid generated Skill ID');
   next.skills.push(artifact);
   changeSet={skills:[artifact],blocks:[],links:[]};
  }else if(action==='canvasEdit.addBlock'){
   const linked=next.skills.find(s=>s.id===data.skillId);
   if(!linked)throw Object.assign(new Error('Referenced Skill missing'),{code:'ACTION_ARGS_INVALID'});
   const defaults=Object.fromEntries(linked.fields.map(f=>[f.id,f.default]));
   artifact={...data,id:createId('block'),values:{...defaults,...data.values},revision:1};
   if(typeof artifact.id!=='string'||!artifact.id||next.blocks.some(b=>b.id===artifact.id))throw new Error('Invalid generated Block ID');
   next.blocks.push(artifact);
   changeSet={skills:[linked],blocks:[artifact],links:[]};
  }else throw Object.assign(new Error('Unimplemented action'),{code:'UNSUPPORTED_ACTION'});
  next.revision++;
  const outcome={status:'applied',operationId,revision:next.revision,artifacts:[copy(artifact)],changeSet:copy(changeSet)};
  // One atomic in-process commit: operation receipt and asset state become visible together.
  room.operations.set(operationId,{signature:stamp,outcome:copy(outcome)});
  room.state=next;
  return copy(outcome);
 }
 return Object.freeze({read,apply,getOperation});
}
