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

test('partially applied Workshop refreshes actual assets and clearly identifies the unsupported next action',async()=>{
 let updatedAssets=[],activity=[],records=[];
 const payload={
  roomId:'r',requestId:'partial',status:'unsupported_workshop',currentLayer:'actionShell',
  handoff:{action:'skillEdit.delete',status:'not_implemented'},
  verifiedResults:[{action:'defineDirect',outcome:{status:'applied',artifacts:[{id:'skill-one',name:'문장 정리기',revision:1}]}}]
 };
 const read=async path=>{
  const value={
   '/api/requests':{roomId:'r',requestId:'partial',status:'queued'},
   '/api/requests/partial?roomId=r':payload,
   '/api/rooms/r/assets':assets
  }[path];
  assert.ok(value,'Unexpected API endpoint: '+path);
  return {ok:true,status:path==='/api/requests'?202:200,json:async()=>value};
 };
 const bridge=createRequestBridge({fetchImpl:read,pollDelay:2,
  onRecords:value=>records=value,
  onActivities:value=>activity=value,
  onAssets:value=>updatedAssets.push(value)});
 const dataAccess={readCanvasSnapshot:()=>({snapshot:{blocks:[]}}),readSkillCatalog:()=>({definitions:[]})};
 try{
  assert.equal((await bridge.submit({roomId:'r',draft:{parts:[{type:'text',text:'스킬 정의 후 편집'}],attachments:[]},dataAccess})).accepted,true);
  for(let n=0;n<70&&(!updatedAssets.length||!activity.some(a=>a.detail.includes('skillEdit.delete')));n++)
   await new Promise(resolve=>setTimeout(resolve,4));
  assert.equal(updatedAssets.length,1,'Real partial outcome must refresh server assets');
  assert.equal(updatedAssets[0].skills[0].id,'skill-one');
  assert.match(activity[0].detail,/일부.*적용|이전.*적용/);
  assert.match(activity[0].detail,/미지원|미구현/);
  assert.doesNotMatch(activity[0].detail,/실행·저장은 미구현/);
  assert.equal(records.some(x=>x.role==='assistant'),false,'Incomplete plan is not a completed assistant reply');
 }finally{bridge.destroy();}
});
