(function(global){
'use strict';
function createOperations({getConversationId,isDestroyed=()=>false}={}){
  let current=null,generation=0;
  function isCurrent(operation){
    return !!operation&&current===operation&&operation.generation===generation&&
      !isDestroyed()&&getConversationId?.()===operation.conversationId;
  }
  function begin({conversationId=getConversationId?.(),kind='request'}={}){
    if(current)throw new Error('LOCAL_OPERATION_ALREADY_ACTIVE');
    if(!conversationId||isDestroyed())throw new Error('LOCAL_SCOPE_UNAVAILABLE');
    const controller=new AbortController();
    current={conversationId,kind,generation:++generation,controller,signal:controller.signal};
    return current;
  }
  function finish(operation){
    if(current!==operation)return false;
    current=null;return true;
  }
  function cancel(){current?.controller.abort();}
  function invalidate(){cancel();current=null;generation++;}
  return Object.freeze({begin,isCurrent,isActive:operation=>isCurrent(operation)&&!operation.signal.aborted,
    cancel,invalidate,finish,getCurrent:()=>current});
}
function createRunPresence({presence,isActive=()=>true,getSkillNodeLabel=()=>''}={}){
  const transitions=new Map();let active=null,activeSkillNode=null;
  const label=id=>String(getSkillNodeLabel(id)||'노드').trim()||'노드';
  function update(run){
    if(!run||!isActive())return;
    for(const entry of run.skillNodes||[]){
      const key=String(run.runId)+':'+entry.skillNodeId,previous=transitions.get(key);
      if(previous===entry.status)continue;
      transitions.set(key,entry.status);
      if(previous!=='running'||entry.status==='running')continue;
      if(active===key){presence?.workAtSkillNode?.(entry.skillNodeId,false);active=null;activeSkillNode=null;}
      if(entry.status==='success'){
        presence?.mascotState?.('skillNodeSuccess',{skillNodeId:entry.skillNodeId});
        presence?.canvasStatus?.(label(entry.skillNodeId)+' 실행 완료',{hold:1700});
      }else if(['failed','blocked','outcome_unknown'].includes(entry.status)){
        presence?.mascotState?.('skillNodeError',{skillNodeId:entry.skillNodeId});
        presence?.canvasStatus?.(label(entry.skillNodeId)+' 실행 실패',{hold:2200});
      }else if(entry.status==='cancelled'){
        presence?.mascotState?.('cancelled',{skillNodeId:entry.skillNodeId});
        presence?.canvasStatus?.('실행 중단됨',{hold:1700});
      }
    }
    const running=(run.skillNodes||[]).find(entry=>entry.status==='running');
    if(running){
      const key=String(run.runId)+':'+running.skillNodeId;
      if(active!==key){
        if(active)presence?.workAtSkillNode?.(activeSkillNode,false);
        presence?.workAtSkillNode?.(running.skillNodeId,true);
        presence?.canvasStatus?.(label(running.skillNodeId)+' 실행 중',{hold:0});
        active=key;activeSkillNode=running.skillNodeId;
      }
    }
  }
  function reset(){
    if(active)presence?.workAtSkillNode?.(activeSkillNode,false);
    active=null;activeSkillNode=null;transitions.clear();
  }
  return Object.freeze({update,reset});
}

function createTaskContext(previous,requestText,additionalContext){
  const text=String(requestText||'').trim();
  const history=Array.isArray(previous?.requestHistory)?
    previous.requestHistory.filter(s=>typeof s==='string'&&s.trim()&&s.length<=2400).slice(-5):[];
  const prior=previous?.requestText;
  if(typeof prior==='string'&&prior.trim()&&prior!==text&&prior.length<=2400&&history.at(-1)!==prior)
    history.push(prior);
  // A new user turn is authoritative. Earlier tasks are background, not active constraints.
  return {objective:text,requestText:text,constraints:[],requestHistory:additionalContext?[]:history.slice(-6)};
}
function additionalContextInput(value){
  return {recentTurns:(value?.recentTurns||[]).slice(-2),sessionContext:value?.sessionContext||'',
    constraints:value?.constraints||[],...(value?.pendingTurns?.length?{pendingCount:value.pendingTurns.length,pendingRefs:value.pendingTurns.flatMap(t=>[t.requestRef,t.responseRef]).filter(Boolean),complete:false}:{}),
    ...(value?.pendingOverflow?{pendingOverflow:true,complete:false}:{})};
}
const contextBytes=value=>Array.from(JSON.stringify(value)).reduce((n,c)=>{const p=c.codePointAt(0);return n+(p>65535?4:p>2047?3:p>127?2:1);},0);
function updateAdditionalContext(previous,record,{requestRef=null,responseRef=null,pendingCovered=false}={}){
  const next=JSON.parse(JSON.stringify(previous||{recentTurns:[],sessionContext:'',constraints:[],pendingTurns:[]}));
  const superseded=record?.supersededConstraints??[];
  const retiredValid=Array.isArray(superseded)&&superseded.length<=64&&new Set(superseded).size===superseded.length&&
    superseded.every(x=>typeof x==='string'&&(next.constraints||[]).includes(x));
  const valid=record&&retiredValid&&[record.requestDigest,record.responseDigest,record.sessionContext].every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&
    Array.isArray(record.constraints)&&record.constraints.length<=64&&record.constraints.every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&contextBytes(record)<=24000;
  if(valid){
    const constraints=[...new Set([...(next.constraints||[]).filter(x=>!superseded.includes(x)),...record.constraints])];
    const candidate={...next,recentTurns:[...(next.recentTurns||[]),{requestDigest:record.requestDigest,responseDigest:record.responseDigest}].slice(-2),sessionContext:record.sessionContext,constraints,
      ...(pendingCovered?{pendingTurns:[]}:{})};
    // Preserve every unrevoked exact condition; never silently drop one to meet admission.
    if(constraints.length<=64&&constraints.every(x=>typeof x==='string'&&x.trim()&&x.length<=2400)&&contextBytes(additionalContextInput(candidate))<=23000)return candidate;
  }
  next.pendingTurns=[...(next.pendingTurns||[]),{requestRef,responseRef}];
  if(next.pendingTurns.length>2){next.pendingTurns=next.pendingTurns.slice(-2);next.pendingOverflow=true;}
  return next;
}
function parseFunctionRequest(text){
  const match=String(text||'').trim().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if(!match)throw new Error('LOCAL_FUNCTION_NOT_FOUND');
  const input=match[2]||'';
  if(input.startsWith('{')){
    let bindings;try{bindings=JSON.parse(input);}catch{throw new Error('FUNCTION_NAMED_INPUTS_REQUIRED');}
    if(!bindings||typeof bindings!=='object'||Array.isArray(bindings))throw new Error('FUNCTION_NAMED_INPUTS_REQUIRED');
    return {id:match[1],input,bindings};
  }
  return {id:match[1],input};
}
global.OvllPointerActivity=Object.freeze({createOperations,createRunPresence,createTaskContext,additionalContextInput,updateAdditionalContext,parseFunctionRequest});
})(window);
