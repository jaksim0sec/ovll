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
  return /(잠시.{0,10}기다|기다려.{0,10}주|(?:삭제|제거|수정|변경|적용|반영|구성|실행|처리|생성|지우)(?:하겠|할게|하도록|했|됐|했습니다|해드리겠)|패치를.{0,16}(?:만들|구성)|완료(?:했|됐|되었|되었습니다)|(?:파일|PDF|보고서|작업).{0,32}(?:준비(?:됐|되었|되었습니다)|생성(?:됐|되었|되었습니다)|완성(?:됐|했)))/i.test(text)||
    /\b(?:file|pdf|report|workflow|task|node)\b.{0,64}\b(?:ready|created|generated|completed|saved|executed)\b|\b(?:created|generated|completed|saved|executed)\b.{0,40}\b(?:file|pdf|report|workflow|task|node)\b/i.test(text);
}
function resultIndex({snapshot,runs=[]}={}){
  const visible=new Set((snapshot?.graph?.nodes||[]).map(n=>n.nodeId)),latest=new Map();
  for(const run of runs){
    if(run.graphRef?.graphId!==snapshot?.graph?.graphId)continue;
    for(const node of run.nodes||[])if(visible.has(node.nodeId))latest.set(node.nodeId,{run,node});
  }
  const items=[];let bytes=0;
  for(const {run,node} of latest.values()){
    const outputs=Object.entries(node.outputs?.values||{}).slice(0,8).map(([port,value])=>{
      const raw=JSON.stringify(value.inline??null),preview=raw.slice(0,400);
      return {port,ref:'local:'+run.runId+':'+node.nodeId+':'+port,preview,truncated:raw.length>preview.length};
    });
    const item={nodeId:node.nodeId,runId:run.runId,status:node.status,
      resultCurrent:node.status==='success'&&node.resultCurrent===true,outputs,
      outputsTotal:Object.keys(node.outputs?.values||{}).length,
      ...(node.error?{error:String(node.error).slice(0,160)}:{})};
    const size=Array.from(JSON.stringify(item)).reduce((n,c)=>{const p=c.codePointAt(0);return n+(p>65535?4:p>2047?3:p>127?2:1);},0);
    if(bytes+size>11000)continue;
    items.push(item);bytes+=size;
  }
  return {items,total:latest.size,truncated:items.length<latest.size};
}
function functionIndex(functions){
  const bytes=value=>Array.from(JSON.stringify(value)).reduce((n,c)=>{const p=c.codePointAt(0);return n+(p>65535?4:p>2047?3:p>127?2:1);},0);
  const port=p=>({name:p.name,representation:p.representation,required:p.required===true});
  return functions.map(fn=>{
    const item={id:fn.id,version:fn.version,purpose:String(fn.purpose||'').slice(0,180),
      inputs:(fn.inputs||[]).slice(0,8).map(port),outputs:(fn.outputs||[]).slice(0,8).map(port),
      inputsTotal:fn.inputs?.length||0,outputsTotal:fn.outputs?.length||0,
      invariantsAvailable:!!fn.invariants?.length,fixedInputsAvailable:!!Object.keys(fn.fixedInputs||{}).length,
      contractRef:fn.id,contractAvailable:true};
    item.contractTruncated=!!fn.invariants?.length||String(fn.purpose||'').length>180||
      item.inputsTotal>8||item.outputsTotal>8;
    if(bytes(item)>1024){delete item.inputs;delete item.outputs;item.purpose=item.purpose.slice(0,80);item.contractTruncated=true;}
    return item;
  });
}
async function coordinate({getContext,request,handlers,isActive=()=>true,onActionStart,onActionResult,onCheckpoint,readSource}={}){
  const facts=[],messages=[],runs=[],seenReads=new Set();let reads=[],correction='',checkpoint=null;
  for(let step=0;step<3&&isActive();step++){
    const context=await getContext();
    const actionResults=facts.map(({run,...fact})=>({...fact,...(run?{run:runEvidence(run)}:{})}));
    const proposal=await request({snapshot:context.snapshot,history:context.history||[],
      ...(context.taskContext?{taskContext:context.taskContext}:{}),
      extraContext:{savedFunctions:functionIndex(context.savedFunctions||[]),availableResults:resultIndex(context),actionResults,reads,
        ...(context.pointerQuestion?{questionCheckpoint:context.pointerQuestion}:{}),
        ...(correction?{actionCorrection:correction}:{})}});
    if(!isActive())break;
    if(proposal.needs?.length){
      const key=JSON.stringify(proposal.needs.map(n=>({kind:n.kind,selector:n.selector})));
      if(seenReads.has(key)||step===2){messages.push(proposal.message&&!uncommittedMutationClaim(proposal.message)?proposal.message:'현재 자료로 해결되지 않은 입력을 알려줘.');break;}
      seenReads.add(key);reads=await readNeedsAsync(proposal.needs,{...context,runs:[...(context.runs||[]),...runs]},
        {readSource:readSource||context.readSource});continue;
    }
    const results=await execute(proposal.actions||[],handlers,{isActive,onActionStart,onActionResult});
    facts.push(...results);runs.push(...results.filter(r=>r.run).map(r=>r.run));
    if(!results.length){
      if(uncommittedMutationClaim(proposal.message)){
        if(facts.length)break; // Actual facts, never a later unsupported declaration, decide the reply.
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
    const questionFact=results.find(r=>r.kind==='question.ask'&&r.status==='waiting');
    if(questionFact){
      checkpoint={questionId:questionFact.questionId||'question:'+questionFact.localKey,
        question:questionFact.question,awaitingInput:true,graphRef:context.snapshot?.graph?{
          graphId:context.snapshot.graph.graphId,revision:context.snapshot.graph.revision}:null,
        taskContext:context.taskContext||null,actionResults:facts.map(({run,...fact})=>({...fact,...(run?{run:runEvidence(run)}:{})})),
        runRefs:runs.map(run=>run.runId).filter(Boolean),createdAt:Date.now()};
      if(onCheckpoint)try{await onCheckpoint(checkpoint);}catch(error){
        checkpoint.storage={status:'failed',error:error?.code||error?.message||'LOCAL_QUESTION_SAVE_FAILED'};
        facts.push({kind:'question.checkpoint',status:'failed',error:checkpoint.storage.error});
      }
      break;
    }
    const recoverable=results.some(r=>r.status==='waiting'||r.status==='failed'&&!r.run&&!['function.run','run.start'].includes(r.kind))&&
      !runs.some(run=>run.nodes.some(n=>n.toolEffectStarted));
    if(!recoverable&&proposal.incomplete!==true)break;
  }
  return {facts,messages,runs,checkpoint};
}
// Keep actual refs and bounded output evidence for follow-up. Full values remain
// in run storage and can be requested through readNeeds rather than disappearing.
function runEvidence(run){
  let budget=24000;
  return {runId:run.runId||'',status:run.status,graphRef:run.graphRef,targets:run.targets,
    deliverableTargets:run.deliverableTargets,coverage:run.coverage,nodes:(run.nodes||[]).map(n=>{
      const row={nodeId:n.nodeId,status:n.status,error:n.error||'',reused:n.reused===true,
        outputRefs:n.outputRefs||Object.keys(n.outputs?.values||{}).map(port=>'local:'+run.runId+':'+n.nodeId+':'+port),
        provenance:n.provenance,execution:n.execution};
      if(n.outputs){const size=JSON.stringify(n.outputs).length;
        if(size<=budget){row.outputs=n.outputs;budget-=size;}
        else {row.outputsAvailable=true;row.outputEvidenceTruncated=true;}}
      return row;
    })};
}
async function readNeedsAsync(needs,context={}, {readSource=global.OvllPointerLocal?.readSource}={}){
  const reads=readNeeds(needs,context);let remaining=32000;
  for(let index=0;index<reads.length;index++){
    const need=needs[index],ref=need.selector?.ref;
    if(!['value','artifact'].includes(need.kind)||!ref?.startsWith('file:'))continue;
    const node=context.snapshot?.graph?.nodes?.find(n=>'file:'+n.nodeId===ref);
    if(!node?.settings?.file||typeof readSource!=='function')continue;
    let source;try{source=await readSource(node.settings.file,{maxBytes:Math.max(1,Math.min(need.selector?.depth==='full'?24000:6000,Math.floor((remaining-1500)/2)))});}
    catch(error){source={status:'blocked',reason:error?.code||error?.message||'LOCAL_FILE_READ_FAILED'};}
    const rawValue=source?.value,available=source?.status==='success';
    const {textPreview,...value}=rawValue||{};
    remaining=Math.max(0,remaining-JSON.stringify(value).length*2);
    reads[index]={...reads[index],available,content:available?value:null,
      availability:available?'local_bytes':'unavailable',contentAvailable:available,coverage:value?.coverage||null,
      truncated:available&&value?.coverage?.truncated===true,
      provenance:value?.provenance||source?.provenance||{},...(available?{}:{reason:source?.reason||'LOCAL_FILE_BYTES_UNAVAILABLE'})};
  }
  return reads;
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
    else if(need.kind==='contract')content=savedFunctions.filter(fn=>selector.scope!=='ref'||fn.id===ref).map(({presentation,createdAt,...contract})=>contract);
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
      availability:selector.ref?.startsWith('file:')?'metadata_only':available?'inline':'unavailable',
      contentAvailable:available&&!selector.ref?.startsWith('file:'),
      coverage:{unit:'items',total:Array.isArray(content)?content.length:available?1:0,
        included:Array.isArray(limited)?limited.length:available?1:0,truncated},
      content:available?(!fits?{preview}:limited):null,
      ...(!available?{reason:'Not available in the current conversation; no external read performed.'}:{})};
  });
}
function deliveryContent(run){
  const success=(run.nodes||[]).filter(n=>n.status==='success'&&n.resultCurrent!==false);
  const delivery=run.deliverableTargets||run.targets||[];
  const selected=success.filter(n=>delivery.includes(n.nodeId));
  const artifacts=[];
  const text=selected.flatMap(n=>Object.values(n.outputs?.values||{}).map(v=>{
    const value=v.inline;
    if(value&&typeof value==='object'&&value.downloadUrl){
      // Only a confirmed runtime effect supplies cards. Model text and model
      // objects are never interpreted as artifact registration instructions.
      const url=String(value.downloadUrl);
      if(n.toolEffectStarted===true&&n.effectConfirmed===true&&
        /^(https?:\/\/|\/(?!\/)|blob:)/.test(url)&&!/[\s()<>"]/.test(url))artifacts.push({...value});
      return String(value.name||'파일');
    }
    return typeof value==='string'?value:JSON.stringify(value);
  })).filter(Boolean).join('\n\n');
  return {text,artifacts};
}
function deliver(run){return deliveryContent(run).text;}
const question=action=>({status:'waiting',question:action.args.question,questionId:action.args.questionId||'question:'+action.localKey});
function blocker(error){
  const known={FUNCTION_INPUT_REQUIRED:'저장 함수의 새 입력을 지정해줘.',FUNCTION_NAMED_INPUTS_REQUIRED:'여러 입력은 이름별로 지정해줘.',
    UNKNOWN_FUNCTION_INPUT:'저장 함수에 정의된 입력 이름을 사용해줘.',FUNCTION_INPUT_TYPE_MISMATCH:'입력 형식이 저장 함수와 맞지 않아.',
    FUNCTION_INPUT_MAPPING_REQUIRED:'저장 함수의 입력 연결을 확인해야 해.',LOCAL_FUNCTION_NOT_FOUND:'저장된 함수를 찾지 못했어.',
    LOCAL_TARGET_UNRESOLVED:'실행할 작업을 찾지 못했어.',REQUIRED_INPUT_MISSING:'실행에 필요한 입력이 빠졌어.',
    LOCAL_FILE_BYTES_UNAVAILABLE:'원본 파일 데이터가 없어. 파일을 다시 추가해줘.',LOCAL_FILE_PARSER_UNAVAILABLE:'이 파일 형식의 원문 분석 기능은 아직 제공되지 않아.',LOCAL_RUN_NOT_REACHED:'선행 작업이 멈춰 남은 작업을 실행하지 않았어.',
    WORKSPACE_REVISION_CONFLICT:'다른 탭에서 작업이 변경됐어. 저장된 내용을 다시 불러와줘.',
    LOCAL_EXECUTOR_UNAVAILABLE:'이 작업에 필요한 실행 기능이 현재 제공되지 않아.',LOCAL_ACTION_DEPENDENCY_FAILED:'선행 작업이 완료되지 않아 진행하지 않았어.',
    LOCAL_CONVERSATION_CHANGED:'대화가 바뀌어 남은 작업을 중단했어.',MODEL_OUTPUT_TRUNCATED:'모델 출력 한도를 넘어 결과가 중단됐어.'};
  return known[error]||error||'작업을 처리하지 못했어.';
}
function presentation({facts=[],messages=[],runs=[]}={}){
  // Latest output for a replaced target wins; independent targets all remain visible.
  const targets=new Map();
  for(const run of runs)for(const id of run.deliverableTargets||run.targets||[])targets.set((run.graphRef?.graphId||'')+':'+id,{run,id});
  const parts=[],artifacts=[],seenArtifacts=new Set();
  function append(content){
    if(content.text&&!parts.includes(content.text))parts.push(content.text);
    for(const artifact of content.artifacts){
      const key=String(artifact.id||artifact.localFileId||artifact.downloadUrl);
      if(!seenArtifacts.has(key)){seenArtifacts.add(key);artifacts.push(artifact);}
    }
  }
  for(const {run,id} of targets.values()){
    append(deliveryContent({...run,targets:[id],deliverableTargets:[id],nodes:(run.nodes||[]).filter(n=>n.nodeId===id)}));
  }
  if(!parts.length)for(const run of runs.filter(r=>r.status!=='completed')){
    append(deliveryContent(run));
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
  parts.push(...runNotices(runs));
  return {text:[...new Set(parts.filter(Boolean))].join('\n\n')||
    (runs.some(r=>r.status==='completed')?'작업을 완료했어.':'실행된 변경은 없어.'),artifacts};
}
function present(result){return presentation(result).text;}
function runNotices(runs=[]){
  const parts=[];
  for(const run of runs){
    if(run.validity?.snapshotCurrent===false)parts.push('작업 구성이 바뀌어 이전 실행 결과는 현재 결과로 사용할 수 없어.');
    if(run.coverage?.sourceTruncated)parts.push('원문 일부만 읽은 결과야. 누락 범위를 확인해줘.');
    if(run.coverage?.outputTruncated)parts.push('내보낸 파일에 내용 일부가 생략됐어. 생략 범위를 확인해줘.');
    if(run.storage?.status==='failed')parts.push('실행 결과를 저장하지 못했어: '+blocker(run.storage.error));
    if((run.nodes||[]).some(node=>Object.values(node.outputs?.values||{}).some(v=>v.inline?.availability?.localSaveError)))
      parts.push('결과 파일을 이 기기에 저장하지 못했어. 다운로드 링크의 만료를 확인해줘.');
  }
  return [...new Set(parts.filter(Boolean))];
}
function withRunNotices(message,runs){
  return [...new Set([String(message||'').trim(),...runNotices(runs)].filter(Boolean))].join('\n\n');
}
function groundedResponse(message,evidence){
  return uncommittedMutationClaim(message)?present(evidence):withRunNotices(message,evidence.runs);
}
function needsLanguage({facts=[],messages=[],runs=[]}={}){
  if(messages.length||runs.some(run=>deliver(run).trim()))return false;
  return facts.some(f=>['failed','rejected','waiting','skipped','cancelled'].includes(f.status)||
    f.run&&['failed','waiting','outcome_unknown'].includes(f.run.status));
}
global.OvllPointerLocalActions=Object.freeze({order,execute,functionIndex,resultIndex,coordinate,readNeeds,readNeedsAsync,deliver,present,presentation,runNotices,withRunNotices,groundedResponse,needsLanguage,question,succeeded});
})(window);
