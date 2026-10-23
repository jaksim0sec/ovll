import {createRequestRunner} from './requestRunner.js';
import {createRequestRegistry} from '../request/registry.js';
import {createRequestScheduler} from '../request/scheduler.js';
import {createMemorySessions} from '../request/memorySessions.js';
import {createCallManager} from './callManager.js';

/** Product-level managed Engine, not the runner of one request. */
export function createEngine({composer,modelCaller,dataProvider,actionShell,registry=createRequestRegistry(),sessions=createMemorySessions(),policy={}}={}){
 const callManager=createCallManager({composer,modelCaller,maxModelCalls:policy.maxModelCalls??2});
 const runner=createRequestRunner({composer,modelCaller,dataProvider,actionShell,callManager});
 const maxConcurrent=policy.maxActiveRequests??3;
 const scheduler=createRequestScheduler({registry,sessions,maxConcurrent,execute:(record,options)=>runner.run(record,options)});
 return Object.freeze({
  submit:input=>scheduler.enqueue({...input,contextData:input.contextData??{overallFlow:'',currentTopic:'',details:''}}),
  getRequest:({roomId,requestId})=>scheduler.get(roomId,requestId),
  whenIdle:()=>scheduler.whenIdle(),
  getCall:args=>callManager.getCall(args),
  listCalls:args=>callManager.listCalls(args),
  // Existing HTTP bridge uses the scheduler-shaped facade.
  enqueue:input=>scheduler.enqueue({...input,contextData:input.contextData??{overallFlow:'',currentTopic:'',details:''}}),
  get:(roomId,requestId)=>scheduler.get(roomId,requestId),
  resume:(roomId,requestId,answer)=>scheduler.resume(roomId,requestId,answer),
  retryOutput:(roomId,requestId)=>scheduler.retryOutput(roomId,requestId)
 });
}
/** Compatibility with pre-facade unit tests; identical runner, no second engine logic. */
export {createRequestRunner as createRequestEngine} from './requestRunner.js';
