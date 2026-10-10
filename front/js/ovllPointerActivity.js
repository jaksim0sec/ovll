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
function createRunPresence({presence,isActive=()=>true}={}){
  const transitions=new Map();let active=null,activeNode=null;
  function update(run){
    if(!run||!isActive())return;
    for(const entry of run.nodes||[]){
      const key=String(run.runId)+':'+entry.nodeId,previous=transitions.get(key);
      if(previous===entry.status)continue;
      transitions.set(key,entry.status);
      if(previous!=='running'||entry.status==='running')continue;
      if(active===key){presence?.workAtNode?.(entry.nodeId,false);active=null;activeNode=null;}
      if(entry.status==='success')presence?.mascotState?.('nodeSuccess',{nodeId:entry.nodeId});
      else if(['failed','blocked','outcome_unknown'].includes(entry.status))
        presence?.mascotState?.('nodeError',{nodeId:entry.nodeId});
      else if(entry.status==='cancelled')presence?.mascotState?.('cancelled',{nodeId:entry.nodeId});
    }
    const running=(run.nodes||[]).find(entry=>entry.status==='running');
    if(running){
      const key=String(run.runId)+':'+running.nodeId;
      if(active!==key){presence?.workAtNode?.(running.nodeId,true);active=key;activeNode=running.nodeId;}
    }
  }
  function reset(){
    if(active)presence?.workAtNode?.(activeNode,false);
    active=null;activeNode=null;transitions.clear();
  }
  return Object.freeze({update,reset});
}
function createTaskContext(previous,requestText){
  const text=String(requestText||'').trim();
  const task=previous?JSON.parse(JSON.stringify(previous)):{};
  task.objective=task.objective||text;
  task.requestText=text;
  task.constraints=Array.isArray(task.constraints)?task.constraints:[];
  task.requestHistory=Array.isArray(task.requestHistory)?task.requestHistory:[];
  const prior=previous?.requestText;
  if(prior&&prior!==task.objective&&prior!==text&&task.requestHistory.at(-1)!==prior)task.requestHistory.push(prior);
  return task;
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
global.OvllPointerActivity=Object.freeze({createOperations,createRunPresence,createTaskContext,parseFunctionRequest});
})(window);
