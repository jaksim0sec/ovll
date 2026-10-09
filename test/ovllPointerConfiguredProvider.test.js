import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredModelProvider} from '../backend/ovllPointer/configuredProvider.js';
const env={OVLL_POINTER_MODEL_ENDPOINT:'https://api.example.test/chat/completions',
  OVLL_POINTER_MODEL_API_KEY:'secret',OVLL_POINTER_MODEL_ID:'model-a',OVLL_POINTER_PROVIDER_ID:'vendor_x',
  OVLL_POINTER_MAX_OUTPUT_TOKENS:'333'};
test('configured provider uses real OpenAI-compatible HTTP wire adapter without vendor code in controller',async()=>{
  let url,body,auth;
  const p=createConfiguredModelProvider({env,fetchImpl:async(u,opt)=>{
    url=u;auth=opt.headers.Authorization;body=JSON.parse(opt.body);
    return {ok:true,json:async()=>({id:'remote1',choices:[{message:{content:'{"message":"hello"}'}}],usage:{prompt_tokens:3}})};
  }});
  const config=await p.resolveTurnModel();
  assert.equal(config.model,'model-a');assert.equal(config.providerId,'vendor_x');
  const result=await p.modelGateway.complete({...config,messages:[{role:'user',content:'say hi'}]});
  assert.equal(url,env.OVLL_POINTER_MODEL_ENDPOINT);
  assert.equal(body.model,'model-a');assert.equal(body.max_completion_tokens,333);
  assert.deepEqual(body.response_format,{type:'json_object'});
  assert.equal(auth,'Bearer secret');assert.equal(result.providerRequestId,'remote1');
  assert.equal(result.text,'{"message":"hello"}');
});
test('missing secrets, insecure endpoint and unbounded token budget reject before a request',()=>{
  assert.throws(()=>createConfiguredModelProvider({env:{...env,OVLL_POINTER_MODEL_API_KEY:''}}),e=>e.code==='MODEL_PROVIDER_UNCONFIGURED');
  assert.throws(()=>createConfiguredModelProvider({env:{...env,OVLL_POINTER_MODEL_ENDPOINT:'http://example.test/a'}}),e=>e.code==='INSECURE_MODEL_ENDPOINT');
  assert.throws(()=>createConfiguredModelProvider({env:{...env,OVLL_POINTER_MAX_OUTPUT_TOKENS:'999999'}}),e=>e.code==='MODEL_BUDGET_INVALID');
});

test('former vNext environment variables remain readable during Pointer migration',()=>{
  const env={OVLL_VNEXT_MODEL_ENDPOINT:'https://api.test.local/completions',OVLL_VNEXT_MODEL_API_KEY:'old-key',
    OVLL_VNEXT_MODEL_ID:'migration-model'};
  const provider=createConfiguredModelProvider({env,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'{}'}}]})})});
  assert.ok(provider.modelGateway);
});
