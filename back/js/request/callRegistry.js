import {actionCatalog} from '../engine/actionShell.js';

const phases=new Set(['initial','return']);
const terminals=new Set(['completed','failed','cancelled','unsupported']);
const copy=value=>structuredClone(value);
function segments(route){
 if(!route||typeof route!=='object'||Array.isArray(route))throw new TypeError('Invalid call route');
 if(route.layer==='gate'&&Object.keys(route).length===1)return ['gate'];
 if(route.layer==='output'&&Object.keys(route).length===1)return ['output'];
 if(route.layer==='hallway'&&Object.keys(route).length===2&&phases.has(route.phase))return ['hallway',route.phase];
 if(route.layer==='workshop'&&Object.keys(route).length===3&&actionCatalog[route.workshop]?.includes(route.action))return ['workshop',route.workshop,route.action];
 throw new TypeError('Unknown call route');
}
export function createCallRegistry({createId=()=>crypto.randomUUID()}={}){
 if(typeof createId!=='function')throw new TypeError('Call ID generator required');
 const calls=new Map();
 function owned({roomId,requestId,callId}){
  const record=calls.get(callId);
  return record&&record.roomId===roomId&&record.requestId===requestId?record:null;
 }
 function register({roomId,requestId,route,requestRevision=0}={}){
  if(typeof roomId!=='string'||!roomId||typeof requestId!=='string'||!requestId||!Number.isSafeInteger(requestRevision)||requestRevision<0)throw new TypeError('Invalid call identity');
  const routeParts=segments(route),callId=createId();
  if(typeof callId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(callId)||calls.has(callId))throw new TypeError('Duplicate or invalid call ID');
  const record={callId,roomId,requestId,route:copy(route),path:callId+'.'+routeParts.join('.'),status:'queued',revision:0,requestRevisionAtStart:requestRevision};
  calls.set(callId,record);
  return copy(record);
 }
 function get({roomId,requestId,callId}={}){const r=owned({roomId,requestId,callId});return r?copy(r):null;}
 function list({roomId,requestId}={}){return [...calls.values()].filter(r=>r.roomId===roomId&&r.requestId===requestId).map(copy);}
 function finish({roomId,requestId,callId,status,expectedRevision,outcomeRef}={}){
  const r=owned({roomId,requestId,callId});
  if(!r||!terminals.has(status)||r.status!=='running'||r.revision!==expectedRevision)throw Object.assign(new Error('Stale call result'),{code:'CHECKPOINT_CONFLICT'});
  const next={...r,status,revision:r.revision+1,...(outcomeRef===undefined?{}:{outcomeRef:copy(outcomeRef)})};calls.set(callId,next);return copy(next);
 }
 function start({roomId,requestId,callId,expectedRevision=0}={}){
  const r=owned({roomId,requestId,callId});
  if(!r||r.status!=='queued'||r.revision!==expectedRevision)throw Object.assign(new Error('Call cannot start'),{code:'CHECKPOINT_CONFLICT'});
  const next={...r,status:'running',revision:r.revision+1};calls.set(callId,next);return copy(next);
 }
 function cancel({roomId,requestId,callId}={}){
  const r=owned({roomId,requestId,callId});
  if(!r||terminals.has(r.status))return r?copy(r):null;
  const next={...r,status:'cancelled',revision:r.revision+1};calls.set(callId,next);return copy(next);
 }
 return Object.freeze({register,get,list,start,finish,cancel});
}
