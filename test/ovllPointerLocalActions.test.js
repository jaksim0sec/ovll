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
