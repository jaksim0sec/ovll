import test from 'node:test';
import assert from 'node:assert/strict';
import {createActionShell,actionNames} from '../../back/js/engine/actionShell.js';
import {createRequestEngine} from '../../back/js/engine/engine.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
import {createRequestRegistry} from '../../back/js/request/registry.js';
import {createRequestScheduler} from '../../back/js/request/scheduler.js';
import {createRequestHttpServer} from '../../back/js/httpServer.js';
const contextData={overallFlow:'',currentTopic:'',details:''};
const block={intent:'스킬블럭 만들기',progress:'계획'};
const reply=v=>({jsonText:JSON.stringify(v)});
const request=text=>({roomId:'room',requestId:'one',request:{parts:[{type:'text',text}],attachments:[]},initialResources:[],contextData});
const plan={plan:[{'skillDefine.defineDirect':{objective:'식물 조사 스킬 정의',need:[]}},{'canvasEdit.addBlock':{objective:'식물 조사 스킬블럭 배치',need:[]}},{terminate:{objective:'종결',need:[]}}],contextBlock:block};
const composer={compose:async x=>'prompt:'+x};

test('action catalog uses qualified names and shell contains no executor',()=>{
 const shell=createActionShell();
 assert.ok(actionNames.includes('skillDefine.defineFromIR'));
 assert.equal(shell.accepts('skillDefine'),false);
 assert.equal(shell.accepts('canvasEdit.addBlock'),true);
 assert.deepEqual(shell.enter({action:'canvasEdit.addBlock',objective:'스킬블럭 배치',need:[],resources:[]}),{action:'canvasEdit.addBlock',workshop:'canvasEdit',objective:'스킬블럭 배치',need:[],status:'not_implemented'});
 assert.equal('apply' in shell,false);assert.equal('decide' in shell,false);
 assert.throws(()=>shell.enter({action:'createNode',objective:'실패',need:[],resources:[]}),e=>e.code==='ENGINE_OUTPUT_INVALID');
});
test('Hallway creates qualified action plan and stops at first shell',async()=>{
 const stages=[],calls=[];
 const engine=createRequestEngine({composer,modelCaller:{generate:async ({layer})=>{calls.push(layer);return reply(layer==='gate'?{need:[]}:plan);}},dataProvider:createMemoryDataProvider()});
 const got=await engine.run(request('식물 조사 스킬블럭 만들어줘'),{onStage:x=>stages.push(x)});
 assert.equal(got.status,'unsupported_workshop');
 assert.equal(got.currentLayer,'actionShell');
 assert.deepEqual(calls,['gate','hallwayInitial']);
 assert.deepEqual(stages,['hallwayInitial','actionShell']);
 assert.equal(got.handoff.action,'skillDefine.defineDirect');
 assert.equal(got.plan[1]['canvasEdit.addBlock'].objective,'식물 조사 스킬블럭 배치');
 assert.equal(got.result,undefined);
});
test('explicit mutation cannot finish through a promise',async()=>{
 let n=0;
 const engine=createRequestEngine({composer,modelCaller:{generate:async ({layer})=>{if(layer==='gate')return reply({need:[]});n++;return reply({languageBlock:'바꿨어!',contextBlock:block,contextData});}},dataProvider:createMemoryDataProvider()});
 await assert.rejects(engine.run(request('스킬블럭 만들어줘')),e=>e.code==='WORK_REQUIRED');
 assert.equal(n,2);
});
test('generic workshop categories and invented names cannot enter a shell',async()=>{
 for(const name of ['skillDefine','createSkill']){
  const engine=createRequestEngine({composer,modelCaller:{generate:async ({layer})=>reply(layer==='gate'?{need:[]}:{plan:[{[name]:{objective:'목표',need:[]}}],contextBlock:block})},dataProvider:createMemoryDataProvider()});
  await assert.rejects(engine.run(request('계획을 세워봐')),e=>e.code==='ENGINE_OUTPUT_INVALID');
 }
});
test('HTTP surfaces selected action but no completion, applied result or assets',async()=>{
 const engine=createRequestEngine({composer,modelCaller:{generate:async ({layer})=>reply(layer==='gate'?{need:[]}:plan)},dataProvider:createMemoryDataProvider()});
 const scheduler=createRequestScheduler({registry:createRequestRegistry(),execute:(snap,opts)=>engine.run(snap,opts)});
 const server=createRequestHttpServer({scheduler,testToken:'test'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port,headers={authorization:'Bearer test','content-type':'application/json'};
 try{
  const posted=await fetch(base+'/api/requests',{method:'POST',headers,body:JSON.stringify({roomId:'room',request:request('식물 조사 스킬블럭 만들어줘').request,initialResources:[]})});
  assert.equal(posted.status,202);
  const id=(await posted.json()).requestId;let record;
  for(let i=0;i<60;i++){
   record=await fetch(base+'/api/requests/'+id+'?roomId=room',{headers}).then(res=>res.json());
   if(record.status==='unsupported_workshop')break;
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(record.status,'unsupported_workshop');
  assert.equal(record.handoff.action,'skillDefine.defineDirect');
  assert.equal(record.result,undefined);
  assert.equal(record.verifiedResults,undefined);
  assert.equal((await fetch(base+'/api/rooms/room/assets',{headers})).status,501);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
