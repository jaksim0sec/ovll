import test from 'node:test';
import assert from 'node:assert/strict';
import {settleInitialWorkspaceReads} from '../../front/js/workspace/controller.js';

test('restoration of available data does not wait for the timeout',async()=>{
 const data=await settleInitialWorkspaceReads([Promise.resolve({value:42}),Promise.resolve(null),Promise.resolve(null)],{timeoutMs:100});
 assert.deepEqual(data.map(x=>x.status),['fulfilled','fulfilled','fulfilled']);
 assert.equal(data[0].value.value,42);
});
test('one blocked IndexedDB request cannot leave app initialization waiting forever',async()=>{
 const blocked=new Promise(()=>{});
 const started=Date.now();
 const data=await settleInitialWorkspaceReads([Promise.resolve({value:'old graph'}),blocked,Promise.resolve(null)],{timeoutMs:20});
 assert.deepEqual(data.map(x=>x.status),['rejected','rejected','rejected']);
 assert.ok(Date.now()-started<500);
});
test('read failures are preserved for existing Workspace protection logic',async()=>{
 const data=await settleInitialWorkspaceReads([Promise.reject(Error('IndexedDB unavailable')),Promise.resolve(null),Promise.resolve(null)],{timeoutMs:100});
 assert.deepEqual(data.map(x=>x.status),['rejected','fulfilled','fulfilled']);
});
