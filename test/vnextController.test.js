import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptComposer } from '../backend/vnext/promptComposer.js';
import { createTurnController } from '../backend/vnext/turnController.js';
import { createContractValidation } from '../backend/vnext/validation.js';
const c={requestRef:'r1',objective:'Summarize',requestText:'hello',constraints:[],capabilities:[],outputContract:'ModelTurn',materials:[]};
const scope={actorRef:'a',workspaceRef:'w'};
function setup(turns,options={}){
  const calls=[],events=[],submits=[];
  const store={assertEditor:async()=>true,recordControllerEvent:async(_s,e)=>events.push(e),
    submit:async(turn,s)=>{submits.push({turn,s});return {message:turn.message,needs:[],results:turn.actions?.map(a=>({
      actionId:a.localKey,status:'rejected',error:{code:'ACTION_NOT_IMPLEMENTED'}}))||[]};}};
  const gateway={complete:async req=>{calls.push(req);return {text:JSON.stringify(turns[Math.min(calls.length-1,turns.length-1)]),
    providerId:'fake',model:'test',usage:null};}};
  const controller=createTurnController({store,composer:createPromptComposer(),gateway,
    prepareContext:async()=>c,resolveModel:async()=>({providerId:'fake',model:'test'}),...options});
  return {controller,calls,events,submits};
}
test('plain request completes in one model turn without forced workflow',async()=>{
  const f=setup([{message:'hello there'}]);
  const out=await f.controller.run({scope,requestRef:'r1',requestText:'hello'});
  assert.equal(out.message,'hello there');
  assert.equal(out.modelCalls,1);
  assert.deepEqual(out.results,[]);
  assert.equal(f.calls[0].messages[0].role,'system');
  assert.match(f.calls[0].messages[1].content,/ENTRY/);
  assert.equal(f.submits.length,1);
  assert.equal(f.events.at(-1).state,'responded');
});
test('actions are submitted as proposals, never presented as verified',async()=>{
  const f=setup([{actions:[{localKey:'a1',kind:'run.cancel',args:{runRef:'r1'}}]}]);
  const out=await f.controller.run({scope,requestRef:'r1',requestText:'hello'});
  assert.equal(out.results[0].status,'rejected');
  assert.equal(out.message,'');
  assert.ok(f.events.some(e=>e.state==='actions_rejected'));
});
test('needs barrier is resolved through host and returned for a second turn',async()=>{
  const need={needs:[{kind:'graph',selector:{scope:'ref',ref:'g1',depth:'semantic'},purpose:'Inspect layout'}]};
  const f=setup([need,{message:'Read the graph'}],{fulfillNeeds:async({context})=>({...context,materials:[
    {ref:'graph1',kind:'graph',source:'server_state',content:{graphId:'g1'},truncated:false}]})});
  const result=await f.controller.run({scope,requestRef:'r1',requestText:'hello'});
  assert.equal(result.modelCalls,2);
  assert.equal(result.message,'Read the graph');
  assert.equal(f.submits.length,1);
});
test('unresolved needs do not submit actions',async()=>{
  const f=setup([{needs:[{kind:'graph',selector:{scope:'ref',ref:'g1',depth:'semantic'},purpose:'Inspect layout'}]}]);
  const out=await f.controller.run({scope,requestRef:'r1',requestText:'hello'});
  assert.equal(out.needs.length,1);
  assert.equal(f.submits.length,0);
});
test('IR proposals receive precise dynamic-definition modules before server submission',async()=>{
  const patch={graphId:'g1',expectedGraphRevision:0,definitions:[],operations:[]};
  const draft={actions:[{localKey:'patch',kind:'ir.applyPatch',args:{patch}}]};
  const f=setup([draft,draft]);
  const result=await f.controller.run({scope,requestRef:'r1',requestText:'hello',graphId:'g1'});
  assert.equal(result.modelCalls,2);
  assert.equal(f.submits.length,1);
  assert.equal(result.message,'','proposed actions must never be presented as completed');
  assert.match(f.calls[1].messages[1].content,/IR —/);
  assert.match(f.calls[1].messages[1].content,/atomic/i);
});
test('refined needs remains unresolved and never submits earlier speculative patch',async()=>{
  const patch={graphId:'g1',expectedGraphRevision:0,definitions:[],operations:[]};
  const f=setup([{actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch}}]},
    {needs:[{kind:'graph',selector:{scope:'ref',ref:'g1',depth:'semantic'},purpose:'Validate references'}]}]);
  const result=await f.controller.run({scope,requestRef:'r1',requestText:'hello'});
  assert.equal(result.needs.length,1);
  assert.equal(f.submits.length,0);
});
test('malformed output or untrusted context fails before writing actions',async()=>{
  const a=setup([{message:'ok',actorRef:'forged'}]);
  await assert.rejects(a.controller.run({scope,requestRef:'r1',requestText:'hello'}),e=>e.code==='INVALID_MODEL_TURN');
  assert.equal(a.submits.length,0);
  const b=setup([{message:'ok'}],{prepareContext:async()=>({...c,requestText:'different'})});
  await assert.rejects(b.controller.run({scope,requestRef:'r1',requestText:'hello'}),e=>e.code==='INVALID_CONTEXT_BUNDLE');
  assert.equal(b.calls.length,0);
});
test('all frozen behavior layers are composable without mandatory extra calls',()=>{
  const p=createPromptComposer({validation:createContractValidation()});
  for(const id of ['layer.chat','layer.ir','layer.run','layer.function','layer.response','shared.context-read']){
    const prompt=p.assemble({context:c,moduleIds:[id]});
    assert.ok(prompt.moduleIds.includes(id));
    assert.equal(prompt.messages[0].role,'system');
  }
});
