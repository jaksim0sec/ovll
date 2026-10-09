import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {localModelReady,mountLocalVNextRoutes} from '../backend/vnext/localHttp.js';
import {readFileSync} from 'node:fs';
test('local model can use existing free Groq configuration without PostgreSQL or account',()=>{
  assert.equal(localModelReady({GROQ_API_KEY:'free-tier-key'}),true);
  assert.equal(localModelReady({GROQ_API_KEY:'free-tier-key',OVLL_VNEXT_LOCAL_MODEL_ENABLED:'false'}),false);
  assert.equal(localModelReady({}),false);
});
test('model readiness endpoint never calls the model, and disabled service rejects inference',async()=>{
  const app=express();app.use(express.json());
  let called=0;mountLocalVNextRoutes(app,{enabled:()=>false,createHost:()=>{called++;return {};}});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port;
    const health=await fetch(url+'/api/vnext/local/ready');
    assert.equal(health.status,200);assert.deepEqual(await health.json(),{ready:false});
    const response=await fetch(url+'/api/vnext/local/turn',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({requestText:'hello'})});
    assert.equal(response.status,503);
    assert.equal((await response.json()).error.code,'LOCAL_MODEL_DISABLED');
    assert.equal(called,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('front enables vNext only after server readiness, and preserves legacy graph conversations',()=>{
  const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  const config=readFileSync(new URL('../front/runtime-config.js',import.meta.url),'utf8');
  const api=readFileSync(new URL('../front/js/vnextApi.js',import.meta.url),'utf8');
  assert.match(config,/vnextEnabled:true/);
  assert.match(app,/verifyLocalVNextReady\(\)/);
  assert.match(app,/if\(!state\.vnextLocalReady\)return null/);
  assert.match(app,/conversation\?\.state\?\.canvas\?\.workflow\?\.nodes\?\.length/);
  assert.match(api,/local\/ready/);
});
