import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8');
const window={};vm.runInNewContext(src,{window});
const order=window.OvllPointerLocalActions.order;
test('model proposal actions execute dependencies before use of temporary node refs',()=>{
  const actions=[{localKey:'run',kind:'run.start',dependsOn:['create']},
    {localKey:'create',kind:'ir.applyPatch'}];
  assert.deepEqual(Array.from(order(actions),x=>x.localKey),['create','run']);
});
test('local action sorter rejects missing dependencies and cycles',()=>{
  assert.throws(()=>order([{localKey:'a',dependsOn:['missing']}]),/MISSING/);
  assert.throws(()=>order([{localKey:'a',dependsOn:['b']},{localKey:'b',dependsOn:['a']}]),/CYCLE/);
  assert.throws(()=>order([{localKey:'a'},{localKey:'a'}]),/DUPLICATE/);
});
test('failed execution blocks dependent function saving and records facts',async()=>{
 assert.equal(typeof window.OvllPointerLocalActions.execute,'function');
 let saved=0;
 const results=await window.OvllPointerLocalActions.execute([
  {localKey:'r',kind:'run.start',args:{}},
  {localKey:'f',kind:'function.save',dependsOn:['r'],args:{}}],{
  'run.start':async()=>({status:'failed',error:'Missing input'}),
  'function.save':async()=>{saved++;return{status:'saved'};}
 });
 assert.equal(saved,0);assert.equal(results[0].status,'failed');assert.equal(results[1].status,'skipped');
});
test('reads resolve only supplied local state and disclose omissions',()=>{
 assert.equal(typeof window.OvllPointerLocalActions.readNeeds,'function');
 const facts=window.OvllPointerLocalActions.readNeeds([{kind:'definition',selector:{scope:'ref',ref:'d',depth:'full'},purpose:'Inspect'},
  {kind:'artifact',selector:{scope:'ref',ref:'private-other-chat',depth:'full'},purpose:'Inspect'}],{snapshot:{definitions:[{definitionId:'d',version:1,purpose:'Actual work'}]}});
 assert.equal(facts[0].content[0].purpose,'Actual work');
 assert.equal(facts[1].available,false);
});
test('target deliverables retain full contents without intermediate trace',()=>{
 assert.equal(typeof window.OvllPointerLocalActions.deliver,'function');
 const text='Long result '.repeat(1000);
 const output=window.OvllPointerLocalActions.deliver({targets:['b'],nodes:[
  {nodeId:'a',status:'success',outputs:{values:{result:{inline:'Intermediate private trace'}}}},
  {nodeId:'b',status:'success',outputs:{values:{result:{inline:text}}}}]});
 assert.equal(output,text);
});
test('coordinator reads and reassesses blocked work within a bounded loop',async()=>{
 assert.equal(typeof window.OvllPointerLocalActions.coordinate,'function');
 let calls=0,runs=0;
 const result=await window.OvllPointerLocalActions.coordinate({
  getContext:async()=>({snapshot:{graph:{graphId:'g'},definitions:[{definitionId:'d',purpose:'Actual'}]},history:[],runs:[]}),
  request:async({extraContext})=>{calls++;
   if(calls===1)return{needs:[{kind:'definition',selector:{scope:'ref',ref:'d',depth:'full'},purpose:'Inspect'}]};
   if(calls===2){assert.equal(extraContext.reads[0].content[0].purpose,'Actual');return{actions:[{localKey:'r',kind:'run.start'}]};}
   assert.equal(extraContext.actionResults[0].status,'waiting');return{message:'자료를 추가해줘.'};},
  handlers:{'run.start':async()=>{runs++;return{status:'waiting',run:{status:'waiting',nodes:[{nodeId:'n',status:'blocked',error:'Missing data'}]}};}}
 });
 assert.equal(calls,3);assert.equal(runs,1);assert.equal(result.messages[0],'자료를 추가해줘.');
});
test('coordinator never repeats file effects or the same unresolved read',async()=>{
 let calls=0;
 await window.OvllPointerLocalActions.coordinate({getContext:async()=>({snapshot:{definitions:[]}}),
  request:async()=>{calls++;return{actions:[{localKey:'r',kind:'run.start'}]};},
  handlers:{'run.start':async()=>({status:'waiting',run:{nodes:[{toolEffectStarted:true}]}})}});
 assert.equal(calls,1);
 calls=0;await window.OvllPointerLocalActions.coordinate({getContext:async()=>({snapshot:{definitions:[]}}),
  request:async()=>{calls++;return{needs:[{kind:'artifact',selector:{scope:'ref',ref:'absent',depth:'full'},purpose:'Read'}]};},handlers:{}});
 assert.equal(calls,2);
});
test('final presentation includes independent runs and concrete failures without a run',()=>{
 const a=window.OvllPointerLocalActions;
 assert.equal(typeof a.present,'function');
 const run=(id,text)=>({status:'completed',graphRef:{graphId:'g'},targets:[id],nodes:[{nodeId:id,status:'success',outputs:{values:{result:{inline:text}}}}]});
 const text=a.present({runs:[run('a','First requested output'),run('b','Second requested output')],messages:[],facts:[{kind:'function.run',status:'failed',error:'FUNCTION_INPUT_REQUIRED'}]});
 assert.match(text,/First requested output/);assert.match(text,/Second requested output/);assert.match(text,/새 입력/);
 const revised=a.present({runs:[run('a','Old output'),run('b','Independent output'),run('a','Corrected output')],facts:[],messages:[]});
 assert.doesNotMatch(revised,/Old output/);assert.match(revised,/Independent output/);assert.match(revised,/Corrected output/);
});
test('asking a question waits for real input and blocks dependent execution',async()=>{
 const a=window.OvllPointerLocalActions;assert.equal(typeof a.question,'function');let runs=0,calls=0;
 const result=await a.coordinate({getContext:async()=>({snapshot:{definitions:[]}}),request:async()=>{calls++;return {actions:[{localKey:'q',kind:'question.ask',args:{question:'어떤 자료를 쓸까?'}},{localKey:'r',kind:'run.start',dependsOn:['q']}]};},
  handlers:{'question.ask':async action=>a.question(action),'run.start':async()=>{runs++;return{status:'completed'};}}});
 assert.equal(runs,0);assert.equal(calls,1);assert.equal(result.facts[0].status,'waiting');assert.equal(result.facts[1].status,'skipped');
 assert.match(a.present(result),/어떤 자료/);
});
test('conversation handoff cancels remaining actions before they can mutate another task',async()=>{
 const a=window.OvllPointerLocalActions;let active=true,ran=false;
 const facts=await a.execute([{localKey:'p',kind:'ir.applyPatch'},{localKey:'r',kind:'run.start'}],{
  'ir.applyPatch':async()=>{active=false;return{status:'applied'};},'run.start':async()=>{ran=true;return{status:'completed'};}
 },{isActive:()=>active});
 assert.equal(ran,false);assert.equal(facts[1].status,'cancelled');
});
test('full reads can retrieve an ordinary Korean source omitted from planner preview',()=>{
 const text='가'.repeat(10000),a=window.OvllPointerLocalActions;
 const result=a.readNeeds([{kind:'value',selector:{scope:'ref',ref:'binding:n:in',depth:'full'},purpose:'Read source'}],{snapshot:{graph:{nodes:[{nodeId:'n',inputBindings:{in:text}}]}}});
 assert.equal(result[0].content,text);assert.equal(result[0].truncated,false);
});

