import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryAssets} from '../../back/js/engine/memoryAssets.js';
import {createMemoryCheckpoints} from '../../back/js/engine/checkpoints.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createWorkshopExecutor} from '../../back/js/engine/workshop.js';
import {createRequestEngine} from '../../back/js/engine/engine.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createMemorySessions} from '../../back/js/request/memorySessions.js';

const data={overallFlow:'',currentTopic:'',details:''};
const definition={name:'식물 조사',description:'식물 조사용 작업 정의',instruction:'식물 이름을 입력받아 조사 항목을 정리한다. 외부 조사 기능은 아직 실행하지 않는다.',inputs:[{id:'plant',type:'text',multiple:false}],outputs:[{id:'report',type:'text',multiple:true}],fields:[],icon:'leaf',color:'#447755'};
const reply=x=>({jsonText:JSON.stringify(x)});
const draft=(text,requestId='r1',history=[])=>({roomId:'room',requestId,request:{parts:[{type:'text',text}],attachments:[]},initialResources:[],contextData:data,chatHistory:history});
const context={intent:'식물을 조사하는 노드 생성',progress:'진행 중'};
const plan={plan:[{skillDefine:{objective:'식물 조사 Skill 생성',need:[]}},{canvasEdit:{objective:'생성된 식물 조사 Skill의 노드를 캔버스에 추가',need:[]}},{terminate:{objective:'결과 보고',need:[]}}],contextBlock:context};

test('an unsupported Workshop action is corrected with allowed actions instead of immediately failing',async()=>{
 const assets=createMemoryAssets();
 const choices=[];
 const caller={generate:async ({context})=>{
   choices.push(context);
   if(choices.length===1)return reply({action:'createSkill',args:{definition}});
   return reply({action:'defineDirect',args:{definition}});
 }};
 const workshop=createWorkshopExecutor({modelCaller:caller,composer:{compose:async()=> '# workshop'},assets});
 const action=await workshop.decide({workshop:'skillDefine',objective:'식물 조사 Skill 생성',scope:'room',request:draft('식물 조사 노드 만들어봐').request,contextBlock:context});
 assert.equal(action.action,'defineDirect');
 assert.equal(choices.length,2);
 assert.equal(choices[1].invalidAction.action,'createSkill');
 assert.deepEqual(choices[1].availableActions,['defineDirect','revise']);
});

test('invalid Workshop action is diagnosed without fabricating success after correction fails',async()=>{
 const assets=createMemoryAssets();
 const caller={generate:async()=>reply({action:'createNode',args:{}})};
 const workshop=createWorkshopExecutor({modelCaller:caller,composer:{compose:async()=> '# workshop'},assets});
 await assert.rejects(workshop.decide({workshop:'canvasEdit',objective:'노드 만들기',scope:'room',request:draft('노드 만들어봐').request}),error=>
   error.code==='UNSUPPORTED_ACTION'&&error.detail.includes('createNode'));
 assert.equal(assets.read({scope:'room'}).revision,0);
});

test('failed request is retained for context without committing its contextData',async()=>{
 const sessions=createMemorySessions(),registry=createRequestRegistry(),scheduler=createRequestScheduler({registry,sessions,execute:async()=>{const e=new Error('unsupported');e.code='UNSUPPORTED_ACTION';throw e;}});
 const r=scheduler.enqueue({roomId:'room',request:{parts:[{type:'text',text:'식물을 조사하는 노드를 만들어봐'}],attachments:[]},contextData:data,initialResources:[]});
 const failed=await r.completion;assert.equal(failed.status,'failed');
 const saved=sessions.load({scope:'room'});
 assert.equal(saved.contextData.currentTopic,'');
 assert.equal(saved.history.length,1);
 assert.equal(saved.history[0].request.parts[0].text,'식물을 조사하는 노드를 만들어봐');
 assert.equal(saved.history[0].status,'failed');
});

test('follow-up after failed node work carries the original objective into Hallway',async()=>{
 const assets=createMemoryAssets(),steps=[];
 const old={requestId:'old',request:draft('식물을 조사하는 노드를 만들어봐').request,contextBlock:{intent:'식물 조사 노드 만들기',progress:'실패'},status:'failed',assistantResponse:'',verifiedResults:[],error:{code:'UNSUPPORTED_ACTION'}};
 const caller={generate:async ({layer,context:ctx})=>{
   steps.push({layer,ctx});
   if(layer==='gate')return reply({need:[]});
   if(layer==='hallwayInitial'){
     if(!ctx.unresolvedRequest)return reply({languageBlock:'어떤 노드를 말하는 거야?',contextBlock:context,contextData:data});
     return reply(plan);
   }
   if(layer==='workshop'){
     const completed=ctx.verifiedResults.filter(r=>r.outcome?.status==='applied');
     if(ctx.workshop==='skillDefine')return reply(completed.some(r=>r.action==='defineDirect')?{done:true}:{action:'defineDirect',args:{definition}});
     if(ctx.workshop==='canvasEdit')return reply(completed.some(r=>r.action==='addBlock')?{done:true}:{action:'addBlock',args:{skillId:ctx.assets.skills[0].id,x:100,y:100}});
   }
   if(layer==='output')return reply({languageBlock:'식물 조사 노드를 배치했어. 조사 실행 기능은 별도야.',contextBlock:{intent:'식물 조사 노드 생성',progress:'완료'},contextData:data});
 }};
 const composer={compose:async x=>x},engine=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider({assets}),workshopExecutor:createWorkshopExecutor({composer,modelCaller:caller,assets}),checkpoints:createMemoryCheckpoints()});
 const result=await engine.run(draft('만들어보라니까?', 'next',[old]));
 assert.equal(result.status,'completed');
 assert.equal(result.currentLayer,'output');
 assert.equal(assets.read({scope:'room'}).skills.length,1);
 assert.equal(assets.read({scope:'room'}).blocks.length,1);
 assert.equal(steps.filter(s=>s.layer==='hallwayInitial')[0].ctx.unresolvedRequest.request.parts[0].text,'식물을 조사하는 노드를 만들어봐');
});

test('existing Skill and new Skill node placement are distinct confirmed actions',async()=>{
 const assets=createMemoryAssets();
 const caller={generate:async ({layer,context:c})=>{
  if(layer==='gate')return reply({need:[]});
  if(layer==='hallwayInitial')return reply(plan);
  if(layer==='workshop'){
    const here=c.verifiedResults.filter(r=>r.outcome?.status==='applied');
    if(c.workshop==='skillDefine')return reply(here.some(r=>r.action==='defineDirect')?{done:true}:{action:'defineDirect',args:{definition}});
    if(c.workshop==='canvasEdit')return reply(here.some(r=>r.action==='addBlock')?{done:true}:{action:'addBlock',args:{skillId:c.assets.skills[0].id,x:10,y:20}});
  }
  if(layer==='output')return reply({languageBlock:'노드 배치 완료',contextBlock:{...context,progress:'완료'},contextData:data});
 }};
 const composer={compose:async x=>x},engine=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider({assets}),workshopExecutor:createWorkshopExecutor({modelCaller:caller,composer,assets}),checkpoints:createMemoryCheckpoints()});
 const out=await engine.run(draft('식물을 조사하는 노드를 만들어봐'));
 assert.equal(out.status,'completed');
 assert.deepEqual(out.result.verifiedResults.map(x=>x.action),['defineDirect','addBlock']);
 const state=assets.read({scope:'room'});assert.equal(state.blocks[0].skillId,state.skills[0].id);
});
