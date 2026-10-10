import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelGateway,ProviderError,openAIChatAdapter} from '../backend/ovllPointer/providers.js';
import {geminiNativeAdapter} from '../backend/ovllPointer/geminiAdapter.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';

const wire={name:'ovll_turn',schema:{type:'object',
  properties:{message:{type:'string'}},required:['message'],additionalProperties:false}};
const options={model:'sample-model',output:'json',
  messages:[{role:'user',content:'Say hello'}],wireSchema:wire};

test('Gemini: rejected structured schema falls back to JSON mode once and caches by model and phase',async()=>{
  const bodies=[];
  const adapter=geminiNativeAdapter({apiKey:'fixture',fetchImpl:async(_url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    if(body.generationConfig.responseJsonSchema)return {ok:false,status:400,
      json:async()=>({error:{status:'INVALID_ARGUMENT',details:[{
        '@type':'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations:[{field:'generationConfig.responseJsonSchema',description:'Unsupported field'}]
      }]}})};
    return {ok:true,status:200,json:async()=>({candidates:[{
      finishReason:'STOP',content:{parts:[{text:'{"message":"ok"}'}]}
    }]})};
  }});
  const gateway=new ModelGateway();
  gateway.register('gemini',adapter,{json:true,structuredOutput:true});
  const first=await gateway.complete({...options,providerId:'gemini'});
  assert.equal(first.text,'{"message":"ok"}');
  assert.equal(first.providerCalls,2);
  assert.equal(first.schemaFallbackUsed,true);
  assert.equal(bodies.length,2);
  assert.ok(bodies[0].generationConfig.responseJsonSchema);
  assert.equal(bodies[1].generationConfig.responseJsonSchema,undefined);
  assert.equal(bodies[1].generationConfig.responseMimeType,'application/json');
  const next=await gateway.complete({...options,providerId:'gemini'});
  assert.equal(next.providerCalls,1);
  assert.equal(next.schemaFallbackUsed,true);
  assert.equal(bodies.length,3);
  assert.equal(bodies[2].generationConfig.responseJsonSchema,undefined);
  const distinctModel=await gateway.complete({...options,providerId:'gemini',model:'new-model'});
  assert.equal(distinctModel.providerCalls,2,'schema negotiation is per model');
});

test('OpenAI-compatible provider: json_schema 400 degrades to json_object without disabling local validation',async()=>{
  const bodies=[];
  const adapter=openAIChatAdapter({endpoint:'https://example.test/llm',
    apiKey:'fixture',fetchImpl:async(_url,options)=>{
      const body=JSON.parse(options.body);bodies.push(body);
      if(body.response_format.type==='json_schema')return {ok:false,status:400};
      return {ok:true,status:200,json:async()=>({id:'id',model:body.model,choices:[{
        message:{content:'{"message":"ok"}'},finish_reason:'stop'
      }]})};
    }});
  const gateway=new ModelGateway();
  gateway.register('groq',adapter,{json:true,structuredOutput:true});
  const response=await gateway.complete({...options,providerId:'groq'});
  assert.equal(response.providerCalls,2);
  assert.deepEqual(bodies.map(body=>body.response_format.type),['json_schema','json_object']);
  await gateway.complete({...options,providerId:'groq'});
  assert.deepEqual(bodies.map(body=>body.response_format.type),['json_schema','json_object','json_object']);
});

test('fallback is strictly limited to schema-associated HTTP 400 and never retries other errors',async()=>{
  for(const status of [401,403,422,429,500]){
    let calls=0;
    const gateway=new ModelGateway();
    gateway.register('p',{complete:async()=>{calls++;
      throw new ProviderError('PROVIDER_HTTP_ERROR','PROVIDER_HTTP_ERROR',status);
    }},{json:true,structuredOutput:true});
    await assert.rejects(gateway.complete({...options,providerId:'p'}),error=>error.status===status);
    assert.equal(calls,1,'unexpected retry for '+status);
  }
  let noSchemaCalls=0;
  const plain=new ModelGateway();
  plain.register('p',{complete:async()=>{noSchemaCalls++;
    throw new ProviderError('PROVIDER_HTTP_ERROR','PROVIDER_HTTP_ERROR',400);
  }},{json:true,structuredOutput:true});
  await assert.rejects(plain.complete({...options,providerId:'p',wireSchema:undefined}),
    error=>error.status===400);
  assert.equal(noSchemaCalls,1);
});

test('persistent provider 400 stops after one schema negotiation and accounts for two physical calls',async()=>{
  let calls=0;
  const gateway=new ModelGateway();
  gateway.register('p',{complete:async()=>{calls++;
    const error=new ProviderError('PROVIDER_HTTP_ERROR','PROVIDER_HTTP_ERROR',400);
    error.providerCalls=1;throw error;
  }},{json:true,structuredOutput:true});
  await assert.rejects(gateway.complete({...options,providerId:'p'}),
    error=>error.status===400&&error.schemaFallbackAttempted===true&&error.providerCalls===2);
  assert.equal(calls,2);
});

test('recovered Gemini-style wire response still passes the full local ModelTurn contract',async()=>{
  let calls=0;
  const gateway=new ModelGateway();
  gateway.register('fixture',{complete:async({wireSchema})=>{
    calls++;
    if(wireSchema)throw new ProviderError('PROVIDER_HTTP_ERROR','PROVIDER_HTTP_ERROR',400);
    return {text:JSON.stringify({executionIntent:null,message:'안녕하세요',
      actions:[],needs:[]}),providerCalls:1};
  }},{json:true,structuredOutput:true});
  const host=createLocalPointerHost({gateway,
    resolveModel:async()=>({providerId:'fixture',model:'fixture'})});
  const snapshot={graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]};
  const result=await host.turn({snapshot,requestRef:'schema_1',requestText:'안녕'});
  assert.equal(result.message,'안녕하세요');
  assert.equal(result._meta.providerCalls,2);
  assert.equal(result._meta.calls[0].schemaFallbackUsed,true);
  assert.equal(calls,2);
  const next=await host.turn({snapshot,requestRef:'schema_2',requestText:'안녕'});
  assert.equal(next._meta.providerCalls,1);
  assert.equal(calls,3);
});

test('Gemini unrelated INVALID_ARGUMENT does not waste a second request',async()=>{
  let count=0;
  const adapter=geminiNativeAdapter({apiKey:'fixture',fetchImpl:async()=>{count++;
    return {ok:false,status:400,json:async()=>({error:{status:'INVALID_ARGUMENT',
      message:'Unknown model or invalid request input'}})};
  }});
  const gateway=new ModelGateway();
  gateway.register('gemini',adapter,{json:true,structuredOutput:true});
  await assert.rejects(gateway.complete({...options,providerId:'gemini'}),e=>
    e.code==='PROVIDER_HTTP_ERROR'&&e.providerStatus==='INVALID_ARGUMENT');
  assert.equal(count,1);
});
