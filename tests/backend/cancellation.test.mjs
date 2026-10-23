import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../../back/js/engine/engine.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const sample=roomId=>({roomId,request:{parts:[{type:'text',text:'안녕'}],attachments:[]},initialResources:[]});
const direct={languageBlock:'응답',contextBlock:{intent:'인사',progress:'완료'},contextData:{overallFlow:'done',currentTopic:'hi',details:''}};
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(resolve=>setImmediate(resolve));}throw Error('timeout');}
test('running cancellation ignores a late model reply and does not commit context',async()=>{
 const waiting=pause();let started=false;
 const engine=createEngine({composer:{compose:async()=>''},dataProvider:createMemoryDataProvider(),modelCaller:{generate:async ({layer})=>{if(layer==='gate'){started=true;await waiting.promise;}return {jsonText:JSON.stringify(layer==='gate'?{need:[]}:direct)};}}});
 const job=engine.submit(sample('r'));
 await until(()=>started);
 const marked=engine.cancel({roomId:'r',requestId:job.requestId});
 assert.equal(marked.status,'stopping');
 waiting.resolve();
 const result=await job.completion;
 assert.equal(result.status,'stopped');
 assert.equal(result.result,undefined);
 assert.equal(engine.getRequest({roomId:'r',requestId:job.requestId}).status,'stopped');
 assert.equal(engine.listCalls({roomId:'r',requestId:job.requestId})[0].status,'cancelled');
});
test('queued cancellation immediately releases pending request',async()=>{
 const waiting=pause();let entered=false;
 const engine=createEngine({composer:{compose:async()=>''},dataProvider:createMemoryDataProvider(),policy:{maxActiveRequests:1,maxModelCalls:1},modelCaller:{generate:async ({layer})=>{if(layer==='gate'&&!entered){entered=true;await waiting.promise;}return {jsonText:JSON.stringify(layer==='gate'?{need:[]}:direct)}}});
 const a=engine.submit(sample('a')),b=engine.submit(sample('b'));
 await until(()=>entered);
 assert.equal(engine.getRequest({roomId:'b',requestId:b.requestId}).status,'queued');
 assert.equal(engine.cancel({roomId:'b',requestId:b.requestId}).status,'stopped');
 assert.equal((await b.completion).status,'stopped');
 waiting.resolve();
 assert.equal((await a.completion).status,'completed');
 assert.deepEqual(engine.listCalls({roomId:'b',requestId:b.requestId}),[]);
});
