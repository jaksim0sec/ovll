import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
function harness(fetch){
 const window={addEventListener(){},setTimeout,clearTimeout,navigator:{}};
 vm.runInNewContext(readFileSync(new URL('../front/js/fileStore.js',import.meta.url),'utf8'),{window,console,fetch,AbortController,Blob,URL});
 return window.OvllFileStore;
}
test('remote artifact capture honors already-aborted request before fetch',async()=>{
 let fetched=0;const store=harness(async()=>{fetched++;throw Error('unexpected fetch');});
 const c=new AbortController();c.abort();
 await assert.rejects(()=>store.putRemote('/artifacts/a',{}, {signal:c.signal}),error=>error.code==='LOCAL_FILE_CANCELLED');
 assert.equal(fetched,0);
});
test('remote file capture enforces byte budget before allocating whole response',async()=>{
 let allocated=0;const store=harness(async()=>({ok:true,headers:{get:()=> '9000'},blob:async()=>{allocated++;return new Blob(['too big']);}}));
 await assert.rejects(()=>store.putRemote('/artifacts/a',{}, {maxBytes:100}),error=>error.code==='LOCAL_FILE_TOO_LARGE');
 assert.equal(allocated,0);
});
test('streamed capture cancels before retaining bytes beyond bounded size',async()=>{
 let cancelled=0,reads=0;
 const store=harness(async()=>({ok:true,headers:{get:()=>null},body:{getReader:()=>({read:async()=>({done:false,value:new Uint8Array(++reads*3)}),cancel:async()=>{cancelled++;}})}}));
 await assert.rejects(()=>store.putRemote('/artifacts/a',{}, {maxBytes:7}),error=>error.code==='LOCAL_FILE_TOO_LARGE');
 assert.equal(cancelled,1);assert.equal(reads,2);
});

function memoryIndexedDB(){
 const records=new Map(),indexes=new Set();let opens=0;
 const request=value=>{const r={};setImmediate(()=>{r.result=value;r.onsuccess?.();});return r;};
 const objectStore={indexNames:{contains:name=>indexes.has(name)},createIndex:name=>indexes.add(name),
  put:r=>records.set(r.id,r),get:id=>request(records.get(id)),getAll:()=>request([...records.values()]),
  index:name=>({getAll:value=>request([...records.values()].filter(r=>r[name]===value))})};
 const db={objectStoreNames:{contains:()=>false},createObjectStore:()=>objectStore,
  transaction(){const tx={objectStore:()=>objectStore};setImmediate(()=>tx.oncomplete?.());return tx;},close(){}};
 return {open(){opens++;const r={};setImmediate(()=>{r.result=db;r.onupgradeneeded?.();r.onsuccess?.();});return r;},get opens(){return opens;}};
}
test('successful IndexedDB write retains actual artifact bytes and versions using one shared connection',async()=>{
 const indexedDB=memoryIndexedDB(),window={indexedDB,addEventListener(){},setTimeout,clearTimeout,navigator:{}};
 vm.runInNewContext(readFileSync(new URL('../front/js/fileStore.js',import.meta.url),'utf8'),{window,console,fetch:async()=>{},AbortController,Blob,URL});
 const store=window.OvllFileStore;
 const first=await store.putBlob(new Blob(['Actual body'],{type:'text/plain'}),{id:'artifact-1',name:'body.txt',size:999999,truncated:true,coverage:{omittedCharacters:3}});
 assert.equal(first.size,11);assert.equal(first.availability.localBytes,true);assert.equal(first.coverage.omittedCharacters,3);
 assert.equal(await (await store.getBlob('artifact-1')).text(),'Actual body');
 const second=await store.putBlob(new Blob(['Replacement']),{id:'artifact-1',name:'body.txt'});
 assert.notEqual(second.contentRevision,first.contentRevision);
 assert.equal(indexedDB.opens,1);
});
