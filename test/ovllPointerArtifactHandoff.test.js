import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
function fragment(start,end){
  const offset=source.indexOf(start),finish=source.indexOf(end,offset);
  assert.ok(offset>=0&&finish>offset,'actual app function boundaries must exist');
  return source.slice(offset,finish);
}
const appFunctions=[
  fragment('  let localRunActive=null;','  function getPointerTask('),
  fragment('  async function runSavedLocalFunction(','  async function runPointerPrompt('),
  fragment('  async function runPointerCanvasNode(','  async function runPrompt(')
].join('\n');
const artifact={id:'actual-pdf',localFileId:'saved-pdf',name:'report.pdf',format:'PDF',
  mime:'application/pdf',size:3250,renderer:'pdfkit',targetPages:2,previewKind:'pdf',
  previewText:'Complete report',downloadUrl:'/api/artifacts/actual-pdf',
  previewUrl:'/api/artifacts/actual-pdf?inline=1',
  availability:{localBytes:true,durable:true,remoteUrl:true},coverage:{complete:true}};
const run={runId:'actual-run',status:'completed',graphRef:{graphId:'g_a'},targets:['export'],
  deliverableTargets:['export'],nodes:[{nodeId:'export',status:'success',resultCurrent:true,
    toolEffectStarted:true,effectConfirmed:true,outputs:{status:'produced',values:{artifact:{inline:artifact}}}}]};

function harness(){
  const window={};
  for(const name of ['ovllPointerLocalActions','ovllPointerActivity'])
    vm.runInNewContext(readFileSync(new URL('../front/js/'+name+'.js',import.meta.url),'utf8'),{window,AbortController,console});
  const messages=[],errors=[],executions=[],bindings=[],fileNodes=[],noop=()=>{};
  const task={objective:'Export report',requestText:'Export report',constraints:[]};
  const snapshot={graph:{graphId:'g_a',revision:1,nodes:[]},definitions:[]};
  const fn={id:'saved-function',purpose:'Export report',inputs:[{name:'in',representation:'text'}]};
  window.OvllPointerLocal={
    state:async()=>({graph:snapshot}),
    run:async options=>{executions.push(options);options.onProgress(run);return run;},
    readSource:async()=>{throw Error('unexpected source read');}
  };
  window.OvllPointerFunctions={list:()=>[fn],get:()=>fn,
    bind:(_fn,inputs)=>{bindings.push(inputs);return{snapshot,targets:['export'],requestText:'Export report',invariants:[]};}};
  const state={destroyed:false,busy:false,runtimeActivity:{order:[]},
    canvas:{getNode:id=>({id})}};
  const sandbox={global:window,AbortController,console,state,
    localOperations:window.OvllPointerActivity.createOperations({getConversationId:()=> 'a'}),
    pointerScope:()=>({storageMode:'local',conversationId:'a'}),getPointerTask:()=>task,
    PointerActivity:window.OvllPointerActivity,
    WorkspaceStore:{getConversation:()=>({state:{pointerRuns:[]}}),
      updateConversationPointerTask:noop,updateConversationPointerQuestion:noop},
    PointerAPI:{localTurn:async()=>({actions:[{localKey:'run',kind:'run.start',args:{targets:[{nodeId:'export'}]}}]}),
      localResponse:async()=>{throw Error('successful artifact must not request language inference');}},
    addAssistantMessage:(text,options={})=>messages.push({text,options}),
    ensureArtifactFileNode:(nodeId,file)=>fileNodes.push({nodeId,file}),
    flushPointerCanvasEdit:async nodeId=>nodeId,
    showErrorNotice:error=>errors.push(error),setBusy:value=>{state.busy=value;},
    composerInput:{value:''},Presence:{thinking:noop,settle:noop},runPresence:{reset:noop},
    recentAiConversation:()=>[],userFacingError:error=>error.message};
  for(const name of ['addUserMessage','resizeComposer','scheduleComposerDraftSave','beginRuntimeActivity',
    'upsertRuntimeStep','pointerActionStarted','pointerActionResult','showLocalRun','pointerNodeProgress',
    'finishRuntimeActivity','focusComposerForDesktop','scheduleWorkspaceSave'])sandbox[name]=noop;
  vm.runInNewContext(appFunctions+'\nthis.prompt=runLocalPrompt;this.canvas=runPointerCanvasNode;',sandbox);
  return {sandbox,messages,errors,executions,bindings,fileNodes};
}

function assertCard(h){
  assert.deepEqual(h.errors,[],'app execution must reach message handoff');
  assert.equal(h.messages.length,1);
  assert.ok(Array.isArray(h.messages[0].options.artifacts),'app must hand actual artifacts to existing message renderer');
  assert.deepEqual(JSON.parse(JSON.stringify(h.messages[0].options.artifacts)),[artifact]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.fileNodes)),[{nodeId:'export',file:artifact}],
    'the same verified artifact must reach the canvas as well as the chat');
  assert.doesNotMatch(h.messages[0].text,/\/api\/artifacts\/|\]\(/);
}

test('general local prompt hands confirmed file metadata to existing message cards',async()=>{
  const h=harness();await h.sandbox.prompt('Export the report as PDF');assertCard(h);
  assert.deepEqual(Array.from(h.executions[0].targets),['export']);
});
test('saved function command hands confirmed file metadata to existing message cards',async()=>{
  const h=harness();await h.sandbox.prompt('/함수실행 1 New evidence');assertCard(h);
  assert.deepEqual(JSON.parse(JSON.stringify(h.bindings)),[{in:'New evidence'}]);
});
test('canvas local execution hands confirmed file metadata to existing message cards',async()=>{
  const h=harness();await h.sandbox.canvas('export');assertCard(h);
  assert.deepEqual(Array.from(h.executions[0].targets),['export']);
});
