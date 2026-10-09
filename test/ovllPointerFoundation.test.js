import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryGraphRepository, KernelError, computeScope } from '../backend/ovllPointer/graph.js';
import { ProposalKernel } from '../backend/ovllPointer/actions.js';
import { WorkspaceEventLog, sseFrame } from '../backend/ovllPointer/events.js';
import { ModelGateway, openAIChatAdapter } from '../backend/ovllPointer/providers.js';
import { suggestFunctionization } from '../backend/ovllPointer/functionization.js';
import { createPointerApp } from '../backend/ovllPointer/http.js';

const def = (k, inputs = [], outputs = [{ name: 'out', role: 'data', representation: 'text' }], extra = {}) =>
  ({ localKey: k, purpose: 'Node ' + k, executorKind: 'model_task', instruction: 'Perform ' + k, inputs, outputs, ...extra });
const node = (k, defKey = 'd') => ({ op: 'node.add', localNodeKey: k, definitionRef: { localDefinitionKey: defKey } });
const link = (k, a, b, kind = 'flow') => ({ op: 'link.add', localLinkKey: k, kind, from: { node: { localNodeKey: a }, port: 'out' }, to: { node: { localNodeKey: b }, port: 'in' } });
function repo() { const r = new MemoryGraphRepository(); r.create('w', 'g'); return r; }
function patch(r, definitions, operations, revision = 0) {
  return r.apply('w', { graphId: 'g', expectedGraphRevision: revision, definitions, operations });
}
const failCode = (fn, expected) => assert.throws(fn, e => e instanceof KernelError && e.code === expected);

