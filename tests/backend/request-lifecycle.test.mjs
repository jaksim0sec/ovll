import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
const sample=(roomId='room-1')=>({roomId,request:{parts:[{type:'text',text:'hello'}],attachments:[]},contextData:{overallFlow:'',currentTopic:'',details:''},initialResources:[]});
test('registration protects room-scoped snapshots and transitions',()=>{
  let n=0;const r=createRequestRegistry({createId:()=>`id-${++n}`});
  const input=sample(),created=r.register(input);
  assert.equal(created.requestId,'id-1');assert.equal(created.status,'queued');assert.equal(created.currentLayer,'gate');
  input.request.parts[0].text='changed';created.request.parts[0].text='changed';
  assert.equal(r.get('room-1','id-1').request.parts[0].text,'hello');
  assert.equal(r.get('other-room','id-1'),null);
  assert.throws(()=>r.transition('room-1','id-1',{status:'completed'}),/transition|전이/i);
  const duplicates=createRequestRegistry({createId:()=> 'same'});duplicates.register(sample());
  assert.throws(()=>duplicates.register(sample()),/duplicate|중복/i);
});
test('scheduler serializes, fails safely and continues other requests',async()=>{
  let n=0,releaseFirst;const started=[];
  const r=createRequestRegistry({createId:()=>`id-${++n}`});
  const s=createRequestScheduler({registry:r,execute:async(snapshot,{onStage})=>{
    started.push(snapshot.requestId);onStage('hallwayInitial');
    if(snapshot.requestId==='id-1')await new Promise(resolve=>releaseFirst=resolve);
    if(snapshot.requestId==='id-1')throw Object.assign(new Error('secret token'),{code:'MODEL_ERROR'});
    return {status:'completed',currentLayer:'hallwayInitial',contextBlock:{intent:'answer',progress:'done'},result:{languageBlock:'ok'}};
  }});
  const a=s.enqueue(sample('room-a')),b=s.enqueue(sample('room-b'));
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(started,['id-1']);assert.equal(s.get('room-b','id-2').status,'queued');
  releaseFirst();const [first,second]=await Promise.all([a.completion,b.completion]);
  assert.equal(first.status,'failed');assert.equal(first.error.code,'MODEL_ERROR');assert.ok(!JSON.stringify(first).includes('secret token'));
  assert.equal(second.status,'completed');assert.equal(second.result.languageBlock,'ok');
  assert.deepEqual(started,['id-1','id-2']);await s.whenIdle();
  assert.equal(s.get('room-a','id-1').currentLayer,'hallwayInitial');
  assert.equal(s.get('room-b','id-2').currentLayer,'hallwayInitial');
});
