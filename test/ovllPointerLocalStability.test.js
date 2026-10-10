import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function harness({values=new Map(),fileStore}={}){
 let writes=0;
 const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{writes++;values.set(k,v);}};
 const window={crypto:{randomUUID:()=>Math.random().toString(36).slice(2)},localStorage:storage};
 const ctx={window,localStorage:storage,console,Blob,TextDecoder};
 vm.runInNewContext(read('front/js/workspaceStore.js'),ctx);
 vm.runInNewContext(read('front/js/ovllPointerLocal.js'),ctx);
 const store=window.OvllWorkspaceStore;
 const local=window.createOvllPointerLocal({workspaceStore:store,fileStore,loadCore:async()=>core,loadPlan:async()=>plan,
  loadResults:()=>import('../front/js/ovllPointerResults.mjs')});
 return {store,local,window,values,get writes(){return writes;}};
}
const model={definitionId:'m',version:1,purpose:'Work',instruction:'Use bytes',executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]};
const file={definitionId:'f',version:1,purpose:'Read',instruction:'Read',executorKind:'tool_task',requiredCapabilities:['file.read_local'],inputs:[],outputs:[{name:'file',representation:'json'}]};
const node=(nodeId,def='m',settings={})=>({nodeId,definitionRef:{definitionId:def,version:1},settings});
const snapshot=(nodes,connections=[],definitions=[model,file])=>({definitions,graph:{graphId:'test',revision:1,nodes,connections}});
const ok=text=>({status:'success',outputs:{status:'produced',values:{result:{inline:text}}},_meta:{provider:'fixed',model:'offline',usage:{outputTokens:2},calls:1}});
test('metadata and cached preview never substitute for local bytes',async()=>{
 const h=harness({fileStore:{getBlob:async()=>null}}),id=h.store.getActiveConversation().id;
 const run=await h.local.run({conversationId:id,targets:['f'],snapshotOverride:snapshot([node('f','f',{file:{name:'notes.txt',localFileId:'lost',textPreview:'Pretend content'}})])});
 assert.equal(run.status,'waiting');assert.equal(run.nodes[0].error,'LOCAL_FILE_BYTES_UNAVAILABLE');
 assert.equal(run.nodes[0].outputs,undefined);
});
test('text reads actual bounded bytes with provenance and unsupported formats block',async()=>{
 const h=harness({fileStore:{getBlob:async()=>new Blob(['Actual bytes'],{type:'text/plain'})}}),id=h.store.getActiveConversation().id;
 const run=await h.local.run({conversationId:id,targets:['f'],maxSourceBytes:6,snapshotOverride:snapshot([node('f','f',{file:{name:'notes.txt',localFileId:'file-1',textPreview:'Wrong'}})])});
 const value=run.nodes[0].outputs.values.file.inline;
 assert.equal(value.text,'Actual');assert.equal(value.textTruncated,true);
 assert.equal(value.coverage.totalBytes,12);assert.equal(value.coverage.readBytes,6);
 assert.equal(value.provenance.localFileId,'file-1');
 const pdf=await h.local.run({conversationId:id,targets:['f'],snapshotOverride:snapshot([node('f','f',{file:{name:'paper.pdf',mime:'application/pdf',localFileId:'file-1'}})])});
 assert.equal(pdf.nodes[0].error,'LOCAL_FILE_PARSER_UNAVAILABLE');
});
test('terminal cancellation normalizes pending nodes and keeps callbacks separate from durable writes',async()=>{
 const h=harness(),id=h.store.getActiveConversation().id,c=new AbortController();
 const before=h.writes;
 const run=await h.local.run({conversationId:id,targets:['a','b','c'],snapshotOverride:snapshot(['a','b','c'].map(x=>node(x))),signal:c.signal,
  executeNode:async()=>{c.abort();return ok('late');}});
 assert.equal(run.status,'cancelled');assert.ok(run.nodes.every(n=>n.status==='cancelled'));
 assert.ok(h.writes-before<=2);
});
test('deliverable coverage requires all active intended targets and records model context and metadata',async()=>{
 const h=harness(),id=h.store.getActiveConversation().id,taskContext={objective:'Original',requestText:'Current',constraints:['Keep details'],historyDigest:'Earlier'};
 const run=await h.local.run({conversationId:id,targets:['a','b'],deliverableTargets:['b'],snapshotOverride:snapshot([node('a'),node('b')]),taskContext,
 executeNode:async args=>{assert.deepEqual(args.taskContext,taskContext);return ok(args.nodeId);}});
 assert.deepEqual(Array.from(run.executionScope),['a','b']);assert.deepEqual(Array.from(run.deliverableTargets),['b']);
 assert.equal(run.coverage.complete,true);assert.equal(run.nodes[0].execution.model,'offline');
 assert.ok(run.nodes[0].semanticFingerprint);assert.equal(run.snapshot.graph.revision,1);
});
test('workspace detects sequential stale-tab writes without losing committed data',()=>{
 const a=harness(),id=a.store.getActiveConversation().id;
 a.store.updateConversationDraft(id,'Initial');
 const b=harness({values:a.values}),errors=[];b.store.on('error',e=>errors.push(e));
 a.store.updateConversationDraft(id,'From first tab');
 b.store.updateConversationDraft(id,'Stale second tab');
 assert.equal(JSON.parse(a.values.get(a.store.storageKey)).conversations[0].state.composerDraft,'From first tab');
 assert.equal(errors[0].error.code,'WORKSPACE_REVISION_CONFLICT');
 assert.equal(b.store.getStorageStatus().status,'conflict');
 b.store.reloadStorage();assert.equal(b.store.getConversation(id).state.composerDraft,'From first tab');
});

