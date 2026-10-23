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
