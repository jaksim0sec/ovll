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
