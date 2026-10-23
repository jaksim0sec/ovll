import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createEngine} from '../../back/js/engine/engine.js';
import {createMemorySessions} from '../../back/js/request/memorySessions.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';

const req=()=>({parts:[{type:'text',text:'안녕'}],attachments:[]});
const context=()=>({overallFlow:'',currentTopic:'',details:''});
test('request registry rejects stale revisions',()=>{
 const r=createRequestRegistry({createId:()=> 'req'});
 const saved=r.register({roomId:'room',request:req(),contextData:context()});
 assert.equal(saved.revision,0);
 const next=r.transition('room','req',{status:'running'},{expectedRevision:0});
 assert.equal(next.revision,1);
 assert.throws(()=>r.transition('room','req',{currentLayer:'output'},{expectedRevision:0}),e=>e.code==='CHECKPOINT_CONFLICT');
 assert.equal(r.get('room','req').currentLayer,'gate');
});
test('simultaneous room completions reject a stale context commit',async()=>{
 const callbacks=[];let resolved=0;
 const gate={need:[]};
 const sessions=createMemorySessions();
 const modelCaller={generate:async ({layer})=>{
  if(layer==='gate')return {jsonText:JSON.stringify(gate)};
  const index=++resolved;
  await new Promise(resolve=>callbacks.push(resolve));
  return {jsonText:JSON.stringify({languageBlock:'응답',contextBlock:{intent:'인사',progress:'완료'},contextData:{overallFlow:'response-'+index,currentTopic:'hi',details:''}})};
 }};
 const engine=createEngine({composer:{compose:async()=>''},modelCaller,dataProvider:createMemoryDataProvider(),sessions,policy:{maxActiveRequests:2,maxModelCalls:2}});
 const a=engine.submit({roomId:'same',request:req()}),b=engine.submit({roomId:'same',request:req()});
 for(let i=0;i<200&&callbacks.length<2;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(callbacks.length,2);
 callbacks[0]();callbacks[1]();
 const outcome=await Promise.all([a.completion,b.completion]);
 assert.deepEqual(outcome.map(x=>x.status).sort(),['completed','failed']);
 assert.equal(outcome.find(x=>x.status==='failed').error.code,'SESSION_CONFLICT');
 assert.match(sessions.load({scope:'same'}).contextData.overallFlow,/response-[12]/);
});
