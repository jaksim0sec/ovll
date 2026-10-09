import {createConfiguredLocalVNextHost} from './localHost.js';
const allowed=new Set(['turn','node']);
export function mountLocalVNextRoutes(app,{createHost=()=>createConfiguredLocalVNextHost()}={}){
  let host;
  const recent=new Map();
  app.post('/api/vnext/local/:kind',async(req,res)=>{
    const kind=req.params.kind;
    if(!allowed.has(kind))return res.status(404).json({error:{code:'UNKNOWN_LOCAL_OPERATION'}});
    // Stateless model use is still server-side and rate bounded; browser never sees API credentials.
    const now=Date.now(),ip=req.ip||'unknown',bucket=recent.get(ip)||{start:now,count:0};
    if(now-bucket.start>60000){bucket.start=now;bucket.count=0;}
    if(++bucket.count>12)return res.status(429).json({error:{code:'LOCAL_MODEL_RATE_LIMIT'}});
    recent.set(ip,bucket);
    if(recent.size>3000)for(const [key,value] of recent)if(now-value.start>60000)recent.delete(key);
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
