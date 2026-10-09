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
test('provider truncation is explicit rather than retried as a JSON typo',async()=>{
 const {openAIChatAdapter}=await import('../backend/ovllPointer/providers.js');
 const adapter=openAIChatAdapter({endpoint:'https://unit.test',apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"actions":['}}]})})});
 await assert.rejects(adapter.complete({model:'test',messages:[],output:'json'}),error=>error.code==='MODEL_OUTPUT_TRUNCATED');
});

test('provider 429 without retry metadata is surfaced once, not retried in a burst',async()=>{
 const {openAIChatAdapter}=await import('../backend/ovllPointer/providers.js');
 let calls=0;
 const adapter=openAIChatAdapter({endpoint:'https://unit.test',apiKey:'secret',
   fetchImpl:async()=>{calls++;return{ok:false,status:429};}});
 await assert.rejects(adapter.complete({model:'x',messages:[]}),error=>
   error.code==='PROVIDER_RATE_LIMIT'&&error.status===429);
 assert.equal(calls,1);
});
test('provider honors short Retry-After once and succeeds without changing request contents',async()=>{
 const {openAIChatAdapter}=await import('../backend/ovllPointer/providers.js');
 let calls=0;
 const requestBodies=[];
 const adapter=openAIChatAdapter({endpoint:'https://unit.test',apiKey:'secret',
   fetchImpl:async(_url,options)=>{
     calls++;requestBodies.push(options.body);
     if(calls===1)return{ok:false,status:429,headers:{get:key=>key==='retry-after'?'0.1':null}};
     return{ok:true,json:async()=>({choices:[{message:{content:'{"message":"ok"}'}}]})};
   }});
 const result=await adapter.complete({model:'x',messages:[{role:'user',content:'test'}],output:'json'});
 assert.equal(result.text,'{"message":"ok"}');
 assert.equal(calls,2);
 assert.equal(requestBodies[0],requestBodies[1]);
});
test('provider remembers a long quota cooldown and suppresses repeated HTTP calls',async()=>{
 const {openAIChatAdapter}=await import('../backend/ovllPointer/providers.js');
 let calls=0;
 const adapter=openAIChatAdapter({endpoint:'https://unit.test',apiKey:'secret',
   fetchImpl:async()=>{calls++;return{ok:false,status:429,headers:{get:()=> '180'}};}});
 for(let i=0;i<2;i++)await assert.rejects(
   adapter.complete({model:'x',messages:[]}),
   error=>error.code==='PROVIDER_RATE_LIMIT'&&error.retryAfterSeconds>0);
 assert.equal(calls,1);
});
test('abort during quota wait does not retry or leak work',async()=>{
 const {openAIChatAdapter}=await import('../backend/ovllPointer/providers.js');
 const abort=new AbortController();let calls=0;
 const adapter=openAIChatAdapter({endpoint:'https://unit.test',apiKey:'secret',
   fetchImpl:async()=>{calls++;return{ok:false,status:429,headers:{get:()=> '1'}};}});
 const pending=adapter.complete({model:'x',messages:[],signal:abort.signal});
 setTimeout(()=>abort.abort(),10);
 await assert.rejects(pending,error=>error.code==='MODEL_REQUEST_CANCELLED');
 assert.equal(calls,1);
});
