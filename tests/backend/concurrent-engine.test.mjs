import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../../back/js/engine/engine.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const request=roomId=>({roomId,initialResources:[],request:{parts:[{type:'text',text:'안녕'}],attachments:[]}});
const answer={languageBlock:'안녕',contextBlock:{intent:'인사',progress:'완료'},contextData:{overallFlow:'대화',currentTopic:'인사',details:''}};
async function until(check){
 for(let i=0;i<200;i++){if(check())return;await new Promise(resolve=>setImmediate(resolve));}
 throw new Error('Expected concurrent state not reached');
}
test('request slots and provider slots are independent',async()=>{
 const waits=[pause(),pause()],gateEntered=[];let active=0,peak=0;
 const modelCaller={generate:async ({layer})=>{
  active++;peak=Math.max(peak,active);
  if(layer==='gate'){
   const index=gateEntered.length;gateEntered.push(index);
   if(index<2)await waits[index].promise;
  }
  active--;
  return {jsonText:JSON.stringify(layer==='gate'?{need:[]}:answer)};
 }};
 const e=createEngine({composer:{compose:async()=>''},modelCaller,dataProvider:createMemoryDataProvider(),policy:{maxActiveRequests:3,maxModelCalls:2}});
 const jobs=['a','b','c','d'].map(roomId=>e.submit(request(roomId)));
 await until(()=>gateEntered.length===2);
 assert.equal(peak,2);
 assert.equal(e.getRequest({roomId:'d',requestId:jobs[3].requestId}).status,'queued');
 waits[0].resolve();waits[1].resolve();
 const results=await Promise.all(jobs.map(x=>x.completion));
 assert.deepEqual(results.map(r=>r.status),['completed','completed','completed','completed']);
 assert.ok(peak<=2);
 assert.equal(e.listCalls({roomId:'a',requestId:jobs[0].requestId}).length,2);
});
test('call slot is released after provider failure',async()=>{
 let n=0;
 const e=createEngine({composer:{compose:async()=>''},dataProvider:createMemoryDataProvider(),policy:{maxActiveRequests:2,maxModelCalls:1},modelCaller:{generate:async ({layer})=>{n++;if(n===1)throw Error('disconnected');return {jsonText:JSON.stringify(layer==='gate'?{need:[]}:answer)};}}});
 const a=e.submit(request('a')),b=e.submit(request('b'));
 const results=await Promise.all([a.completion,b.completion]);
 assert.deepEqual(results.map(x=>x.status).sort(),['completed','failed']);
 assert.ok(n>=3);
});
