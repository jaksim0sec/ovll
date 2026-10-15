import { randomUUID } from 'node:crypto';
import { KernelError } from './graph.js';
import { validateSkillNodeOutput as validateOutputContract,validateValue } from './skillOutput.js';
import { buildExecutionPlan, semanticFingerprint } from './executionPlan.js';

const fail = (code,status=422) => { throw new KernelError(code,code,status); };
const json = v => JSON.stringify(v);
async function tx(pool, work) {
  const c=await pool.connect();
  try {await c.query('BEGIN');const result=await work(c);await c.query('COMMIT');return result;}
  catch(error){await c.query('ROLLBACK');throw error;}
  finally{c.release();}
}
async function fenced(c,job){
  const q=await c.query(`SELECT status,lease_token,execution_token,leased_until>clock_timestamp() AS live FROM ov_run_queue
    WHERE workspace_id=$1 AND run_id=$2 FOR UPDATE`,[job.workspaceRef,job.runRef]);
  if(!q.rows.length||q.rows[0].status!=='leased'||q.rows[0].lease_token!==job.leaseToken||!q.rows[0].live)fail('STALE_LEASE',409);
  if(job.executionToken&&q.rows[0].execution_token!==job.executionToken)fail('STALE_EXECUTION_OWNER',409);
  const r=await c.query(`SELECT r.snapshot,r.plan_epoch,r.graph_id,r.graph_revision,r.requester_ref,m.role
    FROM ov_runs r LEFT JOIN ov_members m ON m.workspace_id=r.workspace_id AND m.actor_ref=r.requester_ref
    WHERE r.workspace_id=$1 AND r.run_id=$2 FOR SHARE OF r`,[job.workspaceRef,job.runRef]);
  const row=r.rows[0],run=row?.snapshot;
  if(!run||row.plan_epoch!==job.run.planEpoch||run.planEpoch!==row.plan_epoch||row.graph_id!==job.run.graphRef?.graphId||row.graph_revision!==job.run.graphRef?.revision||
    ['runId','taskRef','graphRef','planEpoch','targets','damMode'].some(k=>json(run[k])!==json(job.run[k])))fail('PINNED_RUN_MISMATCH',409);
const membership=await c.query('SELECT role FROM ov_members WHERE workspace_id=$1 AND actor_ref=$2 FOR SHARE',[job.workspaceRef,row.requester_ref]);
  if(!row.requester_ref||!membership.rows.length||!['editor','owner'].includes(membership.rows[0].role))fail('EXECUTION_FORBIDDEN',403);
}
async function emit(c,workspaceRef,type,body) {
  const r=await c.query('UPDATE ov_workspaces SET event_cursor=event_cursor+1 WHERE workspace_id=$1 RETURNING event_cursor',[workspaceRef]);
  if(!r.rows.length)fail('WORKSPACE_NOT_FOUND',404);
  await c.query('INSERT INTO ov_events(workspace_id,event_id,event_type,body) VALUES($1,$2,$3,$4::jsonb)',
    [workspaceRef,r.rows[0].event_cursor,type,json(body)]);
}
async function pinned(c, job) {
  const r=await c.query(`SELECT g.snapshot FROM ov_graph_revisions g JOIN ov_runs r
    ON r.workspace_id=g.workspace_id AND r.graph_id=g.graph_id AND r.graph_revision=g.revision
    WHERE r.workspace_id=$1 AND r.run_id=$2 AND r.plan_epoch=$3`,
    [job.workspaceRef,job.runRef,job.run.planEpoch]);
  if(!r.rows.length)fail('PINNED_GRAPH_NOT_FOUND',409);
  return r.rows[0].snapshot;
}
async function successes(c,job,skillNodeId,fingerprint,definition,inputRefs,requireVerified) {
  const r=await c.query(`SELECT attempt_id,output_refs,input_refs,skill_definition_ref FROM ov_attempts
    WHERE workspace_id=$1 AND run_id=$2 AND skill_node_id=$3 AND plan_epoch=$4 AND fingerprint=$5 AND status='success'
    ORDER BY generation DESC LIMIT 1`,[job.workspaceRef,job.runRef,skillNodeId,job.run.planEpoch,fingerprint]);
  if(!r.rows.length)return null;
  const ids=r.rows[0].output_refs;
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||json(r.rows[0].input_refs)!==json(inputRefs)||r.rows[0].skill_definition_ref?.definitionId!==definition.definitionId||r.rows[0].skill_definition_ref?.version!==definition.version)fail('CORRUPT_ATTEMPT_OUTPUTS');
  const result=await c.query('SELECT value_id,run_id,skill_node_id,output_port,representation,value,source_refs,validation_status FROM ov_value_artifacts WHERE workspace_id=$1 AND attempt_id=$2',
    [job.workspaceRef,r.rows[0].attempt_id]);
  if(result.rows.length!==ids.length||!ids.every(id=>result.rows.some(a=>a.value_id===id)))fail('CORRUPT_ATTEMPT_OUTPUTS');
