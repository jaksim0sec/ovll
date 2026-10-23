import {createMemorySessions} from './memorySessions.js';
/** One queue shared by independent request records. */
export function createRequestScheduler({registry,execute,resume,retryOutput,sessions=createMemorySessions(),maxConcurrent=1} = {}) {
  if (!registry?.register || !registry?.get || !registry?.transition || typeof execute !== 'function' || !Number.isSafeInteger(maxConcurrent) || maxConcurrent<1)
    throw new TypeError('Invalid scheduler dependencies');
  const queue=[],idleWaiters=[],resuming=new Set();let running=0;
  const clone=value=>structuredClone(value);
  // Session memory lives on the server, not in each browser request. FIFO ensures
  // queued requests observe the last confirmed completion at execution time.
  function session(roomId,initialContext){
    return sessions.load({scope:roomId,initialContext});
  }
  const publicCodes=new Set(['MODEL_ERROR','MODEL_AUTH','MODEL_RATE_LIMIT','MODEL_NETWORK','MODEL_INVALID_RESPONSE','DATA_UNAVAILABLE','ENGINE_OUTPUT_INVALID','UNSUPPORTED_DATASET','UNSUPPORTED_ACTION','ENGINE_BUDGET_EXCEEDED','CHECKPOINT_CONFLICT','SESSION_CONFLICT','WORK_REQUIRED']);
  const messageFor=code=>({MODEL_AUTH:'Model authentication failed',MODEL_RATE_LIMIT:'Model rate limit exceeded',MODEL_NETWORK:'Model connection failed',DATA_UNAVAILABLE:'Required data unavailable',ENGINE_OUTPUT_INVALID:'Engine output validation failed',MODEL_INVALID_RESPONSE:'Invalid model response',UNSUPPORTED_DATASET:'Unsupported data request',WORK_REQUIRED:'Requested action was not planned or executed'})[code]||'Request execution failed';
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
          const result=await (item.retryOutput?retryOutput(snapshot,{onStage:layer=>registry.transition(item.roomId,item.requestId,{currentLayer:layer})}):item.resumeArgs?resume(snapshot,item.resumeArgs,{onStage:layer=>registry.transition(item.roomId,item.requestId,{currentLayer:layer})}):execute(snapshot,{
            onStage:layer=>registry.transition(item.roomId,item.requestId,{currentLayer:layer})
          }));
          if(!['completed','awaiting_input','unsupported_workshop','failed'].includes(result?.status))throw Object.assign(new Error('Invalid result'),{code:'ENGINE_OUTPUT_INVALID'});
          const {status,currentLayer,contextBlock,contextData,result:answer,plan,waiting,verifiedResults,error}=result;
          if(status==='completed'&&contextData!==undefined){
            const saved=sessions.commit({scope:item.roomId,expectedRevision:state.revision,requestId:item.requestId,request:snapshot.request,contextBlock,contextData,assistantResponse:answer?.languageBlock??'',verifiedResults:answer?.verifiedResults??verifiedResults??[]});
            if(saved.status!=='committed')throw Object.assign(new Error('Session context conflict'),{code:'SESSION_CONFLICT'});
          }
          const updated=registry.transition(item.roomId,item.requestId,{status,currentLayer,contextBlock,
            ...(contextData===undefined?{}:{contextData}),...(answer===undefined?{}:{result:answer}),...(plan===undefined?{}:{plan}),...(waiting===undefined?{}:{waiting}),...(verifiedResults===undefined?{}:{verifiedResults}),...(error===undefined?{}:{error})});
          item.resolve(updated);
        } catch(e){
          const code=publicCodes.has(e?.code)?e.code:'MODEL_ERROR';
          const missing=code==='DATA_UNAVAILABLE'&&Array.isArray(e?.missing)?
            e.missing.slice(0,20).filter(x=>Array.isArray(x)&&x.length===2&&x.every(v=>typeof v==='string'&&v.length<=200)):[];
          item.resolve(registry.transition(item.roomId,item.requestId,{status:'failed',error:{code,message:messageFor(code),...(missing.length?{missing}:{}),...(typeof e?.detail==='string'&&e.detail.length<=160?{detail:e.detail}:{})}}));
        } finally {if(item.resumeArgs||item.retryOutput)resuming.delete(item.requestId);running--;pump();notifyIdle();}
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
  function resumeRequest(roomId,requestId,answer){
    if(typeof resume!=='function')throw new Error('Request resumption unavailable');
    const current=registry.get(roomId,requestId);
    if(current?.status!=='awaiting_input'||current.waiting?.id!==answer?.waitingId||resuming.has(requestId))throw new Error('Request is not waiting for this answer');
    resuming.add(requestId);let resolve;const completion=new Promise(r=>resolve=r);
    queue.push({roomId,requestId,resolve,resumeArgs:answer});pump();
    return {roomId,requestId,completion};
  }
  function retryOutputRequest(roomId,requestId){
    if(typeof retryOutput!=='function')throw new Error('Output retry unavailable');
    const current=registry.get(roomId,requestId);
    if(current?.status!=='failed'||current.currentLayer!=='output'||resuming.has(requestId))throw new Error('Request is not in failed Output');
    resuming.add(requestId);let resolve;const completion=new Promise(r=>resolve=r);
    queue.push({roomId,requestId,resolve,retryOutput:true});pump();
    return {roomId,requestId,completion};
  }
  return Object.freeze({enqueue,resume:resumeRequest,retryOutput:retryOutputRequest,get:(roomId,id)=>registry.get(roomId,id),whenIdle:()=>running===0&&queue.length===0?Promise.resolve():new Promise(resolve=>idleWaiters.push(resolve))});
}
