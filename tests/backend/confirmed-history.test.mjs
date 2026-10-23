import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemorySessions} from '../../back/js/request/memorySessions.js';
import {createRequestHttpServer} from '../../back/js/httpServer.js';
import {createRequestBridge} from '../../front/js/workspace/requestBridge.js';

const contextData={overallFlow:'skill work',currentTopic:'Skill',details:''};
const entry={requestId:'r1',request:{parts:[{type:'text',text:'스킬을 만들어줘'}],attachments:[]},contextBlock:{intent:'create',progress:'completed'},contextData,assistantResponse:'문장 정리기 스킬이 저장됐어.',verifiedResults:[{action:'defineDirect',outcome:{status:'applied',artifacts:[{id:'skill1',name:'문장 정리기',revision:1}]}}]};
test('HTTP returns same-room confirmed conversation, excluding other-room history',async()=>{
 const sessions=createMemorySessions();sessions.load({scope:'r'});sessions.commit({scope:'r',expectedRevision:0,...entry});
 const server=createRequestHttpServer({scheduler:{enqueue(){},get(){}},sessions,testToken:'test'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const r=await fetch(base+'/api/rooms/r/history',{headers:{authorization:'Bearer test'}});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.equal(body.entries[0].assistantResponse,entry.assistantResponse);
  const other=await fetch(base+'/api/rooms/other/history',{headers:{authorization:'Bearer test'}}).then(r=>r.json());
  assert.equal(other.entries.length,0);
  const unauthorized=await fetch(base+'/api/rooms/r/history');
  assert.equal(unauthorized.status,401);
 }finally{await new Promise(r=>server.close(r));}
});
test('browser reload rehydrates exactly one copy of each confirmed user and assistant turn',async()=>{
 const messages=[],fetchImpl=async url=>({ok:true,status:200,json:async()=>({roomId:'r',entries:[entry]})});
 const bridge=createRequestBridge({fetchImpl,onRecords:r=>messages.splice(0,messages.length,...r)});
 try{
  assert.equal(await bridge.loadHistory('r'),true);
  assert.equal(await bridge.loadHistory('r'),true);
  assert.equal(messages.length,2);
  assert.equal(messages[0].text,'스킬을 만들어줘');
  assert.equal(messages[1].text,entry.assistantResponse);
  assert.equal(messages[1].confirmed[0].name,'문장 정리기');
 }finally{bridge.destroy();}
});
