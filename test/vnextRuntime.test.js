import test from 'node:test';
import assert from 'node:assert/strict';
import { createVNextRuntime } from '../backend/vnext/runtime.js';
const options={pool:{connect:async()=>{throw Error('DB must not be accessed for invalid turn');}},executeNode:async()=>({status:'produced',values:{result:{inline:'x'}}}),workerRef:'test',authenticate:async()=>({workspaceRef:'w',actorRef:'a'}),verifyMutation:async()=>true};
test('runtime composes full frozen validation and preserves plain conversation',async()=>{
 const runtime=createVNextRuntime(options);
 assert.deepEqual((await runtime.store.submit({message:'plain'},{requestRef:'r'})).results,[]);
 await assert.rejects(runtime.store.submit({message:'plain',actorRef:'forged'},{requestRef:'r'}),e=>e.code==='INVALID_MODEL_TURN');
});
test('runtime refuses missing trusted authentication or executor',()=>{
 assert.throws(()=>createVNextRuntime({...options,authenticate:undefined}));
 assert.throws(()=>createVNextRuntime({...options,executeNode:undefined}));
});
