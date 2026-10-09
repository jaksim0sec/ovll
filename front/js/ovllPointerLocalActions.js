(function(global){
"use strict";
// The model may return actions in any order. Dependencies decide the sequence.
function order(actions){
  if(!Array.isArray(actions)||actions.length>32)throw new Error("LOCAL_ACTION_LIMIT");
  const map=new Map(),ordered=[],active=new Set(),done=new Set();
  for(const action of actions){
    if(!action||typeof action.localKey!=="string"||!action.localKey||map.has(action.localKey))
      throw new Error("DUPLICATE_LOCAL_ACTION");
    map.set(action.localKey,action);
  }
  function visit(key){
    if(!map.has(key))throw new Error("LOCAL_ACTION_DEPENDENCY_MISSING");
    if(active.has(key))throw new Error("LOCAL_ACTION_DEPENDENCY_CYCLE");
    if(done.has(key))return;
    active.add(key);
    for(const dep of map.get(key).dependsOn||[])visit(dep);
    active.delete(key);done.add(key);ordered.push(map.get(key));
  }
  for(const action of actions)visit(action.localKey);
  return ordered;
}
const succeeded=result=>['applied','completed','saved','answered'].includes(result?.status);
async function execute(actions,handlers,{isActive=()=>true,onActionStart,onActionResult}={}){
  const applied=new Map(),results=[];
  for(const action of order(actions)){
    let result;
    if(!isActive())result={status:'cancelled',error:'LOCAL_CONVERSATION_CHANGED'};
    else if((action.dependsOn||[]).some(key=>!succeeded(applied.get(key))))
      result={status:'skipped',error:'LOCAL_ACTION_DEPENDENCY_FAILED'};
    else if(typeof handlers[action.kind]!=='function')result={status:'rejected',error:'UNSUPPORTED_LOCAL_ACTION'};
    else try{
      try{onActionStart?.(action);}catch(error){console.warn('Pointer activity callback failed',error);}
      result=await handlers[action.kind](action,applied);
      if(!result||typeof result.status!=='string')throw new Error('LOCAL_ACTION_RESULT_REQUIRED');
    }catch(error){result={status:'failed',error:error?.code||error?.message||'LOCAL_ACTION_FAILED'};}
    const fact={...result,localKey:action.localKey,kind:action.kind};
    applied.set(action.localKey,fact);results.push(fact);
    try{onActionResult?.(action,fact);}catch(error){console.warn('Pointer activity callback failed',error);}
  }
  return results;
}
function uncommittedMutationClaim(message){
  const text=String(message||'');
  return /(잠시.{0,10}기다|기다려.{0,10}주|(?:삭제|제거|수정|변경|적용|반영|구성|실행|처리|생성|지우)(?:하겠|할게|하도록|했|됐|했습니다|해드리겠)|패치를.{0,16}(?:만들|구성)|완료했)/.test(text);
}
async function coordinate({getContext,request,handlers,isActive=()=>true,onActionStart,onActionResult}={}){
  const facts=[],messages=[],runs=[],seenReads=new Set();let reads=[],correction='';
  for(let step=0;step<3&&isActive();step++){
    const context=await getContext();
    const actionResults=facts.map(({run,...fact})=>({...fact,...(run?{run:{runId:run.runId||'',status:run.status,
      nodes:run.nodes.map(n=>({nodeId:n.nodeId,status:n.status,error:n.error||'',reused:n.reused===true}))}}:{})}));
    const proposal=await request({snapshot:context.snapshot,history:context.history||[],
      extraContext:{savedFunctions:context.savedFunctions||[],actionResults,reads,
        ...(correction?{actionCorrection:correction}:{})}});
    if(!isActive())break;
    if(proposal.needs?.length){
      const key=JSON.stringify(proposal.needs.map(n=>({kind:n.kind,selector:n.selector})));
      if(seenReads.has(key)||step===2){messages.push(proposal.message||'현재 자료로 해결되지 않은 입력을 알려줘.');break;}
      seenReads.add(key);reads=readNeeds(proposal.needs,context);continue;
    }
    const results=await execute(proposal.actions||[],handlers,{isActive,onActionStart,onActionResult});
    facts.push(...results);runs.push(...results.filter(r=>r.run).map(r=>r.run));
    if(!results.length){
      if(uncommittedMutationClaim(proposal.message)){
        if(step<2){
          correction='The last response promised a graph change but proposed no actions. '+
            'No work has been scheduled or applied. If the requested operation is supported, '+
            'return a valid ir.applyPatch action with exact graph refs and all required fields; '+
            'otherwise explain the blocker without claiming progress or asking the user to wait.';
          continue;
        }
        messages.push('실행 가능한 변경 명령이 생성되지 않아 작업을 적용하지 못했어. '+
          '기존 노드와 정의는 그대로 유지했어.');
      }else if(proposal.message)messages.push(proposal.message);
      break;
    }
    if(results.some(r=>r.kind==='question.ask'&&r.status==='waiting'))break;
    const recoverable=results.some(r=>r.status==='waiting'||r.status==='failed'&&!r.run&&!['function.run','run.start'].includes(r.kind))&&
      !runs.some(run=>run.nodes.some(n=>n.toolEffectStarted));
    if(!recoverable)break;
  }
  return {facts,messages,runs};
}
function readNeeds(needs,{snapshot,history=[],runs=[],savedFunctions=[]}={}){
  let remaining=32000;
  const bytes=s=>Array.from(s).reduce((n,c)=>{const p=c.codePointAt(0);return n+(p>65535?4:p>2047?3:p>127?2:1);},0);
  return needs.slice(0,8).map((need,index)=>{
    const selector=need.selector||{},ref=selector.ref,limit=Math.min(selector.limit||10,20);
    let content;
    if(need.kind==='graph'&&selector.scope!=='ref'||need.kind==='graph'&&ref===snapshot?.graph?.graphId)content=snapshot?.graph;
    else if(need.kind==='definition')content=(snapshot?.definitions||[]).filter(d=>selector.scope!=='ref'||d.definitionId===ref);
    else if(need.kind==='history'&&selector.scope==='current')content=history;
    else if(need.kind==='run')content=runs.filter(r=>selector.scope!=='ref'||r.runId===ref);
    else if(need.kind==='contract'&&selector.scope==='current')content=savedFunctions;
    else if(['value','artifact'].includes(need.kind)&&selector.scope==='ref'){
      for(const node of snapshot?.graph?.nodes||[]){
        if(ref==='file:'+node.nodeId)content=node.settings?.file;
        for(const [port,value] of Object.entries(node.inputBindings||{}))if(ref==='binding:'+node.nodeId+':'+port)content=value;
      }
      for(const run of runs)for(const node of run.nodes||[])for(const [port,value] of Object.entries(node.outputs?.values||{}))
        if(ref==='local:'+run.runId+':'+node.nodeId+':'+port)content=value.inline;
    }
    const available=content!==undefined&&(!Array.isArray(content)||content.length>0);
    const limited=Array.isArray(content)?content.slice(0,limit):content;
    const raw=JSON.stringify(limited??null),budget=selector.depth==='full'?remaining:Math.min(remaining,6000);
    const fits=bytes(raw)<=budget,preview=raw.slice(0,Math.floor(budget/4));
    const truncated=!fits||Array.isArray(content)&&content.length>limit;
    remaining-=fits?bytes(raw):bytes(preview);
    return {ref:'read:'+index,kind:need.kind,selector,available,truncated,
      content:available?(!fits?{preview}:limited):null,
      ...(!available?{reason:'Not available in the current conversation; no external read performed.'}:{})};
  });
}
function deliver(run){
  const success=(run.nodes||[]).filter(n=>n.status==='success');
  const targets=success.filter(n=>(run.targets||[]).includes(n.nodeId));
  const selected=targets.length?targets:run.status==='completed'?[]:success;
  return selected.flatMap(n=>Object.values(n.outputs?.values||{}).map(v=>{
    const value=v.inline;
    if(value&&typeof value==='object'&&value.downloadUrl){
      // Link destinations come only from the artifact adapter, still reject unsafe Markdown URLs.
      const url=String(value.downloadUrl);
      if(/^(https?:\/\/|\/(?!\/)|blob:)/.test(url)&&!/[\s()<>"]/.test(url))
        return '['+String(value.name||'파일').replace(/[\[\]\\]/g,'')+']('+url+')';
    }
    return typeof value==='string'?value:JSON.stringify(value);
  })).filter(Boolean).join('\n\n');
}
const question=action=>({status:'waiting',question:action.args.question});
function blocker(error){
  const known={FUNCTION_INPUT_REQUIRED:'저장 함수의 새 입력을 지정해줘.',FUNCTION_NAMED_INPUTS_REQUIRED:'여러 입력은 이름별로 지정해줘.',
    UNKNOWN_FUNCTION_INPUT:'저장 함수에 정의된 입력 이름을 사용해줘.',FUNCTION_INPUT_TYPE_MISMATCH:'입력 형식이 저장 함수와 맞지 않아.',
    FUNCTION_INPUT_MAPPING_REQUIRED:'저장 함수의 입력 연결을 확인해야 해.',LOCAL_FUNCTION_NOT_FOUND:'저장된 함수를 찾지 못했어.',
    LOCAL_TARGET_UNRESOLVED:'실행할 작업을 찾지 못했어.',REQUIRED_INPUT_MISSING:'실행에 필요한 입력이 빠졌어.',
    LOCAL_EXECUTOR_UNAVAILABLE:'이 작업에 필요한 실행 기능이 현재 제공되지 않아.',LOCAL_ACTION_DEPENDENCY_FAILED:'선행 작업이 완료되지 않아 진행하지 않았어.',
    LOCAL_CONVERSATION_CHANGED:'대화가 바뀌어 남은 작업을 중단했어.',MODEL_OUTPUT_TRUNCATED:'모델 출력 한도를 넘어 결과가 중단됐어.'};
  return known[error]||error||'작업을 처리하지 못했어.';
}
function present({facts=[],messages=[],runs=[]}={}){
  // Latest output for a replaced target wins; independent targets all remain visible.
  const targets=new Map();
  for(const run of runs)for(const id of run.targets||[])targets.set((run.graphRef?.graphId||'')+':'+id,{run,id});
  const parts=[];
  for(const {run,id} of targets.values()){
    const text=deliver({...run,targets:[id],nodes:(run.nodes||[]).filter(n=>n.nodeId===id)});
    if(text&&!parts.includes(text))parts.push(text);
  }
  if(!parts.length)for(const run of runs.filter(r=>r.status!=='completed')){
    const text=deliver(run);if(text&&!parts.includes(text))parts.push(text);
  }
  parts.push(...messages);
  for(const fact of facts){
    if(fact.question){if(!parts.includes(fact.question))parts.push(fact.question);continue;}
    if(fact.run){
      if(fact.run.status!=='completed')parts.push(fact.run.status==='cancelled'?'실행을 중단했어.':fact.run.status==='skipped'?'선택한 작업은 비활성 분기에 있어 실행하지 않았어.':
        blocker(fact.run.nodes.find(n=>n.error)?.error)||'실행을 확인해야 해.');
    }else if(['failed','rejected','skipped','cancelled'].includes(fact.status))parts.push(blocker(fact.error));
    else if(fact.status==='saved')parts.push('함수 초안을 저장했어: '+fact.purpose);
    else if(fact.status==='applied'&&!runs.length)parts.push('작업 구성을 반영했어.');
  }
  return [...new Set(parts.filter(Boolean))].join('\n\n')||
    (runs.some(r=>r.status==='completed')?'작업을 완료했어.':'실행된 변경은 없어.');
}
function needsLanguage({facts=[],messages=[],runs=[]}={}){
  if(messages.length||runs.some(run=>deliver(run).trim()))return false;
  return facts.some(f=>['failed','rejected','waiting','skipped','cancelled'].includes(f.status)||
    f.run&&['failed','waiting','outcome_unknown'].includes(f.run.status));
}
global.OvllPointerLocalActions=Object.freeze({order,execute,coordinate,readNeeds,deliver,present,needsLanguage,question,succeeded});
})(window);