test('an actionless promise is retried once and never presented as completed deletion',async()=>{
 const a=window.OvllPointerLocalActions;
 let calls=0,applied=0;
 const result=await a.coordinate({getContext:async()=>({snapshot:{graph:{graphId:'g'},definitions:[]}}),
  request:async({extraContext})=>{
   calls++;
   if(calls===1)return{message:'중복 정의를 삭제하도록 패치를 구성하겠습니다. 잠시만 기다려 주세요.'};
   assert.match(extraContext.actionCorrection,/no actions/);
   return{actions:[{localKey:'delete',kind:'ir.applyPatch',args:{}}]};
  },handlers:{'ir.applyPatch':async()=>{applied++;return{status:'applied'};}}});
 assert.equal(calls,2);
 assert.equal(applied,1);
 assert.deepEqual(Array.from(result.messages),[]);
 assert.match(a.present(result),/작업 구성을 반영/);
 assert.doesNotMatch(a.present(result),/기다려/);
});
test('repeated actionless deletion claims finish with truthful no-change message',async()=>{
 const a=window.OvllPointerLocalActions;let calls=0;
 const result=await a.coordinate({getContext:async()=>({snapshot:{graph:{graphId:'g'},definitions:[]}}),
  request:async()=>{calls++;return{message:'노드를 삭제했습니다. 잠시 기다려 주세요.'};},
  handlers:{'ir.applyPatch':async()=>{throw Error('must not run');}}});
 assert.equal(calls,3);
 assert.equal(result.facts.length,0);
 assert.match(a.present(result),/적용하지 못했어/);
 assert.doesNotMatch(a.present(result),/삭제했습니다|기다려 주세요/);
});

