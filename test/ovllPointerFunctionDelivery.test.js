import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
import * as results from '../front/js/ovllPointerResults.mjs';

const read=name=>readFileSync(new URL('../front/js/'+name,import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function setup(){
  const stored=new Map(),window={crypto:{randomUUID:()=> 'delivery'},
    localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)}};
  const state={pointerRuns:[]},workspaceStore={getConversation:()=>({state}),
    updateConversationPointerRuns:(_id,runs)=>{state.pointerRuns=runs},
    updateConversationPointerGraph:()=>{},getPointerDefinitions:()=>[]};
  window.OvllWorkspaceStore=workspaceStore;
  for(const name of ['ovllPointerFunctions.js','ovllPointerLocal.js','ovllPointerLocalActions.js'])
    vm.runInNewContext(read(name),{window,console});
  const local=window.createOvllPointerLocal({workspaceStore,loadCore:async()=>core,
    loadPlan:async()=>plan,loadResults:async()=>results});
  const app=read('app.js'),first=app.indexOf('async function runSavedLocalFunction(fn,bindings){'),
    last=app.indexOf('  async function runLocalPrompt(',first);
  const replay=(executeNode,options={})=>new Function('global','runLocalNodes',app.slice(first,last)+
    ';return runSavedLocalFunction;')(window,args=>local.run({...args,...options,conversationId:'c',executeNode}));
  return {window,state,local,replay};
}
const snapshot={graph:{graphId:'g_delivery',revision:1,nodes:[{
  nodeId:'writer',definitionRef:{definitionId:'d_writer',version:1},settings:{request:'Summarize'}}],connections:[]},
  definitions:[{definitionId:'d_writer',version:1,purpose:'Summarize',instruction:'Summarize faithfully',
    executorKind:'model_task',inputs:[],outputs:[
      {name:'report',representation:'text',required:false},
      {name:'notes',representation:'text',required:false}]}]};
const produced=values=>({status:'success',outputs:{status:'produced',values}});
const save=window=>window.OvllPointerFunctions.save({purpose:'Reusable summary',snapshot,targets:['writer'],
  outputs:[{name:'summary',representation:'text'}],outputMap:{summary:{nodeId:'writer',port:'report'}}});

test('saved replay returns only the declared public output and persists its exact source ref',async()=>{
  const {window,state,replay}=setup(),fn=save(window);
  const run=await replay(async()=>produced({report:{inline:'Final report'},notes:{inline:'Working notes'}}))(fn,{});
  assert.equal(run.status,'completed');
  assert.ok(run.functionOutputs);
  assert.deepEqual(plain(run.functionOutputs),{summary:{inline:'Final report'}});
  assert.equal(run.functionOutputRefs.summary,'local:'+run.runId+':writer:report');
  assert.deepEqual(plain(state.pointerRuns[0].functionOutputs),plain(run.functionOutputs));
  assert.equal(window.OvllPointerLocalActions.presentation({runs:[run]}).text,'summary: Final report');
  assert.equal(run.nodes[0].outputs.values.notes.inline,'Working notes');
});

test('a missing declared public output cannot be reported as a completed function',async()=>{
  const {window,replay}=setup(),fn=save(window);
  const run=await replay(async()=>produced({notes:{inline:'Only working notes'}}))(fn,{});
  assert.equal(run.status,'failed');
  assert.equal(run.deliveryError,'FUNCTION_OUTPUT_NOT_PRODUCED');
  assert.equal(run.coverage.complete,false);
  assert.deepEqual(plain(run.functionOutputs),{});
  const text=window.OvllPointerLocalActions.presentation({facts:[{run}],runs:[run]}).text;
  assert.doesNotMatch(text,/Only working notes|완료/);
});

test('invalid persisted output mappings fail before executor calls or run storage',async()=>{
  for(const outputMap of [{summary:{nodeId:'outside',port:'report'}},
    {summary:{nodeId:'writer',port:'missing'}},
    {summary:{nodeId:'writer',port:'report',unexpected:true}}]){
    const {window,state,replay}=setup(),fn=save(window);let calls=0;
    await assert.rejects(()=>replay(async()=>{calls++;return produced({report:{inline:'Result'}});})
      ({...fn,outputMap},{}),/FUNCTION_OUTPUT_MAPPING_REQUIRED/);
    assert.equal(calls,0);assert.equal(state.pointerRuns.length,0);
  }
});

