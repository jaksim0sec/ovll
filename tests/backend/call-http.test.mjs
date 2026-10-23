import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../../back/js/engine/engine.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createRequestHttpServer} from '../../back/js/httpServer.js';

test('request-scoped calls endpoint omits provider internals',async()=>{
 const plan={plan:[{'skillDefine.defineDirect':{objective:'식물 조사 스킬 정의',need:[]}}],contextBlock:{intent:'생성',progress:'계획'}};
 const engine=createEngine({composer:{compose:async()=>''},dataProvider:createMemoryDataProvider(),modelCaller:{generate:async ({layer})=>({jsonText:JSON.stringify(layer==='gate'?{need:[]}:plan)})}});
 const server=createRequestHttpServer({scheduler:engine,testToken:'test'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 const headers={authorization:'Bearer test','content-type':'application/json'};
 try{
  const posted=await fetch(url+'/api/requests',{method:'POST',headers,body:JSON.stringify({roomId:'r',request:{parts:[{type:'text',text:'스킬블럭 만들어줘'}],attachments:[]},initialResources:[]})});
  assert.equal(posted.status,202);
  const {requestId}=await posted.json();
  await engine.whenIdle();
  const data=await fetch(url+'/api/requests/'+requestId+'/calls?roomId=r',{headers}).then(r=>r.json());
  assert.equal(data.calls.length,3);
  assert.equal(data.calls[2].path,data.calls[2].callId+'.workshop.skillDefine.defineDirect');
  assert.equal(data.calls[2].status,'unsupported');
  assert.equal('prompt' in data.calls[0],false);
  assert.equal((await fetch(url+'/api/requests/'+requestId+'/calls?roomId=other',{headers})).status,404);
  assert.equal((await fetch(url+'/api/requests/'+requestId+'/calls?roomId=r')).status,401);
  const status=await fetch(url+'/api/requests/'+requestId+'?roomId=r',{headers}).then(r=>r.json());
  assert.equal(status.planCursor,0);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
