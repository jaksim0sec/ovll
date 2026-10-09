import {randomUUID} from 'node:crypto';
import {KernelError} from './graph.js';
import {assertJsonValue} from './nodeOutput.js';
import {buildExecutionPlan} from './executionPlan.js';
const deny=(code,status=422)=>{throw new KernelError(code,code,status);};
const json=v=>JSON.stringify(v);
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
async function taskRow(c,scope){
  if(!id(scope.taskRef))deny('TASK_REQUIRED');
  const r=await c.query('SELECT status,snapshot FROM ov_tasks WHERE workspace_id=$1 AND task_id=$2 FOR UPDATE',[scope.workspaceRef,scope.taskRef]);
  if(!r.rows.length)deny('TASK_NOT_FOUND',404);
  return r.rows[0];
}
async function taskState(c,scope,task,status){
  const snapshot={...task,status};
  await c.query('UPDATE ov_tasks SET status=$3,snapshot=$4::jsonb WHERE workspace_id=$1 AND task_id=$2',[scope.workspaceRef,scope.taskRef,status,json(snapshot)]);
  return snapshot;
}
export async function askQuestion(c,scope,args,{emit,knownActions}){
  const row=await taskRow(c,scope);
  if(!['active','waiting'].includes(row.status))deny('TASK_NOT_OPEN',409);
  if(typeof args.question!=='string'||!args.question.trim()||args.question.length>2400)deny('BAD_QUESTION');
  const refs=(args.blockedActions||[]).map(k=>knownActions.get(k)||deny('UNKNOWN_BLOCKED_ACTION'));
  const questionId='q_'+randomUUID();
  const question={questionId,taskRef:scope.taskRef,prompt:args.question,blockedActionRefs:refs,status:'open'};
  const questions=[...(row.snapshot.questionRefs||[]),questionId];
  if(questions.length>512)deny('QUESTION_LIMIT');
  await c.query("INSERT INTO ov_questions(workspace_id,question_id,task_id,status,snapshot) VALUES($1,$2,$3,'open',$4::jsonb)",[scope.workspaceRef,questionId,scope.taskRef,json(question)]);
  await taskState(c,scope,{...row.snapshot,questionRefs:questions},'waiting');
  await emit(c,scope.workspaceRef,'question.opened',{taskRef:scope.taskRef,questionRef:questionId});
  return questionId;
}
export async function answerQuestion(c,scope,questionRef,answer,{emit}){
  if(!id(questionRef))deny('BAD_QUESTION_REF');
  assertJsonValue(answer);
  if(Buffer.byteLength(json(answer),'utf8')>32768)deny('ANSWER_TOO_LARGE');
  const found=await c.query('SELECT task_id FROM ov_questions WHERE workspace_id=$1 AND question_id=$2',[scope.workspaceRef,questionRef]);
  if(!found.rows.length)deny('QUESTION_NOT_FOUND',404);
  const taskScope={...scope,taskRef:found.rows[0].task_id},task=await taskRow(c,taskScope);
  const r=await c.query('SELECT status,snapshot FROM ov_questions WHERE workspace_id=$1 AND question_id=$2 FOR UPDATE',[scope.workspaceRef,questionRef]);
  const row=r.rows[0];
  if(row.status==='answered'){
    const previous=await c.query('SELECT answer_id,value FROM ov_question_answers WHERE workspace_id=$1 AND question_id=$2',[scope.workspaceRef,questionRef]);
    if(!previous.rows.length||canonical(previous.rows[0].value)!==canonical(answer))deny('QUESTION_ANSWER_CONFLICT',409);
    return {question:row.snapshot,answer:{ref:previous.rows[0].answer_id,value:previous.rows[0].value}};
  }
  if(row.status!=='open'||!['active','waiting'].includes(task.status))deny('QUESTION_NOT_OPEN',409);
  const answerRef='ans_'+randomUUID(),question={...row.snapshot,status:'answered',answerRef};
  await c.query('INSERT INTO ov_question_answers(workspace_id,answer_id,question_id,value) VALUES($1,$2,$3,$4::jsonb)',[scope.workspaceRef,answerRef,questionRef,json(answer)]);
  await c.query("UPDATE ov_questions SET status='answered',snapshot=$3::jsonb WHERE workspace_id=$1 AND question_id=$2",[scope.workspaceRef,questionRef,json(question)]);
  const remaining=await c.query("SELECT 1 FROM ov_questions WHERE workspace_id=$1 AND task_id=$2 AND status='open' LIMIT 1",[scope.workspaceRef,taskScope.taskRef]);
  if(!remaining.rows.length)await taskState(c,taskScope,task.snapshot,'active');
  await emit(c,scope.workspaceRef,'question.answered',{taskRef:taskScope.taskRef,questionRef,answerRef});
  return {question,answer:{ref:answerRef,value:answer}};
}
export async function cancelRun(c,scope,runRef,{emit}){
  if(!id(runRef))deny('BAD_RUN_REF');
  const q=await c.query('SELECT status,external_effect FROM ov_run_queue WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE',[scope.workspaceRef,runRef]);
  if(!q.rows.length)deny('RUN_NOT_FOUND',404);
  const r=await c.query('SELECT status,task_id,graph_id,graph_revision FROM ov_runs WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE',[scope.workspaceRef,runRef]);
  if(scope.taskRef&&r.rows[0].task_id!==scope.taskRef)deny('RUN_TASK_SCOPE_MISMATCH',403);
  if(r.rows[0].status==='completed')deny('RUN_ALREADY_COMPLETED',409);
  if(r.rows[0].status==='cancelled')return;
  await c.query("UPDATE ov_run_queue SET status='cancelled',execution_token=NULL,lease_token=NULL,leased_until=NULL,updated_at=now() WHERE workspace_id=$1 AND run_id=$2",[scope.workspaceRef,runRef]);
  await c.query("UPDATE ov_runs SET status='cancelled',snapshot=jsonb_set(snapshot,'{status}','\"cancelled\"') WHERE workspace_id=$1 AND run_id=$2",[scope.workspaceRef,runRef]);
  const pin=await c.query('SELECT snapshot FROM ov_graph_revisions WHERE workspace_id=$1 AND graph_id=$2 AND revision=$3',[scope.workspaceRef,r.rows[0].graph_id,r.rows[0].graph_revision]);
  const attempts=await c.query("SELECT attempt_id,definition_ref FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2 AND status='running' FOR UPDATE",[scope.workspaceRef,runRef]);
  for(const attempt of attempts.rows){
    const definition=pin.rows[0]?.snapshot.definitions.find(d=>d.definitionId===attempt.definition_ref?.definitionId&&d.version===attempt.definition_ref?.version);
    const status=definition?.executorKind==='model_task'?'cancelled':'outcome_unknown';
    await c.query('UPDATE ov_attempts SET status=$3,result=$4::jsonb WHERE workspace_id=$1 AND attempt_id=$2',[scope.workspaceRef,attempt.attempt_id,status,json({code:'RUN_CANCELLED'})]);
  }
  await emit(c,scope.workspaceRef,'run.cancelled',{runRef});
}
export async function retryRun(c,scope,args,{emit}){
  const task=await taskRow(c,scope);
  if(task.status!=='active')deny('TASK_NOT_ACTIVE',409);
  if(!id(args.runRef)||!id(args.nodeId))deny('BAD_RETRY');
  const q=await c.query('SELECT status,external_effect FROM ov_run_queue WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE',[scope.workspaceRef,args.runRef]);
  if(!q.rows.length)deny('RUN_NOT_FOUND',404);
  const r=await c.query('SELECT status,task_id,snapshot,plan_epoch FROM ov_runs WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE',[scope.workspaceRef,args.runRef]);
  const row=r.rows[0],run=row.snapshot;
  if(run.planEpoch!==row.plan_epoch)deny('STALE_PLAN_EPOCH',409);
  if(row.task_id!==scope.taskRef)deny('RUN_TASK_SCOPE_MISMATCH',403);
  if(q.rows[0].external_effect||!['failed','waiting'].includes(row.status))deny('RUN_RETRY_NOT_SAFE',409);
  const pin=await c.query('SELECT snapshot FROM ov_graph_revisions WHERE workspace_id=$1 AND graph_id=$2 AND revision=$3',[scope.workspaceRef,run.graphRef.graphId,run.graphRef.revision]);
  if(!pin.rows.length||!buildExecutionPlan(pin.rows[0].snapshot,run).order.some(n=>n.nodeId===args.nodeId))deny('RETRY_NODE_OUTSIDE_PLAN');
  const a=await c.query('SELECT attempt_id,status FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2 AND node_id=$3 AND plan_epoch=$4 ORDER BY generation DESC LIMIT 1',[scope.workspaceRef,args.runRef,args.nodeId,row.plan_epoch]);
  if(args.attemptRef&&a.rows[0]?.attempt_id!==args.attemptRef)deny('STALE_RETRY_ATTEMPT',409);
  if(a.rows[0]?.status!=='failed')deny('NODE_RETRY_NOT_SAFE',409);
  await c.query("UPDATE ov_run_queue SET status='queued',execution_token=NULL,lease_token=NULL,leased_until=NULL,updated_at=now() WHERE workspace_id=$1 AND run_id=$2",[scope.workspaceRef,args.runRef]);
  await c.query("UPDATE ov_runs SET status='queued',snapshot=jsonb_set(snapshot,'{status}','\"queued\"') WHERE workspace_id=$1 AND run_id=$2",[scope.workspaceRef,args.runRef]);
  await emit(c,scope.workspaceRef,'run.retry_queued',{runRef:args.runRef,nodeId:args.nodeId,previousAttemptRef:a.rows[0].attempt_id});
  return args.runRef;
}
export async function completeTask(c,scope,outcomeRefs,{emit,verifyTaskOutcomes,maxValidationMs=5000}){
  const row=await taskRow(c,scope);
  if(!['active','waiting'].includes(row.status))deny('TASK_NOT_OPEN',409);
  const questions=await c.query("SELECT 1 FROM ov_questions WHERE workspace_id=$1 AND task_id=$2 AND status='open' LIMIT 1",[scope.workspaceRef,scope.taskRef]);
  if(questions.rows.length)deny('TASK_HAS_OPEN_QUESTIONS',409);
  const runs=await c.query('SELECT run_id,status FROM ov_runs WHERE workspace_id=$1 AND task_id=$2 FOR SHARE',[scope.workspaceRef,scope.taskRef]);
  if(runs.rows.some(r=>['queued','running','waiting'].includes(r.status)))deny('TASK_HAS_PENDING_RUNS',409);
  if(!Array.isArray(outcomeRefs)||!outcomeRefs.length||outcomeRefs.length>512||new Set(outcomeRefs).size!==outcomeRefs.length||outcomeRefs.some(x=>!id(x)))deny('BAD_TASK_OUTCOMES');
  const values=await c.query(`SELECT v.value_id,v.value,v.semantic_role,v.representation,v.source_refs,v.run_id FROM ov_value_artifacts v
    JOIN ov_attempts a ON a.workspace_id=v.workspace_id AND a.attempt_id=v.attempt_id
    JOIN ov_runs r ON r.workspace_id=v.workspace_id AND r.run_id=v.run_id
    WHERE v.workspace_id=$1 AND v.value_id=ANY($2::text[]) AND a.status='success' AND a.run_id=v.run_id
      AND r.status='completed' AND r.task_id=$3`,[scope.workspaceRef,outcomeRefs,scope.taskRef]);
  if(values.rows.length!==outcomeRefs.length)deny('TASK_OUTCOME_NOT_VERIFIED');
  for(const required of row.snapshot.requiredOutcomes||[]){if((required.evidenceRefs||[]).some(ref=>!outcomeRefs.includes(ref)))deny('REQUIRED_OUTCOME_MISSING');}
  if(typeof verifyTaskOutcomes!=='function')deny('TASK_VERIFICATION_UNAVAILABLE',503);
  if(!Number.isInteger(maxValidationMs)||maxValidationMs<1||maxValidationMs>30000)deny('INVALID_VALIDATION_BUDGET');
  let timer,verified;
  try{verified=await Promise.race([
    Promise.resolve().then(()=>verifyTaskOutcomes({task:structuredClone(row.snapshot),outcomeRefs:[...outcomeRefs],artifacts:structuredClone(values.rows)})),
    new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new KernelError('TASK_VERIFICATION_TIMEOUT')),maxValidationMs);})
  ]);}finally{clearTimeout(timer);}
  if(verified!==true)deny('TASK_OUTCOME_NOT_VERIFIED');
  await taskState(c,scope,row.snapshot,'completed');
  await emit(c,scope.workspaceRef,'task.completed',{taskRef:scope.taskRef,outcomeRefs});
}