test('artifact creation preserves verified effect and captures local bytes without pretending failed capture is durable',async()=>{
 const tool={definitionId:'t',version:1,purpose:'Export',executorKind:'tool_task',requiredCapabilities:['artifact.create'],inputs:[{name:'in',representation:'json'}],outputs:[{name:'artifact',representation:'json'}]};
 const graph=snapshot([{...node('t','t'),inputBindings:{in:'Original complete body'}}],[],[tool]);
 let saved;
 const h=harness({fileStore:{putBlob:async(blob,meta)=>{saved={blob,meta};return{id:'durable-1'};}}}),id=h.store.getActiveConversation().id;
 const run=await h.local.run({conversationId:id,targets:['t'],snapshotOverride:graph,resolveArtifactRequest:()=>({format:'MD'}),
  createArtifact:async()=>({artifact:{id:'artifact1',name:'body.md',downloadUrl:'/artifacts/a',availability:'temporary'},blob:new Blob(['Original complete body'])})});
 assert.equal(run.nodes[0].effectConfirmed,true);assert.equal(run.nodes[0].outputs.values.artifact.inline.localFileId,'durable-1');
 assert.equal(run.nodes[0].outputs.values.artifact.inline.availability.durable,true);
 assert.equal(await saved.blob.text(),'Original complete body');assert.equal(saved.meta.conversationId,id);
 const failed=harness({fileStore:{putRemote:async()=>{throw Object.assign(new Error('Quota exceeded'),{code:'QUOTA'});}}});
 const fallback=await failed.local.run({conversationId:failed.store.getActiveConversation().id,targets:['t'],snapshotOverride:graph,
  resolveArtifactRequest:()=>({format:'MD'}),createArtifact:async()=>({artifact:{downloadUrl:'/artifacts/a',name:'body.md'}})});
 const availability=fallback.nodes[0].outputs.values.artifact.inline.availability;
 assert.equal(fallback.status,'completed');assert.equal(availability.durable,false);assert.equal(availability.localSaveError,'QUOTA');
});
test('task and question checkpoint survive ordinary conversation serialization and enforce context budget',()=>{
 const h=harness(),id=h.store.getActiveConversation().id;
 h.store.updateConversationPointerTask(id,{objective:'Original goal',requestText:'Refinement',constraints:['Fixed'],historyDigest:['Earlier']});
 h.store.updateConversationPointerQuestion(id,{questionId:'q1',question:'Choose source',awaitingInput:true,runRefs:['r1']});
 h.store.updateConversationState(id,{messages:[{role:'assistant',text:'Which?'}]});
 h.store.importJSON(h.store.exportJSON());
 assert.equal(h.store.getConversation(id).state.pointerTask.objective,'Original goal');
 assert.equal(h.store.getConversation(id).state.pointerQuestion.runRefs[0],'r1');
 assert.throws(()=>h.store.updateConversationPointerTask(id,{objective:'x'.repeat(12001)}),/BUDGET/);
});
test('editing graph during execution preserves historical output but marks result validity stale',async()=>{
 const h=harness(),id=h.store.getActiveConversation().id,graphId=h.local.graphId(id);
 const graph=snapshot([node('a')]);graph.graph.graphId=graphId;
 h.store.updateConversationPointerGraph(id,graph);
 const run=await h.local.run({conversationId:id,targets:['a'],executeNode:async()=>{
  const changed=structuredClone(graph);changed.graph.revision=2;changed.graph.nodes[0].settings={request:'Changed'};
  h.store.updateConversationPointerGraph(id,changed);return ok('Historical');
 }});
 assert.equal(run.nodes[0].outputs.values.result.inline,'Historical');
 assert.equal(run.nodes[0].resultCurrent,false);assert.equal(run.validity.snapshotCurrent,false);
});

test('source deletion or replacement invalidates actual-file results without inventing current bytes',async()=>{
 let blob=new Blob(['First'],{type:'text/plain'});
 const h=harness({fileStore:{getBlob:async()=>blob}}),id=h.store.getActiveConversation().id,graph=snapshot([node('f','f',{file:{name:'notes.txt',localFileId:'bytes'}})]);
 const run=await h.local.run({conversationId:id,targets:['f'],snapshotOverride:graph});
 assert.equal((await h.local.validateResults(graph,run.nodes))[0].resultCurrent,true);
 blob=new Blob(['Second'],{type:'text/plain'});
 assert.equal((await h.local.validateResults(graph,run.nodes))[0].status,'stale');
 blob=null;
 assert.equal((await h.local.validateResults(graph,run.nodes))[0].status,'stale');
});

