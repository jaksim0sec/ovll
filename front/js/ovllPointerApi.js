(function(global){
  'use strict';
  const runtime=global.OVLL_RUNTIME||{},origin=typeof runtime.apiOrigin==='string'?runtime.apiOrigin.trim().replace(/\/+$/,''):'';
  const root=origin+'/api/pointer/';
  const makeError=(code,status)=>Object.assign(new Error(code),{name:'OvllApiError',code,status});
  const safeId=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(s);
  async function request(path,{method='GET',body,requestRef,signal}={}){
    const headers={'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(requestRef){if(!safeId(requestRef))throw makeError('INVALID_REQUEST_REF',422);headers['Idempotency-Key']=requestRef;}
    if(method!=='GET'&&typeof runtime.pointerCsrfToken==='string'&&runtime.pointerCsrfToken)headers['X-CSRF-Token']=runtime.pointerCsrfToken;
    let response;
    try{
      response=await global.fetch(root+path,{method,headers,credentials:'include',cache:'no-store',
        ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal});
    }catch(error){throw makeError(signal?.aborted?'REQUEST_ABORTED':'NETWORK_ERROR',signal?.aborted?499:0);}
    let data;
    try{data=await response.json();}catch{throw makeError('INVALID_SERVER_RESPONSE',response.status);}
    if(!response.ok){
      const error=makeError(data?.error?.code||'API_REQUEST_FAILED',response.status);
      const retryAfterSeconds=Number(data?.error?.retryAfterSeconds);
      if(Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0)
        error.retryAfterSeconds=Math.ceil(retryAfterSeconds);
      throw error;
    }
    return data;
  }
  const uniqueId=()=>{if(typeof global.crypto?.randomUUID!=='function')throw makeError('SECURE_REQUEST_ID_UNAVAILABLE',503);
    return 'req_'+global.crypto.randomUUID();};
  const submit=({requestText,requestRef=uniqueId(),taskRef,graphId,signal}={})=>
    request('requests',{method:'POST',requestRef,body:{requestText,...(taskRef?{taskRef}:{}),
      ...(graphId?{graphId}:{})},signal});
  const events=(after=0,limit=100)=>request('events?after='+encodeURIComponent(after)+'&limit='+limit);
  const graph=(id,revision)=>request('graphs/'+encodeURIComponent(id)+(revision===undefined?'':'?revision='+revision));
  const state=(graphId,taskRef)=>request('state?graphId='+encodeURIComponent(graphId)+
    (taskRef?'&taskRef='+encodeURIComponent(taskRef):''));
  const runState=id=>request('runs/'+encodeURIComponent(id)+'/state');
  const turn=({graphId,taskRef,actions,requestRef=uniqueId(),signal})=>
    request('turns',{method:'POST',requestRef,body:{graphId,taskRef,turn:{actions}},signal});
  const localCatalog=({signal}={})=>request('local/catalog',{signal});
  const localReady=({signal}={})=>request('local/ready',{signal});
  const localTurn=({snapshot,requestRef=uniqueId(),requestText,history,extraContext,signal})=>
    request('local/turn',{method:'POST',body:{snapshot,requestRef,requestText,history,extraContext},signal});
  const localResponse=({snapshot,requestRef=uniqueId(),requestText,actionResults,history,signal})=>
    request('local/response',{method:'POST',body:{snapshot,requestRef,requestText,actionResults,history},signal});
  const localNode=({snapshot,requestRef=uniqueId(),requestText,nodeId,inputArtifacts,taskConstraints,signal})=>
    request('local/node',{method:'POST',body:{snapshot,requestRef,requestText,nodeId,inputArtifacts,taskConstraints},signal});
  const run=id=>request('runs/'+encodeURIComponent(id));
  const task=id=>request('tasks/'+encodeURIComponent(id));
  const artifact=id=>request('artifacts/'+encodeURIComponent(id));
  // SSE transports notifications; replayed durable cursor events remain the authority.
  function watch({after=0,onEvent=()=>{},onResync=async()=>0,onError=()=>{}}={}){
    let cursor=Number.isSafeInteger(after)&&after>=0?after:0,closed=false,stream=null,busy=false,resyncing=false;
    const reset=async()=>{
      if(resyncing||closed)return;
      resyncing=true;
      try {
        const next=await onResync();
        cursor=Number.isSafeInteger(next)&&next>=0?next:0;
      }catch(error){if(!closed)onError(error);}
      finally {resyncing=false;}
    };
    const deliver=item=>{
      if(closed||!item||!Number.isSafeInteger(item.id)||item.id<=cursor)return;
      if(item.id!==cursor+1){void replay();return;}
      cursor=item.id;onEvent(item);
    };
    const replay=async()=>{
      if(busy||closed||resyncing)return;
      busy=true;
      try{
        for(let page=0;page<100&&!closed;page++){
          const batch=await events(cursor,100);
          if(batch.resetRequired){await reset();continue;}
          const ordered=batch.events||[];
          if(ordered.length&&ordered[0].id!==cursor+1){await reset();continue;}
          for(const item of ordered)deliver(item);
          if(!batch.hasMore)break;
        }
      }catch(error){if(!closed)onError(error);}finally{busy=false;}
    };
    const connect=()=>{
      if(closed||stream||resyncing||typeof global.EventSource!=='function')return;
      stream=new global.EventSource(root+'events/stream?after='+cursor,{withCredentials:true});
      stream.addEventListener('ovll',e=>{
        try{deliver(JSON.parse(e.data));}catch(error){onError(error);}
      });
      stream.addEventListener('resync_required',()=>{stream?.close();stream=null;
        void reset().then(replay);
      });
      stream.onerror=()=>{stream?.close();stream=null;};
    };
    void replay().then(connect);
    const poll=global.setInterval(()=>{void replay().then(connect);},3000);
    return ()=>{closed=true;global.clearInterval(poll);stream?.close();stream=null;};
  }
  global.OvllPointerApi=Object.freeze({request,submit,turn,events,state,runState,graph,run,task,artifact,watch,uniqueId,localCatalog,localReady,localTurn,localNode,localResponse});
})(window);