test('delivery selection is distinct from execution targets and excludes unrelated partial traces',()=>{
 const a=window.OvllPointerLocalActions;
 const n=(nodeId,value)=>({nodeId,status:'success',outputs:{values:{result:{inline:value}}}});
 assert.equal(a.deliver({status:'completed',targets:['a','b'],deliverableTargets:['b'],nodes:[n('a','Internal'),n('b','Final')]}),'Final');
 assert.equal(a.deliver({status:'waiting',targets:['b'],nodes:[n('a','Internal'),{nodeId:'b',status:'blocked'}]}),'');
});
test('coordinator retains output refs for follow-up and stores question checkpoint across turns',async()=>{
 const a=window.OvllPointerLocalActions;let calls=0,checkpoint;
 const run={runId:'r1',status:'waiting',targets:['n'],nodes:[{nodeId:'n',status:'success',outputs:{values:{result:{inline:'Actual previous output'}}},outputRefs:['local:r1:n:result']}]};
 const result=await a.coordinate({getContext:async()=>({snapshot:{graph:{graphId:'g',revision:2},definitions:[]}}),
  onCheckpoint:cp=>{checkpoint=cp;},
  request:async({extraContext})=>{calls++;
   if(calls===1)return {actions:[{localKey:'r',kind:'run.start'}]};
   assert.equal(extraContext.actionResults[0].run.nodes[0].outputs.values.result.inline,'Actual previous output');
   assert.equal(extraContext.actionResults[0].run.nodes[0].outputRefs[0],'local:r1:n:result');
   return {actions:[{localKey:'q',kind:'question.ask',args:{question:'Which source?',questionId:'q1'}}]};
  },handlers:{'run.start':async()=>({status:'waiting',run}),'question.ask':action=>a.question(action)}});
 assert.equal(calls,2);assert.equal(checkpoint.question,'Which source?');
 assert.equal(checkpoint.awaitingInput,true);assert.equal(result.checkpoint.questionId,'q1');
 assert.equal(checkpoint.actionResults[0].run.runId,'r1');
});
test('source metadata reports missing content and actual async source read discloses byte coverage',async()=>{
 const a=window.OvllPointerLocalActions;
 const context={snapshot:{graph:{nodes:[{nodeId:'f',settings:{file:{name:'notes.txt',localFileId:'id',textPreview:'Cached'}}}]}}};
 const needs=[{kind:'value',selector:{scope:'ref',ref:'file:f',depth:'full'}}];
 assert.equal(a.readNeeds(needs,context)[0].availability,'metadata_only');
 const reads=await a.readNeedsAsync(needs,context,{readSource:async()=>({status:'success',value:{text:'Actual',coverage:{start:0,end:6,totalBytes:12,truncated:true},availability:'local_bytes'}})});
 assert.equal(reads[0].content.text,'Actual');assert.equal(reads[0].truncated,true);
 assert.equal(reads[0].coverage.totalBytes,12);
});
test('partial source/export and unsaved results are disclosed while stale successes are not delivered as current',()=>{
 const a=window.OvllPointerLocalActions,n={nodeId:'a',status:'success',outputs:{values:{result:{inline:'Body'}}}};
 const run={status:'completed',targets:['a'],nodes:[n],coverage:{sourceTruncated:true,outputTruncated:true},storage:{status:'failed',error:'QUOTA'}};
 const text=a.present({runs:[run],facts:[{run}]});
 assert.match(text,/일부/);assert.match(text,/저장/);
 assert.equal(a.deliver({...run,nodes:[{...n,resultCurrent:false}]}),'');
 assert.match(a.present({runs:[{...run,nodes:[{...n,resultCurrent:false}],validity:{snapshotCurrent:false}}]}),/바뀌/);
});
test('function discovery excludes saved values while ref reads preserve full contracts',async()=>{
 const actions=window.OvllPointerLocalActions;
 assert.equal(typeof actions.functionIndex,'function');
 const functions=Array.from({length:30},(_,i)=>({id:'fn_'+i,version:1,purpose:'Review evidence '+i,
  inputs:[{name:'in',representation:'text'}],outputs:[{name:'out',representation:'text'}],invariants:['Use sources'],
  fixedInputs:{'n:constant':'x'.repeat(22000)},inputMap:{in:{nodeId:'n',port:'in'}},presentation:{view:[{id:'n',params:{text:'x'.repeat(10000)}}]}}));
 const index=actions.functionIndex(functions);
 assert.equal(index.length,30);assert.ok(JSON.stringify(index).length<32000);
 assert.equal(index[0].fixedInputs,undefined);assert.equal(index[0].presentation,undefined);
 const read=actions.readNeeds([{kind:'contract',selector:{scope:'ref',ref:'fn_20',depth:'full'}}],{savedFunctions:functions});
 assert.equal(read[0].available,true);assert.equal(read[0].content[0].id,'fn_20');
});
test('language replies retain factual notices and optional function inputs stay optional',()=>{
 const actions=window.OvllPointerLocalActions;
 assert.equal(actions.functionIndex([{id:'f',version:1,purpose:'Test',inputs:[{name:'maybe',representation:'text'}]}])[0].inputs[0].required,false);
 assert.equal(typeof actions.withRunNotices,'function');
 const reply=actions.withRunNotices('Please provide the missing input',[{nodes:[],coverage:{sourceTruncated:true},storage:{status:'failed',error:'QUOTA'},validity:{snapshotCurrent:false}}]);
 assert.ok(reply.includes('Please provide the missing input'));assert.ok(reply.includes('원문 일부'));
 assert.ok(reply.includes('저장하지 못했어'));assert.ok(reply.includes('현재 결과로 사용할 수 없어'));
});
