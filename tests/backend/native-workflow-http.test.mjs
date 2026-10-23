import test from 'node:test';
import assert from 'node:assert/strict';
import {createBetaRuntime} from '../../back/js/runtime.js';
import {createWorkspaceModel} from '../../front/js/workspace/model.js';

test('production composition exposes confirmed Skill and Block through HTTP without touching provisional client graph',async()=>{
 const skill={name:'식물 조사',description:'식물 조사 정의',instruction:'식물을 조사하는 재사용 스킬',
  icon:'globe',color:'#4F8EF7',inputs:[{id:'in',label:'입력',type:'any',multiple:true}],
  outputs:[{id:'result',label:'결과',type:'research',multiple:true}],
  fields:[{id:'request',label:'식물 이름',placeholder:'예: 은행나무',default:'',maxLength:1800}]};
 const response={languageBlock:'스킬 정의와 스킬블럭 배치를 완료했습니다. 조사는 실행하지 않았습니다.',
  contextBlock:{intent:'스킬블럭 만들기',progress:'실제 배치 완료'},
  contextData:{overallFlow:'Skill defined and placed',currentTopic:'식물 조사',details:'미실행'}};
 const calls=[];
 const modelCaller={
  generate:async ({layer})=>({jsonText:JSON.stringify(layer==='gate'?{need:[]}:layer==='hallwayInitial'?
   {plan:[{'skillDefine.defineDirect':{objective:'define',need:[]}},{'canvasEdit.addBlock':{objective:'place',need:[]}},{terminate:{objective:'finish',need:[]}}],contextBlock:{intent:'스킬블럭 만들기',progress:'계획'}}:response)}),
  generateFunction:async ({tool,context})=>{
   calls.push(tool.name);
   return {kind:'function_proposal',name:tool.name,args:tool.name==='define_direct'?skill:{
    skillId:context.verifiedResults[0].outcome.artifacts[0].id,x:100,y:100,expanded:true,values:{request:''}
   }};
  }
 };
 const runtime=createBetaRuntime({modelCaller,composer:{compose:async()=> 'prompt'},testToken:'test-secure-token-1234'});
 await new Promise(resolve=>runtime.server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+runtime.server.address().port,headers={authorization:'Bearer test-secure-token-1234','content-type':'application/json'};
 try{
  const post=await fetch(url+'/api/requests',{method:'POST',headers,body:JSON.stringify({
   roomId:'r',request:{parts:[{type:'text',text:'식물 조사 스킬블럭 만들어줘'}],attachments:[]},initialResources:[]
  })});
  assert.equal(post.status,202);
  const {requestId}=await post.json();
  await runtime.engine.whenIdle();
  const status=await fetch(url+'/api/requests/'+requestId+'?roomId=r',{headers}).then(r=>r.json());
  assert.equal(status.status,'completed',JSON.stringify(status.error));
  assert.equal(status.verifiedResults.length,2);
  const assets=await fetch(url+'/api/rooms/r/assets',{headers}).then(r=>r.json());
  assert.equal(assets.skills.length,1);
  assert.equal(assets.blocks.length,1);
  assert.equal(assets.blocks[0].skillId,assets.skills[0].id);
  assert.equal(assets.revision,2);
  assert.deepEqual(calls,['define_direct','add_block']);
  const projected=createWorkspaceModel({resolveSkill:id=>assets.skills.find(s=>s.id===id)});
  projected.replaceConfirmedSnapshot({version:1,blocks:assets.blocks,links:assets.links});
  assert.equal(projected.getBlocks().length,1);
  const history=await fetch(url+'/api/rooms/r/history',{headers}).then(r=>r.json());
  assert.equal(history.entries.length,1);
  assert.equal(history.entries[0].verifiedResults.length,2);
 }finally{await new Promise(resolve=>runtime.server.close(resolve));}
});

test('insecure default test token never enables actual asset mutations',async()=>{
 const plan={plan:[{'skillDefine.defineDirect':{objective:'create',need:[]}},{terminate:{objective:'finish',need:[]}}],contextBlock:{intent:'create',progress:'planned'}};
 const skill={name:'Unsafe',description:'Should never save',instruction:'Do not execute',
  icon:'globe',color:'#4F8EF7',inputs:[],outputs:[],fields:[]};
 const runtime=createBetaRuntime({testToken:'abcd',composer:{compose:async()=>''},modelCaller:{
  generate:async ({layer})=>({jsonText:JSON.stringify(layer==='gate'?{need:[]}:plan)}),
  generateFunction:async ({tool})=>({kind:'function_proposal',name:tool.name,args:skill})
 }});
 const result=await runtime.engine.submit({roomId:'room',initialResources:[],request:{parts:[{type:'text',text:'스킬 만들어줘'}],attachments:[]}}).completion;
 assert.equal(result.status,'unsupported_workshop');
 assert.equal(runtime.assets.read({scope:'room'}).skills.length,0);
});
