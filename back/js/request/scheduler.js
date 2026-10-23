/** One queue shared by independent request records. */
export function createRequestScheduler({registry,execute,maxConcurrent=1} = {}) {
  if (!registry?.register || !registry?.get || !registry?.transition || typeof execute !== 'function' || !Number.isSafeInteger(maxConcurrent) || maxConcurrent<1)
    throw new TypeError('Invalid scheduler dependencies');
  const queue=[],idleWaiters=[],rooms=new Map();let running=0;
  const clone=value=>structuredClone(value);
  // Session memory lives on the server, not in each browser request. FIFO ensures
  // queued requests observe the last confirmed completion at execution time.
  function session(roomId,initialContext){
    if(!rooms.has(roomId))rooms.set(roomId,{contextData:clone(initialContext??{overallFlow:'',currentTopic:'',details:''}),history:[]});
    return rooms.get(roomId);
  }
  const publicCodes=new Set(['MODEL_ERROR','MODEL_AUTH','MODEL_RATE_LIMIT','MODEL_NETWORK','MODEL_INVALID_RESPONSE','DATA_UNAVAILABLE','ENGINE_OUTPUT_INVALID','UNSUPPORTED_DATASET']);
  const messageFor=code=>({MODEL_AUTH:'Model authentication failed',MODEL_RATE_LIMIT:'Model rate limit exceeded',MODEL_NETWORK:'Model connection failed',DATA_UNAVAILABLE:'Required data unavailable',ENGINE_OUTPUT_INVALID:'Engine output validation failed',MODEL_INVALID_RESPONSE:'Invalid model response',UNSUPPORTED_DATASET:'Unsupported data request'})[code]||'Request execution failed';
  function notifyIdle(){if(running===0 && queue.length===0){for(const resolve of idleWaiters.splice(0))resolve();}}
  function pump(){
    while(running<maxConcurrent && queue.length){
      const item=queue.shift();running++;
      registry.transition(item.roomId,item.requestId,{status:'running'});
      Promise.resolve().then(async()=>{
        try {
          const stored=registry.get(item.roomId,item.requestId);
          const state=session(item.roomId,stored.contextData);
          const snapshot={...stored,contextData:clone(state.contextData),chatHistory:clone(state.history)};
          const result=await execute(snapshot,{
            onStage:layer=>registry.transition(item.roomId,item.requestId,{currentLayer:layer})
          });
          if(!['completed','unsupported_workshop'].includes(result?.status))throw Object.assign(new Error('Invalid result'),{code:'ENGINE_OUTPUT_INVALID'});
          const {status,currentLayer,contextBlock,contextData,result:answer,plan}=result;
          const updated=registry.transition(item.roomId,item.requestId,{status,currentLayer,contextBlock,
            ...(contextData===undefined?{}:{contextData}),...(answer===undefined?{}:{result:answer}),...(plan===undefined?{}:{plan})});
          if(status==='completed'&&contextData!==undefined){
            state.contextData=clone(contextData);
            state.history.push(clone({requestId:item.requestId,request:snapshot.request,contextBlock,contextData}));
            if(state.history.length>8)state.history.shift();
          }
          item.resolve(updated);
        } catch(e){
          const code=publicCodes.has(e?.code)?e.code:'MODEL_ERROR';
          const missing=code==='DATA_UNAVAILABLE'&&Array.isArray(e?.missing)?
            e.missing.slice(0,20).filter(x=>Array.isArray(x)&&x.length===2&&x.every(v=>typeof v==='string'&&v.length<=200)):[];
          item.resolve(registry.transition(item.roomId,item.requestId,{status:'failed',error:{code,message:messageFor(code),...(missing.length?{missing}: {})}}));
        } finally {running--;pump();notifyIdle();}
      });
    }
    notifyIdle();
  }
  function enqueue(input){
    const record=registry.register(input);
    let resolve;
    const completion=new Promise(r=>{resolve=r;});
    queue.push({roomId:record.roomId,requestId:record.requestId,resolve});
    pump();
    return {roomId:record.roomId,requestId:record.requestId,completion};
  }
  return Object.freeze({enqueue,get:(roomId,id)=>registry.get(roomId,id),whenIdle:()=>running===0&&queue.length===0?Promise.resolve():new Promise(resolve=>idleWaiters.push(resolve))});
}
