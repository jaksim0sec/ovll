import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import vm from 'node:vm';

function activity(){
  const window={};
  const path=new URL('../front/js/ovllPointerActivity.js',import.meta.url);
  if(existsSync(path))vm.runInNewContext(readFileSync(path,'utf8'),{window,AbortController,console});
  assert.equal(typeof window.OvllPointerActivity?.createOperations,'function','operation ownership must be available');
  return window.OvllPointerActivity;
}
test('operation ownership rejects late callbacks after a conversation switch',()=>{
  let conversationId='a';
  const ops=activity().createOperations({getConversationId:()=>conversationId});
  const first=ops.begin({conversationId,kind:'run'});
  assert.equal(ops.isActive(first),true);
  conversationId='b';
  assert.equal(ops.isCurrent(first),false);
  ops.invalidate();
  const second=ops.begin({conversationId,kind:'chat'});
  assert.equal(first.signal.aborted,true);
  assert.equal(ops.finish(first),false,'old finalization cannot end new activity');
  assert.equal(ops.isActive(second),true);
});
test('operation cancellation reaches queued requests and keeps cleanup owned',()=>{
  const ops=activity().createOperations({getConversationId:()=> 'a'});
  const op=ops.begin({conversationId:'a'});
  assert.throws(()=>ops.begin({conversationId:'a'}),/LOCAL_OPERATION_ALREADY_ACTIVE/);
  ops.cancel();
  assert.equal(op.signal.aborted,true);
  assert.equal(ops.isActive(op),false);
  assert.equal(ops.isCurrent(op),true);
  assert.equal(ops.finish(op),true);
  assert.equal(ops.getCurrent(),null);
});
test('live run transitions restore mascot work without restarting on repeated progress',()=>{
  const calls=[];
  const presence={workAtNode:(id,active)=>calls.push(['work',id,active]),
    mascotState:(name,detail)=>calls.push([name,detail.nodeId])};
  const bridge=activity().createRunPresence({presence});
  const run={runId:'r',status:'running',nodes:[{nodeId:'a',status:'running'},{nodeId:'b',status:'pending'}]};
  bridge.update(run);bridge.update(run);
  assert.equal(calls.filter(c=>c[0]==='work'&&c[2]).length,1);
  run.nodes[0].status='success';run.nodes[1].status='running';
  bridge.update(run);bridge.update(run);
  assert.equal(calls.filter(c=>c[0]==='nodeSuccess').length,1);
  assert.deepEqual(calls.at(-1),['work','b',true]);
  run.nodes[1].status='failed';run.status='failed';bridge.update(run);
  assert.deepEqual(calls.at(-1),['nodeError','b']);
});
test('inactive run callbacks do not trigger mascot reactions',()=>{
  const calls=[];
  const bridge=activity().createRunPresence({presence:{workAtNode:()=>calls.push('work'),mascotState:()=>calls.push('state')},isActive:()=>false});
  bridge.update({runId:'old',status:'running',nodes:[{nodeId:'a',status:'running'}]});
  assert.equal(calls.length,0);
});
test('local API retains original task context on all model phases',async()=>{
  const bodies=[];
  const window={OVLL_RUNTIME:{},crypto:{randomUUID:()=> 'uuid'},fetch:async(_url,options)=>{
    bodies.push(JSON.parse(options.body));return {ok:true,json:async()=>({message:'ok'})};
  }};
  vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerApi.js',import.meta.url),'utf8'),{window,console});
  const taskContext={objective:'Only use the original attachment',constraints:['Hide names'],requestText:'Make a table'};
  for(const phase of ['localTurn','localNode','localResponse'])await window.OvllPointerApi[phase]({snapshot:{},requestText:'Make a table',taskContext});
  assert.equal(bodies.length,3);
  for(const body of bodies)assert.deepEqual(body.taskContext,taskContext);
});

