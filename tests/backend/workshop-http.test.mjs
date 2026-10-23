import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestHttpServer} from '../../back/js/httpServer.js';
test('exposes verified assets and only resumes matching waiting request',async()=>{
 const assets={read:({scope})=>({revision:scope==='r'?2:0,skills:[],blocks:[],links:[]})};
 const scheduler={
  enqueue:()=>({roomId:'r',requestId:'id',completion:Promise.resolve()}),
  get:(room,id)=>({roomId:room,requestId:id,status:'awaiting_input',waiting:{id:'question-1',text:'Answer?'}}),
  resume:(room,id,answer)=>{assert.equal(answer.waitingId,'question-1');return {roomId:room,requestId:id,completion:Promise.resolve()};}
 };
 const server=createRequestHttpServer({scheduler,assets,testToken:'test'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  const opts={headers:{authorization:'Bearer test'}};
  const state=await fetch(url+'/api/rooms/r/assets',opts).then(r=>r.json());
  assert.equal(state.revision,2);
  const res=await fetch(url+'/api/requests/id/answer',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test'},body:JSON.stringify({roomId:'r',waitingId:'question-1',text:'chemistry'})});
  assert.equal(res.status,202);assert.equal((await res.json()).requestId,'id');
  const invalid=await fetch(url+'/api/requests/id/answer',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer test'},body:JSON.stringify({roomId:'wrong',waitingId:'wrong',text:'bad'})});
  assert.equal(invalid.status,409);
 }finally{await new Promise((r,j)=>server.close(e=>e?j(e):r()));}
});
