import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallManager} from '../../back/js/engine/callManager.js';

test('call manager creates distinct calls and scoped focus',async()=>{
 const seen=[];
 const manager=createCallManager({composer:{compose:async()=> 'prompt'},modelCaller:{generate:async payload=>{seen.push(payload);return {jsonText:'{"need":[]}'}}}});
 await manager.invoke({roomId:'r',requestId:'one',route:{layer:'gate'},context:{contextBlock:{intent:'goal',progress:''}}});
 await manager.invoke({roomId:'r',requestId:'one',route:{layer:'hallway',phase:'initial'},context:{contextBlock:{intent:'goal',progress:''}}});
 const calls=manager.listCalls({roomId:'r',requestId:'one'});
 assert.equal(calls.length,2);
 assert.notEqual(calls[0].callId,calls[1].callId);
 assert.equal(calls[0].status,'completed');
 assert.notEqual(seen[0].context.contextBlock.focus,seen[1].context.contextBlock.focus);
 assert.equal('focus' in calls[0],false);
 assert.equal('prompt' in calls[0],false);
});
test('a provider failure marks the individual call failed',async()=>{
 const manager=createCallManager({composer:{compose:async()=> 'prompt'},modelCaller:{generate:async()=>{throw Error('network')}}});
 await assert.rejects(manager.invoke({roomId:'r',requestId:'one',route:{layer:'gate'},context:{}}));
 assert.equal(manager.listCalls({roomId:'r',requestId:'one'})[0].status,'failed');
 assert.deepEqual(manager.listCalls({roomId:'r',requestId:'two'}),[]);
});

test('Workshop Function Calling gets a routed call ID but applies nothing',async()=>{
 const seen=[];
 const manager=createCallManager({composer:{compose:async layer=>'prompt '+layer},modelCaller:{
  generate:async()=>({jsonText:'{"need":[]}'}),
  generateFunction:async input=>{seen.push(input);return {kind:'function_proposal',name:'define_direct',args:{name:'Plant'}};}
 }});
 const args={roomId:'room',requestId:'request',requestRevision:0,
  route:{layer:'workshop',workshop:'skillDefine',action:'defineDirect'},
  context:{contextBlock:{intent:'plant',progress:'planned'}},
  tool:{name:'define_direct',description:'Define a Skill',parameters:{type:'object',properties:{name:{type:'string'}},required:['name']}}};
 const result=await manager.invokeFunction(args);
 assert.match(result.callId,/^[A-Za-z0-9_-]+$/);
 assert.equal(result.proposal.args.name,'Plant');
 const [call]=manager.listCalls({roomId:'room',requestId:'request'});
 assert.equal(call.path,result.callId+'.workshop.skillDefine.defineDirect');
 assert.equal(call.status,'completed');
 assert.equal(seen[0].prompt,'prompt workshop.skillDefine.defineDirect');
 assert.equal(seen[0].context.contextBlock.focus,'skillDefine.defineDirect');
 assert.equal('args' in call,false);
});
