import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestEngine} from '../../back/js/engine/engine.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
const snapshot={roomId:'r',requestId:'req',request:{parts:[{type:'text',text:'안녕'}],attachments:[]},contextData:{overallFlow:'',currentTopic:'',details:''},initialResources:[{dataset:'canvasSkill',key:'b1',source:'local-view',completeness:'complete',value:{id:'b1',skillId:'research'}}],status:'running',currentLayer:'gate',contextBlock:{intent:'',progress:''}};
const direct={languageBlock:'안녕하세요',contextBlock:{intent:'greet',progress:'complete'},contextData:{overallFlow:'greeted',currentTopic:'hello',details:''}};
const compose={compose:async layer=>`prompt:${layer}`},asText=x=>({jsonText:JSON.stringify(x)});
test('Gate sees initial resources, deduplicates need, Hallway directly completes without Output',async()=>{
 const calls=[],stages=[],caller={generate:async args=>{calls.push(args);return asText(args.layer==='gate'?{need:[['canvasSkill',['b1']]]}:direct)}};
 const e=createRequestEngine({composer:compose,modelCaller:caller,dataProvider:createMemoryDataProvider()});
 const got=await e.run(structuredClone(snapshot),{onStage:s=>stages.push(s)});
 assert.deepEqual(calls.map(x=>x.layer),['gate','hallwayInitial']);assert.deepEqual(stages,['hallwayInitial']);
 assert.equal(calls[0].context.initialResources[0].value.id,'b1');
 assert.equal(calls[1].context.resources.filter(x=>x.dataset==='canvasSkill').length,1);
 assert.equal(got.status,'completed');assert.equal(got.result.languageBlock,'안녕하세요');
 assert.deepEqual(snapshot.contextData,{overallFlow:'',currentTopic:'',details:''});
});
test('unimplemented Workshop remains unsupported',async()=>{
 const e=createRequestEngine({composer:compose,modelCaller:{generate:async ({layer})=>asText(layer==='gate'?{need:[]}:{plan:[{textGenerate:{objective:'write',need:[]}}],contextBlock:{intent:'write',progress:'pending'}})},dataProvider:createMemoryDataProvider()});
 const result=await e.run(snapshot);
 assert.equal(result.status,'unsupported_workshop');assert.equal(result.plan[0].textGenerate.objective,'write');assert.ok(!result.result);
});
test('invalid conditional output and unresolved data fail explicitly',async()=>{
 const bad=createRequestEngine({composer:compose,modelCaller:{generate:async ({layer})=>asText(layer==='gate'?{need:[]}:{...direct,plan:[]})},dataProvider:createMemoryDataProvider()});
 await assert.rejects(bad.run(snapshot),e=>e.code==='ENGINE_OUTPUT_INVALID');
 const missing=createRequestEngine({composer:compose,modelCaller:{generate:async ()=>asText({need:[['skillDef',['missing']]]})},dataProvider:createMemoryDataProvider()});
 await assert.rejects(missing.run(snapshot),e=>e.code==='DATA_UNAVAILABLE');
 const badGate=createRequestEngine({composer:compose,modelCaller:{generate:async ()=>asText({need:[],plan:[]})},dataProvider:createMemoryDataProvider()});
 await assert.rejects(badGate.run(snapshot),e=>e.code==='ENGINE_OUTPUT_INVALID');
});
test('registry scheduler and engine isolate terminal results',async()=>{
 let count=0,n=0;const engine=createRequestEngine({composer:compose,modelCaller:{generate:async ({layer})=>{
  if(layer==='gate')return asText({need:[]});
  count++;return asText(count===1?direct:{...direct,unexpected:'x'});
 }},dataProvider:createMemoryDataProvider()});
 const registry=createRequestRegistry({createId:()=>`req-${++n}`});
 const scheduler=createRequestScheduler({registry,execute:(record,options)=>engine.run(record,options)});
 const args=()=>({roomId:'r',request:snapshot.request,contextData:snapshot.contextData,initialResources:[]});
 const first=scheduler.enqueue(args()),second=scheduler.enqueue(args());
 const [a,b]=await Promise.all([first.completion,second.completion]);
 assert.equal(a.status,'completed');assert.equal(b.status,'failed');assert.equal(b.error.code,'ENGINE_OUTPUT_INVALID');
 await scheduler.whenIdle();
});

test('terminate cannot precede later Workshop steps',async()=>{
 const invalidPlan={plan:[{terminate:{objective:'complete',need:[]}},{textGenerate:{objective:'later action',need:[]}}],contextBlock:{intent:'test',progress:'pending'}};
 const engine=createRequestEngine({composer:compose,modelCaller:{generate:async ({layer})=>asText(layer==='gate'?{need:[]}:invalidPlan)},dataProvider:createMemoryDataProvider()});
 await assert.rejects(engine.run(snapshot),e=>e.code==='ENGINE_OUTPUT_INVALID');
});
