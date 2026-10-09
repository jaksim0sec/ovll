(function(global){
  'use strict';
  const runtime=global.OVLL_RUNTIME||{},origin=typeof runtime.apiOrigin==='string'?runtime.apiOrigin.trim().replace(/\/+$/,''):'';
  const root=origin+'/api/vnext/';
  const makeError=(code,status)=>Object.assign(new Error(code),{name:'OvllApiError',code,status});
  const safeId=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(s);
  async function request(path,{method='GET',body,requestRef,signal}={}){
    const headers={'Accept':'application/json'};
    if(body!==undefined)headers['Content-Type']='application/json';
    if(requestRef){if(!safeId(requestRef))throw makeError('INVALID_REQUEST_REF',422);headers['Idempotency-Key']=requestRef;}
    if(method!=='GET'&&typeof runtime.vnextCsrfToken==='string'&&runtime.vnextCsrfToken)headers['X-CSRF-Token']=runtime.vnextCsrfToken;
    let response;
    try{
      response=await global.fetch(root+path,{method,headers,credentials:'include',cache:'no-store',
        ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal});
    }catch(error){throw makeError(signal?.aborted?'REQUEST_ABORTED':'NETWORK_ERROR',signal?.aborted?499:0);}
    let data;
    try{data=await response.json();}catch{throw makeError('INVALID_SERVER_RESPONSE',response.status);}
    if(!response.ok)throw makeError(data?.error?.code||'API_REQUEST_FAILED',response.status);
    return data;
  }
  const uniqueId=()=>{if(typeof global.crypto?.randomUUID!=='function')throw makeError('SECURE_REQUEST_ID_UNAVAILABLE',503);
    return 'req_'+global.crypto.randomUUID();};
  const submit=({requestText,requestRef=uniqueId(),taskRef,graphId,signal}={})=>
    request('requests',{method:'POST',requestRef,body:{requestText,...(taskRef?{taskRef}:{}),
      ...(graphId?{graphId}:{})},signal});
  const events=(after=0,limit=100)=>request('events?after='+encodeURIComponent(after)+'&limit='+limit);
  const graph=(id,revision)=>request('graphs/'+encodeURIComponent(id)+(revision===undefined?'':'?revision='+revision));
  const run=id=>request('runs/'+encodeURIComponent(id));
  const task=id=>request('tasks/'+encodeURIComponent(id));
  const artifact=id=>request('artifacts/'+encodeURIComponent(id));
  // SSE transports notifications; replayed durable cursor events remain the authority.
  function watch({after=0,onEvent=()=>{},onResync=()=>{},onError=()=>{}}={}){
    let cursor=Number.isSafeInteger(after)&&after>=0?after:0,closed=false,stream=null,poll=null,busy=false;
    const deliver=item=>{
      if(closed||!item||!Number.isSafeInteger(item.id)||item.id<=cursor)return;
      if(item.id!==cursor+1){void replay();return;}
      cursor=item.id;onEvent(item);
    };
    const replay=async()=>{
      if(busy||closed)return;busy=true;
      try{
        for(let page=0;page<100&&!closed;page++){
          const batch=await events(cursor,100);
          if(batch.resetRequired){onResync();cursor=0;continue;}
          for(const item of batch.events||[])deliver(item);
          if(!batch.hasMore)break;
        }
      }catch(error){if(!closed)onError(error);}finally{busy=false;}
    };
    const listen=()=>{
      if(closed||typeof global.EventSource!=='function')return;
      stream=new global.EventSource(root+'events/stream?after='+cursor,{withCredentials:true});
      stream.addEventListener('ovll',e=>{
        try{deliver(JSON.parse(e.data));}catch(error){onError(error);}
      });
      stream.addEventListener('resync_required',()=>{
        onResync();cursor=0;void replay();
      });
      stream.onerror=()=>{stream?.close();stream=null;};
    };
    void replay().then(()=>{if(!closed)listen();});
    poll=global.setInterval(replay,3000);
    return ()=>{closed=true;global.clearInterval(poll);stream?.close();};
  }
  global.OvllVNextApi=Object.freeze({request,submit,events,graph,run,task,artifact,watch,uniqueId});
})(window);
