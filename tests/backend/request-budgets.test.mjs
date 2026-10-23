import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../../back/js/engine/engine.js';
import {createCallManager} from '../../back/js/engine/callManager.js';
import {createMemoryActionStore} from '../../back/js/assets/memoryActionStore.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';

const request={parts:[{type:'text',text:'식물 조사 스킬블럭 만들어줘'}],attachments:[]};
const contextBlock={intent:'식물 스킬블럭 만들기',progress:'계획'};
const step={ 'skillDefine.defineDirect':{objective:'식물 스킬 정의',need:[]} };
const sample=(roomId='room')=>({roomId,request,initialResources:[]});

test('excessive Hallway plan is rejected before any Workshop model call or asset change',async()=>{
 let workshopCalls=0;
 const assets=createMemoryActionStore();
 const plan={plan:[...Array.from({length:25},()=>structuredClone(step)),{terminate:{objective:'마무리',need:[]}}],contextBlock};
 const modelCaller={
  generate:async ({layer})=>({jsonText:JSON.stringify(layer==='gate'?{need:[]}:plan)}),
  generateFunction:async()=>{workshopCalls++;throw new Error('must not call');}
 };
 const engine=createEngine({composer:{compose:async()=>''},modelCaller,
  dataProvider:createMemoryDataProvider({assets}),actionStore:assets});
 const result=await engine.submit(sample()).completion;
 assert.equal(result.status,'failed');
 assert.equal(result.error.code,'ENGINE_BUDGET_EXCEEDED');
 assert.equal(workshopCalls,0);
 assert.equal(assets.read({scope:'room'}).revision,0);
 assert.equal(engine.listCalls({roomId:'room',requestId:result.requestId}).length,2);
});

test('per-request model limit stops additional calls without consuming slots from another request',async()=>{
 let generated=0;
 const caller={generate:async()=>{generated++;return {jsonText:'{"need":[]}'};}};
 const manager=createCallManager({composer:{compose:async()=>''},modelCaller:caller,maxCallsPerRequest:2});
 const call=(requestId)=>manager.invoke({roomId:'room',requestId,route:{layer:'gate'},context:{}});
 await call('one');await call('one');
 await assert.rejects(call('one'),error=>error.code==='ENGINE_BUDGET_EXCEEDED');
 assert.equal(manager.listCalls({roomId:'room',requestId:'one'}).length,2);
 await call('two');
 assert.equal(generated,3);
});

test('Engine policy budget blocks a Workshop model call after Gate and Hallway',async()=>{
 let invoked=0;
 const assets=createMemoryActionStore();
 const modelCaller={
  generate:async ({layer})=>({jsonText:JSON.stringify(layer==='gate'?{need:[]}:{
   plan:[step,{terminate:{objective:'마무리',need:[]}}],contextBlock
  })}),
  generateFunction:async()=>{invoked++;throw new Error('must not call');}
 };
 const engine=createEngine({composer:{compose:async()=>''},modelCaller,
  dataProvider:createMemoryDataProvider({assets}),actionStore:assets,policy:{maxModelCallsPerRequest:2}});
 const result=await engine.submit(sample('budget')).completion;
 assert.equal(result.status,'failed');
 assert.equal(result.error.code,'ENGINE_BUDGET_EXCEEDED');
 assert.equal(invoked,0);
 assert.equal(assets.read({scope:'budget'}).revision,0);
});
