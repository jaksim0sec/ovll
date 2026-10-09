import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresPointerStore } from '../backend/ovllPointer/durable.js';
import { createDurablePointerApp } from '../backend/ovllPointer/durableHttp.js';
import { createRunWorker } from '../backend/ovllPointer/worker.js';

if (!process.env.POINTER_TEST_DATABASE_URL) throw new Error('POINTER_TEST_DATABASE_URL required: isolated PostgreSQL test DB only');
const pool=new Pool({connectionString:process.env.POINTER_TEST_DATABASE_URL,max:12});
const valid=turn=>!!turn && typeof turn==='object' && (typeof turn.message==='string' || Array.isArray(turn.actions) || Array.isArray(turn.needs));
const newStore=(extra={})=>new PostgresPointerStore({pool,validateTurn:valid,...extra});
const ident=(prefix='x')=>prefix+'_'+randomUUID().replaceAll('-','').slice(0,18);
const definition=(key='d',kind='model_task')=>({localKey:key,purpose:'Summarize source evidence',instruction:'Produce a useful summary',executorKind:kind,
  inputs:[],outputs:[{name:'result',role:'user result',representation:'text'}],...(kind==='tool_task'?{requiredCapabilities:['file.write']}: {})});
const patch=(graphId,rev=0,defs=[definition()],ops=[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}])=>
  ({graphId,expectedGraphRevision:rev,definitions:defs,operations:ops});
const action=(key,kind,args,dependsOn=[])=>({localKey:key,kind,args,dependsOn});
async function setup() {
  const store=newStore(),workspaceRef=ident('ws'),actorRef=ident('actor'),scope={workspaceRef,actorRef},graphId=ident('g'),taskId=ident('task');
  await store.provisionWorkspace(workspaceRef,actorRef);
  await store.createGraph(scope,graphId);
  await store.createTask(scope,{taskId,requestRef:ident('req'),objective:'Summarize documents'});
  return {store,scope,graphId,taskId,callScope:(requestRef=ident('request'))=>({...scope,graphId,taskRef:taskId,requestRef})};
}
before(async()=>{for(const name of ['001_initial.sql','002_node_evidence.sql','003_lifecycle.sql'])await pool.query(await readFile(new URL('../backend/ovllPointer/sql/'+name,import.meta.url),'utf8'));});
after(async()=>{await pool.end();});

