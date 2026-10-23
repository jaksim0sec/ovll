import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestBridge} from '../../front/js/workspace/requestBridge.js';
const dataAccess={readCanvasSnapshot:()=>({snapshot:{blocks:[]}}),readSkillCatalog:()=>({definitions:[]})};
test('request-specific failures disclose missing resource and coexist with another successful answer',async()=>{
 const responses=new Map(),ids=['r1','r2'];let latestRecords=[],latestActivities=[];
 const bridge=createRequestBridge({pollDelay:3,onRecords:r=>latestRecords=r,onActivities:a=>latestActivities=a,
  promptForToken:()=>{throw Error('no prompt expected');},
  fetchImpl:async (url)=>{
   if(url==='/api/requests'){const id=ids.shift();return {ok:true,status:202,json:async()=>({roomId:'room',requestId:id})};}
   const id=url.split('/api/requests/')[1].split('?')[0];
   const result=id==='r1'?{status:'failed',currentLayer:'gate',error:{code:'DATA_UNAVAILABLE',message:'Required data unavailable',missing:[['skillDef','실제정의']]}}:{status:'completed',currentLayer:'hallwayInitial',result:{languageBlock:'두 번째 답변'}};
   return {ok:true,status:200,json:async()=>({roomId:'room',requestId:id,...result})};
  }});
 try{
  const mk=text=>({parts:[{type:'text',text}],attachments:[]});
  assert.deepEqual(await bridge.submit({draft:mk('첫 요청 스킬 분석'),roomId:'room',dataAccess}),{accepted:true});
  assert.deepEqual(await bridge.submit({draft:mk('두 번째 안녕'),roomId:'room',dataAccess}),{accepted:true});
  for(let i=0;i<100&&!latestRecords.some(x=>x.role==='assistant');i++)await new Promise(r=>setTimeout(r,5));
  assert.ok(latestRecords.some(x=>x.role==='assistant'&&x.requestId==='r2'&&x.text==='두 번째 답변'));
  assert.equal(latestActivities.length,1);
  assert.equal(latestActivities[0].requestId,'r1');
  assert.match(latestActivities[0].detail,/첫 요청 스킬 분석/);
  assert.match(latestActivities[0].detail,/skillDef/);
  assert.match(latestActivities[0].detail,/실제정의/);
 }finally{bridge.destroy();}
});
