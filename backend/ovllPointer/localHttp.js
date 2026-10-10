import {createConfiguredLocalPointerHost} from './localHost.js';
import {resolveLocalPointerProvider} from './configuredProvider.js';
import {getPointerCatalog} from './nodeCatalog.js';
import {MODEL_CONTEXT_LIMITS} from './contextLimits.js';
const allowed=new Set(['turn','node','response']);
export function localModelReady(env=process.env){
  if(env.OVLL_POINTER_LOCAL_MODEL_ENABLED==='false')return false;
  const selected=resolveLocalPointerProvider(env);
  const key=env.OVLL_POINTER_MODEL_API_KEY||env.OVLL_VNEXT_MODEL_API_KEY;
  if(selected==='gemini')return !!(env.GEMINI_API_KEY||key);
  if(selected==='groq')return !!(env.GROQ_API_KEY||key);
  return !!((env.OVLL_POINTER_MODEL_ENDPOINT||env.OVLL_VNEXT_MODEL_ENDPOINT)&&
    key&&(env.OVLL_POINTER_MODEL_ID||env.OVLL_VNEXT_MODEL_ID));
}
const DEFAULT_LIMITS=Object.freeze({minutePerIp:12,dailyPerIp:48,dailyGlobal:400,
  maxPending:4,deadlineMs:60000,reserveProviderCalls:MODEL_CONTEXT_LIMITS.maxProviderCalls,maxRequestChars:MODEL_CONTEXT_LIMITS.maxRequestChars});
