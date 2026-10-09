import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
const repo=new MemoryGraphRepository();
repo.create('local','g_language');
const snapshot=repo.get('local','g_language');
test('language layer is a scoped optional model call based on verified action facts',async()=>{
  const calls=[];
  const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'fixture'}),
    gateway:{complete:async request=>{
      calls.push(request);
      return {text:JSON.stringify({message:'파일에 필요한 입력이 없어 멈췄어. 자료를 추가해줘.'})};
    }}});
  const result=await host.response({snapshot,requestRef:'response_1',requestText:'문서 생성해',
    actionResults:[{kind:'run.start',status:'waiting',run:{status:'waiting',
      nodes:[{nodeId:'n',status:'blocked',error:'REQUIRED_INPUT_MISSING'}]}}]});
  assert.match(result.message,/자료를 추가/);
  assert.equal(calls.length,1);
  assert.ok(calls[0].messages.some(m=>m.role==='developer'&&m.content.includes('RESPONSE')));
  const context=JSON.parse(calls[0].messages.at(-1).content);
  assert.equal(context.extraContext.actionResults[0].run.status,'waiting');
});
test('language layer rejects new actions masquerading as a presentation',async()=>{
  const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'fixture'}),
    gateway:{complete:async()=>({text:JSON.stringify({message:'완료',actions:[{
      kind:'run.start',localKey:'retry',args:{targets:[{nodeId:'n'}]}
    }]})})}});
  await assert.rejects(host.response({snapshot,requestRef:'response_2',
    requestText:'진행 상황',actionResults:[]}),/INVALID_LOCAL_RESPONSE/);
});
test('completed deliverables and direct model replies bypass a redundant language call',()=>{
  const window={};
  vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),
    {window,console});
  const a=window.OvllPointerLocalActions;
  const run={status:'completed',targets:['n'],nodes:[{nodeId:'n',status:'success',
    outputs:{values:{result:{inline:'User-ready complete answer'}}}}]};
  assert.equal(a.needsLanguage({runs:[run],facts:[{status:'completed'}]}),false);
  assert.equal(a.needsLanguage({runs:[{...run,status:'failed'}],facts:[{status:'failed'}]}),false,
    'a verified partial deliverable must never disappear behind a status-only model rewrite');
  assert.equal(a.needsLanguage({messages:['Direct answer'],facts:[]}),false);
  assert.equal(a.needsLanguage({facts:[{status:'failed',error:'MISSING_INPUT'}]}),true);
  assert.equal(a.needsLanguage({facts:[{status:'applied'}]}),false);
});
