import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PostgresPointerStore } from '../backend/ovllPointer/durable.js';
import { createRunWorker } from '../backend/ovllPointer/worker.js';
import { createNodeExecution,verifyNodeRunEvidence } from '../backend/ovllPointer/nodeExecution.js';
if(!process.env.POINTER_TEST_DATABASE_URL)throw Error('Isolated POINTER_TEST_DATABASE_URL required');
const pool=new Pool({connectionString:process.env.POINTER_TEST_DATABASE_URL,max:10});
const uid=(prefix='t')=>prefix+'_'+randomUUID().replaceAll('-','').slice(0,19);
const produced=value=>({status:'produced',values:{result:{inline:value}}});
const validateTurn=turn=>!!turn&&Array.isArray(turn.actions);
const store=(options={})=>new PostgresPointerStore({pool,validateTurn,verifyRunEvidence:verifyNodeRunEvidence,...options});
const def=(key,ins=[])=>({localKey:key,purpose:'Transform data',instruction:'Process inputs',executorKind:'model_task',
  inputs:ins,outputs:[{name:'result',role:'result',representation:'text'}]});
const add=(n,d)=>({op:'node.add',localNodeKey:n,definitionRef:{localDefinitionKey:d}});
const connect=(type,a,b)=>({op:'link.add',localLinkKey:uid('edge'),kind:type,
  from:{node:{localNodeKey:a},port:'result'},to:{node:{localNodeKey:b},port:'input'}});
