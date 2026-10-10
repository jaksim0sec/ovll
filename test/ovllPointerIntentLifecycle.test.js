import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const app=read('front/js/app.js');

test('configured local Pointer never falls back to legacy because a readiness probe failed',()=>{
  const begin=app.indexOf('function pointerScope(){');
  const end=app.indexOf('  async function refreshPointerCanvas',begin);
  assert.ok(begin>=0&&end>begin);
  let conversation={state:{pointerGraph:{graph:{graphId:'g_c1'}}}};
  const window={OVLL_RUNTIME:{pointerEnabled:true,pointerStorageMode:'local'},
    OvllPointerProjection:{},OvllPointerLocal:{graphId:id=>'g_'+id}};
  const state={pointerLocalReady:false};
  const store={getConversation:()=>conversation};
  const get=new Function('global','state','WorkspaceStore','currentConversationId','PointerAPI',
    app.slice(begin,end)+'\nreturn pointerScope;');
  const scope=()=>get(window,state,store,()=>'c1',{})();
  assert.equal(scope().graphId,'g_c1');
  conversation={state:{canvas:{workflow:{nodes:[]}}}};
  assert.equal(scope().storageMode,'local');
  conversation={state:{canvas:{workflow:{nodes:[{id:'legacy',type:'write'}]}}}};
  assert.equal(scope().storageMode,'local','legacy graph remains Pointer-owned during migration');
  conversation={state:{pointerGraph:{graph:{graphId:'g_c1'}},canvas:{workflow:{nodes:[{type:'pointer:d_custom:1'}]}}}};
  assert.equal(scope().storageMode,'local');
  window.OVLL_RUNTIME.pointerEnabled=false;
  assert.equal(scope(),null);
});

test('a saved dynamic node loads without the remote catalog',async()=>{
  const saved={graph:{graphId:'g_c1',revision:1,nodes:[{
    nodeId:'n1',definitionRef:{definitionId:'d_vocab',version:1},settings:{request:'일본어 단어장'}
  }],connections:[]},definitions:[{definitionId:'d_vocab',version:1,purpose:'단어장',
    executorKind:'model_task',instruction:'일본어 어휘',inputs:[],
    outputs:[{name:'result',representation:'text'}]}]};
  const store={getConversation:id=>id==='c1'?{state:{pointerGraph:saved}}:null,
    updateConversationPointerGraph(){},updateConversationPointerRuns(){}};
  const window={OvllWorkspaceStore:store};
  vm.runInNewContext(read('front/js/ovllPointerLocal.js'),{window,console});
  const local=window.createOvllPointerLocal({workspaceStore:store,
    loadCore:()=>import('../front/js/ovllPointerGraphCore.mjs'),
    loadCatalog:async()=>{throw new Error('OFFLINE_CATALOG');}});
  const result=await local.state('c1');
  assert.equal(result.graph.graph.nodes[0].nodeId,'n1');
  assert.equal(result.graph.definitions[0].definitionId,'d_vocab');
});

test('Pointer coordinator reports actual action start, completion and dependent skip',async()=>{
  const window={};
  vm.runInNewContext(read('front/js/ovllPointerLocalActions.js'),{window,console});
  const events=[];
  const result=await window.OvllPointerLocalActions.execute([
    {localKey:'new',kind:'ir.applyPatch'},
    {localKey:'run',kind:'run.start',dependsOn:['new']}
  ],{'ir.applyPatch':async()=>({status:'failed',error:'PATCH_REJECTED'}),
    'run.start':async()=>{throw Error('must not execute');}},{
    onActionStart:a=>events.push(['start',a.localKey]),
    onActionResult:(a,fact)=>events.push(['result',a.localKey,fact.status])
  });
  assert.deepEqual(Array.from(result,x=>x.status),['failed','skipped']);
  assert.equal(JSON.stringify(events),JSON.stringify([
    ['start','new'],['result','new','failed'],['result','run','skipped']]));
});

test('Pointer user-facing steps track action boundaries, real nodes, and lifecycle',()=>{
  assert.match(app,/onActionStart:action=>\{if\(owns\(\)\)pointerActionStarted\(action\)/);
  assert.match(app,/onActionResult:\(action,fact\)=>\{if\(owns\(\)\)pointerActionResult\(action,fact\)/);
  assert.match(app,/pointerNodeProgress\(run\)/);
  assert.match(app,/upsertRuntimeStep\('__thinking__','생각 완료','done'\)/);
  assert.match(app,/finishRuntimeActivity\(\{removeImmediately:!state\.runtimeActivity\?\.order\?\.length\}\)/);
  assert.match(app,/POINTER_WORKSPACE_UNAVAILABLE/);
  assert.match(app,/POINTER_WORKSPACE_UNAVAILABLE/);
  const entry=read('instructions/prompts/layers/entry.md');
  const define=read('instructions/prompts/micro/ir/define.md');
  const contract=read('backend/ovllPointer/modelContract.js');
  assert.match(entry,/new kind of node/);
  assert.match(define,/builtin:write/);
  assert.match(contract,/definitionRef/);
});
