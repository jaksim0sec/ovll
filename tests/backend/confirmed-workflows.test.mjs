import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestEngine} from '../../back/js/engine/engine.js';
import {createWorkshopExecutor} from '../../back/js/engine/workshop.js';
import {createMemoryAssets} from '../../back/js/engine/memoryAssets.js';
import {createMemoryCheckpoints} from '../../back/js/engine/checkpoints.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
import {createRequestRegistry} from '../../back/js/request/registry.js';

const toText=value=>({jsonText:JSON.stringify(value)});
const contextData={overallFlow:'',currentTopic:'',details:''};
const block={intent:'create document-cleanup Skill',progress:'pending'};
const definition={name:'문장 정리기',description:'줄바꿈 정리',instruction:'불필요한 줄바꿈을 없애되 문단 구분은 유지한다.',inputs:[{id:'raw',type:'text',multiple:false}],outputs:[{id:'cleaned',type:'text',multiple:true}],fields:[],icon:'text',color:'#456789'};
const request=text=>({roomId:'r',requestId:'req-1',request:{parts:[{type:'text',text}],attachments:[]},contextData,initialResources:[],chatHistory:[]});

test('an explicit Skill creation request cannot complete as a mere promise; rerouted to verified Workshop',async()=>{
 const assets=createMemoryAssets(),cp=createMemoryCheckpoints(),seen=[];
 let hallwayCalls=0;
 const modelCaller={generate:async ({layer,context})=>{
  seen.push({layer,context});
  if(layer==='gate')return toText({need:[]});
  if(layer==='hallwayInitial'){
   hallwayCalls++;
   if(hallwayCalls===1)return toText({languageBlock:'만들어 줄게.',contextBlock:block,contextData});
   return toText({plan:[{skillDefine:{objective:'문장 정리기 스킬 정의 생성',need:[]}},{terminate:{objective:'완료',need:[]}}],contextBlock:block});
  }
  if(layer==='workshop')return toText(context.verifiedResults.length?{done:true}:{action:'defineDirect',args:{definition}});
  if(layer==='output')return toText({languageBlock:'문장 정리기 스킬을 저장했어.',contextBlock:{...block,progress:'completed'},contextData:{overallFlow:'created',currentTopic:'skill',details:''}});
 }};
 const composer={compose:async layer=>layer};
 const engine=createRequestEngine({composer,modelCaller,dataProvider:createMemoryDataProvider({assets}),workshopExecutor:createWorkshopExecutor({composer,modelCaller,assets}),checkpoints:cp});
 const result=await engine.run(request("'문장 정리기'라는 스킬을 만들어줘."));
 assert.equal(result.status,'completed');
 assert.equal(hallwayCalls,2);assert.equal(result.currentLayer,'output');
 assert.equal(assets.read({scope:'r'}).skills[0].name,'문장 정리기');
});

test('two direct promises for a write request do not silently complete without an action',async()=>{
 const modelCaller={generate:async ({layer})=>toText(layer==='gate'?{need:[]}:{languageBlock:'만들어 볼게.',contextBlock:block,contextData})};
 const engine=createRequestEngine({composer:{compose:async layer=>layer},modelCaller,dataProvider:createMemoryDataProvider()});
 await assert.rejects(engine.run(request('줄바꿈 스킬을 만들어줘')),err=>err.code==='WORK_REQUIRED');
});

test('follow-up acknowledgements receive recent exact assistant reply and user request',async()=>{
 let n=0;const seen=[];
 const modelCaller={generate:async ({layer,context})=>{
  if(layer==='gate')return toText({need:[]});
  seen.push(context);
  if(n++===0)return toText({languageBlock:'스킬을 만들어 줄게.',contextBlock:{intent:'create 문장 정리기',progress:'not performed'},contextData:{overallFlow:'Skill request',currentTopic:'문장 정리기',details:'pending creation'}});
  return toText({languageBlock:'알겠어.',contextBlock:{intent:'follow-up',progress:'done'},contextData});
 }};
 const engine=createRequestEngine({composer:{compose:async layer=>layer},modelCaller,dataProvider:createMemoryDataProvider()});
 const registry=createRequestRegistry({createId:()=>String(n+1)});
 const scheduler=createRequestScheduler({registry,execute:(record,opts)=>engine.run(record,opts)});
 const one=await scheduler.enqueue({roomId:'r',request:{parts:[{type:'text',text:'스킬 정의를 검토해줘'}],attachments:[]},contextData,initialResources:[]}).completion;
 const two=await scheduler.enqueue({roomId:'r',request:{parts:[{type:'text',text:'ㅇㅇ'}],attachments:[]},contextData,initialResources:[]}).completion;
 assert.equal(one.status,'completed');assert.equal(two.status,'completed');
 assert.equal(seen[1].recentConversation[0].assistantResponse,'스킬을 만들어 줄게.');
 assert.equal(seen[1].recentConversation[0].request.parts[0].text,'스킬 정의를 검토해줘');
});

test('confirmed Skill creation result retains attributable applied artifact in user-facing result',async()=>{
 const assets=createMemoryAssets();const cp=createMemoryCheckpoints();
 const modelCaller={generate:async ({layer,context})=>toText(
  layer==='gate'?{need:[]}:layer==='hallwayInitial'?{plan:[{skillDefine:{objective:'Create text Skill',need:[]}},{terminate:{objective:'Finish',need:[]}}],contextBlock:block}:
  layer==='workshop'?(context.verifiedResults.length?{done:true}:{action:'defineDirect',args:{definition}}):
  {languageBlock:'완료.',contextBlock:{intent:block.intent,progress:'done'},contextData}
 )};
 const composer={compose:async x=>x};
 const engine=createRequestEngine({composer,modelCaller,dataProvider:createMemoryDataProvider({assets}),workshopExecutor:createWorkshopExecutor({composer,modelCaller,assets}),checkpoints:cp});
 const result=await engine.run(request('스킬을 만들어줘'));
 assert.equal(result.status,'completed');
 assert.equal(result.result.verifiedResults[0].outcome.status,'applied');
 assert.equal(result.result.verifiedResults[0].outcome.artifacts[0].name,'문장 정리기');
});
