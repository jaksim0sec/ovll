import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const window={};
vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),{window});
const a=window.OvllPointerLocalActions;
const snapshot={graph:{graphId:'g',nodes:[{nodeId:'source'},{nodeId:'export'}]}};
const run={runId:'r1',graphRef:{graphId:'g'},status:'completed',targets:['source'],nodes:[{
  nodeId:'source',status:'success',resultCurrent:true,semanticFingerprint:'verified',
  outputs:{status:'produced',values:{result:{inline:'Existing researched material'}}}
}]};
test('prior source result refs are discoverable before a PDF follow-up proposal',async()=>{
  let supplied;
  await a.coordinate({getContext:async()=>({snapshot,runs:[run]}),handlers:{},
    request:async({extraContext})=>{supplied=extraContext;return{message:'자료를 확인할게'};}});
  assert.equal(supplied.availableResults.items[0].nodeId,'source');
  assert.equal(supplied.availableResults.items[0].resultCurrent,true);
  assert.equal(supplied.availableResults.items[0].outputs[0].ref,'local:r1:source:result');
  const read=a.readNeeds([{kind:'value',selector:{scope:'ref',ref:supplied.availableResults.items[0].outputs[0].ref,depth:'full'}}],{snapshot,runs:[run]});
  assert.equal(read[0].content,'Existing researched material');
});
test('result index uses latest attempt and never presents stale or other-graph evidence as current',()=>{
  const latest={...run,runId:'r2',nodes:[{...run.nodes[0],status:'failed',outputs:undefined}]};
  const foreign={...run,runId:'foreign',graphRef:{graphId:'other'}};
  const index=a.resultIndex({snapshot,runs:[run,latest,foreign]});
  assert.equal(index.items.length,1);assert.equal(index.items[0].runId,'r2');
  assert.equal(index.items[0].status,'failed');assert.equal(index.items[0].resultCurrent,false);
});
test('result index limits evidence bytes and exposes omitted evidence rather than copying full bodies',()=>{
  const result=a.resultIndex({snapshot,runs:[{...run,nodes:[{...run.nodes[0],outputs:{values:{result:{inline:'한글'.repeat(15000)}}}}]}]});
  assert.ok(Buffer.byteLength(JSON.stringify(result),'utf8')<=12000);
  assert.ok(result.items[0].outputs[0].preview.length<600);
  assert.equal(result.items[0].outputs[0].truncated,true);
});
for(const message of ['PDF 파일이 준비되었습니다.','PDF 파일 생성이 완료되었어.','PDF file created successfully.']){
  test('unsupported completion claim is corrected: '+message,async()=>{
    let calls=0;
    const result=await a.coordinate({getContext:async()=>({snapshot}),handlers:{},
      request:async()=>{calls++;return{message};}});
    assert.equal(calls,3);assert.equal(result.facts.length,0);
    assert.doesNotMatch(a.present(result),/준비되었습니다|완료되었|created successfully/);
  });
}
test('a failed run cannot be followed by an actionless completion declaration',async()=>{
  let calls=0;
  const result=await a.coordinate({getContext:async()=>({snapshot}),handlers:{
    'run.start':async()=>({status:'waiting',run:{status:'waiting',targets:['export'],nodes:[{nodeId:'export',status:'blocked',error:'REQUIRED_INPUT_MISSING'}]}})
  },request:async()=>++calls===1?{actions:[{localKey:'r',kind:'run.start'}]}:{message:'PDF 파일이 준비되었습니다.'}});
  assert.doesNotMatch(a.present(result),/준비되었습니다/);assert.match(a.present(result),/입력/);
});
test('an unresolved read cannot smuggle a completion declaration into the reply',async()=>{
  const result=await a.coordinate({getContext:async()=>({snapshot}),handlers:{},request:async()=>({
    message:'PDF file created successfully.',needs:[{kind:'value',selector:{scope:'ref',ref:'missing'},purpose:'Read source'}]
  })});
  assert.doesNotMatch(a.present(result),/created successfully/);assert.match(a.present(result),/자료|입력/);
});
test('ordinary informational replies remain available without execution',async()=>{
  const result=await a.coordinate({getContext:async()=>({snapshot}),handlers:{},request:async()=>({message:'PDF는 문서 형식을 유지하는 파일 형식이야'})});
  assert.equal(a.present(result),'PDF는 문서 형식을 유지하는 파일 형식이야');
});
test('language fallback cannot promote a blocked run into file completion',()=>{
  const evidence={facts:[{kind:'run.start',status:'waiting',run:{status:'waiting',targets:['export'],nodes:[{nodeId:'export',status:'blocked',error:'REQUIRED_INPUT_MISSING'}]}}],runs:[]};
  assert.doesNotMatch(a.groundedResponse('PDF 파일이 준비되었습니다.',evidence),/준비되었습니다/);
  assert.match(a.groundedResponse('PDF 파일이 준비되었습니다.',evidence),/입력/);
  assert.match(a.groundedResponse('완성된 내용을 연결해줘',evidence),/완성된 내용을 연결해줘/);
});
