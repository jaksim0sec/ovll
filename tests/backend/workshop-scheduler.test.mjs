import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
test('question releases the scheduler slot and resumes same request ID only once',async()=>{
 const r=createRequestRegistry({createId:()=> 'req'}),calls=[];
 const sched=createRequestScheduler({registry:r,execute:async()=>({status:'awaiting_input',currentLayer:'workshop',waiting:{id:'wait',text:'Which one?'},verifiedResults:[],contextBlock:{intent:'ask',progress:'waiting'}}),resume:async(snapshot,answer)=>{calls.push(answer);return {status:'completed',currentLayer:'output',result:{languageBlock:'Answered'},contextBlock:{intent:'ask',progress:'completed'},contextData:{overallFlow:'',currentTopic:'done',details:''}};}});
 const inp={roomId:'room',request:{parts:[{type:'text',text:'ask'}],attachments:[]},initialResources:[],contextData:{overallFlow:'',currentTopic:'',details:''}};
 const start=sched.enqueue(inp),waiting=await start.completion;assert.equal(waiting.status,'awaiting_input');
 await sched.whenIdle();
 const resumed=sched.resume('room',start.requestId,{waitingId:'wait',text:'Chemistry'});
 const final=await resumed.completion;assert.equal(final.status,'completed');assert.equal(final.requestId,'req');
 assert.equal(calls.length,1);
 assert.throws(()=>sched.resume('room','req',{waitingId:'wait',text:'Again'}));
});
