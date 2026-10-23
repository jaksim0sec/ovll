import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConfirmedChatRecords} from '../../front/js/workspace/chat.js';
import {createRequestBridge} from '../../front/js/workspace/requestBridge.js';

const assets={revision:1,skills:[{id:'skill-one',revision:1,name:'문장 정리기',description:'줄바꿈 제거',fields:[],inputs:[],outputs:[],color:'#abcdff',icon:'text'}],blocks:[],links:[]};

test('confirmed assistant records keep a structured verified action separate from prose',()=>{
 const records=normalizeConfirmedChatRecords([{id:'reply',role:'assistant',text:'저장했어.',confirmed:[{action:'defineDirect',id:'skill-one',name:'문장 정리기',revision:1}]}]);
 assert.deepEqual(records[0].confirmed,[{action:'defineDirect',id:'skill-one',name:'문장 정리기',revision:1}]);
 assert.throws(()=>normalizeConfirmedChatRecords([{id:'reply',role:'assistant',text:'fake',confirmed:[{action:'defineDirect'}]}]),TypeError);
});

test('completed Workshop delivers verified Skill to both chat record and live asset reader',async()=>{
 let onAssets=[],onRecords=[],onActivities=[];
 const server={
  '/api/requests':{roomId:'r',requestId:'req',status:'queued'},
  '/api/requests/req?roomId=r':{roomId:'r',requestId:'req',status:'completed',currentLayer:'output',result:{languageBlock:'완료했어.',verifiedResults:[{action:'defineDirect',outcome:{status:'applied',artifacts:[{id:'skill-one',name:'문장 정리기',revision:1}]}}]}},
  '/api/rooms/r/assets':assets
 };
 const fetchImpl=async(path,options={})=>({ok:true,status:path==='/api/requests'?202:200,json:async()=>server[path]});
 const bridge=createRequestBridge({fetchImpl,pollDelay:2,onRecords:r=>onRecords=r,onActivities:a=>onActivities=a,onAssets:x=>onAssets.push(x)});
 const dataAccess={readCanvasSnapshot:()=>({snapshot:{blocks:[]}}),readSkillCatalog:()=>({definitions:[]})};
 try{
  const result=await bridge.submit({roomId:'r',draft:{parts:[{type:'text',text:'스킬 생성'}],attachments:[]},dataAccess});
  assert.equal(result.accepted,true);
  for(let i=0;i<50&&!onRecords.some(x=>x.role==='assistant');i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(onRecords.find(x=>x.role==='assistant').confirmed[0].name,'문장 정리기');
  for(let i=0;i<50&&!onAssets.length;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(onAssets[0].skills[0].name,'문장 정리기');
  assert.equal(onActivities.length,0);
 }finally{bridge.destroy();}
});
