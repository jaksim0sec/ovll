import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {mountLocalPointerRoutes} from '../backend/ovllPointer/localHttp.js';
test('stateless local model API is disabled by default and cannot invoke provider',async()=>{
 const app=express();app.use(express.json());
 let calls=0;mountLocalPointerRoutes(app,{enabled:()=>false,createHost:()=>{calls++;return{};}});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 try{
  const port=server.address().port;
  const result=await fetch('http://127.0.0.1:'+port+'/api/pointer/local/turn',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({requestText:'hello'})});
  assert.equal(result.status,503);
  assert.equal((await result.json()).error.code,'LOCAL_MODEL_DISABLED');
  assert.equal(calls,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('explicitly enabled mock host serves valid local model request without SQL',async()=>{
 const app=express();app.use(express.json());
 mountLocalPointerRoutes(app,{enabled:()=>true,createHost:()=>({
  turn:async({requestText})=>({message:'hello '+requestText})})});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 try{
  const port=server.address().port;
  const result=await fetch('http://127.0.0.1:'+port+'/api/pointer/local/turn',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({requestText:'test'})});
  assert.equal(result.status,200);
  assert.equal((await result.json()).message,'hello test');
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('local model minute budget returns actionable Retry-After without making excess provider calls',async()=>{
 const app=express();app.use(express.json());let calls=0;
 mountLocalPointerRoutes(app,{enabled:()=>true,createHost:()=>({
   turn:async()=>{calls++;return{message:'ok'};}
 })});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 try{
   const url='http://127.0.0.1:'+server.address().port+'/api/pointer/local/turn';
   let response;
   for(let i=0;i<13;i++)response=await fetch(url,{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({requestText:'hello'})});
   assert.equal(calls,12);
   assert.equal(response.status,429);
   assert.ok(Number(response.headers.get('retry-after'))>0);
   const body=await response.json();
   assert.equal(body.error.code,'LOCAL_MODEL_RATE_LIMIT');
   assert.ok(body.error.retryAfterSeconds>0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('provider rate limit remains distinct from local budget and carries sanitized retry timing',async()=>{
 const app=express();app.use(express.json());
 mountLocalPointerRoutes(app,{enabled:()=>true,createHost:()=>({
   turn:async()=>{throw Object.assign(new Error('secret upstream body'),{
     code:'PROVIDER_RATE_LIMIT',status:429,retryAfterSeconds:35
   });}
 })});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 try{
   const result=await fetch('http://127.0.0.1:'+server.address().port+'/api/pointer/local/turn',{
     method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestText:'hello'})
   });
   assert.equal(result.status,429);
   assert.equal(result.headers.get('retry-after'),'35');
   assert.deepEqual(await result.json(),{error:{code:'PROVIDER_RATE_LIMIT',retryAfterSeconds:35}});
 }finally{await new Promise(resolve=>server.close(resolve));}
});

async function fixture(options, run) {
 const app=express();app.use(express.json());mountLocalPointerRoutes(app,{enabled:()=>true,...options});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 const url='http://127.0.0.1:'+server.address().port+'/api/pointer/local/turn';
 const post=(body={requestText:'hello'},signal)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 try {await run(post,url);} finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('daily budget reserves concurrent admissions and settles trusted physical invocations',async()=>{
 let release,entered;const start=new Promise(resolve=>entered=resolve);const gate=new Promise(resolve=>release=resolve);let calls=0;
 await fixture({limits:{dailyPerIp:2,dailyGlobal:2,reserveProviderCalls:1},createHost:()=>({turn:async()=>{calls++;entered();await gate;return{message:'ok',_meta:{providerCalls:1}};}})},async post=>{
  const first=post();await start;const second=post();await new Promise(resolve=>setTimeout(resolve,20));
  const thirdPromise=post();await new Promise(resolve=>setTimeout(resolve,20));release();const third=await thirdPromise;await Promise.all([first,second]);
  assert.equal(third.status,429);assert.equal(calls,2);
  assert.equal((await post()).status,429);
 });
});
test('queued disconnect abandons work and does not spend quota',async()=>{
 let release,entered;const start=new Promise(resolve=>entered=resolve);const gate=new Promise(resolve=>release=resolve);let calls=0;
 await fixture({limits:{dailyPerIp:2,dailyGlobal:2,reserveProviderCalls:1},createHost:()=>({turn:async()=>{calls++;entered();await gate;return{message:'ok'};}})},async post=>{
  const first=post();await start;const controller=new AbortController();const queued=post(undefined,controller.signal).catch(()=>null);
  await new Promise(resolve=>setTimeout(resolve,20));controller.abort();await queued;await new Promise(resolve=>setTimeout(resolve,20));
  release();await first;assert.equal((await post()).status,200);assert.equal(calls,2);
 });
});
test('deadline includes queue wait and invalid payload does not reserve provider budget',async()=>{
 let calls=0;
 await fixture({limits:{deadlineMs:35,dailyPerIp:2,dailyGlobal:2,reserveProviderCalls:1},createHost:()=>({turn:async({signal})=>{calls++;await new Promise(resolve=>setTimeout(resolve,80));if(signal.aborted)throw signal.reason;return{message:'late'};}})},async post=>{
  assert.equal((await post({requestText:42})).status,422);
  const responses=await Promise.all([post(),post()]);
  assert.ok(responses.every(response=>response.status===504));assert.equal(calls,1);
 });
});
test('readiness declares configuration and leaves live model health unproven',async()=>{
 await fixture({createHost:()=>{throw new Error('must not probe');}},async(_post,url)=>{
  const response=await fetch(url.replace('/turn','/ready'));const value=await response.json();
  assert.equal(value.configured,true);assert.equal(value.modelHealth,'unverified');
 });
});

test('repair physical usage consumes daily budget and zero-call host validation releases it',async()=>{
 let calls=0;
 await fixture({limits:{dailyPerIp:2,dailyGlobal:2,reserveProviderCalls:2},createHost:()=>({turn:async()=>{
  calls++;if(calls===1)throw Object.assign(new Error('bad'),{code:'INVALID_LOCAL_MODEL_REQUEST',status:422,_meta:{providerCalls:0}});
  return{message:'fixed',_meta:{providerCalls:2}};
 }})},async post=>{
  assert.equal((await post()).status,422);assert.equal((await post()).status,200);
  assert.equal((await post()).status,429);assert.equal(calls,2);
 });
});

test('overload rejection leaves model quota available for a later valid request',async()=>{
 let release,entered;const start=new Promise(resolve=>entered=resolve);const gate=new Promise(resolve=>release=resolve);let calls=0;
 await fixture({limits:{maxPending:1,dailyPerIp:2,dailyGlobal:2,reserveProviderCalls:1},createHost:()=>({turn:async()=>{calls++;entered();await gate;return{message:'ok'};}})},async post=>{
  const first=post();await start;assert.equal((await post()).status,503);release();await first;
  assert.equal((await post()).status,200);assert.equal((await post()).status,429);assert.equal(calls,2);
 });
});
