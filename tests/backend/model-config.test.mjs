import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveGeminiConfig,createConfiguredGeminiCaller} from '../../back/js/model/configuredGemini.js';

const request={layer:'gate',prompt:'Gate instruction',context:{request:'hello'},format:'json'};

test('Gemini config uses main aliases, precedence and default without mandatory model ID',()=>{
 assert.deepEqual(resolveGeminiConfig({GEMINI_API_KEY:'my-key'}),{apiKey:'my-key',model:'gemini-3.5-flash-lite'});
 assert.equal(resolveGeminiConfig({GEMINI_API_KEY:'a',GEMINI_MODEL:'low',OVLL_VNEXT_MODEL_ID:'middle',OVLL_POINTER_MODEL_ID:'top'}).model,'top');
 assert.equal(resolveGeminiConfig({OVLL_POINTER_MODEL_API_KEY:'pointer-key'}).apiKey,'pointer-key');
 assert.equal(resolveGeminiConfig({OVLL_VNEXT_MODEL_API_KEY:'vnext-key'}).apiKey,'vnext-key');
});
test('Gemini key is only required when a model call occurs, not on startup',async()=>{
 let calls=0;
 const caller=createConfiguredGeminiCaller({env:{},fetchImpl:async()=>{calls++;throw Error('should not call');}});
 assert.equal(typeof caller.generate,'function');
 await assert.rejects(caller.generate(request),error=>error.code==='MODEL_AUTH');
 assert.equal(calls,0);
});
test('main pointer aliases configure the beta Gemini caller without changing engine port',async()=>{
 let url,headers;
 const caller=createConfiguredGeminiCaller({env:{OVLL_POINTER_MODEL_API_KEY:'pointer',OVLL_POINTER_MODEL_ID:'gemini-pointer'},fetchImpl:async(u,init)=>{
  url=u;headers=init.headers;return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"need":[]}'}]}}]})};
 }});
 assert.deepEqual(await caller.generate(request),{jsonText:'{"need":[]}'});
 assert.match(url,/gemini-pointer:generateContent$/);
 assert.equal(headers['x-goog-api-key'],'pointer');
});
test('an explicit other provider is not silently replaced with Gemini',async()=>{
 const caller=createConfiguredGeminiCaller({env:{OVLL_POINTER_PROVIDER_ID:'groq',GEMINI_API_KEY:'key'}});
 await assert.rejects(caller.generate(request),error=>error.code==='MODEL_ERROR');
});
