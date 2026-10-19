import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalDataStore} from '../../front/js/data/localDataStore.js';

test('blocked IndexedDB upgrades cannot install a late stale connection',async()=>{
  const requests=[],factory={open(){const request={};requests.push(request);return request;}};
  const store=createLocalDataStore({name:'blocked-upgrade-test',factory});
  const first=store.cache.read('chatDraft','room','state');
  assert.equal(requests.length,1);
  requests[0].onblocked();
  await assert.rejects(first,/blocked/);
  let closes=0;
  requests[0].result={close(){closes++;}};
  requests[0].onsuccess();
  assert.equal(closes,1,'late success from rejected opening is closed');

  const second=store.cache.read('chatDraft','room','state');
  assert.equal(requests.length,2,'a rejected opening is not reused');
  store.destroy();
  requests[1].result={close(){closes++;}};
  requests[1].onsuccess();
  await assert.rejects(second,/destroyed/);
  assert.equal(closes,2);
});
