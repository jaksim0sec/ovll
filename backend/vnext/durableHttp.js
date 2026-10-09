import express from 'express';
import { KernelError } from './graph.js';

const error = (code,status=422) => { throw new KernelError(code,code,status); };
const safeId = s => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(s);
export function createDurableVNextApp({ store, authenticate, verifyMutation }={}) {
  if (!store || typeof authenticate!=='function' || typeof verifyMutation!=='function') error('AUTHENTICATION_AND_CSRF_REQUIRED',500);
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'128kb'}));
  async function session(req) {
    const scope=await authenticate(req);
    if (!scope?.actorRef || !scope?.workspaceRef) error('UNAUTHENTICATED',401);
    return {actorRef:scope.actorRef,workspaceRef:scope.workspaceRef};
  }
  async function mutation(req) {
    const scope=await session(req);
    if (await verifyMutation(req,scope)!==true) error('CSRF_DENIED',403);
    return scope;
  }
  function handler(fn) { return async (req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}}; }
  app.post('/api/vnext/graphs/:graphId',handler(async(req,res)=>{
    const scope=await mutation(req);
    res.status(201).json(await store.createGraph(scope,req.params.graphId));
  }));
  app.get('/api/vnext/graphs/:graphId',handler(async(req,res)=>{
    const scope=await session(req);
    const raw=req.query.revision;
    if (raw!==undefined && !/^(0|[1-9]\d*)$/.test(String(raw))) error('BAD_REVISION');
    res.json(await store.readGraph(scope,req.params.graphId,raw===undefined?undefined:Number(raw)));
  }));
  app.post('/api/vnext/tasks',handler(async(req,res)=>{
    const scope=await mutation(req);
    res.status(201).json(await store.createTask(scope,req.body||{}));
  }));
  app.post('/api/vnext/turns',handler(async(req,res)=>{
    const scope=await mutation(req);
    const requestRef=req.get('Idempotency-Key');
    if (!safeId(requestRef)) error('IDEMPOTENCY_KEY_REQUIRED');
    const graphId=req.body?.graphId, taskRef=req.body?.taskRef;
    if (graphId!==undefined && !safeId(graphId)) error('BAD_GRAPH_ID');
    if (taskRef!==undefined && !safeId(taskRef)) error('BAD_TASK_ID');
    res.json(await store.submit(req.body?.turn,{...scope,requestRef,graphId,taskRef}));
  }));
  app.get('/api/vnext/tasks/:taskRef',handler(async(req,res)=>{
    res.set('Cache-Control','no-store').json(await store.readTask(await session(req),req.params.taskRef));
  }));
  app.get('/api/vnext/questions/:questionRef',handler(async(req,res)=>{
    res.set('Cache-Control','no-store').json(await store.readQuestion(await session(req),req.params.questionRef));
  }));
  app.post('/api/vnext/questions/:questionRef/answer',handler(async(req,res)=>{
    res.json(await store.answerQuestion(await mutation(req),req.params.questionRef,req.body?.answer));
  }));
  app.get('/api/vnext/runs/:runRef',handler(async(req,res)=>{
    res.set('Cache-Control','no-store').json(await store.inspectRun(await session(req),req.params.runRef));
  }));
  app.get('/api/vnext/artifacts/:valueRef',handler(async(req,res)=>{
    res.set('Cache-Control','no-store').json(await store.readArtifact(await session(req),req.params.valueRef));
  }));
  app.get('/api/vnext/events',handler(async(req,res)=>{
    const scope=await session(req);
    const after=req.query.after===undefined?0:Number(req.query.after);
    const limit=req.query.limit===undefined?100:Number(req.query.limit);
    res.set('Cache-Control','no-store').json(await store.readEvents(scope,after,limit));
  }));
  app.get('/api/vnext/events/stream',handler(async(req,res)=>{
    let scope=await session(req);
    const raw=req.get('Last-Event-ID')||req.query.after||'0';
    if (!/^(0|[1-9]\d{0,14})$/.test(String(raw))) error('BAD_CURSOR');
    let cursor=Number(raw);
    // Membership is checked on every database read, not only on SSE connect.
    const first=await store.readEvents(scope,cursor,100);
    res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
    res.write('retry: 3000\n\n');
    const push=e=>res.write('id: '+e.id+'\nevent: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');
    const emit=batch=>{
      if(batch.resetRequired){res.write('event: resync_required\ndata: {}\n\n');res.end();return false;}
      for(const event of batch.events){push(event);cursor=event.id;}
      return true;
    };
    if(!emit(first))return;
    let closed=false,working=false;
    res.on('close',()=>{closed=true;clearInterval(timer);});
    const tick=async()=>{
      if(working||closed)return;
      working=true;
      try{
        const newer=await session(req);
        if(newer.actorRef!==scope.actorRef||newer.workspaceRef!==scope.workspaceRef) throw new Error('SESSION_CHANGED');
        const data=await store.readEvents(scope,cursor,100);
        if(!closed && emit(data))res.write(': heartbeat\n\n');
      }catch{if(!closed)res.end();}
      finally{working=false;}
    };
    const timer=setInterval(tick,2000);
    timer.unref?.();
  }));
  app.use((err,_req,res,_next)=>{
    if(res.headersSent){res.end();return;}
    const status=err instanceof KernelError?err.status:err?.type==='entity.too.large'?413:500;
    res.status(status).json({error:{code:err.code||(status===413?'PAYLOAD_TOO_LARGE':'INTERNAL_ERROR')}});
  });
  return app;
}