test('public outputs can include dependency ports without leaking other sink ports',async()=>{
  const {window,replay}=setup();
  const graph=plain(snapshot);
  graph.graph.nodes.unshift({nodeId:'source',definitionRef:{definitionId:'d_source',version:1}});
  graph.definitions.push({definitionId:'d_source',version:1,purpose:'Read',instruction:'Read source',
    executorKind:'model_task',inputs:[],outputs:[{name:'evidence',representation:'text'}]});
  graph.definitions[0].inputs=[{name:'in',representation:'text',required:true}];
  graph.graph.connections.push({id:'data',kind:'data',from:{nodeId:'source',port:'evidence'},to:{nodeId:'writer',port:'in'}});
  const fn=window.OvllPointerFunctions.save({purpose:'Evidence and report',snapshot:graph,targets:['writer'],
    outputs:[{name:'evidence',representation:'text'},{name:'summary',representation:'text'}],
    outputMap:{evidence:{nodeId:'source',port:'evidence'},summary:{nodeId:'writer',port:'report'}}});
  const run=await replay(async step=>produced(step.nodeId==='source'?{evidence:{inline:'Actual evidence'}}:
    {report:{inline:'Final report'},notes:{inline:'Private scratch'}}))(fn,{});
  assert.ok(run.functionOutputs);
  assert.deepEqual(plain(run.functionOutputs),{evidence:{inline:'Actual evidence'},summary:{inline:'Final report'}});
  const text=window.OvllPointerLocalActions.presentation({runs:[run]}).text;
  assert.match(text,/evidence: Actual evidence/);assert.match(text,/summary: Final report/);
  assert.doesNotMatch(text,/Private scratch/);
});

test('selected artifact output keeps confirmed file cards and excludes unselected ports',()=>{
  const {window}=setup(),artifact={id:'pdf',name:'Report.pdf',downloadUrl:'/api/artifacts/pdf'};
  const run={status:'completed',targets:['writer'],outputMap:{document:{nodeId:'writer',port:'file'}},nodes:[{
    nodeId:'writer',status:'success',resultCurrent:true,toolEffectStarted:true,effectConfirmed:true,
    outputs:{values:{file:{inline:artifact},notes:{inline:'Internal notes'}}}}]};
  const delivered=window.OvllPointerLocalActions.presentation({runs:[run]});
  assert.deepEqual(plain(delivered.artifacts),[artifact]);assert.doesNotMatch(delivered.text,/Internal notes/);
  run.nodes[0].effectConfirmed=false;
  assert.deepEqual(plain(window.OvllPointerLocalActions.presentation({runs:[run]}).artifacts),[]);
});

test('legacy functions without output mappings retain ordinary target delivery',async()=>{
  const {window,replay}=setup(),fn=save(window);delete fn.outputMap;
  const run=await replay(async()=>produced({report:{inline:'Legacy report'},notes:{inline:'Legacy notes'}}))(fn,{});
  assert.equal(run.status,'completed');
  assert.equal(window.OvllPointerLocalActions.presentation({runs:[run]}).text,'Legacy report\n\nLegacy notes');
});

test('automatic output names do not expose internal node IDs in chat',async()=>{
  const {window,replay}=setup();
  const fn=window.OvllPointerFunctions.save({purpose:'Default outputs',snapshot,targets:['writer']});
  const run=await replay(async()=>produced({report:{inline:'Final report'},notes:{inline:'Notes'}}))(fn,{});
  assert.equal(window.OvllPointerLocalActions.presentation({runs:[run]}).text,'Final report\n\nNotes');
});

test('missing optional public outputs preserve successful partial delivery',async()=>{
  const {window,replay}=setup();
  const fn=window.OvllPointerFunctions.save({purpose:'Report with optional notes',snapshot,targets:['writer'],
    outputs:[{name:'summary',representation:'text',required:true},{name:'detail',representation:'text',required:false}],
    outputMap:{summary:{nodeId:'writer',port:'report'},detail:{nodeId:'writer',port:'notes'}}});
  const run=await replay(async()=>produced({report:{inline:'Final report'}}))(fn,{});
  assert.equal(run.status,'completed');assert.equal(run.coverage.complete,true);
  assert.deepEqual(plain(run.functionOutputs),{summary:{inline:'Final report'}});
});