async function fixture({conditional=false,toolRoot=false}={}){
  const s=store(),workspaceRef=uid('ws'),actorRef=uid('actor'),scope={workspaceRef,actorRef},
    graphId=uid('g'),taskId=uid('task'),requestRef=uid('request');
  await s.provisionWorkspace(workspaceRef,actorRef);
  await s.createGraph(scope,graphId);
  await s.createTask(scope,{taskId,requestRef:uid('source'),objective:'Turn source text into a reusable result'});
  const ops=[add('root','a'),add('child','b'),connect('data','root','child')];
  if(conditional)ops.push({...connect('flow','root','child'),from:{node:{localNodeKey:'root'},port:'true'}});
  const patch={graphId,expectedGraphRevision:0,definitions:[{...def('a'),...(toolRoot?{executorKind:'tool_task',requiredCapabilities:['test.effect']}: {})},def('b',[{name:'input',role:'source',representation:'text'}])],operations:ops};
  const result=await s.submit({actions:[
    {localKey:'patch',kind:'ir.applyPatch',args:{patch}},
    {localKey:'run',kind:'run.start',dependsOn:['patch'],args:{targets:[{fromAction:'patch',localNodeKey:'child'}]}}
  ]},{...scope,requestRef,graphId,taskRef:taskId});
  assert.deepEqual(result.results.map(x=>x.status),['applied','scheduled']);
  return {...scope,scope,graphId,taskId,createdRefs:result.results[0].createdRefs,runRef:result.results[1].runRef,store:s};
}
before(async()=>{for(const file of ['001_initial.sql','002_node_evidence.sql','003_lifecycle.sql']){
  await pool.query(await readFile(new URL('../backend/ovllPointer/sql/'+file,import.meta.url),'utf8'));
}});
after(async()=>{await pool.end();});
test('Run executes pinned graph topologically and stores Attempt, ValueArtifact and provenance atomically',async()=>{
  const f=await fixture(),calls=[];
  const executeRun=createNodeExecution({pool,executeNode:async({node,inputArtifacts})=>{
    calls.push({nodeId:node.nodeId,inputCount:inputArtifacts.length});
    return produced(inputArtifacts.length?inputArtifacts[0].value+' processed':'seed');
  }});
  const worker=createRunWorker({store:f.store,executeRun,workerRef:uid('worker')});
  const result=await worker.workOnce({workspaceRef:f.workspaceRef});
  assert.equal(result.status,'completed');
  assert.deepEqual(calls.map(c=>c.inputCount),[0,1]);
  assert.equal((await f.store.inspectRun(f.scope,f.runRef)).status,'completed');
  const attempts=await pool.query('SELECT node_id,status,output_refs,input_refs,plan_epoch,generation FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2 ORDER BY generation,attempt_id',
    [f.workspaceRef,f.runRef]);
  assert.equal(attempts.rows.length,2);
  assert.equal(attempts.rows.filter(x=>x.status==='success').length,2);
  assert.equal(attempts.rows.filter(x=>x.plan_epoch!==0).length,0);
  const artifacts=await pool.query('SELECT node_id,output_port,value,source_refs FROM ov_value_artifacts WHERE workspace_id=$1 AND run_id=$2',
    [f.workspaceRef,f.runRef]);
  assert.equal(artifacts.rows.length,2);
  assert.ok(artifacts.rows.some(x=>x.value==='seed'));
  const child=artifacts.rows.find(x=>x.value==='seed processed');
  assert.ok(child);assert.equal(child.source_refs.length,1);
  const task=await pool.query('SELECT status FROM ov_tasks WHERE workspace_id=$1 AND task_id=$2',[f.workspaceRef,f.taskId]);
  assert.equal(task.rows[0].status,'active','Run completed must not imply Task completed');
});
test('Callback cannot create undeclared output ports; rejected node has no artifact',async()=>{
  const f=await fixture();
  const executeRun=createNodeExecution({pool,executeNode:async()=>({status:'produced',values:{fictional:{inline:'wrong'}}})});
  const result=await createRunWorker({store:f.store,executeRun,workerRef:uid('worker')}).workOnce({workspaceRef:f.workspaceRef});
  assert.equal(result.status,'failed');
  const attempt=await pool.query('SELECT status FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2',[f.workspaceRef,f.runRef]);
  assert.deepEqual(attempt.rows.map(x=>x.status),['failed']);
  const values=await pool.query('SELECT count(*)::int AS count FROM ov_value_artifacts WHERE workspace_id=$1 AND run_id=$2',[f.workspaceRef,f.runRef]);
  assert.equal(values.rows[0].count,0);
});
test('Result verification refuses invented evidence even when Run has begun',async()=>{
  const f=await fixture();
  const job=await f.store.claimRun({workerRef:uid('worker'),workspaceRef:f.workspaceRef});
  await assert.rejects(f.store.settleRun({workspaceRef:f.workspaceRef,runRef:f.runRef,leaseToken:job.leaseToken,
    status:'completed',evidenceRefs:['v_fabricated']}),e=>e.code==='RUN_EVIDENCE_NOT_VERIFIED');
  assert.equal((await f.store.inspectRun(f.scope,f.runRef)).status,'running');
});
test('Expired lease cannot persist delayed model output after new owner reclaims work',async()=>{
  const f=await fixture();
  const job=await f.store.claimRun({workerRef:uid('worker'),workspaceRef:f.workspaceRef});
  const run=createNodeExecution({pool,executeNode:async()=>{
    await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",
      [f.workspaceRef,f.runRef]);
    return produced('late');
  }});
  await assert.rejects(run(job),e=>e.code==='STALE_LEASE');
  const r=await pool.query('SELECT count(*)::int AS n FROM ov_value_artifacts WHERE workspace_id=$1 AND run_id=$2',[f.workspaceRef,f.runRef]);
  assert.equal(r.rows[0].n,0);
});
test('Reclaimed pure-model run reuses persisted semantic attempts without a duplicate model call',async()=>{
  const f=await fixture(),original=await f.store.claimRun({workerRef:uid('worker'),workspaceRef:f.workspaceRef});
  let calls=0;
  const run=createNodeExecution({pool,executeNode:async({inputArtifacts})=>{
    calls++;return produced(inputArtifacts.length?'B':'A');
  }});
  const first=await run(original);
  assert.equal(first.status,'completed');
  assert.equal(calls,2);
  await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);
  const replacement=await f.store.claimRun({workerRef:uid('worker2'),workspaceRef:f.workspaceRef});
  assert.equal(replacement.runRef,f.runRef);
  const second=await run(replacement);
  assert.deepEqual(second.evidenceRefs,first.evidenceRefs);
  assert.equal(calls,2);
  const finished=await f.store.settleRun({workspaceRef:f.workspaceRef,runRef:f.runRef,leaseToken:replacement.leaseToken,
    status:'completed',evidenceRefs:second.evidenceRefs});
  assert.equal(finished.status,'completed');
  const a=await pool.query('SELECT count(*)::int AS n FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2',[f.workspaceRef,f.runRef]);
  assert.equal(a.rows[0].n,2);
});
test('Conditional flow branches are blocked instead of executing both outcomes',async()=>{
  const f=await fixture({conditional:true});
  const job=await f.store.claimRun({workerRef:uid('worker'),workspaceRef:f.workspaceRef});
  let calls=0;
  const run=createNodeExecution({pool,executeNode:async()=>{calls++;return produced('x');}});
  await assert.rejects(run(job),e=>e.code==='CONDITIONAL_ROUTING_NOT_IMPLEMENTED');
  assert.equal(calls,0);
});