if(new Set(result.rows.map(v=>v.output_port)).size!==ids.length||result.rows.some(v=>v.run_id!==job.runRef||v.skill_node_id!==skillNodeId||!definition.outputs.some(p=>p.name===v.output_port&&p.representation===v.representation)||json(v.source_refs)!==json(inputRefs)))fail('CORRUPT_ATTEMPT_OUTPUTS');
  if(requireVerified&&result.rows.some(v=>v.validation_status!=='externally_verified'))fail('OUTPUT_VERIFICATION_POLICY_CHANGED',409);
  return result.rows;
}
function inputsFor(plan,skillNodeId,bySkillNode,snapshot) {
  const edges=snapshot.graph.connections.filter(x=>x.kind==='data'&&x.to.skillNodeId===skillNodeId);
  const inputRefs=[], inputArtifacts=[];
  for(const link of edges) {
    const upstream=bySkillNode.get(link.from.skillNodeId)||[];
    const value=upstream.find(v=>v.output_port===link.from.port);
    if(!value)fail('REQUIRED_INPUT_MISSING');
    inputRefs.push(value.value_id);
    inputArtifacts.push({port:link.to.port,sourceSkillNodeId:link.from.skillNodeId,sourcePort:link.from.port,valueRef:value.value_id,
      representation:value.representation,value:value.value});
  }
  return {inputRefs,inputArtifacts};
}
export function createSkillNodeExecution({pool,executeSkillNode,authorizeCapabilities,validateSkillNodeOutput,validateRepresentation,maxSkillNodes=512,maxSkillNodeMs=60000,maxRunMs=300000,executionProfileId='v1'}={}) {
  if(!pool||typeof pool.connect!=='function'||typeof executeSkillNode!=='function'||typeof executionProfileId!=='string'||!executionProfileId) fail('SKILL_NODE_EXECUTOR_DEPENDENCIES_REQUIRED',500);
  if(!Number.isInteger(maxSkillNodeMs)||maxSkillNodeMs<1||maxSkillNodeMs>300000||!Number.isInteger(maxRunMs)||maxRunMs<1||maxRunMs>3600000)fail('INVALID_EXECUTION_BUDGET');
  const execute=async function executeRun(job,{signal}={}) {
    const deadline=Date.now()+maxRunMs;
    const bounded=async work=>{
      const remaining=Math.min(maxSkillNodeMs,deadline-Date.now());
      if(remaining<=0)fail('SKILL_NODE_EXECUTION_TIMEOUT');
      const controller=new AbortController(),skillNodeSignal=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      let timer,onAbort;
      const stopped=new Promise((_resolve,reject)=>{
        onAbort=()=>reject(new KernelError(controller.signal.aborted?'SKILL_NODE_EXECUTION_TIMEOUT':'EXECUTION_ABORTED'));
        skillNodeSignal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(()=>controller.abort(),remaining);
      });
      try{if(skillNodeSignal.aborted)fail('EXECUTION_ABORTED');return await Promise.race([Promise.resolve().then(()=>work(skillNodeSignal)),stopped]);}
      finally{clearTimeout(timer);skillNodeSignal.removeEventListener('abort',onAbort);}
    };
    const snapshot=await tx(pool,async c=>{await fenced(c,job);return pinned(c,job);});
    const plan=buildExecutionPlan(snapshot,job.run);
    if(!Number.isInteger(maxSkillNodes)||maxSkillNodes<1||plan.order.length>maxSkillNodes)fail('SKILL_NODE_EXECUTION_LIMIT');
    for(const {skillNode,definition} of plan.order){
      for(const [name,value] of Object.entries(skillNode.inputBindings||{}))await bounded(()=>validateValue(definition.inputs.find(p=>p.name===name).representation,value,validateRepresentation));
      if(definition.executorKind==='tool_task'){
        if(!job.externalEffect)fail('EXTERNAL_EFFECT_QUEUE_REQUIRED',409);
        if(!definition.requiredCapabilities?.length||typeof authorizeCapabilities!=='function'||await bounded(skillNodeSignal=>authorizeCapabilities({job,definition,capabilities:definition.requiredCapabilities,signal:skillNodeSignal}))!==true)fail('TOOL_CAPABILITY_NOT_AUTHORIZED',403);
      }
    }
    const bySkillNode=new Map(),targetRefs=new Map();
    for(const item of plan.order) {
      if(signal?.aborted)fail('EXECUTION_ABORTED',409);
      const {skillNode,definition,skillNodeId}=item;
      if(definition.executorKind==='subgraph')fail('SUBGRAPH_EXECUTOR_NOT_IMPLEMENTED',501);
      if(definition.executorKind==='tool_task'){
        if(!Array.isArray(definition.requiredCapabilities)||!definition.requiredCapabilities.length||
          typeof authorizeCapabilities!=='function'||
          await bounded(skillNodeSignal=>authorizeCapabilities({job,definition,capabilities:definition.requiredCapabilities,signal:skillNodeSignal}))!==true)fail('TOOL_CAPABILITY_NOT_AUTHORIZED',403);
      }
      const {inputRefs,inputArtifacts}=inputsFor(plan,skillNodeId,bySkillNode,snapshot);
      for(const input of inputArtifacts)await bounded(()=>validateValue(definition.inputs.find(p=>p.name===input.port).representation,input.value,validateRepresentation));
      const fingerprint=semanticFingerprint({snapshot,run:job.run,skillNode,definition,inputRefs,executorVersion:executionProfileId});
      const begun=await tx(pool,async c=>{
        await fenced(c,job);
        const previous=await successes(c,job,skillNodeId,fingerprint,definition,inputRefs,typeof validateSkillNodeOutput==='function');
        if(previous){
          const outputs=Object.fromEntries(previous.map(v=>[v.output_port,{inline:v.value}]));
          await bounded(()=>validateOutputContract(definition,{status:'produced',values:outputs},{validateRepresentation}));
          if(previous.some(v=>json(v.source_refs)!==json(inputRefs)))fail('CORRUPT_ATTEMPT_OUTPUTS');
          return {reused:previous};
        }
        const active=await c.query(`SELECT 1 FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2 AND skill_node_id=$3 AND plan_epoch=$4 AND status='running' AND lease_token=$5`,[job.workspaceRef,job.runRef,skillNodeId,job.run.planEpoch,job.leaseToken]);
        if(active.rows.length)fail('RUN_EXECUTION_IN_PROGRESS',409);
        // A crashed former pure-model worker cannot leave an ambiguous 'running' Attempt forever.
        // The queue itself already blocks automatic replay when external side effects are possible.
        await c.query(`UPDATE ov_attempts SET status='cancelled',result='{"code":"STALE_PREVIOUS_LEASE"}'::jsonb
          WHERE workspace_id=$1 AND run_id=$2 AND skill_node_id=$3 AND plan_epoch=$4
            AND status='running' AND lease_token<>$5`,
          [job.workspaceRef,job.runRef,skillNodeId,job.run.planEpoch,job.leaseToken]);
        const last=await c.query(`SELECT COALESCE(MAX(generation),-1)+1 AS next
          FROM ov_attempts WHERE workspace_id=$1 AND run_id=$2 AND skill_node_id=$3 AND plan_epoch=$4`,
          [job.workspaceRef,job.runRef,skillNodeId,job.run.planEpoch]);
        const attemptId='a_'+randomUUID(),generation=Number(last.rows[0].next);
        await c.query(`INSERT INTO ov_attempts(workspace_id,attempt_id,run_id,plan_epoch,generation,fingerprint,status,
          skill_node_id,skill_definition_ref,input_refs,lease_token)
          VALUES($1,$2,$3,$4,$5,$6,'running',$7,$8::jsonb,$9::jsonb,$10)`,
          [job.workspaceRef,attemptId,job.runRef,job.run.planEpoch,generation,fingerprint,skillNodeId,
          json(skillNode.skillDefinitionRef),json(inputRefs),job.leaseToken]);
        await emit(c,job.workspaceRef,'skillNode.started',{runRef:job.runRef,skillNodeId,attemptId,generation});
        return {attemptId,generation};
      });
      if(begun.reused){
        if(typeof validateSkillNodeOutput==='function'&&await bounded(()=>validateSkillNodeOutput({job,skillNode,definition,response:{status:'produced',values:Object.fromEntries(begun.reused.map(v=>[v.output_port,{inline:v.value}]))},outputs:begun.reused.map(v=>({port:definition.outputs.find(p=>p.name===v.output_port),value:v.value,sourceRefs:v.source_refs})),inputArtifacts}))!==true)fail('SKILL_NODE_OUTPUT_NOT_VERIFIED');
        bySkillNode.set(skillNodeId,begun.reused);if(job.run.targets.includes(skillNodeId))targetRefs.set(skillNodeId,begun.reused.map(v=>v.value_id));continue;}
      let validated,executionError=null;
      try {
        const response=await bounded(skillNodeSignal=>executeSkillNode({job,skillNode,definition,graphRef:plan.graphRef,
          attemptRef:begun.attemptId,inputBindings:skillNode.inputBindings||{},inputArtifacts,signal:skillNodeSignal}));
        validated=await bounded(()=>validateOutputContract(definition,response,{inputArtifacts,validateRepresentation}));
        if(!validated.blocked&&typeof validateSkillNodeOutput==='function'){
          const allowed=await bounded(()=>validateSkillNodeOutput({job,skillNode,definition,response,outputs:validated,inputArtifacts}));
          if(allowed!==true)fail('SKILL_NODE_OUTPUT_NOT_VERIFIED');
        }
      }catch(error){executionError=error;}
      const recorded=await tx(pool,async c=>{
        await fenced(c,job);
        const row=await c.query('SELECT status,lease_token FROM ov_attempts WHERE workspace_id=$1 AND attempt_id=$2 FOR UPDATE',
          [job.workspaceRef,begun.attemptId]);
        if(!row.rows.length||row.rows[0].status!=='running'||row.rows[0].lease_token!==job.leaseToken)fail('STALE_ATTEMPT',409);
        if(executionError){
          const status=definition.executorKind==='tool_task'?'outcome_unknown':'failed';
          await c.query('UPDATE ov_attempts SET status=$3,result=$4::jsonb WHERE workspace_id=$1 AND attempt_id=$2',
            [job.workspaceRef,begun.attemptId,status,json({code:executionError.code||'SKILL_NODE_EXECUTION_FAILED'})]);
          await emit(c,job.workspaceRef,'skillNode.'+status,{runRef:job.runRef,skillNodeId,attemptId:begun.attemptId});
          return null;
        }
        if(validated.blocked){
          await c.query(`UPDATE ov_attempts SET status='failed',result=$3::jsonb WHERE workspace_id=$1 AND attempt_id=$2`,[job.workspaceRef,begun.attemptId,json({code:'SKILL_NODE_BLOCKED',reason:validated.reason})]);
          await emit(c,job.workspaceRef,'skillNode.blocked',{runRef:job.runRef,skillNodeId,attemptId:begun.attemptId,reason:validated.reason});
          return null;
        }
        const recorded=[];
        for(const output of validated){
          const valueId='v_'+randomUUID();
          await c.query(`INSERT INTO ov_value_artifacts(workspace_id,value_id,run_id,attempt_id,skill_node_id,output_port,representation,value,source_refs,validation_status,semantic_role)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
            [job.workspaceRef,valueId,job.runRef,begun.attemptId,skillNodeId,output.port.name,
              output.port.representation,json(output.value),json(inputRefs),typeof validateSkillNodeOutput==='function'?'externally_verified':'contract_validated',output.port.role||output.port.name]);
          recorded.push({value_id:valueId,output_port:output.port.name,representation:output.port.representation,value:output.value,source_refs:inputRefs});
        }
        await c.query(`UPDATE ov_attempts SET status='success',output_refs=$3::jsonb,result=$4::jsonb
          WHERE workspace_id=$1 AND attempt_id=$2`,
          [job.workspaceRef,begun.attemptId,json(recorded.map(v=>v.value_id)),json({ports:recorded.map(v=>v.output_port)})]);
        await emit(c,job.workspaceRef,'skillNode.success',{runRef:job.runRef,skillNodeId,attemptId:begun.attemptId,outputRefs:recorded.map(v=>v.value_id)});
        await fenced(c,job);
        return recorded;
      });
      if(!recorded)return {status:validated?.blocked||definition.executorKind==='tool_task'?'waiting':'failed',evidenceRefs:[]};
      bySkillNode.set(skillNodeId,recorded);
      if(job.run.targets.includes(skillNodeId))targetRefs.set(skillNodeId,recorded.map(v=>v.value_id));
    }
    const evidenceRefs=job.run.targets.flatMap(n=>targetRefs.get(n)||[]);
    if(!evidenceRefs.length||targetRefs.size!==new Set(job.run.targets).size)fail('TARGET_EVIDENCE_MISSING');
    return {status:'completed',evidenceRefs};
  };
  return async(job,options={})=>{
    const executionToken=randomUUID();
    await tx(pool,async c=>{
      await fenced(c,job);
      const reserved=await c.query(`UPDATE ov_run_queue SET execution_token=$4
        WHERE workspace_id=$1 AND run_id=$2 AND lease_token=$3 AND execution_token IS NULL RETURNING run_id`,
        [job.workspaceRef,job.runRef,job.leaseToken,executionToken]);
      if(!reserved.rows.length)fail('RUN_EXECUTION_IN_PROGRESS',409);
    });
    try{return await execute({...job,executionToken},options);}
    finally{await pool.query(`UPDATE ov_run_queue SET execution_token=NULL
      WHERE workspace_id=$1 AND run_id=$2 AND lease_token=$3 AND execution_token=$4`,
      [job.workspaceRef,job.runRef,job.leaseToken,executionToken]);}
  };
}
// Called by the durable store within its settleRun transaction. This verifies
// *contractual coverage/provenance*, never truthfulness of model-generated content.
export async function verifySkillNodeRunEvidence({client,workspaceRef,runRef,evidenceRefs,executionProfileId='v1',validateRepresentation,maxValidationMs=5000}) {
  const deadline=Date.now()+maxValidationMs;
  if(!Number.isInteger(maxValidationMs)||maxValidationMs<1||maxValidationMs>30000)return false;
  if(!Array.isArray(evidenceRefs)||!evidenceRefs.length||new Set(evidenceRefs).size!==evidenceRefs.length)return false;
  const result=await client.query('SELECT snapshot,plan_epoch,requester_ref FROM ov_runs WHERE workspace_id=$1 AND run_id=$2',[workspaceRef,runRef]);
  if(!result.rows.length)return false;
const membership=await client.query('SELECT role FROM ov_members WHERE workspace_id=$1 AND actor_ref=$2 FOR SHARE',[workspaceRef,result.rows[0].requester_ref]);
  if(!membership.rows.length||!['editor','owner'].includes(membership.rows[0].role))return false;
  const run=result.rows[0].snapshot,planEpoch=result.rows[0].plan_epoch;
  if(run.planEpoch!==planEpoch)return false;
  const pin=await client.query('SELECT snapshot FROM ov_graph_revisions WHERE workspace_id=$1 AND graph_id=$2 AND revision=$3',
    [workspaceRef,run.graphRef.graphId,run.graphRef.revision]);
  if(!pin.rows.length)return false;
  let plan;
  try {plan=buildExecutionPlan(pin.rows[0].snapshot,run);}catch{return false;}
  const attempts=await client.query(`SELECT skill_node_id,attempt_id,generation,fingerprint,output_refs,input_refs FROM ov_attempts
    WHERE workspace_id=$1 AND run_id=$2 AND plan_epoch=$3 AND status='success'
    ORDER BY generation DESC`,[workspaceRef,runRef,planEpoch]);
  const valuesResult=await client.query('SELECT value_id,skill_node_id,attempt_id,output_port,representation,value,source_refs FROM ov_value_artifacts WHERE workspace_id=$1 AND run_id=$2',
    [workspaceRef,runRef]);
  const values=new Map(valuesResult.rows.map(r=>[r.value_id,r]));
  const perSkillNode=new Map(),bySkillNode=new Map();
  for(const step of plan.order){
    const inputRefs=[];
    for(const link of pin.rows[0].snapshot.graph.connections.filter(l=>l.kind==='data' && l.to.skillNodeId===step.skillNodeId)){
      const upstream=bySkillNode.get(link.from.skillNodeId)||[];
      const output=upstream.find(v=>v.output_port===link.from.port);
      if(!output)return false;
      inputRefs.push(output.value_id);
    }
    const expectedFingerprint=semanticFingerprint({snapshot:pin.rows[0].snapshot,run,skillNode:step.skillNode,definition:step.definition,inputRefs,executorVersion:executionProfileId});
    const attempt=attempts.rows.find(a=>a.skill_node_id===step.skillNodeId && a.fingerprint===expectedFingerprint);
    if(!attempt || json(attempt.input_refs)!==json(inputRefs)||!Array.isArray(attempt.output_refs)||!attempt.output_refs.length)return false;
    const artifacts=attempt.output_refs.map(id=>values.get(id));
    if(new Set(attempt.output_refs).size!==attempt.output_refs.length||new Set(artifacts.map(v=>v?.output_port)).size!==artifacts.length)return false;
    if(artifacts.some(v=>!v||v.skill_node_id!==step.skillNodeId||v.attempt_id!==attempt.attempt_id ||
        !step.definition.outputs.some(p=>p.name===v.output_port && p.representation===v.representation) ||
        json(v.source_refs)!==json(inputRefs)))return false;
    const remaining=deadline-Date.now();if(remaining<=0)return false;
    let timer;
    try{
      await Promise.race([
        validateOutputContract(step.definition,{status:'produced',values:Object.fromEntries(artifacts.map(v=>[v.output_port,{inline:v.value}]))},{validateRepresentation}),
        new Promise((_resolve,reject)=>{timer=setTimeout(()=>reject(new KernelError('EVIDENCE_VALIDATION_TIMEOUT')),remaining);})
      ]);
    }catch{return false;}finally{clearTimeout(timer);}
    bySkillNode.set(step.skillNodeId,artifacts);perSkillNode.set(step.skillNodeId,attempt);
  }
  const expected=new Set();
  for(const target of run.targets) {
    const attempt=perSkillNode.get(target);
    if(!attempt)return false;
    for(const id of attempt.output_refs)expected.add(id);
  }
  return expected.size>0 && expected.size===evidenceRefs.length && evidenceRefs.every(id=>expected.has(id));
}

