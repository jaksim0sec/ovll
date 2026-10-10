import test from 'node:test';
import assert from 'node:assert/strict';
import * as artifacts from '../backend/artifacts/artifactStore.js';

test('CSV exports structured matrix and parsed CSV without flattening columns',async()=>{
 for(const sources of [[{headers:['name','note'],rows:[['Ada','x,y'],['Bo','line\nnext']]}],['name,note\r\nAda,"x,y"\r\nBo,"line\nnext"']]){
  const artifact=await artifacts.createStoredArtifact({format:'CSV',sources});
  const text=artifacts.getStoredArtifact(artifact.id).buffer.toString('utf8');
  assert.equal(text,'\uFEFFname,note\r\nAda,"x,y"\r\nBo,"line\nnext"');
 }
});
test('artifact export reports omitted rows columns and source content',async()=>{
 const rows=Array.from({length:5002},(_,r)=>r?{c0:1}:Object.fromEntries(Array.from({length:42},(_,i)=>['c'+i,i])));
 const artifact=await artifacts.createStoredArtifact({format:'CSV',sources:[rows]});
 assert.equal(artifact.truncated,true);assert.equal(artifact.coverage.omittedRows,2);assert.equal(artifact.coverage.omittedColumns,2);
 const text=await artifacts.createStoredArtifact({format:'TXT',sources:['x'.repeat(420010)]});
 assert.equal(text.truncated,true);assert.equal(text.coverage.omittedCharacters,10);
});
test('unknown artifact format cannot declare a successful export',async()=>{
 await assert.rejects(artifacts.createStoredArtifact({format:'PPTX',sources:['hello']}),{code:'ARTIFACT_UNSUPPORTED_FORMAT'});
});
test('bounded artifact store limits count bytes concurrency and expires without serving stale files',async()=>{
 assert.equal(typeof artifacts.createArtifactStore,'function');
 let now=1000,release;const gate=new Promise(resolve=>release=resolve);
 const store=artifacts.createArtifactStore({limits:{maxCount:1,maxTotalBytes:8,maxArtifactBytes:8,maxConcurrent:1,ttlMs:10},now:()=>now,build:async()=>{await gate;return{buffer:Buffer.from('1234'),renderer:'fixture'};}});
 const first=store.createStoredArtifact({sources:['x']});
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_BUSY'});release();
 const saved=await first;assert.equal(saved.expiresAt,1010);assert.equal(saved.availability,'temporary');
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_STORE_FULL'});
 now=1011;assert.equal(store.getStoredArtifact(saved.id),null);assert.equal(store.stats().count,0);
 assert.equal((await store.createStoredArtifact({sources:['x']})).size,4);store.dispose();
});
test('artifact failures release capacity and oversized output never reaches storage',async()=>{
 assert.equal(typeof artifacts.createArtifactStore,'function');let fail=true;
 const store=artifacts.createArtifactStore({limits:{maxCount:1,maxArtifactBytes:3},build:async()=>{if(fail){fail=false;throw new Error('fixture');}return{buffer:Buffer.from('large'),renderer:'fixture'};}});
 await assert.rejects(store.createStoredArtifact({sources:['x']}),/fixture/);
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_OUTPUT_TOO_LARGE'});
 assert.equal(store.stats().count,0);assert.equal(store.stats().active,0);store.dispose();
});