test('durable graph and immutable revision survive store recreation',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  const out=await store.submit({actions:[action('patch','ir.applyPatch',{patch:patch(graphId)})]},callScope());
  assert.equal(out.results[0].status,'applied');
  const fresh=newStore();
  assert.equal((await fresh.readGraph(scope,graphId)).graph.revision,1);
  assert.equal((await fresh.readGraph(scope,graphId,0)).definitions.length,0);
  assert.equal((await fresh.readGraph(scope,graphId,1)).graph.nodes.length,1);
});
test('atomic patch failure and optimistic revision conflict are fail closed',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  const invalid=patch(graphId,0,[definition()],[
    {op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}},
    {op:'node.delete',nodeId:'missing'}
  ]);
  assert.equal((await store.submit({actions:[action('p','ir.applyPatch',{patch:invalid})]},callScope())).results[0].status,'rejected');
  assert.equal((await store.readGraph(scope,graphId)).graph.revision,0);
  const a=store.submit({actions:[action('p','ir.applyPatch',{patch:patch(graphId)})]},callScope());
  const b=store.submit({actions:[action('p','ir.applyPatch',{patch:patch(graphId)})]},callScope());
  const outcomes=(await Promise.all([a,b])).map(x=>x.results[0].status).sort();
  assert.deepEqual(outcomes,['applied','rejected']);
  assert.equal((await store.readGraph(scope,graphId)).graph.revision,1);
});
test('durable idempotency deduplicates across independent server instances',async()=>{
  const {store,scope,graphId,callScope}=await setup(),ctx=callScope();
  const turn={actions:[action('patch','ir.applyPatch',{patch:patch(graphId)})]};
  const outputs=await Promise.all([store.submit(turn,ctx),newStore().submit(turn,ctx)]);
  assert.deepEqual(outputs.map(x=>x.results[0].status).sort(),['applied','duplicate']);
  assert.equal((await newStore().readGraph(scope,graphId)).graph.revision,1);
  const again=await newStore().submit(turn,ctx);
  assert.equal(again.results[0].status,'duplicate');
  const divergent=await store.submit({actions:[action('patch','ir.applyPatch',{patch:patch(graphId,0,[],[])})]},ctx);
  assert.equal(divergent.results[0].error.code,'IDEMPOTENCY_CONFLICT');
});
test('membership scope denies other workspace reads and viewer edits',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  await assert.rejects(store.readGraph({workspaceRef:scope.workspaceRef,actorRef:'outsider'},graphId),e=>e.code==='FORBIDDEN');
  const viewer=ident('viewer');await store.grant(scope,viewer,'viewer');
  const other={workspaceRef:scope.workspaceRef,actorRef:viewer};
  assert.equal((await store.readGraph(other,graphId)).graph.revision,0);
  const denied=await store.submit({actions:[action('patch','ir.applyPatch',{patch:patch(graphId)})]}, {...callScope(),actorRef:viewer});
  assert.equal(denied.results[0].error.code,'FORBIDDEN');
  await assert.rejects(store.readEvents({workspaceRef:ident('foreign'),actorRef:viewer}),e=>e.code==='FORBIDDEN');
});
test('patch and dependent run create durable queue, not fake completion',async()=>{
  const {store,graphId,taskId,scope,callScope}=await setup();
  const reply=await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId)}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  assert.deepEqual(reply.results.map(r=>r.status),['applied','scheduled']);
  const run=await store.inspectRun(scope,reply.results[1].runRef);
  assert.equal(run.status,'queued');assert.equal(run.graphRef.revision,1);assert.equal(run.taskRef,taskId);
  const queue=await pool.query('SELECT status FROM ov_run_queue WHERE workspace_id=$1 AND run_id=$2',[scope.workspaceRef,run.runId]);
  assert.equal(queue.rows[0].status,'queued');
  const events=await store.readEvents(scope,0);
  assert.ok(events.events.some(e=>e.type==='run.queued'));
});
test('leases fence stale workers, completion requires independent verification',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  const r=await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId)}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  const runRef=r.results[1].runRef;
  const job=await store.claimRun({workerRef:ident('worker'),workspaceRef:scope.workspaceRef});
  assert.equal(job.runRef,runRef);
  await assert.rejects(store.settleRun({workspaceRef:scope.workspaceRef,runRef,leaseToken:ident('wrong'),status:'failed'}),e=>e.code==='STALE_LEASE');
  await assert.rejects(store.settleRun({workspaceRef:scope.workspaceRef,runRef,leaseToken:job.leaseToken,status:'completed',evidenceRefs:['fake']}),e=>e.code==='RUN_VERIFICATION_UNAVAILABLE');
  assert.equal((await store.inspectRun(scope,runRef)).status,'running');
  await store.settleRun({workspaceRef:scope.workspaceRef,runRef,leaseToken:job.leaseToken,status:'failed'});
  assert.equal((await store.inspectRun(scope,runRef)).status,'failed');
  assert.equal((await newStore().inspectRun(scope,runRef)).status,'failed');
});
test('external-effect lease expiry marks outcome unknown without replay',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  const r=await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId,0,[definition('d','tool_task')])}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  const runRef=r.results[1].runRef;
  const claimed=await store.claimRun({workerRef:ident('worker'),workspaceRef:scope.workspaceRef});
  assert.equal(claimed.runRef,runRef);
  await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",[scope.workspaceRef,runRef]);
  const recovered=await newStore().claimRun({workerRef:ident('worker'),workspaceRef:scope.workspaceRef});
  assert.equal(recovered.outcomeUnknown,runRef);
  assert.equal((await store.inspectRun(scope,runRef)).status,'waiting');
  const row=await pool.query('SELECT status,attempts FROM ov_run_queue WHERE workspace_id=$1 AND run_id=$2',[scope.workspaceRef,runRef]);
  assert.equal(row.rows[0].status,'outcome_unknown');assert.equal(row.rows[0].attempts,1);
});
test('durable workspace event cursors are isolated and replayable',async()=>{
  const first=await setup(),second=await setup();
  const a=await first.store.readEvents(first.scope,0),b=await second.store.readEvents(second.scope,0);
  assert.ok(a.events.length>=2&&b.events.length>=2);
  assert.equal(a.events[0].id,1);assert.equal(b.events[0].id,1);
  assert.equal((await newStore().readEvents(first.scope,1)).events[0].id,2);
  assert.equal((await first.store.readEvents(first.scope,999999)).resetRequired,true);
});
test('HTTP OvllPointer deployment requires trusted auth and CSRF and never trusts client actorRef',async()=>{
  const {store,scope,graphId}=await setup();
  const app=createDurablePointerApp({store,authenticate:async(req)=>req.get('x-test-actor')?scope:null,
    verifyMutation:async(req)=>req.get('x-csrf')==='ok'});
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const url='http://127.0.0.1:'+server.address().port, path='/api/pointer/graphs/'+graphId;
    assert.equal((await fetch(url+path)).status,401);
    assert.equal((await fetch(url+'/api/pointer/tasks',{method:'POST',headers:{'content-type':'application/json','x-test-actor':'owner'},body:JSON.stringify({taskId:ident('task'),requestRef:ident('req'),objective:'test'})})).status,403);
    const r=await fetch(url+path,{headers:{'x-test-actor':'owner'}});
    assert.equal(r.status,200);assert.equal((await r.json()).graph.revision,0);
    const message=await fetch(url+'/api/pointer/turns',{method:'POST',
      headers:{'x-test-actor':'owner','x-csrf':'ok','Idempotency-Key':ident('req'),'content-type':'application/json'},
      body:JSON.stringify({actorRef:'spoofed',graphId,turn:{message:'hello'}})});
    assert.equal(message.status,200);assert.equal((await message.json()).message,'hello');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('lease renewal fences the old token and cancellation is durable',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  const r=await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId)}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  const runRef=r.results[1].runRef;
  const job=await store.claimRun({workerRef:ident('worker'),workspaceRef:scope.workspaceRef});
  assert.equal(await store.renewLease({workspaceRef:scope.workspaceRef,runRef,leaseToken:job.leaseToken}),true);
  assert.equal((await store.cancelRun(scope,runRef)).status,'cancelled');
  assert.equal((await newStore().inspectRun(scope,runRef)).status,'cancelled');
  await assert.rejects(store.renewLease({workspaceRef:scope.workspaceRef,runRef,leaseToken:job.leaseToken}),e=>e.code==='STALE_LEASE');
  await assert.rejects(store.settleRun({workspaceRef:scope.workspaceRef,runRef,leaseToken:job.leaseToken,status:'failed'}),e=>e.code==='STALE_LEASE');
  assert.equal(await store.claimRun({workerRef:ident('worker'),workspaceRef:scope.workspaceRef}),null);
});
test('worker uses trusted callback and records failures without completing Task',async()=>{
  const {store,scope,graphId,taskId,callScope}=await setup();
  const r=await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId)}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  const worker=createRunWorker({store,workerRef:ident('worker'),executeRun:async(job)=>{
    assert.equal(job.run.graphRef.revision,1);
    return {status:'failed',errorCode:'MODEL_UNAVAILABLE'};
  }});
  const result=await worker.workOnce({workspaceRef:scope.workspaceRef});
  assert.equal(result.runRef,r.results[1].runRef);
  assert.equal(result.status,'failed');
  const task=await pool.query('SELECT status FROM ov_tasks WHERE workspace_id=$1 AND task_id=$2',[scope.workspaceRef,taskId]);
  assert.equal(task.rows[0].status,'active');
});
test('worker refuses to manufacture successful Run when evidence gate missing',async()=>{
  const {store,scope,graphId,callScope}=await setup();
  await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId)}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  const worker=createRunWorker({store,workerRef:ident('worker'),executeRun:async()=>({status:'completed',evidenceRefs:['fake']})});
  await assert.rejects(worker.workOnce({workspaceRef:scope.workspaceRef}),e=>e.code==='RUN_VERIFICATION_UNAVAILABLE');
});

test('unsharded worker claims a queued Run using the DB-selected tenant',async()=>{
  const {store,graphId,callScope}=await setup();
  await store.submit({actions:[
    action('patch','ir.applyPatch',{patch:patch(graphId)}),
    action('run','run.start',{targets:[{fromAction:'patch',localNodeKey:'n'}]},['patch'])
  ]},callScope());
  const job=await newStore().claimRun({workerRef:ident('global_worker')});
  assert.equal(typeof job?.workspaceRef,'string');
  assert.equal(typeof job?.leaseToken,'string');
  const record=await pool.query('SELECT status,lease_token FROM ov_run_queue WHERE workspace_id=$1 AND run_id=$2',[job.workspaceRef,job.runRef]);
  assert.equal(record.rows[0].status,'leased');
  assert.equal(record.rows[0].lease_token,job.leaseToken);
});