test('an optional public output cannot stand in for a missing required output',async()=>{
  const {window,replay}=setup();
  const fn=window.OvllPointerFunctions.save({purpose:'Required report',snapshot,targets:['writer'],
    outputs:[{name:'summary',representation:'text',required:true},{name:'detail',representation:'text',required:false}],
    outputMap:{summary:{nodeId:'writer',port:'report'},detail:{nodeId:'writer',port:'notes'}}});
  const run=await replay(async()=>produced({notes:{inline:'Working notes'}}))(fn,{});
  assert.equal(run.status,'failed');assert.equal(run.coverage.complete,false);
});

test('revised required public outputs invalidate incomplete dependency history and cache reuse',async()=>{
  for(const sharedCache of [false,true]){
    const {window,replay}=setup(),graph=plain(snapshot),cache=new Map();
    graph.graph.nodes.unshift({nodeId:'source',definitionRef:{definitionId:'d_source',version:1}});
    graph.definitions.push({definitionId:'d_source',version:1,purpose:'Read',instruction:'Read source',
      executorKind:'model_task',inputs:[],outputs:[{name:'data',representation:'text',required:true},
        {name:'evidence',representation:'text',required:false}]});
    graph.definitions[0].inputs=[{name:'in',representation:'text',required:true}];
    graph.graph.connections.push({id:'data',kind:'data',from:{nodeId:'source',port:'data'},to:{nodeId:'writer',port:'in'}});
    const fn=window.OvllPointerFunctions.save({purpose:'Report',snapshot:graph,
      targets:sharedCache?['source','writer']:['writer'],outputs:[{name:'summary',representation:'text',required:true}],
      outputMap:{summary:{nodeId:'writer',port:'report'}}});
    let sourceCalls=0;
    const runSaved=replay(async step=>{
      if(step.nodeId==='writer')return produced({report:{inline:'Report'}});
      sourceCalls++;return produced({data:{inline:'Source'},...(sourceCalls>1?{evidence:{inline:'Verified evidence'}}:{})});
    },sharedCache?{cache}:{});
    assert.equal((await runSaved(fn,{})).status,'completed');
    const revised={...fn,outputs:[...fn.outputs,{name:'evidence',representation:'text',required:true}],
      outputMap:{...fn.outputMap,evidence:{nodeId:'source',port:'evidence'}}};
    const run=await runSaved(revised,{});
    assert.equal(sourceCalls,2);assert.equal(run.status,'completed');
    assert.equal(run.functionOutputs.evidence.inline,'Verified evidence');
  }
});

test('structured deliverables are readable while original typed outputs stay intact',()=>{
 const {window}=setup();
 const data={title:'초콜릿의 역사',overview:'문명별 기원과 전파',
  sections:[{title:'올메크 문명',content:'카카오를 음료로 활용'}],conclusion:'역사를 이해할 수 있음'};
 const run={status:'completed',targets:['writer'],nodes:[{
  nodeId:'writer',status:'success',resultCurrent:true,outputs:{values:{result:{inline:data}}}
 }]};
 const message=window.OvllPointerLocalActions.presentation({runs:[run]}).text;
 assert.match(message,/# 초콜릿의 역사/);
 assert.match(message,/## 개요\n\n문명별 기원과 전파/);
 assert.match(message,/## 올메크 문명\n\n카카오를 음료로 활용/);
 assert.match(message,/## 결론\n\n역사를 이해할 수 있음/);
 assert.doesNotMatch(message,/\{"title":/);
 assert.deepEqual(plain(run.nodes[0].outputs.values.result.inline),data);
});
test('mixed graph patch failures do not claim unqualified completion',()=>{
 const {window}=setup();
 const message=window.OvllPointerLocalActions.presentation({facts:[
  {kind:'ir.applyPatch',status:'failed',error:'NODE_HAS_LINKS'},
  {kind:'ir.applyPatch',status:'applied'}
 ]}).text;
 assert.match(message,/NODE_HAS_LINKS/);
 assert.match(message,/작업 구성 일부만 반영했어/);
 assert.doesNotMatch(message,/^작업 구성을 반영했어\.$/m);
});