test('each user turn owns its objective while older requests remain background',()=>{
  const api=activity();
  assert.equal(typeof api.createTaskContext,'function');
  const first=api.createTaskContext(null,'Summarize attachment and hide names');
  first.constraints=['No external sources'];
  const second=api.createTaskContext(first,'Use a table\nwith three columns');
  const third=api.createTaskContext(second,'Shorten the conclusion');
  assert.equal(third.objective,third.requestText);
  assert.equal(third.requestText,'Shorten the conclusion');
  assert.deepEqual(Array.from(third.constraints),[]);
  assert.deepEqual(Array.from(third.requestHistory),[first.requestText,second.requestText]);
});
test('function command keeps multiline input and accepts named JSON bindings',()=>{
  const api=activity();
  assert.equal(typeof api.parseFunctionRequest,'function');
  const parsed=api.parseFunctionRequest('12 First line\nSecond line');
  assert.equal(parsed.id,'12');assert.equal(parsed.input,'First line\nSecond line');
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseFunctionRequest('f {"left":"A","right":"B"}').bindings)),{left:'A',right:'B'});
});
test('presence reset uses full node id even when run id contains a colon',()=>{
  const calls=[];const bridge=activity().createRunPresence({presence:{workAtNode:(...args)=>calls.push(args)}});
  bridge.update({runId:'local:run',nodes:[{nodeId:'node:a',status:'running'}]});bridge.reset();
  assert.deepEqual(calls.at(-1),['node:a',false]);
});
test('app local run owns signal and ignores progress after invalidation',async()=>{
  const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  const fragment=source.slice(source.indexOf('  let localRunActive=null;'),source.indexOf('  function localRunSummary'));
  const ops=activity().createOperations({getConversationId:()=> 'a'}),op=ops.begin({conversationId:'a'});
  let options,resolve;const calls=[];
  const sandbox={AbortController,console,localOperations:ops,
    pointerScope:()=>({storageMode:'local',conversationId:'a'}),currentConversationId:()=> 'a',
    state:{destroyed:false},showLocalRun:()=>calls.push('canvas'),pointerNodeProgress:()=>calls.push('presence'),
    getPointerTask:()=>null,global:{OvllPointerLocal:{run:args=>{options=args;return new Promise(r=>resolve=r);}}}};
  vm.runInNewContext(fragment+'\nthis.runLocalNodes=runLocalNodes;',sandbox);
  const promise=sandbox.runLocalNodes({targets:['n'],operation:op,taskContext:{objective:'original'}});
  assert.equal(options.taskContext.objective,'original');
  options.onProgress({nodes:[{nodeId:'n',status:'running'}]});assert.equal(calls.length,2);
  ops.invalidate();assert.equal(options.signal.aborted,true);
  options.onProgress({nodes:[{nodeId:'n',status:'success'}]});assert.equal(calls.length,2);
  resolve({status:'cancelled',nodes:[]});await promise;
});
test('node result inspection opens full output and marks historical content',async()=>{
  const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  async function handleCanvasNodeResult(');
  assert.ok(start>=0,'runtime result inspector must exist');
  const fragment=source.slice(start,source.indexOf('  function openConversation(',start));
  const previews=[];const sandbox={currentConversationId:()=> 'a',state:{destroyed:false},
    WorkspaceStore:{getPointerNodeOutput:()=>({status:'produced',values:{result:{inline:'ACTUAL STORED FULL RESULT'}}})},openArtifactPreview:async artifact=>{previews.push(artifact);return true;},
    showErrorNotice:()=>{},console};
  vm.runInNewContext(fragment+'\nthis.inspect=handleCanvasNodeResult;',sandbox);
  const full='First line\n'+'x'.repeat(6000)+'\nLast line';
  await sandbox.inspect({id:'n',runtime:{status:'STALE',result:{values:{result:{inline:full}},resultCurrent:false}}});
  assert.equal(previews.length,1);
  assert.ok(previews[0].previewText.includes(full));
  assert.ok(previews[0].previewText.includes('이전 실행 결과'));
  assert.equal(previews[0].format,'txt','plain text avoids executing model output');
  await sandbox.inspect({id:'n',runtime:{status:'SUCCESS',result:{runId:'saved-run',values:{result:{inline:'old cached output'}}}}});
  assert.ok(previews[1].previewText.includes('ACTUAL STORED FULL RESULT'));
  assert.ok(!previews[1].previewText.includes('undefined'));
});

 test('long original and current request do not duplicate within task history budget',()=>{
 const api=activity(),first=api.createTaskContext(null,'a'.repeat(10000));
 const second=api.createTaskContext(first,'b'.repeat(3000));
 assert.equal(second.objective.length,3000);assert.equal(second.requestText.length,3000);
 assert.equal(second.requestHistory.length,0);
 });
test('all execution entry paths preserve partial coverage and storage warnings',()=>{
 const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
 const start=source.indexOf('  function localRunSummary('),end=source.indexOf('  function getPointerTask(',start);
 const window={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),{window});
 const sandbox={global:window};vm.runInNewContext(source.slice(start,end)+'\nthis.summary=localRunSummary;',sandbox);
 const text=sandbox.summary({status:'completed',targets:['n'],coverage:{sourceTruncated:true},storage:{status:'failed',error:'QUOTA'},nodes:[{nodeId:'n',status:'success',outputs:{values:{result:{inline:'Part'}}}}]});
 assert.ok(text.includes('원문 일부'));assert.ok(text.includes('저장하지 못했어'));assert.ok(text.includes('Part'));
});

