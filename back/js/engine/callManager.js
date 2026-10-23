import {createCallRegistry} from '../request/callRegistry.js';
export function createCallManager({callRegistry=createCallRegistry(),composer,modelCaller,maxModelCalls=2}={}){
 if(!composer?.compose||!modelCaller?.generate||!Number.isInteger(maxModelCalls)||maxModelCalls<1)throw new TypeError('Invalid call manager');
 let active=0;const waiting=[];
 async function slot(){if(active<maxModelCalls){active++;return;}await new Promise(resolve=>waiting.push(resolve));}
 function free(){const next=waiting.shift();if(next)next();else active--;}
 async function invoke({roomId,requestId,requestRevision=0,route,context={},bindings={},format='json',signal}={}){
  const record=callRegistry.register({roomId,requestId,requestRevision,route});
  const started=callRegistry.start({roomId,requestId,callId:record.callId});
  const layer=route.layer==='hallway'?'hallway'+(route.phase==='initial'?'Initial':'Return'):route.layer;
  const frame=structuredClone(context);
  frame.contextBlock={...(frame.contextBlock??{intent:'',progress:''}),focus:route.layer==='workshop'?route.workshop+'.'+route.action:layer};
  let held=false;
  try{
   const prompt=await composer.compose(layer,bindings);
   await slot();held=true;
   const out=await modelCaller.generate({layer,prompt,context:frame,format,signal});
   callRegistry.finish({roomId,requestId,callId:record.callId,status:'completed',expectedRevision:started.revision});
   return {...out,callId:record.callId};
  }catch(error){
   const current=callRegistry.get({roomId,requestId,callId:record.callId});
   if(current?.status==='running')callRegistry.finish({roomId,requestId,callId:record.callId,status:'failed',expectedRevision:current.revision});
   throw error;
  }finally{if(held)free();}
 }
 return Object.freeze({invoke,getCall:q=>callRegistry.get(q),listCalls:q=>callRegistry.list(q),callRegistry});
}
