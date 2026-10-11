import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {phaseWireContract} from '../backend/ovllPointer/modelContract.js';

const snapshot={graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]};
const record={requestDigest:'Make a report',responseDigest:'Explained the next step',sessionContext:'Preparing a report. Sources remain unresolved.',constraints:['Preserve exact citations']};
function fixture(responses){
 const calls=[];
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async call=>{calls.push(call);return {text:JSON.stringify(responses.shift()),providerCalls:1,usage:{total_tokens:5}};}}});
 return {host,calls};
}
function browser(files=['ovllPointerActivity.js']){
 const values=new Map(),window={},localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 for(const file of files)vm.runInNewContext(readFileSync(new URL('../front/js/'+file,import.meta.url),'utf8'),{window,localStorage,AbortController,console});
 return {window,localStorage};
}
test('ordinary response carries exit records separately from the unchanged action domain',async()=>{
 const {host,calls}=fixture([{message:'Please provide sources',...record}]);
 const additionalContext={recentTurns:[{requestDigest:'Start report',responseDigest:'Asked for scope'}],sessionContext:'A report is in progress.',constraints:['Preserve exact citations']};
 const result=await host.turn({snapshot,requestRef:'r',requestText:'Continue\nwith the report',additionalContext});
 assert.deepEqual(result._meta.contextRecord,record);
 assert.equal(result.requestDigest,undefined);
 const data=JSON.parse(calls[0].messages.at(-1).content);
 assert.deepEqual(data.extraContext.additionalContext,additionalContext);
 assert.equal(data.context.requestText,'Continue\nwith the report');
 assert.ok(data.extraContext.datasets.some(x=>x.kind==='history'));
 const instructions=calls[0].messages.map(x=>x.content).join('\n');
 assert.match(instructions,/CORRIDOR/);
 assert.doesNotMatch(instructions,/# DEFINE/);
 assert.doesNotMatch(instructions,/# EXTRACT/);
});
test('unselected action families stay out of initial canonical and wire prompts',async()=>{
 for(const structuredOutput of [false,true]){
  const calls=[],responses=[
   {needs:[{kind:'contract',selector:{scope:'ref',ref:'prompt:action.definitions',depth:'full'},purpose:'Need custom node contract'}]},
   {message:'Ready for the custom definition'}
  ];
  const wire=output=>({contract:'action-plan.v1',executionIntent:null,message:output.message??null,
   actions:[],needs:(output.needs||[]).map(({selector,...n})=>({...n,selectorJson:JSON.stringify(selector)})),
   taskContext:null,requestDigest:null,responseDigest:null,sessionContext:null,constraints:null,supersededConstraints:null});
  const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),
   gateway:{capabilities:()=>({structuredOutput}),complete:async request=>{calls.push(request);
    const next=responses.shift();return {text:JSON.stringify(structuredOutput?wire(next):next),providerCalls:1};}}});
  const output=await host.turn({snapshot,requestRef:'select_'+structuredOutput,requestText:'Define a new kind'});
  assert.equal(calls.length,2,'only one detailed module retrieval');
  const initial=calls[0].messages.map(x=>x.content).join('\n');
  const detailed=calls[1].messages.map(x=>x.content).join('\n');
  assert.match(initial,/prompt:action\.definitions/);
  assert.doesNotMatch(initial,/## action\.definitions/);
  assert.doesNotMatch(initial,/# SELECTED EXAMPLES/);
  assert.match(detailed,/## action\.definitions/);
  assert.match(detailed,/node\.define requires alias/);
  assert.doesNotMatch(detailed,/## action\.nodes/);
  assert.doesNotMatch(detailed,/## action\.functions/);
  assert.ok(detailed.length>initial.length);
  assert.ok(output._meta.selectedModules.includes('action.definitions'));
  assert.ok(!output._meta.selectedModules.includes('action.nodes'));
 }
});
test('simple direct chat never receives the full action repertoire',async()=>{
 const {host,calls}=fixture([{message:'Hello'}]);
 await host.turn({snapshot,requestRef:'chat_short',requestText:'Hello'});
 const content=calls[0].messages.map(x=>x.content).join('\n');
 assert.match(content,/# ACTION DIRECTORY/);
 assert.doesNotMatch(content,/# SELECTED ACTION CONTRACTS/);
 assert.doesNotMatch(content,/# SELECTED EXAMPLES/);
});
test('model selects detail modules through existing needs without a word-based intent classifier',async()=>{
 const {host,calls}=fixture([{needs:[{kind:'contract',selector:{scope:'ref',ref:'prompt:ir.define',depth:'full'},purpose:'Read the dynamic definition contract'}]},{message:'Definition contract read',...record}]);
 const result=await host.turn({snapshot,requestRef:'r',requestText:'Design my reusable task'});
 assert.equal(calls.length,2);
 assert.doesNotMatch(calls[0].messages.map(x=>x.content).join('\n'),/# DEFINE/);
 assert.match(calls[1].messages.map(x=>x.content).join('\n'),/# DEFINE/);
 assert.doesNotMatch(calls[1].messages.map(x=>x.content).join('\n'),/# EXTRACT/);
 assert.equal(result._meta.providerCalls,2);
 assert.equal(result._meta.usage.total_tokens,10);
});
test('response wire includes context records while malformed records cannot invalidate a useful message',async()=>{
 const schema=phaseWireContract('response').schema;
 for(const key of ['message','requestDigest','responseDigest','sessionContext','constraints'])assert.ok(schema.properties[key]);
 const {host}=fixture([{message:'Useful response',...record,constraints:'invalid'}]);
 const result=await host.response({snapshot,requestRef:'r',requestText:'Explain',actionResults:[]});
 assert.equal(result.message,'Useful response');
 assert.equal(result._meta.contextRecord,null);
});
test('recent context keeps two compressed exchanges and retains previous context when exit is missing',()=>{
 const api=browser().window.OvllPointerActivity;
 let context=null;
 for(let i=1;i<=3;i++)context=api.updateAdditionalContext(context,{...record,requestDigest:'request '+i,responseDigest:'response '+i},{requestText:'raw '+i,responseText:'actual '+i});
 assert.deepEqual(JSON.parse(JSON.stringify(context.recentTurns)).map(x=>x.requestDigest),['request 2','request 3']);
 const failed=api.updateAdditionalContext(context,null,{requestText:'Execute',responseText:'Actual result'});
 assert.equal(failed.sessionContext,record.sessionContext);
 assert.deepEqual(JSON.parse(JSON.stringify(failed.constraints)),record.constraints);
 assert.equal(failed.pendingTurns.length,1);
 const input=api.additionalContextInput(failed);
 assert.equal(input.pendingTurns,undefined,'uncompressed exchanges are retrieved through history needs');
 assert.equal(input.pendingCount,1);
 assert.equal(input.complete,false);
});
test('forgotten conditions survive compressed EXIT records without a summary-model call',()=>{
 const api=browser().window.OvllPointerActivity;
 const prior=api.updateAdditionalContext(null,{...record,constraints:['Use informal Korean','Keep answers short','Preserve 12 source citations']});
 const compressed=api.updateAdditionalContext(prior,{...record,requestDigest:'Answer follow-up',responseDigest:'Answered',constraints:[]});
 assert.deepEqual(JSON.parse(JSON.stringify(compressed.constraints)),['Use informal Korean','Keep answers short','Preserve 12 source citations']);
 assert.equal(compressed.recentTurns.length,2);
});
test('explicit supersession retires only exact previous conditions',()=>{
 const api=browser().window.OvllPointerActivity;
 const prior=api.updateAdditionalContext(null,{...record,constraints:['Use informal Korean','Keep answers short']});
 const updated=api.updateAdditionalContext(prior,{...record,constraints:['Use formal Korean'],supersededConstraints:['Use informal Korean']});
 assert.deepEqual(JSON.parse(JSON.stringify(updated.constraints)),['Keep answers short','Use formal Korean']);
 const invented=api.updateAdditionalContext(updated,{...record,supersededConstraints:['Unrecorded rule']},{requestRef:'history:2',responseRef:'history:3'});
 assert.deepEqual(JSON.parse(JSON.stringify(invented.constraints)),JSON.parse(JSON.stringify(updated.constraints)));
 assert.equal(invented.pendingTurns.length,1);
});
test('invalid supersession preserves useful message but does not corrupt the context record',async()=>{
 const {host}=fixture([{message:'Actual answer',...record,supersededConstraints:'drop everything'}]);
 const result=await host.response({snapshot,requestRef:'r',requestText:'Continue'});
 assert.equal(result.message,'Actual answer');
 assert.equal(result._meta.contextRecord,null);
});
test('context records survive export/import and failed persistence rolls back the memory update',()=>{
 const {window,localStorage}=browser(['workspaceStore.js','ovllPointerActivity.js']);
 const store=window.OvllWorkspaceStore,id=store.getActiveConversation().id;
 const context=window.OvllPointerActivity.updateAdditionalContext(null,record,{requestText:'raw',responseText:'actual'});
 store.updateConversationPointerContext(id,context);
 const exported=store.exportJSON();store.reset();store.importJSON(exported);
 assert.equal(store.getConversation(id).state.pointerContext.sessionContext,record.sessionContext);
 localStorage.setItem=()=>{throw Error('QUOTA');};
 assert.throws(()=>store.updateConversationPointerContext(id,{...context,sessionContext:'new'}));
 assert.equal(store.getConversation(id).state.pointerContext.sessionContext,record.sessionContext);
});
test('original history remains readable by reference without returning only compressed context',()=>{
 const api=browser(['ovllPointerLocalActions.js']).window.OvllPointerLocalActions;
 const history=['user: original exact request','assistant: original full response'];
 const read=api.readNeeds([{kind:'history',selector:{scope:'ref',ref:'history:1',depth:'full'},purpose:'Recover the original response'}],{snapshot,history});
 assert.equal(read[0].content,history[1]);
 assert.equal(read[0].truncated,false);
});
test('coordinator passes compressed context but exposes raw history only through reads',async()=>{
 const api=browser(['ovllPointerLocalActions.js']).window.OvllPointerLocalActions,calls=[];
 const result=await api.coordinate({getContext:async()=>({snapshot,history:['raw source'],additionalContext:{sessionContext:'In progress',recentTurns:[],constraints:[]}}),
 request:async input=>{calls.push(input);return {message:'Actual explanation',_meta:{contextRecord:record}};},handlers:{}});
 assert.equal(calls[0].history,undefined);
 assert.equal(calls[0].additionalContext.sessionContext,'In progress');
 assert.equal(calls[0].extraContext.historyIndex[0].ref,'history:0');
 assert.deepEqual(JSON.parse(JSON.stringify(result.contextRecord)),record);
});
test('local history references remain stable beyond the old twelve-message window',()=>{
 const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('  function recentAiConversation('),source.indexOf('  function likelyWorkflowRequest('));
 const state={messages:Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',text:'original '+i}))};
 const read=new Function('state',fragment+';return recentAiConversation;')(state);
 assert.equal(read(undefined,true).length,30);
 assert.equal(read(undefined,true)[0].text,'original 0');
 assert.equal(read().length,12,'other existing consumers keep their previous behavior');
});
test('pending context is cleared only after its exact original references are read',async()=>{
 const api=browser(['ovllPointerLocalActions.js']).window.OvllPointerLocalActions;
 let calls=0;
 const result=await api.coordinate({getContext:async()=>({snapshot,history:['user: action','assistant: actual result'],additionalContext:{pendingRefs:['history:0','history:1']}}),
 request:async()=>++calls===1?{needs:[{kind:'history',selector:{scope:'current',depth:'full'},purpose:'Recover pending facts'}]}:{message:'Explained result',_meta:{contextRecord:record}},handlers:{}});
 assert.equal(result.pendingCovered,true);
 const activity=browser().window.OvllPointerActivity;
 const previous=activity.updateAdditionalContext(null,null,{requestRef:'history:0',responseRef:'history:1'});
 assert.equal(activity.updateAdditionalContext(previous,record).pendingTurns.length,1);
 assert.equal(activity.updateAdditionalContext(previous,record,{pendingCovered:true}).pendingTurns.length,0);
});
test('selected continuation task conditions reach existing action handlers',async()=>{
 const {host}=fixture([{executionIntent:'requested',actions:[{localKey:'run',kind:'run.start',args:{targets:[{nodeId:'n'}],damMode:'closed'}}],taskContext:{objective:'Repeat the report',constraints:['Never include URLs']}}]);
 const state={graph:{graphId:'g',revision:0,nodes:[{nodeId:'n',definitionRef:{definitionId:'builtin:write',version:1},settings:{request:'Write report'},inputBindings:{}}],connections:[]},definitions:[]};
 const proposal=await host.turn({snapshot:state,requestRef:'r',requestText:'Run it again',additionalContext:{recentTurns:[],sessionContext:'A report is in progress.',constraints:['Never include URLs']}});
 const api=browser(['ovllPointerLocalActions.js']).window.OvllPointerLocalActions;let task=null,executed;
 await api.coordinate({getContext:async()=>({snapshot:state}),request:async()=>proposal,onTaskContext:value=>{task=value;},handlers:{'run.start':async()=>{executed=task;return {status:'completed'};}}});
 assert.deepEqual(JSON.parse(JSON.stringify(executed)),{objective:'Repeat the report',constraints:['Never include URLs']});
});
test('mixed module and data needs preserve reads and selected modules across requests',async()=>{
 const {host,calls}=fixture([{needs:[{kind:'contract',selector:{scope:'ref',ref:'prompt:ir.define',depth:'full'},purpose:'Definition details'},{kind:'history',selector:{scope:'ref',ref:'history:0',depth:'full'},purpose:'Exact prior request'}]},{message:'Read both',...record}]);
 const first=await host.turn({snapshot,requestRef:'r',requestText:'Continue'});
 assert.equal(calls.length,1);assert.equal(first.needs.length,1);assert.equal(first.needs[0].kind,'history');
 await host.turn({snapshot,requestRef:'r',requestText:'Continue',extraContext:{selectedModules:first._meta.selectedModules,reads:[{kind:'history',available:true,content:'Original'}]}});
 assert.match(calls[1].messages.map(m=>m.content).join('\n'),/# DEFINE/);
 assert.equal(JSON.parse(calls[1].messages.at(-1).content).extraContext.reads[0].content,'Original');
});
test('module selection shares the existing single correction and physical call budget',async()=>{
 let calls=0;
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async()=>({text:++calls%2?'invalid':JSON.stringify({needs:[{kind:'contract',selector:{scope:'ref',ref:'prompt:ir.define',depth:'full'},purpose:'Details'}]}),providerCalls:2})}});
 await assert.rejects(host.turn({snapshot,requestRef:'r',requestText:'Continue'}),error=>error._meta.providerCalls<=6&&error._meta.repairCount===1);
 assert.equal(calls,3);
});
test('oversized rolling UTF-8 context retains prior conditions and uses raw references',async()=>{
 const api=browser().window.OvllPointerActivity;
 const long={requestDigest:'가'.repeat(2200),responseDigest:'나'.repeat(2200),sessionContext:'Preparing report.',constraints:['Preserve exact citations']};
 const first=api.updateAdditionalContext(null,long);
 const second=api.updateAdditionalContext(first,long,{requestRef:'history:2',responseRef:'history:3'});
 assert.equal(second.recentTurns.length,1);assert.equal(second.pendingTurns.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(second.constraints)),long.constraints);
 const {host}=fixture([{message:'Continue',...record}]);
 await host.turn({snapshot,requestRef:'r',requestText:'Continue',additionalContext:api.additionalContextInput(second)});
});
test('later unrelated reads do not erase pending history coverage',async()=>{
 const api=browser(['ovllPointerLocalActions.js']).window.OvllPointerLocalActions;let calls=0;
 const result=await api.coordinate({getContext:async()=>({snapshot,history:['user: original','assistant: result'],additionalContext:{pendingRefs:['history:0','history:1']}}),request:async()=>++calls===1?{needs:[{kind:'history',selector:{scope:'current',depth:'full'},purpose:'Original'}]}:calls===2?{needs:[{kind:'definition',selector:{scope:'current',depth:'full'},purpose:'Definition'}]}:{message:'Done',_meta:{contextRecord:record}},handlers:{}});
 assert.equal(result.pendingCovered,true);
});
test('saved-function action execution receives chosen conditions together with fixed invariants',async()=>{
 const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
 const start=source.indexOf('  async function runSavedLocalFunction('),end=source.indexOf('  async function runLocalPrompt(',start);
 let executed;
 const run=new Function('global','runLocalNodes',source.slice(start,end)+';return runSavedLocalFunction;')({OvllPointerFunctions:{bind:()=>({snapshot,targets:[],requestText:'Fresh inputs',invariants:['Use approved source']})}},async value=>{executed=value;});
 await run({purpose:'Reusable report'},{},{objective:'Repeat report',constraints:['Never include URLs']});
 assert.deepEqual(executed.taskConstraints,['Use approved source','Never include URLs']);
 assert.equal(executed.taskContext.objective,'Repeat report');
 await run({purpose:'Reusable report'},{});
 assert.deepEqual(executed.taskConstraints,['Use approved source']);
});
test('dataset selection exposes file names and references without preloading contents',async()=>{
 const state={...snapshot,graph:{...snapshot.graph,nodes:[{nodeId:'file',definitionRef:{definitionId:'builtin:file',version:1},settings:{file:{name:'sources.txt',mime:'text/plain',textPreview:'EXACT PRIVATE SOURCE'}}}]}};
 const {host,calls}=fixture([{message:'Select source',...record}]);
 await host.turn({snapshot:state,requestRef:'r',requestText:'Use sources.txt'});
 const data=JSON.parse(calls[0].messages.at(-1).content),node=data.context.materials[0].content.graph.nodes[0];
 assert.equal(node.file.name,'sources.txt');assert.equal(node.file.ref,'file:file');
 assert.doesNotMatch(calls[0].messages.at(-1).content,/EXACT PRIVATE SOURCE/);
});
test('selected conditions must fit existing task persistence before actions are admitted',async()=>{
 const response={actions:[{localKey:'cancel',kind:'run.cancel',args:{runRef:'run1'}}],taskContext:{objective:'Cancel report',constraints:Array.from({length:6},()=> 'Condition '+ 'x'.repeat(2190))}};
 const {host}=fixture([response,response]);
 await assert.rejects(host.turn({snapshot,requestRef:'r',requestText:'Cancel report'}),error=>error.code==='INVALID_MODEL_TURN'&&error.validationIssues[0].rule==='invalidTaskContext');
});
