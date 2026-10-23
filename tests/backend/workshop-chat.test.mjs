import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestBridge} from '../../front/js/workspace/requestBridge.js';
test('waiting request can be answered and server assets projected without generating a fresh request',async()=>{
 const seen=[],activities=[],assets=[];
 const fake=async(url,opts={})=>{
  seen.push({url,method:opts.method||'GET'});
  if(url==='/api/requests')return {ok:true,json:async()=>({roomId:'r',requestId:'q1'}),status:202};
  if(url.startsWith('/api/requests/q1?'))return {ok:true,json:async()=>({roomId:'r',requestId:'q1',status:'awaiting_input',currentLayer:'workshop',waiting:{id:'w1',text:'Which subject?'}})};
  if(url==='/api/requests/q1/answer')return {ok:true,status:202,json:async()=>({roomId:'r',requestId:'q1',status:'running'})};
  if(url==='/api/rooms/r/assets')return {ok:true,status:200,json:async()=>({revision:2,skills:[],blocks:[],links:[]})};
  throw new Error('Unexpected URL '+url);
 };
 const reader={readCanvasSnapshot:()=>({snapshot:{blocks:[]}}),readSkillCatalog:()=>({definitions:[]})};
 const bridge=createRequestBridge({fetchImpl:fake,pollDelay:2,onActivities:a=>activities.splice(0,activities.length,...a),onAssets:s=>assets.push(s)});
 try{
  await bridge.submit({roomId:'r',dataAccess:reader,draft:{parts:[{type:'text',text:'ask'}],attachments:[]}});
  for(let i=0;i<20&&!activities.some(x=>x.waiting);i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(activities.find(x=>x.requestId==='q1').waiting.id,'w1');
  const answer=await bridge.answer({roomId:'r',requestId:'q1',waitingId:'w1',text:'Chemistry'});
  assert.equal(answer.accepted,true);
  assert.equal(seen.filter(x=>x.url==='/api/requests').length,1);
  assert.equal(seen.filter(x=>x.url==='/api/requests/q1/answer').length,1);
 }finally{bridge.destroy();}
});
