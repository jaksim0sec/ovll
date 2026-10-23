import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestEngine} from '../../back/js/engine/engine.js';
import {createMemoryAssets} from '../../back/js/engine/memoryAssets.js';
import {createMemoryCheckpoints} from '../../back/js/engine/checkpoints.js';
import {createMemorySessions} from '../../back/js/request/memorySessions.js';
import {createWorkshopExecutor} from '../../back/js/engine/workshop.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createRequestHttpServer} from '../../back/js/httpServer.js';
import {createRequestBridge} from '../../front/js/workspace/requestBridge.js';

const definition={name:'문장 정리기',description:'텍스트의 불필요한 줄바꿈 제거',instruction:'빈 줄로 구분된 문단을 유지하며 문단 내부 불필요한 줄바꿈만 제거한다.',inputs:[{id:'input',type:'text',multiple:false}],outputs:[{id:'output',type:'text',multiple:true}],fields:[],icon:'text',color:'#456789'};
const contextData={overallFlow:'',currentTopic:'',details:''};
const block={intent:'문장 정리기 스킬 저장',progress:'생성 중'};
const json=x=>({jsonText:JSON.stringify(x)});

test('HTTP -> AI plan -> verified Skill -> HTTP assets/history -> frontend chat -> follow-up status works',async()=>{
 const assets=createMemoryAssets(),sessions=createMemorySessions(),checkpoints=createMemoryCheckpoints();
 const composer={compose:async layer=>'prompt:'+layer};let checkedHistory=false,hallwayAttempts=0;
 const caller={generate:async ({layer,context})=>{
   const words=context?.userRequest?.parts?.find(x=>x.type==='text')?.text??'';
   if(layer==='gate')return json({need:words.includes('만들긴')?[['skillList']]:[]});
   if(layer==='hallwayInitial'){
     if(words.includes('만들긴')){
       checkedHistory=context.recentConversation?.[0]?.verifiedResults?.[0]?.action==='defineDirect';
       return json({languageBlock:checkedHistory?'서버에 저장된 스킬을 확인했어.':'확인된 저장 이력이 없어.',contextBlock:{intent:'스킬 생성 여부 확인',progress:'확인'},contextData});
     }
     hallwayAttempts++;
     if(hallwayAttempts===1)return json({languageBlock:'만들어 줄게.',contextBlock:block,contextData});
     return json({plan:[{skillDefine:{objective:'문장 정리기 정의를 실제로 저장',need:[]}},{terminate:{objective:'결과 보고',need:[]}}],contextBlock:block});
   }
   if(layer==='workshop')return json(context.verifiedResults.length?{done:true}:{action:'defineDirect',args:{definition}});
   if(layer==='output')return json({languageBlock:'문장 정리기 스킬을 서버에 저장했어.',contextBlock:{intent:'문장 정리기 스킬 저장',progress:'완료'},contextData:{overallFlow:'스킬 생성',currentTopic:'스킬 관리',details:''}});
   throw new Error('Unexpected model layer '+layer);
 }};
 const engine=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider({assets}),workshopExecutor:createWorkshopExecutor({composer,modelCaller:caller,assets}),checkpoints});
 const scheduler=createRequestScheduler({sessions,registry:createRequestRegistry(),execute:(r,o)=>engine.run(r,o),resume:(r,a,o)=>engine.resume(r,{...a,...o}),retryOutput:(r,o)=>engine.retryOutput(r,o)});
 const server=createRequestHttpServer({scheduler,assets,sessions,testToken:'abcd'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const fetchImpl=(url,options)=>fetch(base+url,options);
 let records=[],liveAssets=null;
 const bridge=createRequestBridge({fetchImpl,pollDelay:10,onRecords:r=>records=r,onAssets:a=>{liveAssets=a;}});
 const dataAccess={readCanvasSnapshot:()=>({snapshot:{blocks:[]}}),readSkillCatalog:()=>({definitions:[]})};
 async function send(text){
  const sent=await bridge.submit({roomId:'r',draft:{parts:[{type:'text',text}],attachments:[]},dataAccess});
  assert.equal(sent.accepted,true);
  const target=records.filter(r=>r.role==='user').at(-1).requestId,until=Date.now()+4000;
  while(Date.now()<until&&!records.some(r=>r.id===target+':assistant'))await new Promise(r=>setTimeout(r,20));
  return records.find(r=>r.id===target+':assistant');
 }
 try{
  const first=await send('문장 정리기 스킬을 만들어줘');
  assert.ok(first,'expected an actual assistant completion');
  assert.equal(first.confirmed?.[0]?.name,'문장 정리기');
  assert.equal(hallwayAttempts,2);
  const endpoint=await fetchImpl('/api/rooms/r/assets',{headers:{authorization:'Bearer abcd'}}).then(r=>r.json());
  assert.equal(endpoint.skills[0].name,'문장 정리기');
  const until=Date.now()+1500;
  while(Date.now()<until&&!liveAssets)await new Promise(r=>setTimeout(r,10));
  assert.equal(liveAssets?.skills?.[0]?.name,'문장 정리기');
  const history=await fetchImpl('/api/rooms/r/history',{headers:{authorization:'Bearer abcd'}}).then(r=>r.json());
  assert.equal(history.entries.length,1);
  assert.equal(history.entries[0].assistantResponse,'문장 정리기 스킬을 서버에 저장했어.');
  const follow=await send('만들긴 한 거야?');
  assert.equal(follow.text,'서버에 저장된 스킬을 확인했어.');
  assert.equal(checkedHistory,true);
 }finally{bridge.destroy();await new Promise(resolve=>server.close(resolve));}
});