const failure=(code,status)=>Object.assign(new Error(code),{code,status});
export function mountLocalPointerRoutes(app,{createHost=()=>createConfiguredLocalPointerHost(),
  enabled=()=>localModelReady(),limits:overrides={},now=()=>Date.now()}={}){
  const limits={...DEFAULT_LIMITS,...overrides};
  let host,active=false;const queue=[],recent=new Map(),daily=new Map(),global=new Map();
  function prune(at){
    for(const [ip,bucket] of recent)if(at-bucket.start>=60000)recent.delete(ip);
    const day=new Date(at).toISOString().slice(0,10);
    for(const key of daily.keys())if(!key.startsWith(day+':'))daily.delete(key);
    for(const key of global.keys())if(key!==day)global.delete(key);
  }
  function pump(){
    if(active)return;
    const ticket=queue.shift();if(!ticket)return;
    if(ticket.signal.aborted){ticket.reject(ticket.signal.reason);pump();return;}
    active=true;ticket.started=true;
    Promise.resolve().then(ticket.work).then(ticket.resolve,ticket.reject).finally(()=>{
      ticket.signal.removeEventListener('abort',ticket.onAbort);active=false;pump();
    });
  }
  function serialized(work,signal){
    return new Promise((resolve,reject)=>{
      const ticket={work,signal,resolve,reject,started:false};
      ticket.onAbort=()=>{
        if(!ticket.started){const index=queue.indexOf(ticket);if(index>=0)queue.splice(index,1);}
        signal.removeEventListener('abort',ticket.onAbort);reject(signal.reason);
      };
      signal.addEventListener('abort',ticket.onAbort,{once:true});queue.push(ticket);pump();
    });
  }
  function limited(res,code,seconds){
    const retryAfterSeconds=Math.max(1,Math.ceil(seconds));
    return res.set('Retry-After',String(retryAfterSeconds)).status(429).json({error:{code,retryAfterSeconds}});
  }
  app.get('/api/pointer/local/catalog',(_req,res)=>res.set('Cache-Control','no-store').json(getPointerCatalog()));
  app.get('/api/pointer/local/ready',(_req,res)=>{
    const configured=!!enabled();
    res.set('Cache-Control','no-store').json({ready:configured,configured,modelHealth:'unverified'});
  });
  app.post('/api/pointer/local/:kind',async(req,res)=>{
    const kind=req.params.kind;res.set('Cache-Control','no-store');
    if(!allowed.has(kind))return res.status(404).json({error:{code:'UNKNOWN_LOCAL_OPERATION'}});
    if(!enabled())return res.status(503).json({error:{code:'LOCAL_MODEL_DISABLED'}});
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||
      (kind!=='node'&&(typeof body.requestText!=='string'||!body.requestText.trim()))||
      (body.requestText!==undefined&&(typeof body.requestText!=='string'||body.requestText.length>limits.maxRequestChars)))
      return res.status(422).json({error:{code:'INVALID_LOCAL_MODEL_REQUEST'}});
    if(Buffer.byteLength(JSON.stringify(body),'utf8')>262144)
      return res.status(413).json({error:{code:'LOCAL_MODEL_PAYLOAD_TOO_LARGE'}});
    // Reject overload before reserving either logical requests or physical calls.
    if(queue.length+Number(active)>=limits.maxPending)
      return res.set('Retry-After','5').status(503).json({error:{code:'LOCAL_MODEL_BUSY',retryAfterSeconds:5}});
    const at=now();prune(at);const ip=req.ip||'unknown';
    const bucket=recent.get(ip)||{start:at,count:0};
    if(bucket.count>=limits.minutePerIp)return limited(res,'LOCAL_MODEL_RATE_LIMIT',(60000-(at-bucket.start))/1000);
    const day=new Date(at).toISOString().slice(0,10),key=day+':'+ip,reserved=limits.reserveProviderCalls;
    if((daily.get(key)||0)+reserved>limits.dailyPerIp||(global.get(day)||0)+reserved>limits.dailyGlobal)
      return limited(res,'LOCAL_MODEL_DAILY_BUDGET',(Date.parse(day+'T00:00:00.000Z')+86400000-at)/1000);
    bucket.count++;recent.set(ip,bucket);daily.set(key,(daily.get(key)||0)+reserved);global.set(day,(global.get(day)||0)+reserved);
    let started=false,settled=false;
    function settle(value,fallback){
      if(settled)return;settled=true;
      const actual=Number.isInteger(value?._meta?.providerCalls)&&value._meta.providerCalls>=0?
        value._meta.providerCalls:fallback;
      const difference=actual-reserved;
      if(daily.has(key))daily.set(key,Math.max(0,daily.get(key)+difference));
      if(global.has(day))global.set(day,Math.max(0,global.get(day)+difference));
      if(actual===0)bucket.count=Math.max(0,bucket.count-1);
    }
    const controller=new AbortController();
    const onClose=()=>{if(!res.writableEnded)controller.abort(failure('LOCAL_MODEL_ABORTED',499));};
    res.once('close',onClose);
    const timeout=setTimeout(()=>controller.abort(failure('LOCAL_MODEL_DEADLINE',504)),limits.deadlineMs);
    try{
      const result=await serialized(async()=>{
        started=true;
        try{
          if(!host)host=createHost();
          const result=await host[kind]({...body,signal:controller.signal});settle(result,1);return result;
        }catch(error){settle(error,error?.code==='INVALID_LOCAL_MODEL_REQUEST'?0:1);throw error;}
      },controller.signal);
      if(!res.headersSent&&!res.destroyed)res.json(result);
    }catch(error){
      if(error?.code==='PROVIDER_HTTP_ERROR')
        console.warn('[OvllPointer upstream HTTP]',{
          status:error.status,providerStatus:error.providerStatus||'UNKNOWN',
          schemaFallbackAttempted:error.schemaFallbackAttempted===true
        });
      if(!res.headersSent&&!res.destroyed){
        const retryAfterSeconds=Number(error?.retryAfterSeconds);
        if(Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0)
          res.set('Retry-After',String(Math.ceil(retryAfterSeconds)));
        const validationIssues=Array.isArray(error?.validationIssues)?
          error.validationIssues.slice(0,4).map(item=>({
            path:typeof item.path==='string'&&/^\/(?:[A-Za-z0-9_]+\/?)*$/.test(item.path)?
              item.path.slice(0,120):'/',
            rule:typeof item.rule==='string'&&/^[A-Za-z]+$/.test(item.rule)?item.rule:'invalid',
            ...(typeof item.missing==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(item.missing)?
              {missing:item.missing}:{})
          })):null;
        res.status(error.status>=400&&error.status<600?error.status:502)
          .json({error:{code:error.code||'LOCAL_MODEL_REQUEST_FAILED',
            ...(validationIssues?.length?{validationIssues}:{}),
            ...(typeof error.providerStatus==='string'&&
              /^[A-Z_]{2,48}$/.test(error.providerStatus)?
              {providerStatus:error.providerStatus}:{}),
            ...(Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0?
              {retryAfterSeconds:Math.ceil(retryAfterSeconds)}:{})}});
      }
    }finally{
      clearTimeout(timeout);res.off('close',onClose);
      if(!started)settle(null,0);
    }
  });
}
