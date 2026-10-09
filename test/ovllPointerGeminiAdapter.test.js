import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredModelProvider} from '../backend/ovllPointer/configuredProvider.js';
import {localModelReady} from '../backend/ovllPointer/localHttp.js';
const mock=text=>({ok:true,status:200,json:async()=>({
  responseId:'req_1',candidates:[{finishReason:'STOP',content:{parts:[{text}]}}],
  usageMetadata:{promptTokenCount:5,candidatesTokenCount:3,totalTokenCount:8}
})});
test('Gemini native mode preserves all message roles and JSON output contract',async()=>{
  let endpoint,request;
  const env={OVLL_POINTER_PROVIDER_ID:'gemini',GEMINI_API_KEY:'test-gemini-key',
    OVLL_POINTER_MODEL_ID:'gemini-3.5-flash-lite',
    OVLL_POINTER_MODEL_ENDPOINT:'https://api.groq.com/openai/v1/chat/completions',
    OVLL_POINTER_MODEL_API_KEY:'old-provider-key'};
  const host=createConfiguredModelProvider({env,fetchImpl:async(url,init)=>{
    endpoint=url;request=init;return mock('{"message":"안녕"}');
  }});
  const model=await host.resolveModel();
  const result=await host.modelGateway.complete({...model,messages:[
    {role:'system',content:'core'},{role:'developer',content:'schema'},
    {role:'user',content:'hello'},{role:'assistant',content:'draft'},
    {role:'user',content:'revise'}
  ]});
  assert.equal(model.providerId,'gemini');
  assert.match(endpoint,/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(request.headers['x-goog-api-key'],'test-gemini-key');
  assert.equal(request.headers.Authorization,undefined);
  const body=JSON.parse(request.body);
  assert.deepEqual(body.systemInstruction.parts,[{text:'core'},{text:'schema'}]);
  assert.deepEqual(body.contents.map(m=>m.role),['user','model','user']);
  assert.equal(body.generationConfig.responseMimeType,'application/json');
  assert.equal(body.generationConfig.maxOutputTokens,2048);
  assert.equal(result.text,'{"message":"안녕"}');
  assert.equal(result.providerRequestId,'req_1');
  assert.equal(result.usage.total_tokens,8);
});
test('provider selection requires Gemini credentials and does not fall back to Groq',async()=>{
  assert.equal(localModelReady({OVLL_POINTER_PROVIDER_ID:'gemini',GEMINI_API_KEY:'a'}),true);
  assert.equal(localModelReady({OVLL_POINTER_PROVIDER_ID:'gemini',GROQ_API_KEY:'a'}),false);
  assert.equal(localModelReady({GROQ_API_KEY:'a'}),true);
  assert.equal(localModelReady({OVLL_POINTER_PROVIDER_ID:'gemini',GEMINI_API_KEY:'a',
    OVLL_POINTER_LOCAL_MODEL_ENABLED:'false'}),false);
  assert.equal(localModelReady({OVLL_POINTER_PROVIDER_ID:'vendor',GROQ_API_KEY:'a'}),false);
  const provider=createConfiguredModelProvider({env:{OVLL_POINTER_PROVIDER_ID:'gemini',
    GEMINI_API_KEY:'a',GEMINI_MODEL:'gemini-3.1-flash-lite'}});
  assert.equal((await provider.resolveModel()).model,'gemini-3.1-flash-lite');
  assert.throws(()=>createConfiguredModelProvider({env:{OVLL_POINTER_PROVIDER_ID:'gemini',
    GROQ_API_KEY:'a'}}),e=>e.code==='MODEL_PROVIDER_UNCONFIGURED');
});
