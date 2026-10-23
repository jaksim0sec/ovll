import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../../back/js/engine/engine.js';
import {createMemoryActionStore} from '../../back/js/assets/memoryActionStore.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
const skill={name:'식물 조사',description:'식물 정보 조사 정의',instruction:'입력한 식물을 조사하도록 정의한다.',
 icon:'globe',color:'#4F8EF7',inputs:[{id:'in',label:'입력',type:'any',multiple:true}],
 outputs:[{id:'result',label:'결과',type:'research',multiple:true}],
 fields:[{id:'request',label:'식물',placeholder:'예: 은행나무',default:'',maxLength:1800}]};
const block={intent:'식물 조사 스킬블럭 만들기',progress:'계획'};
const data={overallFlow:'식물 조사 스킬블럭 정의 및 배치',currentTopic:'스킬 생성',details:'실제 조사 실행은 하지 않음'};
const makePlan=(actions=['skillDefine.defineDirect','canvasEdit.addBlock','terminate'])=>({
 plan:actions.map(action=>({[action]:{objective:action,need:[]}})),contextBlock:block
});
const input={roomId:'r',request:{parts:[{type:'text',text:'식물 조사 스킬블럭 만들어줘'}],attachments:[]},initialResources:[]};
function fixture({actions,outputFails=false}={}){
 const store=createMemoryActionStore(),layers=[],proposals=[];
 const modelCaller={
  generate:async ({layer})=>{
   layers.push(layer);
   if(layer==='gate')return {jsonText:JSON.stringify({need:[]})};
   if(layer==='hallwayInitial')return {jsonText:JSON.stringify(makePlan(actions))};
   if(layer==='output'){
    if(outputFails)throw Object.assign(new Error('Output failed'),{code:'MODEL_ERROR'});
    return {jsonText:JSON.stringify({languageBlock:'식물 조사 스킬과 스킬블럭을 생성했습니다. 조사를 실행한 것은 아닙니다.',contextBlock:{intent:block.intent,progress:'정의와 배치 완료'},contextData:data})};
   }
   throw Error('Unexpected layer: '+layer);
  },
  generateFunction:async ({tool,context})=>{
   proposals.push({name:tool.name,context});
   if(tool.name==='define_direct')return {kind:'function_proposal',name:tool.name,args:skill};
   if(tool.name==='add_block'){
    const skillId=context.verifiedResults?.[0]?.outcome?.artifacts?.[0]?.id;
    return {kind:'function_proposal',name:tool.name,args:{skillId,x:120,y:120,expanded:true,values:{request:''}}};
   }
   throw Error('Unexpected tool');
  }
 };
 const engine=createEngine({composer:{compose:async layer=>'prompt '+layer},modelCaller,dataProvider:createMemoryDataProvider({assets:store}),actionStore:store});
 return {store,engine,layers,proposals};
}
test('one request defines a Skill and places its Block using two verified Function Calls',async()=>{
 const f=fixture();
 const job=f.engine.submit(input);
 const result=await job.completion;
 assert.equal(result.status,'completed',JSON.stringify(result.error));
 assert.equal(result.currentLayer,'output');
 assert.equal(result.verifiedResults.length,2);
 assert.equal(result.planCursor,2);
 assert.deepEqual(result.verifiedResults.map(x=>x.outcome.status),['applied','applied']);
 const current=f.store.read({scope:'r'});
 assert.equal(current.skills.length,1);assert.equal(current.blocks.length,1);
 assert.equal(current.blocks[0].skillId,current.skills[0].id);
 assert.equal(f.proposals[1].context.verifiedResults[0].outcome.artifacts[0].id,current.skills[0].id);
 const calls=f.engine.listCalls({roomId:'r',requestId:job.requestId});
 assert.deepEqual(calls.map(x=>x.route.layer),['gate','hallway','workshop','workshop','output']);
 assert.notEqual(calls[2].callId,calls[3].callId);
 assert.equal(result.result.languageBlock.includes('실행한 것은 아닙니다'),true);
});
test('Output failure preserves already applied assets and request verified outcomes',async()=>{
 const f=fixture({outputFails:true});
 const result=await f.engine.submit(input).completion;
 assert.equal(result.status,'failed');
 assert.equal(result.verifiedResults.length,2);
 assert.equal(f.store.read({scope:'r'}).blocks.length,1);
});
test('later unsupported action preserves earlier applied result without false completion',async()=>{
 const f=fixture({actions:['skillDefine.defineDirect','skillEdit.delete','terminate']});
 const result=await f.engine.submit(input).completion;
 assert.equal(result.status,'unsupported_workshop');
 assert.equal(result.verifiedResults.length,1);
 assert.equal(result.planCursor,1);
 assert.equal(f.store.read({scope:'r'}).skills.length,1);
 assert.equal(f.store.read({scope:'r'}).blocks.length,0);
});
