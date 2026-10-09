import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiNativeAdapter} from '../backend/ovllPointer/geminiAdapter.js';
const ok=({text='{"message":"ok"}',finishReason='STOP',parts}={})=>({
  ok:true,status:200,json:async()=>({candidates:[{finishReason,
    content:{parts:parts||[{text}]}}]})
});
test('Gemini returns only response text, not internal thought parts',async()=>{
  let body;
  const adapter=geminiNativeAdapter({apiKey:'key',fetchImpl:async(_url,init)=>{
    body=JSON.parse(init.body);
    return ok({parts:[{text:'internal',thought:true},{text:'user answer'}]});
  }});
  const result=await adapter.complete({model:'gemini-2.5-flash-lite',
    messages:[{role:'user',content:'hi'}],output:'text'});
  assert.equal(result.text,'user answer');
  assert.equal(body.generationConfig,undefined);
});
test('Gemini truncation and blocked output have explicit errors',async()=>{
  for(const [response,code] of [
    [ok({finishReason:'MAX_TOKENS',text:'partial'}),'MODEL_OUTPUT_TRUNCATED'],
    [ok({finishReason:'SAFETY',parts:[]}), 'PROVIDER_OUTPUT_BLOCKED'],
    [{ok:true,status:200,json:async()=>({promptFeedback:{blockReason:'SAFETY'},candidates:[]})},
      'PROVIDER_OUTPUT_BLOCKED']
  ]){
    const adapter=geminiNativeAdapter({apiKey:'key',fetchImpl:async()=>response});
    await assert.rejects(adapter.complete({model:'gemini-2.5-flash-lite',
      messages:[],output:'json'}),error=>error.code===code);
  }
});
test('Gemini native rate limit retries briefly and stops excessive calls',async()=>{
  let calls=0;
  const adapter=geminiNativeAdapter({apiKey:'key',fetchImpl:async()=>{
    calls++;
    if(calls===1)return{ok:false,status:429,json:async()=>({error:{details:[{
      '@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'0.01s'
    }]}})};
    return ok();
  }});
  await adapter.complete({model:'gemini-2.5-flash-lite',messages:[],output:'json'});
  assert.equal(calls,2);
  let quotaCalls=0;
  const limited=geminiNativeAdapter({apiKey:'key',fetchImpl:async()=>{
    quotaCalls++;return{ok:false,status:429,json:async()=>({error:{details:[{
      '@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'180s'
    }]}})};
  }});
  for(let i=0;i<2;i++)await assert.rejects(
    limited.complete({model:'gemini-2.5-flash-lite',messages:[]}),
    error=>error.code==='PROVIDER_RATE_LIMIT'&&error.retryAfterSeconds>0);
  assert.equal(quotaCalls,1);
});
test('Gemini HTTP error and cancellation do not expose credentials',async()=>{
  const denied=geminiNativeAdapter({apiKey:'private-key',fetchImpl:async()=>({
    ok:false,status:403
  })});
  await assert.rejects(denied.complete({model:'gemini-2.5-flash-lite',messages:[]}),
    error=>error.code==='PROVIDER_HTTP_ERROR'&&error.status===403&&
      !String(error.message).includes('private-key'));
  const abort=new AbortController();
  abort.abort();
  const adapter=geminiNativeAdapter({apiKey:'key',fetchImpl:async()=>{throw Error('called');}});
  await assert.rejects(adapter.complete({model:'gemini-2.5-flash-lite',
    messages:[],signal:abort.signal}),error=>error.code==='MODEL_REQUEST_CANCELLED');
});
