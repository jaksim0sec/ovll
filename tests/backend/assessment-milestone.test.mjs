import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createRequestEngine} from '../../back/js/engine/engine.js';

const emptyContext=()=>({overallFlow:'',currentTopic:'',details:''});
const input=(roomId,text,resources=[])=>({roomId,request:{parts:[{type:'text',text}],attachments:[]},contextData:emptyContext(),initialResources:resources});
const result=(answer,flow)=>({languageBlock:answer,contextBlock:{intent:answer,progress:'completed'},contextData:{overallFlow:flow,currentTopic:'topic',details:'important'}});
const composer={compose:async layer=>layer};
test('completed room context flows to the next queued Gate; other rooms stay isolated',async()=>{
 let counter=0,firstResolve;const observations=[];
 const caller={generate:async ({layer,context})=>{
  observations.push({layer,context:structuredClone(context)});
  if(layer==='gate'){
   if(context.userRequest.parts[0].text==='followup')return {jsonText:JSON.stringify({need:[['chatContext',1],['originalReq',1]]})};
   return {jsonText:JSON.stringify({need:[]})};
  }
  const text=context.userRequest.parts[0].text;
  if(text==='first')await new Promise(resolve=>firstResolve=resolve);
  return {jsonText:JSON.stringify(result(text,text==='first'?'remember me':'other'))};
 }};
 const engine=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider()});
 const scheduler=createRequestScheduler({registry:createRequestRegistry({createId:()=>String(++counter)}),execute:(record,opts)=>engine.run(record,opts)});
 const first=scheduler.enqueue(input('A','first'));
 const followup=scheduler.enqueue(input('A','followup'));
 const other=scheduler.enqueue(input('B','other room'));
 for(let n=0;n<30&&!firstResolve;n++)await new Promise(r=>setTimeout(r,2));
 assert.equal(scheduler.get('A',followup.requestId).status,'queued');
 firstResolve();
 const done=await Promise.all([first.completion,followup.completion,other.completion]);
 assert.deepEqual(done.map(x=>x.status),['completed','completed','completed']);
 const followGate=observations.find(x=>x.layer==='gate'&&x.context.userRequest.parts[0].text==='followup');
 assert.equal(followGate.context.contextData.overallFlow,'remember me');
 assert.equal(followGate.context.availableHistory.completedRequests,1);
 const followHall=observations.find(x=>x.layer==='hallwayInitial'&&x.context.userRequest.parts[0].text==='followup');
 assert.equal(followHall.context.resources.find(x=>x.dataset==='chatContext').value[0].contextData.overallFlow,'remember me');
 assert.equal(followHall.context.resources.find(x=>x.dataset==='originalReq').value.parts[0].text,'first');
 const otherGate=observations.find(x=>x.layer==='gate'&&x.context.userRequest.parts[0].text==='other room');
 assert.equal(otherGate.context.contextData.overallFlow,'');
 assert.equal(otherGate.context.availableHistory.completedRequests,0);
});
test('metadata-only Skill references are available to explanatory Hallway without pretending to be executable',async()=>{
 const skill={dataset:'skillDef',key:'조사하기',source:'local-presentation-catalog',completeness:'metadata',value:{name:'조사하기',description:'자료를 조사함'}};
 const seen=[];
 const e=createRequestEngine({composer,modelCaller:{generate:async args=>{
  seen.push(args);
  return {jsonText:JSON.stringify(args.layer==='gate'?{need:[]}:result('설명만 할 수 있어요','explained'))};
 }},dataProvider:createMemoryDataProvider()});
 const got=await e.run({...input('A','첨부한 스킬의 역할을 설명해 줘',[skill]),requestId:'x'});
 assert.equal(got.status,'completed');
 assert.equal(seen[1].context.resources[0].completeness,'metadata');
});
test('missing data remains an explicit diagnostic, not a fabricated successful answer',async()=>{
 const e=createRequestEngine({composer,modelCaller:{generate:async()=>({jsonText:JSON.stringify({need:[['skillDef',['unknown-skill']]]})})},dataProvider:createMemoryDataProvider()});
 let error;
 try{await e.run({...input('A','run unknown skill'),requestId:'x'});}catch(caught){error=caught;}
 assert.equal(error?.code,'DATA_UNAVAILABLE');
 assert.deepEqual(error?.missing,[['skillDef','unknown-skill']]);
});
test('failed requests do not replace the prior confirmed room context',async()=>{
 let n=0;const gates=[];const caller={generate:async ({layer,context})=>{
 if(layer==='gate'){gates.push(context.contextData.overallFlow);return {jsonText:JSON.stringify({need:context.userRequest.parts[0].text==='fail'?[['skillDef',['absent']]]:[]})};}
 return {jsonText:JSON.stringify(result('ok',context.userRequest.parts[0].text))};
 }};
 const engine=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider()});
 const scheduler=createRequestScheduler({registry:createRequestRegistry({createId:()=>String(++n)}),execute:(snapshot,opts)=>engine.run(snapshot,opts)});
 const a=scheduler.enqueue(input('A','remember'));await a.completion;
 const b=scheduler.enqueue(input('A','fail'));const failure=await b.completion;
 assert.equal(failure.status,'failed');
 assert.deepEqual(failure.error.missing,[['skillDef','absent']]);
 const c=scheduler.enqueue(input('A','after failure'));await c.completion;
 assert.deepEqual(gates,['','remember','remember']);
});
