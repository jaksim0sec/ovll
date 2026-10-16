import assert from 'node:assert/strict';
import { createRequestRuntime } from './requestRuntime.mjs';
import { createPromptBuilder } from './promptBuilder.mjs';
import {createCallAI} from './callAI.mjs';

const cb = (progress='pending') => ({intent:'fulfill user request',progress});
const cd = () => ({overallFlow:'flow',currentTopic:'topic',details:'decisions'});
const mk = (responses, overrides={}) => {
  let room = {revision:0,contextData:cd()};
  const events=[], saves=[], calls=[];
  const deps={
    buildPrompt:async (layer,data)=>JSON.stringify({layer,data}),
    callAI:async x=>{calls.push(x);if(typeof responses==='function')return responses(x); const reply=responses.shift(); if(!reply)throw new Error('No test response'); return reply;},
    lookupNeed:async({need})=>need.map(x=>[x,'verified-data']),
    runWorkroom:async({workroom, objective})=>({ok:true,summary:`finished ${workroom}: ${objective}`}),
    loadRoom:async()=>structuredClone(room),
    saveRoomContext:async({expectedRevision,contextData})=>{if(room.revision!==expectedRevision)return null;room={revision:room.revision+1,contextData};return {revision:room.revision};},
    persist:async packet=>{saves.push(packet)},
    publish:async event=>{events.push(event)},
    ...overrides
  };
  return {r:createRequestRuntime(deps),events,saves,calls,getRoom:()=>room};
};
async function task(t,userRequest='hello'){const {finished,requestId}=await t.r.begin({roomId:'x',userRequest});return {state:await finished,requestId};}
{
  const t=mk([{need:[]},{languageBlock:'hi',contextBlock:cb('done'),contextData:cd()}]);
  const {state}=await task(t);
  assert.equal(state.status,'completed');assert.equal(state.languageBlock,'hi');
  assert.deepEqual(t.calls.map(x=>x.layer),['gate','corridorInitial']);
  assert.ok(t.events.some(e=>e.type==='final'));
  assert.equal(t.getRoom().revision,1);
}
{
  const t=mk([{need:[]},{plan:[{skillDefine:{objective:'build skill',need:[]}},{canvasEdit:{objective:'put skill on canvas',need:[]}},{terminate:{objective:'deliver',need:[]}}],contextBlock:cb()},{languageBlock:'done',contextBlock:cb('all done'),contextData:cd()}]);
  const {state}=await task(t);
  assert.equal(state.status,'completed'); assert.equal(state.planIndex,2);
  assert.deepEqual(t.calls.map(x=>x.layer),['gate','corridorInitial','output']);
  assert.equal(t.events.filter(e=>e.type==='workroom_result').length,2);
}
{
  const t=mk([{need:[]},{plan:[{skillDefine:{objective:'first',need:[]}}],contextBlock:cb()},{plan:[{terminate:{objective:'finish',need:[]}}],contextBlock:cb('done')},{languageBlock:'done',contextBlock:cb('done'),contextData:cd()}]);
  const {state}=await task(t);
  assert.equal(state.status,'completed');
  assert.deepEqual(t.calls.map(x=>x.layer),['gate','corridorInitial','corridorReturn','output']);
}
{
  const t=mk([{need:[]},{plan:[{canvasEdit:{objective:'step',need:[]}},{terminate:{objective:'end',need:[]}}],contextBlock:cb()},{plan:[{terminate:{objective:'end',need:[]}}],contextBlock:cb('failed action')},{languageBlock:'could not do it',contextBlock:cb('failed action'),contextData:cd()}], {runWorkroom:async()=>({ok:false,summary:'no permission'})});
  const {state}=await task(t);
  assert.equal(state.status,'completed'); assert.equal(state.verifiedResults[0].ok,false);
  assert.ok(t.calls.some(x=>x.layer==='corridorReturn'));
}
{
  let started;const pending=new Promise(resolve=>{started=resolve});
  let seenSignal;
  const t=mk(async({layer,signal})=>{
    if(layer!=='gate')throw Error('Should stop during Gate');
    seenSignal=signal;started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true}));
  });
  const {finished,requestId}=await t.r.begin({roomId:'x',userRequest:'stop'});
  await pending;
  const stopping=await t.r.stop('x',requestId);
  assert.ok(['stopping','stopped'].includes(stopping.status));assert.equal(seenSignal.aborted,true);
  assert.equal((await finished).status,'stopped');
  assert.equal(t.events.at(-1).type,'final');
}
{
  let entered;const enteredPromise=new Promise(resolve=>entered=resolve);
  let finishAction;const actionPromise=new Promise(resolve=>finishAction=resolve);
  const t=mk([{need:[]},{plan:[{canvasEdit:{objective:'save',need:[]}},{terminate:{objective:'end',need:[]}}],contextBlock:cb()}], {runWorkroom:async()=>{entered();await actionPromise;return {ok:true,summary:'canvas mutation committed',refs:['asset1']}}});
  const {finished,requestId}=await t.r.begin({roomId:'x',userRequest:'create'});
  await enteredPromise;
  await t.r.stop('x',requestId);
  finishAction();
  const state=await finished;
  assert.equal(state.status,'stopped');
  assert.equal(state.verifiedResults[0].summary,'canvas mutation committed');
  assert.ok(t.events.some(e=>e.type==='workroom_result'));
}
{
  const t=mk([{need:[]},{plan:[{terminate:{objective:'bye',need:[]}}],contextBlock:cb()},{languageBlock:'bye',contextBlock:cb('complete'),contextData:cd()}], {saveRoomContext:async()=>null});
  const {state}=await task(t);
  assert.equal(state.status,'failed');
  assert.equal(state.languageBlock,null);
  assert.ok(!t.events.some(e=>e.type==='language'));
}
{
  const t=mk([{need:[]},{plan:[{skillDefine:{objective:'a',need:[]}},{terminate:{objective:'b',need:[]}}],contextBlock:{intent:'a',progress:'b',focus:'unauthorized'}}]);
  const {state}=await task(t);
  assert.equal(state.status,'failed');assert.match(state.error,/contextBlock/);
}
{
  const manifest={layers:{gate:['common.md','gate.md']}};
  const builder=createPromptBuilder({manifest,readText:async(name)=>name==='gate.md'?'settings:${languageSettings}; syntax:${interfaceSyntax}':name});
  const p=await builder('gate',{userRequest:'{{do-not-execute}}'},{languageSettings:'Korean',interfaceSyntax:'tokens'});
  assert.match(p,/common.md\n\nsettings:/);assert.match(p,/settings:Korean/);
  assert.match(p,/\{\{do-not-execute\}\}/);
}
{
  let fails = 0;
  const t = mk([{need:[]}], { persist: async ({event}) => {
    if (event.type === 'model_call' && fails++ === 0) throw new Error('Temporary storage unavailable');
  }});
  const {state} = await task(t);
  assert.equal(state.status, 'failed');
  assert.match(state.error, /Temporary storage/);
  assert.equal(t.events.at(-1).type, 'final');
}
for (const provider of ['gemini','groq']) {
  let body;
  const fakeResult = provider === 'gemini'
    ? {candidates:[{content:{parts:[{text:'{"need":[]}'},{functionCall:{name:'addBlock',args:{x:1}}}]}}]}
    : {choices:[{message:{content:'{"need":[]}',tool_calls:[{id:'1',function:{name:'addBlock',arguments:'{"x":1}'}}]}}]};
  const fakeFetch = async(url, options) => {body=JSON.parse(options.body); return {ok:true,json:async()=>fakeResult};};
  const call=createCallAI({provider,model:'test',apiKey:'fake',fetchImpl:fakeFetch});
  assert.equal(await call({prompt:'json',mode:'json'}),'{"need":[]}');
  const answer=await call({prompt:'tool',mode:'tools',tools:[{name:'addBlock',description:'Add',parameters:{type:'object',properties:{x:{type:'integer'}}}}]});
  assert.equal(answer.toolCalls[0].name,'addBlock');
  assert.ok(provider === 'gemini' ? body.tools[0].functionDeclarations : body.tools[0].function.name === 'addBlock');
}
console.log('PASS: direct, plan terminate, corridor return, failed action, stop in model, stop with committed action, session CAS, strict context, prompt order');