test('same Run and lease cannot execute simultaneously through two executor invocations',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 let enter,release;const entered=new Promise(r=>enter=r),hold=new Promise(r=>release=r);let calls=0;
 const run=createNodeExecution({pool,executeNode:async()=>{calls++;if(calls===1){enter();await hold;}return produced('x');}});
 const first=run(job);await entered;
 try{await assert.rejects(run(job),e=>e.code==='RUN_EXECUTION_IN_PROGRESS');}finally{release();}
 assert.equal((await first).status,'completed');assert.equal(calls,2);
});
test('tampered job settings do not override DB pinned Run',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});let calls=0;
 const run=createNodeExecution({pool,executeNode:async()=>{calls++;return produced('x');}});
 await assert.rejects(run({...job,run:{...job.run,targets:[job.run.targets[0]],damMode:'open'}}),e=>e.code==='PINNED_RUN_MISMATCH');
 assert.equal(calls,0);
});
test('blocked NodeOutput persists no values and puts Run in waiting',async()=>{
 const f=await fixture();
 const run=createNodeExecution({pool,executeNode:async()=>({status:'blocked',reason:'Need a file'})});
 const result=await createRunWorker({store:f.store,executeRun:run,workerRef:uid('w')}).workOnce({workspaceRef:f.workspaceRef});
 assert.equal(result.status,'waiting');
 const values=await pool.query('SELECT count(*)::int AS n FROM ov_value_artifacts WHERE workspace_id=$1',[f.workspaceRef]);assert.equal(values.rows[0].n,0);
 const a=await pool.query('SELECT result FROM ov_attempts WHERE workspace_id=$1',[f.workspaceRef]);assert.equal(a.rows[0].result.reason,'Need a file');
});
test('revoked execution membership prevents the next model invocation',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 await pool.query('DELETE FROM ov_members WHERE workspace_id=$1 AND actor_ref=$2',[f.workspaceRef,f.actorRef]);let calls=0;
 const run=createNodeExecution({pool,executeNode:async()=>{calls++;return produced('x');}});
 await assert.rejects(run(job),e=>e.code==='EXECUTION_FORBIDDEN');assert.equal(calls,0);
});
test('changed planEpoch cannot accept a delayed worker result',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 const run=createNodeExecution({pool,executeNode:async()=>{
  await pool.query("UPDATE ov_runs SET plan_epoch=1,snapshot=jsonb_set(snapshot,'{planEpoch}','1') WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);return produced('late');
 }});
 await assert.rejects(run(job),e=>e.code==='PINNED_RUN_MISMATCH');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM ov_value_artifacts WHERE workspace_id=$1',[f.workspaceRef])).rows[0].n,0);
});
test('completion verifier refuses corrupt persisted representations',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 const result=await createNodeExecution({pool,executeNode:async()=>produced('x')})(job);
 await pool.query("UPDATE ov_value_artifacts SET value='{}'::jsonb WHERE workspace_id=$1",[f.workspaceRef]);
 await assert.rejects(f.store.settleRun({...job,status:'completed',evidenceRefs:result.evidenceRefs}),e=>e.code==='RUN_EVIDENCE_NOT_VERIFIED');
});
test('successful pure-model predecessor survives a real mid-run crash and expired lease',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});let calls=0;
 const first=createNodeExecution({pool,executeNode:async({inputArtifacts})=>{
  calls++;if(inputArtifacts.length)await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);return produced(inputArtifacts.length?'lost':'seed');
 }});
 await assert.rejects(first(job),e=>e.code==='STALE_LEASE');
 const replacement=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 const result=await createNodeExecution({pool,executeNode:async({inputArtifacts})=>{calls++;assert.equal(inputArtifacts[0].value,'seed');return produced('recovered');}})(replacement);
 assert.equal(calls,3);assert.equal(result.status,'completed');
 const rows=await pool.query('SELECT status FROM ov_attempts WHERE workspace_id=$1',[f.workspaceRef]);
 assert.equal(rows.rows.filter(a=>a.status==='cancelled').length,1);
 assert.equal((await f.store.settleRun({...replacement,status:'completed',evidenceRefs:result.evidenceRefs})).status,'completed');
});
test('single-connection pool executes without starving itself or lease renewal',async()=>{
 const f=await fixture(),one=new Pool({connectionString:process.env.POINTER_TEST_DATABASE_URL,max:1});
 try{
  const run=createNodeExecution({pool:one,executeNode:async()=>produced('x')});
  const worker=createRunWorker({store:f.store,executeRun:run,workerRef:uid('w')});
  assert.equal((await worker.workOnce({workspaceRef:f.workspaceRef})).status,'completed');
 }finally{await one.end();}
});
test('node time budget stops an executor that ignores AbortSignal',async()=>{
 const f=await fixture();
 const run=createNodeExecution({pool,maxNodeMs:20,executeNode:async()=>new Promise(()=>{})});
 const result=await createRunWorker({store:f.store,executeRun:run,workerRef:uid('w')}).workOnce({workspaceRef:f.workspaceRef});
 assert.equal(result.status,'failed');
 const row=await pool.query('SELECT status,result FROM ov_attempts WHERE workspace_id=$1',[f.workspaceRef]);
 assert.equal(row.rows[0].result.code,'NODE_EXECUTION_TIMEOUT');
});
test('corrupt reused output representation is rejected before downstream execution',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 await createNodeExecution({pool,executeNode:async()=>produced('x')})(job);
 await pool.query("UPDATE ov_value_artifacts SET representation='json' WHERE workspace_id=$1",[f.workspaceRef]);
 await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);
 const next=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});let calls=0;
 await assert.rejects(createNodeExecution({pool,executeNode:async()=>{calls++;return produced('x');}})(next),e=>e.code==='CORRUPT_ATTEMPT_OUTPUTS');
 assert.equal(calls,0);
});
test('adopting stronger output verification cannot reuse contract-only artifacts',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 await createNodeExecution({pool,executeNode:async()=>produced('x')})(job);
 await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);
 const next=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});let calls=0;
 await assert.rejects(createNodeExecution({pool,validateNodeOutput:async()=>false,executeNode:async()=>{calls++;return produced('x');}})(next),e=>e.code==='OUTPUT_VERIFICATION_POLICY_CHANGED');
 assert.equal(calls,0);
});
test('referenced validation callback cannot wait beyond execution budget',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 await createNodeExecution({pool,validateNodeOutput:async()=>true,executeNode:async()=>produced('x')})(job);
 await pool.query("UPDATE ov_run_queue SET leased_until=now()-interval '1 second' WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);
 const next=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 await assert.rejects(createNodeExecution({pool,maxNodeMs:20,validateNodeOutput:async()=>new Promise(()=>{}),executeNode:async()=>produced('x')})(next),e=>e.code==='NODE_EXECUTION_TIMEOUT');
});
test('old epoch worker cannot fail a newly adopted Run plan',async()=>{
 const f=await fixture();
 const run=createNodeExecution({pool,executeNode:async()=>{
  await pool.query("UPDATE ov_runs SET plan_epoch=1,snapshot=jsonb_set(snapshot,'{planEpoch}','1') WHERE workspace_id=$1 AND run_id=$2",[f.workspaceRef,f.runRef]);return produced('late');
 }});
 await assert.rejects(createRunWorker({store:f.store,executeRun:run,workerRef:uid('w')}).workOnce({workspaceRef:f.workspaceRef}),e=>e.code==='STALE_PLAN_EPOCH');
 assert.equal((await f.store.inspectRun(f.scope,f.runRef)).status,'running');
});
test('tool timeout is outcome_unknown and never automatically claimed again',async()=>{
 const f=await fixture({toolRoot:true});let calls=0;
 const run=createNodeExecution({pool,maxNodeMs:20,authorizeCapabilities:async()=>true,executeNode:async()=>{calls++;return new Promise(()=>{});}});
 assert.equal((await createRunWorker({store:f.store,executeRun:run,workerRef:uid('w')}).workOnce({workspaceRef:f.workspaceRef})).status,'waiting');
 assert.equal(calls,1);
 assert.equal((await pool.query('SELECT status FROM ov_attempts WHERE workspace_id=$1',[f.workspaceRef])).rows[0].status,'outcome_unknown');
 assert.equal(await f.store.claimRun({workspaceRef:f.workspaceRef,workerRef:uid('w')}),null);
});
test('a data join waits for both producers and never treats flow-only edges as values',async()=>{
 const f=await fixture();await f.store.cancelRun(f.scope,f.runRef);
 const link=(key,from,to,port,kind='data')=>({op:'link.add',localLinkKey:key,kind,from:{node:from,port:'result'},to:{node:to,port}});
 const patch={graphId:f.graphId,expectedGraphRevision:1,definitions:[def('join',[
  {name:'left',role:'source',representation:'text',required:true},{name:'right',role:'source',representation:'text',required:true}
 ])],operations:[
  {op:'node.add',localNodeKey:'other',definitionRef:{definitionId:f.createdRefs['definition:a'],version:1}},add('joined','join'),
  link('left',{nodeId:f.createdRefs['node:child']},{localNodeKey:'joined'},'left'),
  link('right',{localNodeKey:'other'},{localNodeKey:'joined'},'right'),
  link('order',{nodeId:f.createdRefs['node:root']},{localNodeKey:'joined'},'enter','flow')
 ]};
 const result=await f.store.submit({actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch}},
  {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[{fromAction:'p',localNodeKey:'joined'}]}}
 ]},{...f.scope,requestRef:uid('request'),graphId:f.graphId,taskRef:f.taskId});
 assert.deepEqual(result.results.map(r=>r.status),['applied','scheduled']);let sawJoin=false;
 const execute=createNodeExecution({pool,executeNode:async({inputArtifacts})=>{
  if(inputArtifacts.length===2){sawJoin=true;assert.deepEqual(inputArtifacts.map(a=>a.port),['left','right']);assert.notEqual(inputArtifacts[0].valueRef,inputArtifacts[1].valueRef);}
  return produced(inputArtifacts.map(a=>a.value).join('+')||'seed');
 }});
 assert.equal((await createRunWorker({store:f.store,executeRun:execute,workerRef:uid('w')}).workOnce({workspaceRef:f.workspaceRef})).status,'completed');assert.equal(sawJoin,true);
});
test('artifact insert failure rolls back values and node success event together',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 const trigger=uid('fail');
 await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test insert failure'; END; $$;
 CREATE TRIGGER ${trigger} BEFORE INSERT ON ov_value_artifacts FOR EACH ROW WHEN (NEW.workspace_id='${f.workspaceRef}') EXECUTE FUNCTION ${trigger}();`);
 try{
  await assert.rejects(createNodeExecution({pool,executeNode:async()=>produced('x')})(job),/test insert failure/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ov_value_artifacts WHERE workspace_id=$1',[f.workspaceRef])).rows[0].n,0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM ov_events WHERE workspace_id=$1 AND event_type='node.success'",[f.workspaceRef])).rows[0].n,0);
  assert.equal((await pool.query('SELECT status FROM ov_attempts WHERE workspace_id=$1',[f.workspaceRef])).rows[0].status,'running');
 }finally{await pool.query(`DROP TRIGGER ${trigger} ON ov_value_artifacts; DROP FUNCTION ${trigger}();`);}
});
test('completion representation checker has a finite validation deadline',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 const outcome=await createNodeExecution({pool,executeNode:async()=>produced('x')})(job);
 // Introduce a custom representation into the isolated test snapshot and update the matching fingerprints.
 const pin=await pool.query('SELECT snapshot FROM ov_graph_revisions WHERE workspace_id=$1 AND graph_id=$2 AND revision=1',[f.workspaceRef,f.graphId]);
 const snapshot=pin.rows[0].snapshot;
 for(const d of snapshot.definitions){for(const p of [...d.inputs,...d.outputs])p.representation='custom';}
 await pool.query('UPDATE ov_graph_revisions SET snapshot=$3::jsonb WHERE workspace_id=$1 AND graph_id=$2 AND revision=1',[f.workspaceRef,f.graphId,JSON.stringify(snapshot)]);
 await pool.query("UPDATE ov_value_artifacts SET representation='custom' WHERE workspace_id=$1",[f.workspaceRef]);
 const {semanticFingerprint}=await import('../backend/ovllPointer/executionPlan.js');
 const attempts=await pool.query('SELECT attempt_id,node_id,input_refs FROM ov_attempts WHERE workspace_id=$1',[f.workspaceRef]);
 for(const a of attempts.rows){const node=snapshot.graph.nodes.find(n=>n.nodeId===a.node_id),definition=snapshot.definitions.find(d=>d.definitionId===node.definitionRef.definitionId);
  await pool.query('UPDATE ov_attempts SET fingerprint=$3 WHERE workspace_id=$1 AND attempt_id=$2',[f.workspaceRef,a.attempt_id,semanticFingerprint({run:job.run,node,definition,inputRefs:a.input_refs})]);}
 const s=store({verifyRunEvidence:ctx=>verifyNodeRunEvidence({...ctx,maxValidationMs:20,validateRepresentation:async()=>new Promise(()=>{})})});
 await assert.rejects(s.settleRun({...job,status:'completed',evidenceRefs:outcome.evidenceRefs}),e=>e.code==='RUN_EVIDENCE_NOT_VERIFIED');
});
test('artifact read returns frozen ValueArtifact and actual content with tenant isolation',async()=>{
 const f=await fixture(),job=await f.store.claimRun({workerRef:uid('w'),workspaceRef:f.workspaceRef});
 const outcome=await createNodeExecution({pool,executeNode:async()=>produced('x')})(job);
 const result=await f.store.readArtifact(f.scope,outcome.evidenceRefs[0]);
 const {createContractValidation}=await import('../backend/ovllPointer/validation.js');
 assert.equal(createContractValidation().validate('ValueArtifact',result.artifact),true);
 assert.equal(result.content.value,'x');assert.equal(result.content.representation,'text');
 const stranger={workspaceRef:uid('ws'),actorRef:uid('actor')};await f.store.provisionWorkspace(stranger.workspaceRef,stranger.actorRef);
 await assert.rejects(f.store.readArtifact(stranger.scope||stranger,outcome.evidenceRefs[0]),e=>e.code==='ARTIFACT_NOT_FOUND');
});
test('standalone runtime HTTP serves executed results and refuses forged ModelTurn fields',async()=>{
 const f=await fixture();const {createPointerRuntime}=await import('../backend/ovllPointer/runtime.js');
 const runtime=createPointerRuntime({pool,executeNode:async()=>produced('http result'),workerRef:uid('w'),
  authenticate:async()=>f.scope,verifyMutation:async()=>true});
 assert.equal((await runtime.worker.workOnce({workspaceRef:f.workspaceRef})).status,'completed');
 const events=await f.store.readEvents(f.scope);const evidence=events.events.find(e=>e.type==='run.completed').data.evidenceRefs[0];
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const url='http://127.0.0.1:'+server.address().port;
  const response=await fetch(url+'/api/pointer/artifacts/'+evidence);assert.equal(response.status,200);assert.equal((await response.json()).content.value,'http result');
  const state=await fetch(url+'/api/pointer/runs/'+f.runRef);assert.equal((await state.json()).status,'completed');
  const forged=await fetch(url+'/api/pointer/turns',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':uid('r')},body:JSON.stringify({turn:{message:'ok',actorRef:'fake'}})});
  assert.equal(forged.status,422);assert.equal((await forged.json()).error.code,'INVALID_MODEL_TURN');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
