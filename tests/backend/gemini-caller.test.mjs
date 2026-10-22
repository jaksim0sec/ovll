import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeminiCaller} from '../../back/js/model/gemini.js';
const inputs={layer:'gate',prompt:'instructions',context:{request:{parts:[{type:'text',text:'hi'}]}},format:'json'};
test('Gemini translates the neutral call and response',async()=>{
 let called;
 const caller=createGeminiCaller({apiKey:'test-key',model:'gemini-test',fetchImpl:async(url,options)=>{
  called={url,options};return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"need":[]}' }]}}]})};
 }});
 assert.deepEqual(await caller.generate(inputs),{jsonText:'{"need":[]}'});
 assert.match(called.url,/models\/gemini-test:generateContent$/);
 assert.equal(called.options.headers['x-goog-api-key'],'test-key');
 const body=JSON.parse(called.options.body);
 assert.equal(body.systemInstruction.parts[0].text,'instructions');
 assert.equal(body.generationConfig.responseMimeType,'application/json');
 assert.equal(JSON.parse(body.contents[0].parts[0].text).request.parts[0].text,'hi');
});
test('Gemini errors have safe codes and cannot expose secrets',async()=>{
 const rate=createGeminiCaller({apiKey:'private',model:'gemini-test',fetchImpl:async()=>({ok:false,status:429})});
 await assert.rejects(rate.generate(inputs),e=>e.code==='MODEL_RATE_LIMIT'&&!String(e).includes('private'));
 const blocked=createGeminiCaller({apiKey:'private',model:'gemini-test',fetchImpl:async()=>({ok:true,json:async()=>({candidates:[]})})});
 await assert.rejects(blocked.generate(inputs),e=>e.code==='MODEL_INVALID_RESPONSE');
 const down=createGeminiCaller({apiKey:'private',model:'gemini-test',fetchImpl:async()=>{throw Error('private secret')}});
 await assert.rejects(down.generate(inputs),e=>e.code==='MODEL_NETWORK'&&!String(e).includes('private'));
});