test('failed durable checkpoint prevents external artifact effect and failed metadata stays inspectable',async()=>{
 const h=harness(),id=h.store.getActiveConversation().id;let writes=0,effects=0;
 const store={...h.store,updateConversationPointerRuns(...args){if(++writes===2)throw Object.assign(new Error('Quota'),{code:'QUOTA'});return h.store.updateConversationPointerRuns(...args);}};
 const local=h.window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,loadPlan:async()=>plan,loadResults:()=>import('../front/js/ovllPointerResults.mjs')});
 const tool={definitionId:'t',version:1,purpose:'Export',executorKind:'tool_task',requiredCapabilities:['artifact.create'],inputs:[{name:'in',representation:'json'}],outputs:[{name:'artifact',representation:'json'}]};
 const run=await local.run({conversationId:id,targets:['t'],snapshotOverride:snapshot([{...node('t','t'),inputBindings:{in:'Body'}}],[],[tool]),
  resolveArtifactRequest:()=>({format:'MD'}),createArtifact:async()=>{effects++;return{artifact:{downloadUrl:'/actual.md'}};}});
 assert.equal(effects,0);assert.equal(run.status,'failed');assert.equal(run.nodes[0].error,'QUOTA');
 assert.equal(run.nodes[0].toolEffectStarted,false);
});
test('failed model invocation retains usage/provider metadata and cancels remaining pending state',async()=>{
 const h=harness(),id=h.store.getActiveConversation().id;
 const run=await h.local.run({conversationId:id,targets:['a','b'],snapshotOverride:snapshot([node('a'),node('b')]),
  executeNode:async()=>{throw Object.assign(new Error('MODEL_OUTPUT_TRUNCATED'),{_meta:{model:'fixed',providerCalls:2,repairCount:1}});}});
 assert.equal(run.status,'failed');assert.equal(run.nodes[0].execution.providerCalls,2);
 assert.equal(run.nodes[1].status,'blocked');
});
test('blocked model answer retains actual inference metadata',async()=>{
 const h=harness(),id=h.store.getActiveConversation().id;
 const run=await h.local.run({conversationId:id,targets:['a'],snapshotOverride:snapshot([node('a')]),
  executeNode:async()=>({status:'blocked',outputs:{status:'blocked',reason:'Needs evidence'},_meta:{model:'fixed',providerCalls:1,usage:{inputTokens:3}}})});
 assert.equal(run.status,'waiting');assert.equal(run.nodes[0].execution.providerCalls,1);
 assert.equal(run.nodes[0].execution.usage.inputTokens,3);
});
test('real file evidence crosses local runner and model host budgets without duplicate preview',async()=>{
 const {createLocalPointerHost}=await import('../backend/ovllPointer/localHost.js');
 const original='a'.repeat(40000);let calls=0;
 const h=harness({fileStore:{getBlob:async()=>new Blob([original],{type:'text/plain'})}});
 const definition={...model,inputs:[{name:'in',role:'source',representation:'json'}],outputs:[{name:'result',role:'summary',representation:'text'}]};
 const graph=snapshot([node('source','f',{file:{name:'notes.txt',localFileId:'bytes',textPreview:'Wrong old preview'}}),node('summary')],
  [{linkId:'input',kind:'data',from:{nodeId:'source',port:'file'},to:{nodeId:'summary',port:'in'}}],[definition,file]);
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async()=>{calls++;return {text:JSON.stringify({outputs:{status:'produced',values:{result:{inline:'Read'}}}})};}}});
 const run=await h.local.run({conversationId:h.store.getActiveConversation().id,targets:['summary'],snapshotOverride:graph,
  executeNode:args=>host.node({...args,requestRef:'fixture'})});
 assert.equal(run.status,'completed');assert.equal(calls,1);
 const source=run.nodes[0].outputs.values.file.inline;
 assert.equal(source.text,original);assert.equal(source.textPreview,undefined);assert.equal(source.coverage.complete,true);
});
test('source JSON escaping obeys serialized evidence budget with explicit omitted bytes',async()=>{
 const original='"\\\n'.repeat(30000);
 const h=harness({fileStore:{getBlob:async()=>new Blob([original],{type:'text/plain'})}});
 const run=await h.local.run({conversationId:h.store.getActiveConversation().id,targets:['f'],snapshotOverride:snapshot([node('f','f',{file:{name:'notes.txt',localFileId:'bytes'}})])});
 const value=run.nodes[0].outputs.values.file.inline;
 assert.ok(Buffer.byteLength(JSON.stringify(value))<60000);
 assert.equal(value.coverage.truncated,true);assert.equal(value.coverage.readBytes,Buffer.byteLength(value.text));
 assert.equal(value.coverage.totalBytes,Buffer.byteLength(original));
});
