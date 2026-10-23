import {createCallRegistry} from '../request/callRegistry.js';
import {createActionShell} from './actionShell.js';
export function createCallManager({callRegistry=createCallRegistry(),composer,modelCaller,maxModelCalls=2,actionShell=createActionShell()}={}){
 if(!composer?.compose||!modelCaller?.generate||!Number.isInteger(maxModelCalls)||maxModelCalls<1)throw new TypeError('Invalid call manager');
 let active=0;const waiting=[];
 const aborted=()=>Object.assign(new Error('Cancelled model call'),{code:'MODEL_CANCELLED'});
 async function slot(signal){
  if(signal?.aborted)throw aborted();
  if(active<maxModelCalls){active++;return;}
  await new Promise((resolve,reject)=>{
   const waiter={resolve,reject,signal};
   const onAbort=()=>{const pos=waiting.indexOf(waiter);if(pos>=0)waiting.splice(pos,1);reject(aborted());};
   waiter.onAbort=onAbort;signal?.addEventListener('abort',onAbort,{once:true});waiting.push(waiter);
  });
  if(signal?.aborted){free();throw aborted();}
 }
 function free(){const next=waiting.shift();if(next){next.signal?.removeEventListener('abort',next.onAbort);next.resolve();}else active--;}
 async function invoke({roomId,requestId,requestRevision=0,route,context={},bindings={},format='json',signal}={}){
  const record=callRegistry.register({roomId,requestId,requestRevision,route});
  const started=callRegistry.start({roomId,requestId,callId:record.callId});
  const layer=route.layer==='hallway'?'hallway'+(route.phase==='initial'?'Initial':'Return'):route.layer;
  const frame=structuredClone(context);
  frame.contextBlock={...(frame.contextBlock??{intent:'',progress:''}),focus:route.layer==='workshop'?route.workshop+'.'+route.action:layer};
  let held=false;
  try{
   const prompt=await composer.compose(layer,bindings);
   await slot(signal);held=true;
   if(signal?.aborted)throw aborted();
   const out=await modelCaller.generate({layer,prompt,context:frame,format,signal});
   if(signal?.aborted)throw aborted();
   callRegistry.finish({roomId,requestId,callId:record.callId,status:'completed',expectedRevision:started.revision});
   return {...out,callId:record.callId};
  }catch(error){
   const current=callRegistry.get({roomId,requestId,callId:record.callId});
   if(current?.status==='running')callRegistry.finish({roomId,requestId,callId:record.callId,status:signal?.aborted?'cancelled':'failed',expectedRevision:current.revision});
   throw error;
  }finally{if(held)free();}
 }
 async function invokeFunction({roomId,requestId,requestRevision=0,route,context={},tool,bindings={},signal}={}){
  if(route?.layer!=='workshop'||!tool?.name||typeof modelCaller.generateFunction!=='function')
   throw Object.assign(new Error('Native Workshop model port unavailable'),{code:'UNSUPPORTED_ACTION'});
  const record=callRegistry.register({roomId,requestId,requestRevision,route});
  const started=callRegistry.start({roomId,requestId,callId:record.callId});
  const layer='workshop.'+route.workshop+'.'+route.action;
  const frame=structuredClone(context);
  frame.contextBlock={...(frame.contextBlock??{intent:'',progress:''}),focus:route.workshop+'.'+route.action};
  let held=false;
  try{
   const prompt=await composer.compose(layer,bindings);
   await slot(signal);held=true;
   if(signal?.aborted)throw aborted();
   const proposal=await modelCaller.generateFunction({prompt,context:frame,tool:structuredClone(tool),signal});
   if(signal?.aborted)throw aborted();
   if(proposal?.kind!=='function_proposal'||proposal.name!==tool.name)
    throw Object.assign(new Error('Unexpected Workshop function proposal'),{code:'MODEL_INVALID_RESPONSE'});
   callRegistry.finish({roomId,requestId,callId:record.callId,status:'completed',expectedRevision:started.revision});
   return {callId:record.callId,proposal};
  }catch(error){
   const current=callRegistry.get({roomId,requestId,callId:record.callId});
   if(current?.status==='running')callRegistry.finish({roomId,requestId,callId:record.callId,status:signal?.aborted?'cancelled':'failed',expectedRevision:current.revision});
   throw error;
  }finally{if(held)free();}
 }
 async function enterAction({roomId,requestId,requestRevision=0,action,objective,need,resources}={}){
  const [workshop,name,...extra]=String(action).split('.');
  if(extra.length||!actionShell.accepts(action))throw Object.assign(new Error('Unknown Action'),{code:'UNSUPPORTED_ACTION'});
  const row=callRegistry.register({roomId,requestId,requestRevision,route:{layer:'workshop',workshop,action:name}});
  const started=callRegistry.start({roomId,requestId,callId:row.callId});
  try{
   const handoff=actionShell.enter({action,objective,need,resources});
   callRegistry.finish({roomId,requestId,callId:row.callId,status:'unsupported',expectedRevision:started.revision});
   return {callId:row.callId,handoff:{...handoff,callId:row.callId}};
  }catch(error){
   callRegistry.finish({roomId,requestId,callId:row.callId,status:'failed',expectedRevision:started.revision});
   throw error;
  }
 }
 function cancelRequest({roomId,requestId}){
  for(const row of callRegistry.list({roomId,requestId}))if(row.status==='queued'||row.status==='running')callRegistry.cancel({roomId,requestId,callId:row.callId});
 }
 return Object.freeze({invoke,invokeFunction,enterAction,cancelRequest,getCall:q=>callRegistry.get(q),listCalls:q=>callRegistry.list(q),callRegistry});
}