test('a running node animates and speaks once per transition',()=>{
  const calls=[];
  const presence={
    workAtNode:(id,active)=>calls.push(['work',id,active]),
    mascotState:(name,detail)=>calls.push([name,detail.nodeId]),
    canvasStatus:(message,options)=>calls.push(['speech',message,options.hold])
  };
  const bridge=activity().createRunPresence({presence,getNodeLabel:id=>id==='a'?'조사하기':'작성하기'});
  bridge.update({runId:'r',nodes:[{nodeId:'a',status:'running'}]});
  bridge.update({runId:'r',nodes:[{nodeId:'a',status:'running'}]});
  assert.equal(calls.filter(c=>c[0]==='speech').length,1);
  assert.deepEqual(calls.find(c=>c[0]==='speech'),['speech','조사하기 실행 중',0]);
  bridge.update({runId:'r',nodes:[{nodeId:'a',status:'success'},{nodeId:'b',status:'running'}]});
  assert.deepEqual(calls.at(-2),['work','b',true]);
  assert.deepEqual(calls.at(-1),['speech','작성하기 실행 중',0]);
  bridge.reset();
  assert.deepEqual(calls.at(-1),['work','b',false]);
});
test('mobile Enter inserts a newline while desktop Enter still submits',()=>{
  const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  function handleComposerKeydown(event) {');
  const end=source.indexOf('  /* =======================================================',start);
  assert.ok(start>=0&&end>start);
  const method=source.slice(start,end);
  function keydown(userAgent,coarse,shiftKey=false){
    let sent=0,prevented=0;
    const global={navigator:{userAgent},matchMedia:()=>({matches:coarse})};
    const context={global,state:{busy:false},composerForm:{requestSubmit:()=>sent++}};
    vm.runInNewContext(method+'\nthis.keydown=handleComposerKeydown;',context);
    context.keydown({key:'Enter',shiftKey,isComposing:false,preventDefault:()=>prevented++});
    return {sent,prevented};
  }
  assert.deepEqual(keydown('Mozilla/5.0 (Linux; Android 16)',false),{sent:0,prevented:0});
  assert.deepEqual(keydown('Mozilla/5.0 (iPhone; CPU iPhone OS 17)',false),{sent:0,prevented:0});
  assert.deepEqual(keydown('Mozilla/5.0 (Windows NT 10.0)',true),{sent:0,prevented:0});
  assert.deepEqual(keydown('Mozilla/5.0 (Windows NT 10.0)',false),{sent:1,prevented:1});
  assert.deepEqual(keydown('Mozilla/5.0 (Windows NT 10.0)',false,true),{sent:0,prevented:0});
});