test('graph revision 0 exists and patch adds an arbitrary semantic node definition', () => {
  const r = repo();
  const result = patch(r, [def('d')], [node('n')]);
  assert.equal(result.graphRef.revision, 1);
  assert.equal(r.get('w', 'g').graph.nodes.length, 1);
  assert.equal(r.getRevision('w', 'g', 0).definitions.length, 0);
  assert.equal(r.getRevision('w', 'g', 1).definitions.length, 1);
});
test('failed patch is atomic and cannot apply partial nodes', () => {
  const r = repo();
  failCode(() => patch(r, [def('d')], [node('n'), { op:'node.delete', nodeId:'missing' }]), 'UNKNOWN_NODE');
  assert.equal(r.get('w','g').graph.nodes.length,0);
  assert.equal(r.get('w','g').definitions.length,0);
});
test('stale revision never overwrites latest graph', () => {
  const r = repo();
  patch(r,[def('d')],[node('n')]);
  failCode(() => patch(r,[],[{op:'node.delete',nodeId:'any'}],0),'STALE_REVISION');
  assert.equal(r.get('w','g').graph.revision,1);
});
test('graph cannot be changed by an active Run without plan adoption protocol', () => {
  const r = repo();
  failCode(() => r.apply('w',{graphId:'g',expectedGraphRevision:0,adoption:'active_run',definitions:[def('d')],operations:[]}), 'ACTIVE_RUN_ADOPTION_PENDING');
});
test('tool-task definitions require real capability references', () => {
  const r = repo();
  failCode(() => patch(r,[def('d',[],undefined,{executorKind:'tool_task'})],[]),'CAPABILITY_REQUIRED');
});
test('definition versions preserve original immutable version', () => {
  const r = repo();
  const first = patch(r,[def('d')],[]);
  const ref = r.get('w','g').definitions[0];
  patch(r,[def('next',[],undefined,{supersedes:{definitionId:ref.definitionId,version:1}})],[],1);
  const defs = r.get('w','g').definitions;
  assert.deepEqual(defs.map(x=>x.version),[1,2]);
  assert.equal(r.getRevision('w','g',1).definitions.length,1);
});
test('data connections check semantic ports, not UI geometry', () => {
  const r=repo(), inputs=[{name:'in',role:'data',representation:'number'}];
  failCode(() => patch(r,[def('a'),def('b',inputs)],[node('a','a'),node('b','b'),link('one','a','b','data')]),'PORT_MISMATCH');
  assert.equal(r.get('w','g').graph.revision,0);
});
test('flow/data cycles are rejected before commit', () => {
  const r = repo();
  failCode(() => patch(r,[def('d')],[node('a'),node('b'),link('ab','a','b'),link('ba','b','a')]),'GRAPH_CYCLE');
});
test('closed and open dam never fan out through a parent sibling', () => {
  const r = repo();
  patch(r,[def('d',[{name:'in',representation:'text'}])],
    [node('root'),node('pivot'),node('sibling'),node('child'),node('evidence'),link('rp','root','pivot'),link('rs','root','sibling'),link('pc','pivot','child'),link('ec','evidence','child','data')]);
  const graph=r.get('w','g').graph;
  const byKey=graph.nodes.map((n,i)=>n.nodeId);
  const closed=new Set(computeScope(graph,[byKey[1]],'closed'));
  const open=new Set(computeScope(graph,[byKey[1]],'open'));
  assert.deepEqual(closed,new Set([byKey[0],byKey[1]]));
  assert.deepEqual(open,new Set([byKey[0],byKey[1],byKey[3],byKey[4]]));
});
const turn = patchData => ({ actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:patchData}}] });
const scope = {actorRef:'actor',workspaceRef:'w',requestRef:'request',graphId:'g'};
const kernel = (r, overrides={}) => new ProposalKernel({graphStore:r,authorize:async()=>true,validateProposal:()=>true,...overrides});
test('kernel requires trustworthy authorization and schema validators', () => {
  assert.throws(()=>new ProposalKernel({graphStore:repo()}),/GUARDS_REQUIRED/);
});
test('kernel rejects ambiguous needs plus mutation before changing state', async () => {
  const r=repo();
  await assert.rejects(()=>kernel(r).submit({needs:[{kind:'graph'}],actions:[{localKey:'x',kind:'ir.applyPatch',args:{patch:{graphId:'g',expectedGraphRevision:0,definitions:[],operations:[]}}}]},scope),e=>e.code==='NEEDS_ACTION_BARRIER');
  assert.equal(r.get('w','g').graph.revision,0);
});
test('unauthorized actions never modify graph', async () => {
  const r=repo();
  const k=kernel(r,{authorize:async()=>false});
  const response=await k.submit(turn({graphId:'g',expectedGraphRevision:0,definitions:[def('d')],operations:[]}),scope);
  assert.equal(response.results[0].error.code,'FORBIDDEN');
  assert.equal(r.get('w','g').graph.revision,0);
});
test('idempotent mutation is applied once and repeated as duplicate', async () => {
  const r=repo();const k=kernel(r);
  const data=turn({graphId:'g',expectedGraphRevision:0,definitions:[def('d')],operations:[]});
  const a=await k.submit(data,scope), b=await k.submit(data,scope);
  assert.equal(a.results[0].status,'applied');
  assert.equal(b.results[0].status,'duplicate');
  assert.equal(r.get('w','g').graph.revision,1);
});
test('run request cannot claim scheduled without durable queue', async () => {
  const r=repo();patch(r,[def('d')],[node('a')]);
  const n=r.get('w','g').graph.nodes[0].nodeId;
  const result=await kernel(r).submit({actions:[{localKey:'run',kind:'run.start',args:{targets:[{nodeId:n}]}}]},scope);
  assert.equal(result.results[0].status,'rejected');
  assert.equal(result.results[0].error.code,'DURABLE_QUEUE_REQUIRED');
});
test('new patch node targets resolve from confirmed references only', async () => {
  const r=repo();
  const k=kernel(r,{scheduleRun:async()=>({durable:true,runRef:'r_1'})});
  const out=await k.submit({actions:[
    {localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId:'g',expectedGraphRevision:0,definitions:[def('d')],operations:[node('n')]}}},
    {localKey:'run',kind:'run.start',dependsOn:['p'],args:{targets:[{fromAction:'p',localNodeKey:'n'}]}}
  ]},scope);
  assert.deepEqual(out.results.map(x=>x.status),['applied','scheduled']);
  assert.equal(out.results[1].runRef,'r_1');
});
test('events isolate workspace scopes and detect replay gaps', () => {
  const e=new WorkspaceEventLog({capacity:2});
  e.append('w',{type:'patch'});e.append('other',{type:'private'});e.append('w',{type:'run'});e.append('w',{type:'done'});
  assert.equal(e.read('w',1).events.length,2);
  assert.equal(e.read('w',1).resetRequired,false);
  assert.equal(e.read('w',0).resetRequired,false);
  assert.equal(e.read('w',1).events.some(x=>x.workspaceRef==='other'),false);
  assert.match(sseFrame(e.read('w',1).events[0]),/event: run/);
});
test('provider gateway normalizes results and prevents unsupported features', async () => {
  let seen;
  const gateway=new ModelGateway();
  gateway.register('groq',openAIChatAdapter({endpoint:'https://unit.test/completions',apiKey:'SECRET',fetchImpl:async(_url,options)=>{
    seen=JSON.parse(options.body);
    return {ok:true,json:async()=>({id:'x',choices:[{message:{content:'ok'}}],usage:{prompt_tokens:4}})};
  }}),{json:true});
  const out=await gateway.complete({providerId:'groq',model:'unit',messages:[{role:'user',content:'hello'}],output:'json',maxOutputTokens:200});
  assert.equal(out.text,'ok');
  assert.equal(seen.max_completion_tokens,200);
  await assert.rejects(()=>gateway.complete({providerId:'absent',model:'unit',messages:[]}),e=>e.code==='UNKNOWN_PROVIDER');
});
test('function suggestion requires verified outcome and does not silently save', () => {
  const task={taskId:'t',status:'completed',objective:'Compare',requiredOutcomes:[{name:'result',evidenceRefs:['v1']}]};
  assert.equal(suggestFunctionization({task,evidence:[]}),null);
  const candidate=suggestFunctionization({task,evidence:[{ref:'v1',verified:true}]});
  assert.equal(candidate.saved,false);
  assert.equal(candidate.verified,false);
});
test('standalone HTTP app refuses missing authentication dependencies', () => {
  assert.throws(()=>createPointerApp(),e=>e.code==='SECURITY_DEPENDENCIES_REQUIRED');
});
test('HTTP transport never accepts actorRef from untrusted request body', async () => {
  const r=new MemoryGraphRepository(),events=new WorkspaceEventLog(),k=kernel(r);
  const app=createPointerApp({repository:r,kernel:k,events,authenticate:async()=>({actorRef:'authenticated',workspaceRef:'w'}),authorize:async()=>true});
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/api/pointer/graphs/g',{method:'POST'});
    assert.equal(response.status,201);
    const reply=await fetch(base+'/api/pointer/turns',{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':'once'},body:JSON.stringify({actorRef:'spoofed',graphId:'g',turn:{message:'Hello'}})});
    assert.equal(reply.status,200);
    assert.equal((await reply.json()).message,'Hello');
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

test('HTTP transport returns 401 for missing trusted session', async () => {
  const r=repo(),events=new WorkspaceEventLog(),k=kernel(r);
  const app=createPointerApp({repository:r,kernel:k,events,authenticate:async()=>null,authorize:async()=>true});
  const server=await new Promise(resolve=>{const value=app.listen(0,'127.0.0.1',()=>resolve(value));});
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const reply=await fetch(base+'/api/pointer/graphs/g');
    assert.equal(reply.status,401);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
