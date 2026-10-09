import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createConfiguredModelProvider} from '../backend/ovllPointer/configuredProvider.js';
import {localModelReady} from '../backend/ovllPointer/localHttp.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';

const base={GEMINI_API_KEY:'gemini-test',GROQ_API_KEY:'groq-test'};
const geminiOK=(content='{"message":"Gemini result"}')=>({
  ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',
    content:{parts:[{text:content}]}}]})
});
const groqOK=(content='{"message":"Groq standby result"}')=>({
  ok:true,status:200,json:async()=>({choices:[{message:{content}}]})
});
function snapshot(){
  const repo=new MemoryGraphRepository();
  repo.create('local','g_failover');
  return repo.get('local','g_failover');
}
const call=host=>host.turn({snapshot:snapshot(),requestRef:'fallback_1',requestText:'안녕'});
test('Gemini 3.5 is the implicit default with both keys; Groq is standby only',async()=>{
  const config=createConfiguredModelProvider({env:base});
  const selected=await config.resolveModel();
  assert.equal(selected.providerId,'gemini');
  assert.equal(selected.model,'gemini-3.5-flash-lite');
  assert.equal(selected.standby.providerId,'groq');
  assert.equal(selected.standby.model,'openai/gpt-oss-120b');
  assert.equal(localModelReady(base),true);
  let google=0,groq=0;
  const host=createConfiguredLocalPointerHost({env:base,fetchImpl:async url=>{
    if(url.includes('googleapis.com')){google++;return geminiOK();}
    groq++;return groqOK();
  }});
  assert.equal((await call(host)).message,'Gemini result');
  assert.equal(google,1);
  assert.equal(groq,0);
});
test('Gemini model ID is configurable; never silently override an explicit value',async()=>{
  const explicit=createConfiguredModelProvider({env:{...base,
    OVLL_POINTER_PROVIDER_ID:'gemini',OVLL_POINTER_MODEL_ID:'gemini-2.5-flash-lite'}});
  assert.equal((await explicit.resolveModel()).model,'gemini-2.5-flash-lite');
  const env={...base,GEMINI_MODEL:'gemini-3.1-flash-lite'};
  assert.equal((await createConfiguredModelProvider({env}).resolveModel()).model,'gemini-3.1-flash-lite');
});
test('Gemini HTTP 429 activates Groq only once with same user request',async()=>{
  const urls=[],requests=[];
  const host=createConfiguredLocalPointerHost({env:base,fetchImpl:async(url,init)=>{
    urls.push(url);requests.push(JSON.parse(init.body));
    if(url.includes('googleapis.com'))return {ok:false,status:429,
      json:async()=>({error:{status:'RESOURCE_EXHAUSTED'}})};
    return groqOK();
  }});
  assert.equal((await call(host)).message,'Groq standby result');
  assert.equal(urls.length,2);
  assert.match(urls[0],/gemini-3\.5-flash-lite/);
  assert.match(urls[1],/api\.groq\.com/);
  assert.equal(requests[1].model,'openai/gpt-oss-120b');
  assert.match(JSON.stringify(requests[0]),/안녕/);
  assert.match(JSON.stringify(requests[1]),/안녕/);
});
test('temporary Gemini 503 or network failure activates standby, no repeated burst',async()=>{
  for(const mode of ['http','network']){
    let requests=0;
    const host=createConfiguredLocalPointerHost({env:base,fetchImpl:async url=>{
      requests++;
      if(url.includes('googleapis.com')){
        if(mode==='network')throw Error('upstream unavailable');
        return {ok:false,status:503,json:async()=>({error:{status:'UNAVAILABLE'}})};
      }
      return groqOK();
    }});
    assert.equal((await call(host)).message,'Groq standby result');
    assert.equal(requests,2);
  }
});
test('Gemini invalid argument, missing permission and missing model never switch suppliers',async()=>{
  for(const [status,name] of [[400,'INVALID_ARGUMENT'],[403,'PERMISSION_DENIED'],[404,'NOT_FOUND']]){
    let requests=0;
    const host=createConfiguredLocalPointerHost({env:base,fetchImpl:async()=>{
      requests++;
      return {ok:false,status,json:async()=>({
        error:{status:name,message:'provider message should not be leaked'}
      })};
    }});
    await assert.rejects(call(host),e=>e.code==='PROVIDER_HTTP_ERROR'&&
      e.status===status&&e.providerStatus===name&&
      !String(e.message).includes('provider message'));
    assert.equal(requests,1);
  }
});
test('Gemini invalid JSON receives one user-side correction without forged model history',async()=>{
  let requests=0;
  const host=createConfiguredLocalPointerHost({env:base,fetchImpl:async(url,init)=>{
    assert.match(url,/googleapis\.com/);
    requests++;
    const body=JSON.parse(init.body);
    assert.equal(body.contents.some(x=>x.role==='model'),false);
    if(requests===2){
      assert.match(body.contents.at(-1).parts[0].text,/Previous output/);
      assert.match(body.contents.at(-1).parts[0].text,/Schema issues/);
    }
    return geminiOK(requests===1?'not JSON':'{"message":"corrected"}');
  }});
  assert.equal((await call(host)).message,'corrected');
  assert.equal(requests,2);
});
test('Groq remains available by explicit selection and for older Groq-only installations',async()=>{
  for(const env of [
    {GROQ_API_KEY:'groq-test'},
    {...base,OVLL_POINTER_PROVIDER_ID:'groq',GROQ_MODEL:'custom-groq'}
  ]){
    let target,body;
    const host=createConfiguredLocalPointerHost({env,fetchImpl:async(url,init)=>{
      target=url;body=JSON.parse(init.body);return groqOK();
    }});
    assert.equal((await call(host)).message,'Groq standby result');
    assert.match(target,/api\.groq\.com/);
    if(env.GROQ_MODEL)assert.equal(body.model,'custom-groq');
  }
  assert.equal(localModelReady({OVLL_POINTER_PROVIDER_ID:'gemini',GROQ_API_KEY:'groq-test'}),false);
});