test('artifact deadline aborts work and retains concurrency until ignored cancellation settles',async()=>{
 let finish;const gate=new Promise(resolve=>finish=resolve);
 const store=artifacts.createArtifactStore({limits:{deadlineMs:10,maxConcurrent:1},build:async()=>{await gate;return{buffer:Buffer.from('late'),renderer:'fixture'};}});
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_DEADLINE'});
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_BUSY'});
 finish();await new Promise(resolve=>setTimeout(resolve,1));assert.equal(store.stats().active,0);assert.equal(store.stats().count,0);store.dispose();
});
test('PDF fallback coverage reports its smaller physical table limits',async()=>{
 const {pdfFallbackCoverage}=await import('../backend/artifacts/pdfRenderer.js');
 const coverage=pdfFallbackCoverage({blocks:[{type:'table',headers:Array(14).fill('h'),rows:Array.from({length:302},()=>Array(14).fill('x'.repeat(3002)))}]});
 assert.deepEqual(coverage,{omittedRows:2,omittedColumns:2,omittedCharacters:7200});
});
test('large newline expansion reports omitted document content',async()=>{
 const artifact=await artifacts.createStoredArtifact({format:'DOCX',sources:['a\n'.repeat(15000)]});
 assert.equal(artifact.truncated,true);assert.ok(artifact.coverage.omittedCharacters>0);
});
test('metadata-only files cannot claim complete document export',async()=>{
 await assert.rejects(artifacts.createStoredArtifact({format:'TXT',sources:[{kind:'workflow-file',name:'missing.txt',size:25}]}),{code:'ARTIFACT_SOURCE_UNAVAILABLE'});
 const partial=await artifacts.createStoredArtifact({format:'TXT',sources:[{kind:'workflow-file',previewText:'visible'}]});
 assert.equal(partial.truncated,true);assert.equal(partial.sourceAvailability,'partial');
});

test('wall deadline rejects synchronous builders even before timer can run',async()=>{
 const store=artifacts.createArtifactStore({limits:{deadlineMs:1},build:async()=>{
  const until=performance.now()+8;while(performance.now()<until){}return{buffer:Buffer.from('late'),renderer:'fixture'};
 }});
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_DEADLINE'});
 assert.equal(store.stats().count,0);store.dispose();
});
test('artifact input and total byte limits reject before retaining extra buffers',async()=>{
 const store=artifacts.createArtifactStore({limits:{maxInputBytes:80,maxTotalBytes:6,maxArtifactBytes:4},build:async()=>({buffer:Buffer.from('1234'),renderer:'fixture'})});
 await assert.rejects(store.createStoredArtifact({sources:['x'.repeat(81)]}),{code:'ARTIFACT_INPUT_TOO_LARGE'});
 await store.createStoredArtifact({sources:['x']});
 await assert.rejects(store.createStoredArtifact({sources:['x']}),{code:'ARTIFACT_STORE_FULL'});
 assert.equal(store.stats().totalBytes,4);store.dispose();
});

test('CSV preserves literal tabs inside comma-separated fields',async()=>{
 const artifact=await artifacts.createStoredArtifact({format:'CSV',sources:['name,note\nAda,one\ttwo']});
 assert.equal(artifacts.getStoredArtifact(artifact.id).buffer.toString('utf8'),'\uFEFFname,note\r\nAda,one\ttwo');
});

test('artifact HTTP admission guard limits per-address creation without invoking excess work',async()=>{
 const {default:express}=await import('express');const app=express();let creations=0;
 app.post('/create',artifacts.createArtifactAdmissionGuard({minutePerIp:2}),(_req,res)=>{creations++;res.json({ok:true});});
 const server=await new Promise(resolve=>{const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
 try{
  const url='http://127.0.0.1:'+server.address().port+'/create';
  await fetch(url,{method:'POST'});await fetch(url,{method:'POST'});const denied=await fetch(url,{method:'POST'});
  assert.equal(denied.status,429);assert.equal(creations,2);assert.ok(Number(denied.headers.get('retry-after'))>0);
  assert.equal((await denied.json()).code,'ARTIFACT_RATE_LIMIT');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('spreadsheet columns preserve nested cell values beyond the sixth column',async()=>{
 const headers=Array.from({length:8},(_,i)=>'c'+i);
 const artifact=await artifacts.createStoredArtifact({format:'CSV',sources:[{headers,rows:[headers.map(()=>({value:'ok'}))]}]});
 assert.doesNotMatch(artifacts.getStoredArtifact(artifact.id).buffer.toString('utf8'),/\[nested\]/);
});
