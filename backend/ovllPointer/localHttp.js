import {createConfiguredLocalPointerHost} from './localHost.js';
import {getPointerCatalog} from './nodeCatalog.js';
const allowed=new Set(['turn','node']);
export function localModelReady(env=process.env){
  if(env.OVLL_POINTER_LOCAL_MODEL_ENABLED==='false')return false;
  const configured=!!((env.OVLL_POINTER_MODEL_ENDPOINT||env.OVLL_VNEXT_MODEL_ENDPOINT)&&
    (env.OVLL_POINTER_MODEL_API_KEY||env.OVLL_VNEXT_MODEL_API_KEY)&&
    (env.OVLL_POINTER_MODEL_ID||env.OVLL_VNEXT_MODEL_ID));
  return configured||!!env.GROQ_API_KEY;
}
export function mountLocalPointerRoutes(app,{createHost=()=>createConfiguredLocalPointerHost(),
  enabled=()=>localModelReady()}={}){
  let host;
  const recent=new Map();
  const daily=new Map();
  let globalDay='',globalCount=0;
  // A single shared free-tier provider should not receive simultaneous model bursts.
  let queueTail=Promise.resolve(),pending=0;
  async function serialized(work){
    if(pending>=4)throw Object.assign(new Error('LOCAL_MODEL_BUSY'),{
      code:'LOCAL_MODEL_BUSY',status:503,retryAfterSeconds:5
    });
    pending++;
    let release;
    const ticket=new Promise(resolve=>{release=resolve;});
    const previous=queueTail;
    queueTail=ticket;
    try{await previous;return await work();}
    finally{pending--;release();}
  }
  function limited(res,code,seconds){
    const retryAfterSeconds=Math.max(1,Math.ceil(seconds));
    return res.set('Retry-After',String(retryAfterSeconds)).status(429)
      .json({error:{code,retryAfterSeconds}});
  }
  app.get('/api/pointer/local/catalog',(_req,res)=>{
    res.set('Cache-Control','no-store').json(getPointerCatalog());
  });
  app.get('/api/pointer/local/ready',(_req,res)=>{
    res.set('Cache-Control','no-store').json({ready:!!enabled()});
  });
  app.post('/api/pointer/local/:kind',async(req,res)=>{
    const kind=req.params.kind;
    res.set('Cache-Control','no-store');
    if(!allowed.has(kind))return res.status(404).json({error:{code:'UNKNOWN_LOCAL_OPERATION'}});
    if(!enabled())return res.status(503).json({error:{code:'LOCAL_MODEL_DISABLED'}});
    // Invalid payloads must not consume scarce shared model capacity.
    const length=Buffer.byteLength(JSON.stringify(req.body||{}),'utf8');
    if(length>262144)return res.status(413).json({error:{code:'LOCAL_MODEL_PAYLOAD_TOO_LARGE'}});
    const now=Date.now(),ip=req.ip||'unknown',bucket=recent.get(ip)||{start:now,count:0};
    if(now-bucket.start>=60000){bucket.start=now;bucket.count=0;}
    if(bucket.count>=12)return limited(res,'LOCAL_MODEL_RATE_LIMIT',(60000-(now-bucket.start))/1000);
    const day=new Date(now).toISOString().slice(0,10);
    if(globalDay!==day){globalDay=day;globalCount=0;daily.clear();}
    const dailyKey=day+':'+ip;
    const count=daily.get(dailyKey)||0;
    if(count>=48||globalCount>=400){
      const nextDay=Date.parse(day+'T00:00:00.000Z')+86400000;
      return limited(res,'LOCAL_MODEL_DAILY_BUDGET',(nextDay-now)/1000);
    }
    let admitted=true;
    try{
      if(!host)host=createHost();
      const result=await serialized(async()=>{
        const controller=new AbortController();
        const onClose=()=>{if(!res.writableEnded)controller.abort();};
        res.once('close',onClose);
        const timeout=setTimeout(()=>controller.abort(),60000);
        try{return await host[kind]({...req.body,signal:controller.signal});}
        finally{clearTimeout(timeout);res.off('close',onClose);}
      });
      if(!res.headersSent)res.json(result);
    }catch(error){
      if(error?.code==='LOCAL_MODEL_BUSY')admitted=false;
      if(!res.headersSent){
        const retryAfterSeconds=Number(error?.retryAfterSeconds);
        if(Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0)
          res.set('Retry-After',String(Math.ceil(retryAfterSeconds)));
        res.status(error.status>=400&&error.status<600?error.status:502)
          .json({error:{code:error.code||'LOCAL_MODEL_REQUEST_FAILED',
            ...(Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>0?
              {retryAfterSeconds:Math.ceil(retryAfterSeconds)}:{})}});
      }
    }finally{
      // Count admitted operations once; overload/invalid requests do not burn quota.
      if(admitted){
        bucket.count++;recent.set(ip,bucket);
        daily.set(dailyKey,count+1);globalCount++;
        if(recent.size>3000)for(const [key,value] of recent)
          if(Date.now()-value.start>=60000)recent.delete(key);
      }
    }
  });
}
