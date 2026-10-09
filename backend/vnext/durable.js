import {askQuestion,answerQuestion,cancelRun,retryRun,completeTask} from './lifecycle.js';
import { randomUUID, createHash } from 'node:crypto';
import { MemoryGraphRepository, KernelError, computeScope } from './graph.js';
import {createContractValidation} from './validation.js';
const taskValidation=createContractValidation();

const deny = (code, status = 422) => { throw new KernelError(code, code, status); };
const id = s => typeof s === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(s);
const checkId = s => { if (!id(s)) deny('INVALID_IDENTIFIER'); };
const stable = value => JSON.stringify(value, (_key, v) =>
  v && typeof v === 'object' && !Array.isArray(v) ?
    Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
const clone = x => structuredClone(x);
const actionRef=(scope,key)=>'a_'+digest([scope.workspaceRef,scope.actorRef,scope.requestRef,key]).slice(0,40);
const ledgerKey=(requestRef,key)=>JSON.stringify([requestRef,key]);
async function ledgerEntry(c,scope,key){
  const canonical=ledgerKey(scope.requestRef,key),legacy=scope.requestRef+':'+key;
  const rows=await c.query('SELECT idempotency_key,signature,result FROM ov_action_ledger WHERE workspace_id=$1 AND actor_ref=$2 AND idempotency_key=ANY($3::text[])',[scope.workspaceRef,scope.actorRef,[canonical,legacy]]);
  // Delimiter keys from older versions may alias other valid identifiers. Compare their original Action ID.
  return rows.rows.find(r=>r.idempotency_key===canonical)||rows.rows.find(r=>r.result?.actionId===actionRef(scope,key));
}
function actionsInOrder(actions) {
  if (!Array.isArray(actions) || actions.length > 32) deny('ACTION_LIMIT');
  const byKey = new Map();
  for (const a of actions) {
    if (!id(a?.localKey) || byKey.has(a.localKey)) deny('DUPLICATE_OR_INVALID_ACTION_KEY');
    byKey.set(a.localKey, a);
  }
  const visiting = new Set(), visited = new Set(), result = [];
  function walk(k) {
    if (!byKey.has(k)) deny('UNKNOWN_ACTION_DEPENDENCY');
    if (visiting.has(k)) deny('CYCLIC_ACTION_DEPENDENCY');
    if (visited.has(k)) return;
    visiting.add(k);
    for (const dep of byKey.get(k).dependsOn || []) walk(dep);
    visiting.delete(k); visited.add(k); result.push(byKey.get(k));
  }
  for (const k of byKey.keys()) walk(k);
  return result;
}
async function transaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally { c.release(); }
}
async function member(c, scope, canEdit = false) {
  checkId(scope?.workspaceRef); checkId(scope?.actorRef);
  const r = await c.query('SELECT role FROM ov_members WHERE workspace_id=$1 AND actor_ref=$2 FOR SHARE', [scope.workspaceRef, scope.actorRef]);
  if (!r.rows.length || (canEdit && r.rows[0].role === 'viewer')) deny('FORBIDDEN', 403);
  return r.rows[0].role;
}
async function event(c, workspaceRef, type, data) {
  const id = (await c.query('UPDATE ov_workspaces SET event_cursor=event_cursor+1 WHERE workspace_id=$1 RETURNING event_cursor', [workspaceRef])).rows[0]?.event_cursor;
  if (id === undefined) deny('WORKSPACE_NOT_FOUND', 404);
  await c.query('INSERT INTO ov_events(workspace_id,event_id,event_type,body) VALUES($1,$2,$3,$4::jsonb)', [workspaceRef,id,type,JSON.stringify(data)]);
  return Number(id);
}
async function graphRow(c, workspaceRef, graphId, lock = false) {
  const r = await c.query('SELECT revision,snapshot FROM ov_graphs WHERE workspace_id=$1 AND graph_id=$2' + (lock?' FOR UPDATE':''), [workspaceRef,graphId]);
  if (!r.rows.length) deny('GRAPH_NOT_FOUND',404);
  return r.rows[0];
}
function expiredOrBadLease(row, token) {
  if (!row || row.status !== 'leased' || row.lease_token !== token || new Date(row.leased_until).getTime() <= Date.now()) deny('STALE_LEASE',409);
}
export class PostgresVNextStore {
  #pool; #validate; #verifyRunEvidence; #verifyTaskOutcomes; #maxTaskValidationMs;
  constructor({ pool, validateTurn, verifyRunEvidence, verifyTaskOutcomes, maxTaskValidationMs=5000 } = {}) {
    if (!pool || typeof pool.connect !== 'function' || typeof validateTurn !== 'function') deny('DURABLE_DEPENDENCIES_REQUIRED',500);
    this.#pool=pool; this.#validate=validateTurn; this.#verifyRunEvidence=verifyRunEvidence; this.#verifyTaskOutcomes=verifyTaskOutcomes; this.#maxTaskValidationMs=maxTaskValidationMs;
  }
  // Provisioning is an internal admin operation; never expose to an untrusted HTTP request.
  async provisionWorkspace(workspaceRef, ownerRef) {
    checkId(workspaceRef); checkId(ownerRef);
    return transaction(this.#pool, async c => {
      await c.query('INSERT INTO ov_workspaces(workspace_id) VALUES($1) ON CONFLICT DO NOTHING',[workspaceRef]);
      await c.query('SELECT workspace_id FROM ov_workspaces WHERE workspace_id=$1 FOR UPDATE',[workspaceRef]);
      const exists=await c.query('SELECT 1 FROM ov_members WHERE workspace_id=$1 LIMIT 1',[workspaceRef]);
      if (exists.rows.length) deny('WORKSPACE_PROVISIONED',409);
      await c.query("INSERT INTO ov_members(workspace_id,actor_ref,role) VALUES($1,$2,'owner')",[workspaceRef,ownerRef]);
    });
  }
  async grant(scope, actorRef, role) {
    checkId(actorRef);
    if (!['viewer','editor','owner'].includes(role)) deny('INVALID_ROLE');
    return transaction(this.#pool, async c => {
      if (await member(c,scope,true) !== 'owner') deny('FORBIDDEN',403);
      await c.query('INSERT INTO ov_members(workspace_id,actor_ref,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,actor_ref) DO UPDATE SET role=EXCLUDED.role',[scope.workspaceRef,actorRef,role]);
      await event(c,scope.workspaceRef,'workspace.membership.changed',{actorRef,role});
    });
  }
  async createGraph(scope, graphId) {
    checkId(graphId);
    return transaction(this.#pool, async c => {
      await member(c,scope,true);
      const state={graph:{graphId,revision:0,nodes:[],connections:[]},definitions:[]};
      await c.query('INSERT INTO ov_graphs(workspace_id,graph_id,revision,snapshot) VALUES($1,$2,0,$3::jsonb)',[scope.workspaceRef,graphId,JSON.stringify(state)]);
      await c.query('INSERT INTO ov_graph_revisions(workspace_id,graph_id,revision,snapshot) VALUES($1,$2,0,$3::jsonb)',[scope.workspaceRef,graphId,JSON.stringify(state)]);
      await event(c,scope.workspaceRef,'graph.created',{graphId,revision:0});
      return state;
    });
  }
  async readGraph(scope, graphId, revision) {
    checkId(graphId);
    return transaction(this.#pool, async c => {
      await member(c,scope);
      if (revision === undefined) return clone((await graphRow(c,scope.workspaceRef,graphId)).snapshot);
      if (!Number.isInteger(revision) || revision<0) deny('BAD_REVISION');
      const r=await c.query('SELECT snapshot FROM ov_graph_revisions WHERE workspace_id=$1 AND graph_id=$2 AND revision=$3',[scope.workspaceRef,graphId,revision]);
      if (!r.rows.length) deny('REVISION_NOT_FOUND',404);
      return clone(r.rows[0].snapshot);
    });
  }
  async createTask(scope, { taskId, requestRef, objective, constraintRefs=[], requiredOutcomes=[] }) {
    checkId(taskId); checkId(requestRef);
    if (typeof objective !== 'string' || !objective.trim()) deny('BAD_OBJECTIVE');
    if (!Array.isArray(constraintRefs)||!Array.isArray(requiredOutcomes)) deny('BAD_TASK');
    const state={taskId,requestRef,objective,constraintRefs,requiredOutcomes,status:'active'};
    if(!taskValidation.validate('Task',state))deny('BAD_TASK');
    return transaction(this.#pool, async c => {
      await member(c,scope,true);
      await c.query("INSERT INTO ov_tasks(workspace_id,task_id,status,snapshot) VALUES($1,$2,'active',$3::jsonb)",[scope.workspaceRef,taskId,JSON.stringify(state)]);
      await event(c,scope.workspaceRef,'task.created',{taskId});
      return state;
    });
  }
  async submit(turn, scope) {
    if (!this.#validate(turn)) deny('INVALID_MODEL_TURN');
    checkId(scope?.requestRef);
    if (turn?.needs?.length && (turn.actions?.length || turn.outputs)) deny('NEEDS_ACTION_BARRIER');
    if (!turn?.actions?.length) return {message:turn?.message,needs:turn?.needs||[],results:[]};
    const ordered=actionsInOrder(turn.actions),done=new Map();
    const knownActions=new Map(ordered.map(a=>[a.localKey,actionRef(scope,a.localKey)]));
    for (const action of ordered) {
      const actionId=actionRef(scope,action.localKey);
      if ((action.dependsOn||[]).some(k=>!['applied','scheduled','duplicate'].includes(done.get(k)?.status))) {
        done.set(action.localKey,{actionId,status:'rejected',error:{code:'DEPENDENCY_NOT_APPLIED',retryable:false}});continue;
      }
      try {
        const result=await transaction(this.#pool,async c => {
          await member(c,scope,true);
          const key=ledgerKey(scope.requestRef,action.localKey);
          // Serialize a turn's actions, including future Question blockers, across instances.
          await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify([scope.workspaceRef,scope.actorRef,scope.requestRef])]);
          const signature=digest({taskRef:scope.taskRef||null,graphId:scope.graphId||null,kind:action.kind,args:action.args,dependsOn:action.dependsOn||[]});
          const prior=await ledgerEntry(c,scope,action.localKey);
          if (prior) {
            if (prior.signature!==signature) deny('IDEMPOTENCY_CONFLICT',409);
            return {...prior.result,status:'duplicate',originalActionId:prior.result.actionId};
          }
          if(scope.taskRef){
            checkId(scope.taskRef);
            const task=await c.query('SELECT task_id FROM ov_tasks WHERE workspace_id=$1 AND task_id=$2 FOR UPDATE',[scope.workspaceRef,scope.taskRef]);
            if(!task.rows.length)deny('TASK_NOT_FOUND',404);
          }
          const blocked=await c.query("SELECT 1 FROM ov_questions WHERE workspace_id=$1 AND status='open' AND snapshot->'blockedActionRefs' ? $2 LIMIT 1",[scope.workspaceRef,actionId]);
          if(blocked.rows.length)deny('ACTION_BLOCKED_BY_QUESTION',409);
          let outcome;
          if (action.kind==='ir.applyPatch') {
            const patch=action.args?.patch;
            if (!patch || !id(patch.graphId) || (scope.graphId && scope.graphId!==patch.graphId)) deny('GRAPH_SCOPE_MISMATCH',403);
            if (patch.adoption==='active_run') deny('ACTIVE_RUN_ADOPTION_PENDING',409);
            const row=await graphRow(c,scope.workspaceRef,patch.graphId,true);
            const temp=new MemoryGraphRepository();
            temp.restore(scope.workspaceRef,patch.graphId,row.snapshot);
            const applied=temp.apply(scope.workspaceRef,patch);
            const state=temp.get(scope.workspaceRef,patch.graphId);
            await c.query('UPDATE ov_graphs SET revision=$3,snapshot=$4::jsonb WHERE workspace_id=$1 AND graph_id=$2',
              [scope.workspaceRef,patch.graphId,applied.graphRef.revision,JSON.stringify(state)]);
            await c.query('INSERT INTO ov_graph_revisions(workspace_id,graph_id,revision,snapshot) VALUES($1,$2,$3,$4::jsonb)',
              [scope.workspaceRef,patch.graphId,applied.graphRef.revision,JSON.stringify(state)]);
            outcome={actionId,status:'applied',newRevision:applied.graphRef.revision,createdRefs:applied.createdRefs};
            await event(c,scope.workspaceRef,'graph.applied',{graphId:patch.graphId,revision:applied.graphRef.revision,actionId});
          } else if (action.kind==='run.start') {
            checkId(scope.graphId);checkId(scope.taskRef);
            const task=await c.query('SELECT status FROM ov_tasks WHERE workspace_id=$1 AND task_id=$2 FOR UPDATE',[scope.workspaceRef,scope.taskRef]);
            if (!task.rows.length || task.rows[0].status!=='active') deny('TASK_NOT_ACTIVE',409);
            const graph=(await graphRow(c,scope.workspaceRef,scope.graphId,true)).snapshot;
            const depPatches=(action.dependsOn||[]).map(k=>done.get(k)).filter(x=>x?.newRevision!==undefined);
            if (depPatches.length && depPatches.some(x=>x.newRevision!==graph.graph.revision)) deny('STALE_DEPENDENT_GRAPH',409);
            const targets=(action.args?.targets||[]).map(t=>{
              if (t.nodeId) return t.nodeId;
              if (!action.dependsOn?.includes(t.fromAction)) deny('MISSING_TARGET_DEPENDENCY');
              const dep=done.get(t.fromAction);
              return dep?.createdRefs?.['node:'+t.localNodeKey] || deny('UNRESOLVED_TARGET');
            });
            if (!targets.length || targets.length>512) deny('INVALID_TARGETS');
            const mode=action.args?.damMode||'closed';
            const selected=computeScope(graph.graph,targets,mode);
            const runId='r_'+randomUUID();
            const spec={runId,taskRef:scope.taskRef,graphRef:{graphId:scope.graphId,revision:graph.graph.revision},
              planEpoch:0,targets,damMode:mode,status:'queued',executionOwner:'server'};
            const externalEffect=selected.some(nodeId=>{
              const node=graph.graph.nodes.find(n=>n.nodeId===nodeId);
              const definition=graph.definitions.find(d=>d.definitionId===node?.definitionRef.definitionId&&d.version===node?.definitionRef.version);
              return definition?.executorKind==='tool_task'; // unknown tool side effects are fail-closed
            });
            await c.query('INSERT INTO ov_runs(workspace_id,run_id,task_id,graph_id,graph_revision,status,snapshot,requester_ref) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',
              [scope.workspaceRef,runId,scope.taskRef,scope.graphId,graph.graph.revision,'queued',JSON.stringify(spec),scope.actorRef]);
            await c.query("INSERT INTO ov_run_queue(workspace_id,run_id,status,external_effect) VALUES($1,$2,'queued',$3)",[scope.workspaceRef,runId,externalEffect]);
            outcome={actionId,status:'scheduled',runRef:runId};
            await event(c,scope.workspaceRef,'run.queued',{runRef:runId,graphRef:spec.graphRef,actionId});
          } else if(action.kind==='question.ask'){
            for(const key of action.args.blockedActions||[]){
              if(!knownActions.has(key))deny('UNKNOWN_BLOCKED_ACTION');
              if(ordered.findIndex(a=>a.localKey===key)<=ordered.indexOf(action))deny('BLOCKER_NOT_FUTURE_ACTION',409);
              if(await ledgerEntry(c,scope,key))deny('BLOCKER_ALREADY_APPLIED',409);
            }
            const questionRef=await askQuestion(c,scope,action.args,{emit:event,knownActions});
            outcome={actionId,status:'applied',createdRefs:{questionRef}};
          } else if(action.kind==='run.cancel'){
            await cancelRun(c,scope,action.args.runRef,{emit:event});
            outcome={actionId,status:'applied',runRef:action.args.runRef};
          } else if(action.kind==='run.retry'){
            const runRef=await retryRun(c,scope,action.args,{emit:event});
            outcome={actionId,status:'scheduled',runRef};
          } else if(action.kind==='task.complete'){
            await completeTask(c,scope,action.args.outcomeRefs,{emit:event,verifyTaskOutcomes:this.#verifyTaskOutcomes,maxValidationMs:this.#maxTaskValidationMs});
            outcome={actionId,status:'applied'};
          } else deny('ACTION_NOT_IMPLEMENTED',501);
          await c.query('INSERT INTO ov_action_ledger(workspace_id,actor_ref,idempotency_key,signature,result) VALUES($1,$2,$3,$4,$5::jsonb)',
            [scope.workspaceRef,scope.actorRef,key,signature,JSON.stringify(outcome)]);
          return outcome;
        });
        done.set(action.localKey,result);
      } catch (error) {
        done.set(action.localKey,{actionId,status:'rejected',error:{code:error.code||'DATABASE_ERROR',retryable:[409,503].includes(error.status)}});
      }
    }
    return {message:turn?.message,needs:[],results:[...done.values()]};
  }

  async assertEditor(scope) {
    return transaction(this.#pool,async c=>{await member(c,scope,true);return true;});
  }
  async recordControllerEvent(scope,{requestRef,state,...details}={}) {
    checkId(requestRef);
    if(!['started','model_requested','context_requested','needs_pending','actions_rejected',
      'actions_settled','responded','failed'].includes(state))deny('INVALID_CONTROLLER_EVENT');
    const payload={requestRef,...details};
    if(Buffer.byteLength(JSON.stringify(payload),'utf8')>4096)deny('EVENT_TOO_LARGE');
    return transaction(this.#pool,async c=>{
      await member(c,scope,true);
      return event(c,scope.workspaceRef,'controller.'+state,payload);
    });
  }
  async readEvents(scope, after=0, limit=100) {
    if (!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>500) deny('INVALID_CURSOR');
    return transaction(this.#pool,async c=>{
      await member(c,scope);
      const latest=Number((await c.query('SELECT event_cursor FROM ov_workspaces WHERE workspace_id=$1',[scope.workspaceRef])).rows[0].event_cursor);
      const rows=await c.query('SELECT event_id,event_type,body FROM ov_events WHERE workspace_id=$1 AND event_id>$2 ORDER BY event_id LIMIT $3',[scope.workspaceRef,after,limit]);
      return {events:rows.rows.map(r=>({id:Number(r.event_id),type:r.event_type,data:r.body})),
        latestId:latest,resetRequired:after>latest,hasMore:rows.rows.length===limit && Number(rows.rows.at(-1).event_id)<latest};
    });
  }
  async claimRun({workerRef,workspaceRef=null,leaseSeconds=30}={}) {
    checkId(workerRef);
    if (workspaceRef!==null) checkId(workspaceRef);
    if (!Number.isInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>300) deny('INVALID_LEASE');
    return transaction(this.#pool,async c=>{
      const r=await c.query(`SELECT q.workspace_id,q.run_id,q.status,q.external_effect,q.attempts,r.snapshot
        FROM ov_run_queue q JOIN ov_runs r ON (r.workspace_id=q.workspace_id AND r.run_id=q.run_id)
        WHERE ($1::text IS NULL OR q.workspace_id=$1) AND (q.status='queued' OR (q.status='leased' AND q.leased_until<now()))
        ORDER BY q.updated_at FOR UPDATE OF q SKIP LOCKED LIMIT 1`,[workspaceRef]);
      if (!r.rows.length) return null;
      const row=r.rows[0], claimedWorkspace=row.workspace_id,runRef=row.run_id;
      if (row.status==='leased' && row.external_effect) {
        await c.query("UPDATE ov_run_queue SET status='outcome_unknown',execution_token=NULL,lease_token=NULL,updated_at=now() WHERE workspace_id=$1 AND run_id=$2",[claimedWorkspace,runRef]);
        await c.query("UPDATE ov_runs SET status='waiting',snapshot=jsonb_set(snapshot,'{status}','\"waiting\"') WHERE workspace_id=$1 AND run_id=$2",[claimedWorkspace,runRef]);
        await event(c,claimedWorkspace,'run.outcome_unknown',{runRef});
        return {outcomeUnknown:runRef};
      }
      const leaseToken=randomUUID();
      await c.query("UPDATE ov_run_queue SET status='leased',execution_token=NULL,lease_token=$3,leased_until=now()+($4*interval '1 second'),attempts=attempts+1,updated_at=now() WHERE workspace_id=$1 AND run_id=$2",
        [claimedWorkspace,runRef,leaseToken,leaseSeconds]);
      await c.query("UPDATE ov_runs SET status='running',snapshot=jsonb_set(snapshot,'{status}','\"running\"') WHERE workspace_id=$1 AND run_id=$2",[claimedWorkspace,runRef]);
      await event(c,claimedWorkspace,'run.running',{runRef,attempt:Number(row.attempts)+1});
      return {workspaceRef:claimedWorkspace,runRef,leaseToken,attempt:Number(row.attempts)+1,externalEffect:row.external_effect,run:{...row.snapshot,status:'running'}};
    });
  }
  async settleRun({workspaceRef,runRef,leaseToken,status,evidenceRefs=[],expectedPlanEpoch}) {
    checkId(workspaceRef);checkId(runRef);checkId(leaseToken);
    if (!['completed','failed','waiting'].includes(status)) deny('INVALID_RUN_STATUS');
    if (status==='completed' && (!Array.isArray(evidenceRefs)||!evidenceRefs.length)) deny('RUN_EVIDENCE_REQUIRED');
    if (status==='completed' && typeof this.#verifyRunEvidence!=='function') deny('RUN_VERIFICATION_UNAVAILABLE',503);
    return transaction(this.#pool,async c=>{
      const r=await c.query('SELECT status,lease_token,leased_until FROM ov_run_queue WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE',[workspaceRef,runRef]);
      expiredOrBadLease(r.rows[0],leaseToken);
      if(expectedPlanEpoch!==undefined){
        const plan=await c.query('SELECT plan_epoch FROM ov_runs WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE',[workspaceRef,runRef]);
        if(!Number.isInteger(expectedPlanEpoch)||plan.rows[0]?.plan_epoch!==expectedPlanEpoch)deny('STALE_PLAN_EPOCH',409);
      }
      if (status==='completed' && await this.#verifyRunEvidence({workspaceRef,runRef,evidenceRefs,client:c})!==true) deny('RUN_EVIDENCE_NOT_VERIFIED',409);
      expiredOrBadLease(r.rows[0],leaseToken);
      const queuedStatus=status==='waiting'?'outcome_unknown':'done';
      await c.query('UPDATE ov_run_queue SET status=$3,execution_token=NULL,lease_token=NULL,leased_until=NULL,updated_at=now() WHERE workspace_id=$1 AND run_id=$2',[workspaceRef,runRef,queuedStatus]);
      await c.query("UPDATE ov_runs SET status=$3,snapshot=jsonb_set(snapshot,'{status}',to_jsonb($3::text)) WHERE workspace_id=$1 AND run_id=$2",[workspaceRef,runRef,status]);
      await event(c,workspaceRef,'run.'+status,{runRef,evidenceRefs});
      return {runRef,status};
    });
  }
  async renewLease({workspaceRef,runRef,leaseToken,leaseSeconds=30}) {
    checkId(workspaceRef);checkId(runRef);checkId(leaseToken);
    if (!Number.isInteger(leaseSeconds)||leaseSeconds<5||leaseSeconds>300) deny('INVALID_LEASE');
    const result=await this.#pool.query(`UPDATE ov_run_queue
      SET leased_until=now()+($4*interval '1 second'),updated_at=now()
      WHERE workspace_id=$1 AND run_id=$2 AND status='leased'
        AND lease_token=$3 AND leased_until>now() RETURNING run_id`,
      [workspaceRef,runRef,leaseToken,leaseSeconds]);
    if (!result.rows.length) deny('STALE_LEASE',409);
    return true;
  }
  async cancelRun(scope,runRef){
    return transaction(this.#pool,async c=>{await member(c,scope,true);await cancelRun(c,scope,runRef,{emit:event});return {runRef,status:'cancelled'};});
  }
  async answerQuestion(scope,questionRef,answer){
    return transaction(this.#pool,async c=>{await member(c,scope,true);return answerQuestion(c,scope,questionRef,answer,{emit:event});});
  }
  async readTask(scope,taskRef){
    checkId(taskRef);
    return transaction(this.#pool,async c=>{
      await member(c,scope);const r=await c.query('SELECT snapshot FROM ov_tasks WHERE workspace_id=$1 AND task_id=$2',[scope.workspaceRef,taskRef]);
      if(!r.rows.length)deny('TASK_NOT_FOUND',404);return r.rows[0].snapshot;
    });
  }
  async readQuestion(scope,questionRef){
    checkId(questionRef);
    return transaction(this.#pool,async c=>{
      await member(c,scope);const r=await c.query(`SELECT q.snapshot,a.answer_id,a.value FROM ov_questions q
        LEFT JOIN ov_question_answers a ON a.workspace_id=q.workspace_id AND a.question_id=q.question_id
        WHERE q.workspace_id=$1 AND q.question_id=$2`,[scope.workspaceRef,questionRef]);
      if(!r.rows.length)deny('QUESTION_NOT_FOUND',404);
      const row=r.rows[0];return {question:row.snapshot,...(row.answer_id?{answer:{ref:row.answer_id,value:row.value}}:{})};
    });
  }
  async readArtifact(scope,valueRef){
    checkId(valueRef);
    return transaction(this.#pool,async c=>{
      await member(c,scope);
      const result=await c.query('SELECT value_id,attempt_id,semantic_role,source_refs,representation,value,validation_status FROM ov_value_artifacts WHERE workspace_id=$1 AND value_id=$2',[scope.workspaceRef,valueRef]);
      if(!result.rows.length)deny('ARTIFACT_NOT_FOUND',404);
      const value=result.rows[0];
      return {artifact:{valueId:value.value_id,semanticRole:value.semantic_role,contentRef:'content:'+value.value_id,
        producerAttemptRef:value.attempt_id,sourceRefs:value.source_refs},
        content:{representation:value.representation,value:value.value},validationStatus:value.validation_status};
    });
  }
  async inspectRun(scope,runRef) {
    checkId(runRef);
    return transaction(this.#pool,async c=>{
      await member(c,scope);
      const result=await c.query('SELECT status,snapshot FROM ov_runs WHERE workspace_id=$1 AND run_id=$2',[scope.workspaceRef,runRef]);
      if (!result.rows.length) deny('RUN_NOT_FOUND',404);
      return { ...result.rows[0].snapshot, status:result.rows[0].status };
    });
  }
}
