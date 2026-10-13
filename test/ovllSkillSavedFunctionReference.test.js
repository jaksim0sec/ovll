import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';

const repository=new MemoryGraphRepository();
repository.create('local','g');
const snapshot=repository.get('local','g');
const token='⟦ovll:ref:v1:function:saved-review:1⟧';

test('saved function references use verified server-side function context',async()=>{
  let calls=0,requests=[];
  const host=createLocalPointerHost({
    gateway:{complete:async request=>{
      calls++;
      requests.push(JSON.stringify(request.messages));
      return {text:JSON.stringify({message:'확인'})};
    }},
    resolveModel:async()=>({providerId:'test',model:'test',maxOutputTokens:300})
  });
  const options={snapshot,requestRef:'r',requestText:'이 함수 검토: '+token};
  await host.turn({...options,extraContext:{
    savedFunctions:[{id:'saved-review',version:1,purpose:'Review source'}]
  }});
  assert.equal(calls,1);
  assert.match(requests[0],/saved-review/);
  assert.match(requests[0],/저장 함수/);
  await assert.rejects(host.turn({...options,requestRef:'r2',
    extraContext:{savedFunctions:[]}}),error=>error.code==='INVALID_SKILL_REFERENCE');
  assert.equal(calls,1);
});
