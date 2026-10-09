import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {PostgresVNextStore} from '../backend/vnext/durable.js';
import {createContractValidation} from '../backend/vnext/validation.js';
import {createNodeExecution,verifyNodeRunEvidence} from '../backend/vnext/nodeExecution.js';
import {createRunWorker} from '../backend/vnext/worker.js';
import {createDurableVNextApp} from '../backend/vnext/durableHttp.js';
if(!process.env.VNEXT_TEST_DATABASE_URL)throw Error('Isolated VNEXT_TEST_DATABASE_URL required');
const pool=new Pool({connectionString:process.env.VNEXT_TEST_DATABASE_URL,max:10});
const validation=createContractValidation(),uid=p=>p+'_'+randomUUID(),produced=v=>({status:'produced',values:{result:{inline:v}}});
const makeStore=opts=>new PostgresVNextStore({pool,validateTurn:validation.validateTurn,verifyRunEvidence:verifyNodeRunEvidence,...opts});
async function fixture(opts={}){
 const store=makeStore(opts),scope={workspaceRef:uid('ws'),actorRef:uid('actor'),taskRef:uid('task'),graphId:uid('g'),requestRef:uid('req')};
 await store.provisionWorkspace(scope.workspaceRef,scope.actorRef);await store.createGraph(scope,scope.graphId);
 await store.createTask(scope,{taskId:scope.taskRef,requestRef:uid('source'),objective:'Produce a useful result'});
 return {store,scope};
}
const proposal=(key,kind,args,dependsOn=[])=>({localKey:key,kind,args,...(dependsOn.length?{dependsOn}:{})});
const submit=(f,actions,requestRef=uid('req'))=>f.store.submit({actions},{...f.scope,requestRef});
before(async()=>{for(const name of ['001_initial.sql','002_node_evidence.sql','003_lifecycle.sql'])await pool.query(await readFile(new URL('../backend/vnext/sql/'+name,import.meta.url),'utf8'));});
after(async()=>{await pool.end();});
test('question proposal atomically waits Task and duplicate request does not create another question',async()=>{
 const f=await fixture(),requestRef=uid('req'),actions=[proposal('ask','question.ask',{question:'Which source?'})];
 const result=await submit(f,actions,requestRef);assert.equal(result.results[0].status,'applied');
 const ref=result.results[0].createdRefs.questionRef;
 assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'waiting');
 assert.equal((await f.store.readQuestion(f.scope,ref)).question.status,'open');
 assert.equal((await submit(f,actions,requestRef)).results[0].status,'duplicate');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM ov_questions WHERE workspace_id=$1',[f.scope.workspaceRef])).rows[0].n,1);
});
test('Task activates only after every question is answered and answers are immutable',async()=>{
 const f=await fixture();
 const result=await submit(f,[proposal('a','question.ask',{question:'Source?'}),proposal('b','question.ask',{question:'Format?'})]);
 const [a,b]=result.results.map(r=>r.createdRefs.questionRef);
 await f.store.answerQuestion(f.scope,a,'source');assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'waiting');
 const first=await f.store.answerQuestion(f.scope,b,{format:'text'});assert.equal(first.question.status,'answered');
 assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'active');
 assert.equal((await f.store.answerQuestion(f.scope,b,{format:'text'})).question.answerRef,first.question.answerRef);
 await assert.rejects(f.store.answerQuestion(f.scope,b,{format:'pdf'}),e=>e.code==='QUESTION_ANSWER_CONFLICT');
});
test('unknown blocked action reference cannot become an authoritative Question reference',async()=>{
 const f=await fixture();const result=await submit(f,[proposal('a','question.ask',{question:'Why?',blockedActions:['invented']})]);
 assert.equal(result.results[0].status,'rejected');assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'active');
});
test('open Question blocks its future Action until answered; past and self blockers are rejected',async()=>{
 const f=await fixture(),requestRef=uid('req');
 const actions=[proposal('ask','question.ask',{question:'Apply?',blockedActions:['patch']}),proposal('patch','ir.applyPatch',{patch:{graphId:f.scope.graphId,expectedGraphRevision:0,definitions:[{localKey:'d',purpose:'Work',instruction:'Work',executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]}],operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]}})];
 let r=await submit(f,actions,requestRef);assert.equal(r.results[1].error?.code,'ACTION_BLOCKED_BY_QUESTION');
 assert.equal((await f.store.readGraph(f.scope,f.scope.graphId)).graph.revision,0);
 await f.store.answerQuestion(f.scope,r.results[0].createdRefs.questionRef,true);
 r=await submit(f,actions,requestRef);assert.deepEqual(r.results.map(x=>x.status),['duplicate','applied']);
 r=await submit(f,[proposal('ask','question.ask',{question:'Self?',blockedActions:['ask']})]);assert.equal(r.results[0].error?.code,'BLOCKER_NOT_FUTURE_ACTION');
 r=await submit(f,[proposal('patch','ir.applyPatch',{patch:{graphId:f.scope.graphId,expectedGraphRevision:1,definitions:[],operations:[{op:'node.update',nodeId:(await f.store.readGraph(f.scope,f.scope.graphId)).graph.nodes[0].nodeId,settings:{changed:true}}]}}),proposal('ask','question.ask',{question:'Already done?',blockedActions:['patch']})]);
 assert.equal(r.results[1].error?.code,'BLOCKER_NOT_FUTURE_ACTION');
});
test('ledger replay is bound to Task and graph scope',async()=>{
 const f=await fixture(),requestRef=uid('req'),actions=[proposal('ask','question.ask',{question:'Source?'})];
 await submit(f,actions,requestRef);const taskRef=uid('task');
 await f.store.createTask(f.scope,{taskId:taskRef,requestRef:uid('source'),objective:'Another task'});
 const r=await f.store.submit({actions},{...f.scope,taskRef,requestRef});assert.equal(r.results[0].error?.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await f.store.readTask(f.scope,taskRef)).status,'active');
 const graphMismatch=await f.store.submit({actions},{...f.scope,graphId:uid('other'),requestRef});assert.equal(graphMismatch.results[0].error?.code,'IDEMPOTENCY_CONFLICT');
});
test('colon-bearing request and local keys cannot alias another action ledger entry',async()=>{
 const f=await fixture(),args={question:'Source?'};
 const first=await submit(f,[proposal('c','question.ask',args)],'a:b');
 const second=await submit(f,[proposal('b:c','question.ask',args)],'a');
 assert.equal(second.results[0].status,'applied');assert.notEqual(first.results[0].createdRefs.questionRef,second.results[0].createdRefs.questionRef);
 // Existing delimiter-key rows remain replay-safe without interpreting an aliased row as ours.
 await pool.query('UPDATE ov_action_ledger SET idempotency_key=$2 WHERE workspace_id=$1 AND idempotency_key=$3',[f.scope.workspaceRef,'a:b:c',JSON.stringify(['a:b','c'])]);
 assert.equal((await submit(f,[proposal('c','question.ask',args)],'a:b')).results[0].status,'duplicate');
});
test('Question snapshot and answer are read in one committed statement',async()=>{
 const f=await fixture(),ref=(await submit(f,[proposal('ask','question.ask',{question:'Source?'})])).results[0].createdRefs.questionRef;
 await f.store.answerQuestion(f.scope,ref,{source:'document'});let reads=0;
 const reader=makeStore({pool:{connect:async()=>{const c=await pool.connect();return {release:()=>c.release(),query:(sql,args)=>{if(/SELECT.*ov_question/s.test(sql))reads++;return c.query(sql,args);}};}}});
 const result=await reader.readQuestion(f.scope,ref);assert.equal(reads,1);assert.equal(result.question.status,'answered');assert.equal(result.question.answerRef,result.answer.ref);
});
test('Task creation applies the frozen schema before persistence',async()=>{
 const f=await fixture();
 await assert.rejects(f.store.createTask(f.scope,{taskId:uid('task'),requestRef:uid('source'),objective:'x'.repeat(2401)}));
 await assert.rejects(f.store.createTask(f.scope,{taskId:uid('task'),requestRef:uid('source'),objective:'Result',requiredOutcomes:[{name:42}]}));
});
test('foreign workspace cannot read or answer a Question',async()=>{
 const f=await fixture(),stranger=await fixture();const ref=(await submit(f,[proposal('a','question.ask',{question:'Private?'})])).results[0].createdRefs.questionRef;
 await assert.rejects(stranger.store.readQuestion(stranger.scope,ref),e=>e.code==='QUESTION_NOT_FOUND');
 await assert.rejects(stranger.store.answerQuestion(stranger.scope,ref,'fake'),e=>e.code==='QUESTION_NOT_FOUND');
});
async function queue(f){
 const definition={localKey:'d',purpose:'Process input',instruction:'Process',executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]};
 const patch={graphId:f.scope.graphId,expectedGraphRevision:0,definitions:[definition],operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]};
 const r=await submit(f,[proposal('p','ir.applyPatch',{patch}),proposal('r','run.start',{targets:[{fromAction:'p',localNodeKey:'n'}]},['p'])]);
 assert.deepEqual(r.results.map(x=>x.status),['applied','scheduled']);return {runRef:r.results[1].runRef,nodeId:r.results[0].createdRefs['node:n']};
}
test('run.cancel proposal uses the ledger and clears queue ownership',async()=>{
 const f=await fixture(),run=await queue(f),requestRef=uid('req'),actions=[proposal('c','run.cancel',{runRef:run.runRef})];
 assert.equal((await submit(f,actions,requestRef)).results[0].status,'applied');
 assert.equal((await f.store.inspectRun(f.scope,run.runRef)).status,'cancelled');
 assert.equal((await submit(f,actions,requestRef)).results[0].status,'duplicate');
});
test('explicit failed-node retry creates a new generation without deleting failed attempt',async()=>{
 const f=await fixture(),run=await queue(f);
 const bad=createNodeExecution({pool,executeNode:async()=>produced(4)});
 assert.equal((await createRunWorker({store:f.store,executeRun:bad,workerRef:uid('w')}).workOnce({workspaceRef:f.scope.workspaceRef})).status,'failed');
 assert.equal((await submit(f,[proposal('retry','run.retry',run)])).results[0].status,'scheduled');
 const good=createNodeExecution({pool,executeNode:async()=>produced('ok')});
 assert.equal((await createRunWorker({store:f.store,executeRun:good,workerRef:uid('w')}).workOnce({workspaceRef:f.scope.workspaceRef})).status,'completed');
 const a=await pool.query('SELECT generation,status FROM ov_attempts WHERE workspace_id=$1 ORDER BY generation',[f.scope.workspaceRef]);
 assert.deepEqual(a.rows,[{generation:0,status:'failed'},{generation:1,status:'success'}]);
});
test('retry refuses live Run and stale explicit Attempt',async()=>{
 const f=await fixture(),run=await queue(f);assert.equal((await submit(f,[proposal('retry','run.retry',run)])).results[0].status,'rejected');
 await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async()=>produced(1)})}).workOnce({workspaceRef:f.scope.workspaceRef});
 const out=await submit(f,[proposal('retry','run.retry',{...run,attemptRef:'a_wrong'})]);assert.equal(out.results[0].error.code,'STALE_RETRY_ATTEMPT');
});
test('Task completion always needs actual outcome verification independent of Run completion',async()=>{
 const f=await fixture(),run=await queue(f);await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async()=>produced('ok')})}).workOnce({workspaceRef:f.scope.workspaceRef});
 const refs=(await f.store.readEvents(f.scope)).events.find(e=>e.type==='run.completed').data.evidenceRefs;
 const result=await submit(f,[proposal('complete','task.complete',{outcomeRefs:refs})]);assert.equal(result.results[0].error.code,'TASK_VERIFICATION_UNAVAILABLE');
 assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'active');
});
test('verified Task completion stores its fact and forbids further Run scheduling',async()=>{
 const f=await fixture({verifyTaskOutcomes:async({artifacts})=>artifacts.every(a=>a.value==='ok')}),run=await queue(f);
 await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async()=>produced('ok')})}).workOnce({workspaceRef:f.scope.workspaceRef});
 const refs=(await f.store.readEvents(f.scope)).events.find(e=>e.type==='run.completed').data.evidenceRefs;
 assert.equal((await submit(f,[proposal('complete','task.complete',{outcomeRefs:refs})])).results[0].status,'applied');
 const task=await f.store.readTask(f.scope,f.scope.taskRef);assert.equal(task.status,'completed');assert.equal(validation.validate('Task',task),true);
 const result=await submit(f,[proposal('run','run.start',{targets:[{nodeId:run.nodeId}]})]);assert.equal(result.results[0].error.code,'TASK_NOT_ACTIVE');
});
test('Task completion cannot use invented outcomes or ignore pending Questions',async()=>{
 const f=await fixture({verifyTaskOutcomes:async()=>true});
 let r=await submit(f,[proposal('complete','task.complete',{outcomeRefs:['v_invented']})]);assert.equal(r.results[0].status,'rejected');
 await submit(f,[proposal('ask','question.ask',{question:'Source?'})]);
 r=await submit(f,[proposal('complete','task.complete',{outcomeRefs:['v_invented']})]);assert.equal(r.results[0].error.code,'TASK_HAS_OPEN_QUESTIONS');
});
test('Task outcome verifier timeout preserves active state and releases locks',async()=>{
 const f=await fixture({verifyTaskOutcomes:async()=>new Promise(()=>{}),maxTaskValidationMs:20}),run=await queue(f);
 await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async()=>produced('ok')})}).workOnce({workspaceRef:f.scope.workspaceRef});
 const refs=(await f.store.readEvents(f.scope)).events.find(e=>e.type==='run.completed').data.evidenceRefs;
 const result=await submit(f,[proposal('complete','task.complete',{outcomeRefs:refs})]);assert.equal(result.results[0].error.code,'TASK_VERIFICATION_TIMEOUT');
 assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'active');
});
test('tool failure cannot be retried as if its external effect were known',async()=>{
 const f=await fixture(),definition={localKey:'tool',purpose:'External effect',instruction:'Execute',executorKind:'tool_task',requiredCapabilities:['test.effect'],inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]};
 const patch={graphId:f.scope.graphId,expectedGraphRevision:0,definitions:[definition],operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'tool'}}]};
 const r=await submit(f,[proposal('p','ir.applyPatch',{patch}),proposal('run','run.start',{targets:[{fromAction:'p',localNodeKey:'n'}]},['p'])]);
 const run={runRef:r.results[1].runRef,nodeId:r.results[0].createdRefs['node:n']};
 await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,authorizeCapabilities:async()=>true,executeNode:async()=>{throw Error('effect unknown');}})}).workOnce({workspaceRef:f.scope.workspaceRef});
 const result=await submit(f,[proposal('retry','run.retry',run)]);assert.equal(result.results[0].error.code,'RUN_RETRY_NOT_SAFE');
});
test('proposed cancellation fences output from an already-running model node',async()=>{
 const f=await fixture(),run=await queue(f),job=await f.store.claimRun({workspaceRef:f.scope.workspaceRef,workerRef:uid('w')});
 const execute=createNodeExecution({pool,executeNode:async()=>{assert.equal((await submit(f,[proposal('cancel','run.cancel',{runRef:run.runRef})])).results[0].status,'applied');return produced('late');}});
 await assert.rejects(execute(job),e=>e.code==='STALE_LEASE');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM ov_value_artifacts WHERE workspace_id=$1',[f.scope.workspaceRef])).rows[0].n,0);
 assert.equal((await pool.query('SELECT status FROM ov_attempts WHERE workspace_id=$1',[f.scope.workspaceRef])).rows[0].status,'cancelled');
});
test('cancelling a model predecessor of a tool records cancelled rather than unknown effect',async()=>{
 const f=await fixture(),base={purpose:'Work',instruction:'Work',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]};
 const patch={graphId:f.scope.graphId,expectedGraphRevision:0,definitions:[{...base,localKey:'model',executorKind:'model_task'},{...base,localKey:'tool',executorKind:'tool_task',requiredCapabilities:['test.effect']}],operations:[{op:'node.add',localNodeKey:'m',definitionRef:{localDefinitionKey:'model'}},{op:'node.add',localNodeKey:'t',definitionRef:{localDefinitionKey:'tool'}},{op:'link.add',localLinkKey:'flow',kind:'flow',from:{node:{localNodeKey:'m'},port:'next'},to:{node:{localNodeKey:'t'},port:'in'}}]};
 const r=await submit(f,[proposal('p','ir.applyPatch',{patch}),proposal('run','run.start',{targets:[{fromAction:'p',localNodeKey:'t'}]},['p'])]);
 assert.deepEqual(r.results.map(x=>x.status),['applied','scheduled']);const runRef=r.results[1].runRef;
 const job=await f.store.claimRun({workspaceRef:f.scope.workspaceRef,workerRef:uid('w')});
 const execute=createNodeExecution({pool,authorizeCapabilities:async()=>true,executeNode:async()=>{await f.store.cancelRun(f.scope,runRef);return produced('late');}});
 await assert.rejects(execute(job),e=>e.code==='STALE_LEASE');
 assert.equal((await pool.query('SELECT status FROM ov_attempts WHERE workspace_id=$1',[f.scope.workspaceRef])).rows[0].status,'cancelled');
});
async function finish(f){
 const run=await queue(f);
 await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async()=>produced('ok')})}).workOnce({workspaceRef:f.scope.workspaceRef});
 const refs=(await f.store.readEvents(f.scope)).events.find(e=>e.type==='run.completed').data.evidenceRefs;
 return {...run,refs};
}
test('simultaneous identical answers store one immutable fact and conflicting answers cannot overwrite',async()=>{
 const f=await fixture(),ref=(await submit(f,[proposal('ask','question.ask',{question:'Source?'})])).results[0].createdRefs.questionRef;
 const answers=await Promise.all([f.store.answerQuestion(f.scope,ref,'source'),makeStore().answerQuestion(f.scope,ref,'source')]);
 assert.equal(answers[0].answer.ref,answers[1].answer.ref);
 await assert.rejects(makeStore().answerQuestion(f.scope,ref,'other'),e=>e.code==='QUESTION_ANSWER_CONFLICT');
 assert.equal((await f.store.readQuestion(f.scope,ref)).answer.value,'source');
});
test('answer racing a new question cannot reactivate Task with an open question',async()=>{
 const f=await fixture(),ref=(await submit(f,[proposal('ask','question.ask',{question:'Source?'})])).results[0].createdRefs.questionRef;
 await Promise.all([f.store.answerQuestion(f.scope,ref,'source'),submit(f,[proposal('new','question.ask',{question:'Format?'})])]);
 assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'waiting');
});
test('Task completion rejects real foreign Task evidence and pending Run despite valid prior outcomes',async()=>{
 const f=await fixture({verifyTaskOutcomes:async()=>true}),run=await finish(f),taskRef=uid('task');
 await f.store.createTask(f.scope,{taskId:taskRef,requestRef:uid('source'),objective:'Another result'});
 let r=await f.store.submit({actions:[proposal('complete','task.complete',{outcomeRefs:run.refs})]},{...f.scope,taskRef,requestRef:uid('req')});
 assert.equal(r.results[0].error.code,'TASK_OUTCOME_NOT_VERIFIED');
 r=await submit(f,[proposal('run','run.start',{targets:[{nodeId:run.nodeId}]})]);assert.equal(r.results[0].status,'scheduled');
 r=await submit(f,[proposal('complete','task.complete',{outcomeRefs:run.refs})]);assert.equal(r.results[0].error.code,'TASK_HAS_PENDING_RUNS');
});
test('required outcome evidence cannot be replaced by another valid artifact',async()=>{
 const f=await fixture({verifyTaskOutcomes:async()=>true}),run=await finish(f);
 await pool.query("UPDATE ov_tasks SET snapshot=jsonb_set(snapshot,'{requiredOutcomes}',$3::jsonb) WHERE workspace_id=$1 AND task_id=$2",[f.scope.workspaceRef,f.scope.taskRef,JSON.stringify([{name:'Source outcome',evidenceRefs:['v_required']}])]);
 const r=await submit(f,[proposal('complete','task.complete',{outcomeRefs:run.refs})]);assert.equal(r.results[0].error.code,'REQUIRED_OUTCOME_MISSING');
});
test('authenticated question HTTP reads and answers enforce membership CSRF and no caching',async()=>{
 const f=await fixture(),ref=(await submit(f,[proposal('ask','question.ask',{question:'Source?'})])).results[0].createdRefs.questionRef;
 const app=createDurableVNextApp({store:f.store,authenticate:async req=>req.get('x-actor')==='owner'?f.scope:null,verifyMutation:async req=>req.get('x-csrf')==='yes'});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const url='http://127.0.0.1:'+server.address().port+'/api/vnext/questions/'+ref;
 try{
  assert.equal((await fetch(url)).status,401);
  const read=await fetch(url,{headers:{'x-actor':'owner'}});assert.equal(read.headers.get('cache-control'),'no-store');assert.equal((await read.json()).question.status,'open');
  const opts={method:'POST',headers:{'content-type':'application/json','x-actor':'owner'},body:JSON.stringify({answer:'document'})};
  assert.equal((await fetch(url+'/answer',opts)).status,403);
  const answered=await fetch(url+'/answer',{...opts,headers:{...opts.headers,'x-csrf':'yes'}});assert.equal(answered.status,200);assert.equal((await answered.json()).question.status,'answered');
 }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('Task completion lock prevents a Run or Question appearing after semantic verification', {skip:process.env.VNEXT_SINGLE_SESSION_SMOKE==='1',timeout:15000},async()=>{
 let entered,release;const ready=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 const f=await fixture({verifyTaskOutcomes:async()=>{entered();await hold;return true;}}),run=await finish(f);
 const completing=submit(f,[proposal('complete','task.complete',{outcomeRefs:run.refs})]);await ready;
 const starting=submit(f,[proposal('run','run.start',{targets:[{nodeId:run.nodeId}]})]);
 const asking=submit(f,[proposal('ask','question.ask',{question:'Late question?'})]);
 release();const [a,b,c]=await Promise.all([completing,starting,asking]);
 assert.equal(a.results[0].status,'applied');assert.equal(b.results[0].error.code,'TASK_NOT_ACTIVE');assert.equal(c.results[0].error.code,'TASK_NOT_OPEN');
 assert.equal((await f.store.readTask(f.scope,f.scope.taskRef)).status,'completed');
});
test('retry preserves successful ancestors and reexecutes only failed descendants',async()=>{
 const f=await fixture(),base={purpose:'Work',instruction:'Work',executorKind:'model_task',outputs:[{name:'result',role:'result',representation:'text'}]};
 const patch={graphId:f.scope.graphId,expectedGraphRevision:0,definitions:[{...base,localKey:'a',inputs:[]},{...base,localKey:'b',inputs:[{name:'input',role:'source',representation:'text'}]}],operations:[{op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'a'}},{op:'node.add',localNodeKey:'b',definitionRef:{localDefinitionKey:'b'}},{op:'link.add',localLinkKey:'data',kind:'data',from:{node:{localNodeKey:'a'},port:'result'},to:{node:{localNodeKey:'b'},port:'input'}}]};
 const r=await submit(f,[proposal('p','ir.applyPatch',{patch}),proposal('run','run.start',{targets:[{fromAction:'p',localNodeKey:'b'}]},['p'])]),runRef=r.results[1].runRef,nodeId=r.results[0].createdRefs['node:b'];let calls=0;
 await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async({inputArtifacts})=>{calls++;return produced(inputArtifacts.length?4:'seed');}})}).workOnce({workspaceRef:f.scope.workspaceRef});
 assert.equal((await submit(f,[proposal('retry','run.retry',{runRef,nodeId})])).results[0].status,'scheduled');
 const result=await createRunWorker({store:f.store,workerRef:uid('w'),executeRun:createNodeExecution({pool,executeNode:async()=>{calls++;return produced('ok');}})}).workOnce({workspaceRef:f.scope.workspaceRef});
 assert.equal(result.status,'completed');assert.equal(calls,3);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM ov_attempts WHERE workspace_id=$1',[f.scope.workspaceRef])).rows[0].n,3);
});
