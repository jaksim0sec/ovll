import {createConfiguredLocalVNextHost} from './localHost.js';
const allowed=new Set(['turn','node']);
export function localModelReady(env=process.env){
  if(env.OVLL_VNEXT_LOCAL_MODEL_ENABLED==='false')return false;
  const configured=!!(env.OVLL_VNEXT_MODEL_ENDPOINT&&env.OVLL_VNEXT_MODEL_API_KEY&&env.OVLL_VNEXT_MODEL_ID);
  return configured||!!env.GROQ_API_KEY;
}
export function mountLocalVNextRoutes(app,{createHost=()=>createConfiguredLocalVNextHost(),
  enabled=()=>localModelReady()}={}){
  let host;
  const recent=new Map();
  const daily=new Map();
  let globalDay='',globalCount=0;
  app.get('/api/vnext/local/ready',(_req,res)=>{
    res.set('Cache-Control','no-store').json({ready:!!enabled()});
  });
  app.post('/api/vnext/local/:kind',async(req,res)=>{
    const kind=req.params.kind;
    res.set('Cache-Control','no-store');
    if(!allowed.has(kind))return res.status(404).json({error:{code:'UNKNOWN_LOCAL_OPERATION'}});
    if(!enabled())return res.status(503).json({error:{code:'LOCAL_MODEL_DISABLED'}});
    // Stateless model use is still server-side and rate bounded; browser never sees API credentials.
    const now=Date.now(),ip=req.ip||'unknown',bucket=recent.get(ip)||{start:now,count:0};
    if(now-bucket.start>60000){bucket.start=now;bucket.count=0;}
    if(++bucket.count>12)return res.status(429).json({error:{code:'LOCAL_MODEL_RATE_LIMIT'}});
    recent.set(ip,bucket);
    if(recent.size>3000)for(const [key,value] of recent)if(now-value.start>60000)recent.delete(key);
    const day=new Date(now).toISOString().slice(0,10);
    if(globalDay!==day){globalDay=day;globalCount=0;daily.clear();}
    const dailyKey=day+':'+ip;
    const count=(daily.get(dailyKey)||0)+1;
    if(count>48||globalCount>=400)return res.status(429).json({error:{code:'LOCAL_MODEL_DAILY_BUDGET'}});
    daily.set(dailyKey,count);globalCount++;
    const length=Buffer.byteLength(JSON.stringify(req.body||{}),'utf8');
    if(length>65536)return res.status(413).json({error:{code:'LOCAL_MODEL_PAYLOAD_TOO_LARGE'}});
    try{
      if(!host)host=createHost();
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),60000);
      try{
        const result=await host[kind]({...req.body,signal:controller.signal});
        if(!res.headersSent)res.set('Cache-Control','no-store').json(result);
      }finally{clearTimeout(timeout);}
    }catch(error){
      if(!res.headersSent)res.status(error.status>=400&&error.status<600?error.status:502)
        .json({error:{code:error.code||'LOCAL_MODEL_REQUEST_FAILED'}});
    }
  });
}
