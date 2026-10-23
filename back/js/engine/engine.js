/** Port-driven Gate -> Hallway -> non-IR Workshop -> Output coordinator. */
export function createRequestEngine({composer,modelCaller,dataProvider,workshopExecutor,checkpoints}={}){
 if(!composer?.compose||!modelCaller?.generate||!dataProvider?.resolveNeed)throw new TypeError('Engine ports required');
 const invalid=(code='ENGINE_OUTPUT_INVALID')=>Object.assign(new Error(code),{code});
 const copy=x=>structuredClone(x);
 const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
 const exact=(v,keys)=>obj(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
 const strings=(v,keys)=>exact(v,keys)&&keys.every(k=>typeof v[k]==='string');
 const needValid=need=>Array.isArray(need)&&need.every(x=>{
  if(!Array.isArray(x)||typeof x[0]!=='string')return false;
  if(x[0]==='skillList')return x.length===1;
  if(x[0]==='skillDef'||x[0]==='canvasSkill')return x.length===2&&Array.isArray(x[1])&&x[1].every(k=>typeof k==='string'&&k.length>0);
  if(x[0]==='originalReq'||x[0]==='chatContext')return x.length===2&&Number.isSafeInteger(x[1])&&x[1]>=0;
  return false;
 });
 const blockValid=x=>strings(x,['intent','progress']);
 const dataValid=x=>strings(x,['overallFlow','currentTopic','details']);
 const types=new Set(['skillDefine','skillEdit','canvasEdit','textGenerate','terminate']);
 const recent=history=>history.slice(-4).map(({request,assistantResponse,contextBlock,verifiedResults=[]})=>({request,assistantResponse:assistantResponse??'',contextBlock,verifiedResults:verifiedResults.filter(x=>x?.outcome?.status==='applied').map(x=>({action:x.action,artifacts:x.outcome.artifacts}))}));
 const workIntent=(request,history=[])=>{
   const text=(request?.parts??[]).filter(x=>x.type==='text').map(x=>x.text).join(' ').trim();
   const action=/만들까\?|만들어\s*(줘|주세요|봐|달라)|생성해\s*(줘|주세요)|정의해\s*(줘|주세요)|추가해\s*(줘|주세요)|배치해\s*(줘|주세요)|수정해\s*(줘|주세요)|삭제해\s*(줘|주세요)|바꿔\s*(줘|주세요)|옮겨\s*(줘|주세요)|(?:create|add|edit|delete|remove|update)\b/i;
   const target=/(?:스킬|skill|캔버스|블록|block|노드|node)/i;
   const explicit=target.test(text)&&action.test(text)&&!/(?:방법|예시|설명|알려|어떻게|가능해|can you|how to)/i.test(text);
   if(explicit)return true;
   if(!/^(?:응|ㅇㅇ|그래|좋아|네|예|yes|yep|do it|해줘|진행해)$/i.test(text))return false;
   const last=history.at(-1);
   const asked=last?.assistantResponse??'';
   const previous=(last?.request?.parts??[]).filter(x=>x.type==='text').map(x=>x.text).join(' ');
   return /(?:할까\?|해\s*줄까\?|진행할까\?|만들까\?|shall i\?|should i\?)/i.test(asked)&&target.test(previous+' '+asked)&&action.test(previous+' '+asked);
 };
 const planValid=plan=>Array.isArray(plan)&&plan.length>0&&plan.every((step,index)=>{
  if(!obj(step)||Object.keys(step).length!==1)return false;
  const [name]=Object.keys(step),detail=step[name];
  return types.has(name)&&(name!=='terminate'||index===plan.length-1)&&exact(detail,['objective','need'])&&typeof detail.objective==='string'&&detail.objective.trim()&&needValid(detail.need);
 });
 const finalValid=out=>exact(out,['languageBlock','contextBlock','contextData'])&&typeof out.languageBlock==='string'&&out.languageBlock.trim()&&blockValid(out.contextBlock)&&dataValid(out.contextData);
 async function call(layer,context){
  const prompt=await composer.compose(layer,{languageSettings:'',interfaceSyntax:''});
  const response=await modelCaller.generate({layer,prompt,context,format:'json'});
  try{return JSON.parse(response.jsonText);}catch{throw invalid();}
 }
 function resolved({roomId,requestId,need,resources,request,contextData,chatHistory}){
  return dataProvider.resolveNeed({roomId,requestId,need,availableResources:resources,request,contextData,chatHistory});
 }
 function requireLookup(lookup){
  if(!Array.isArray(lookup?.resources)||!Array.isArray(lookup?.missing))throw invalid();
  if(lookup.missing.length)throw Object.assign(new Error('Required data unavailable'),{code:'DATA_UNAVAILABLE',missing:lookup.missing});
  return lookup.resources;
 }
 const errorResult=(error,stage,state)=>({status:'failed',currentLayer:stage,error:{code:error?.code||'MODEL_ERROR',message:String(error?.code||'Execution failed')},contextBlock:state?.contextBlock,verifiedResults:state?.verifiedResults||[]});
 const roomArgs=state=>({scope:state.roomId,requestId:state.requestId});
 function write(state){
  if(!checkpoints?.save)throw invalid('CHECKPOINT_UNAVAILABLE');
  const previous=checkpoints.load(roomArgs(state));const expectedRevision=previous?.revision??0;
  const result=checkpoints.save({...roomArgs(state),expectedRevision,next:state});
  if(result.status!=='saved')throw invalid('CHECKPOINT_CONFLICT');
  return result;
 }
 async function nextPlan(state,onStage){
  state.returnCount++;
  if(state.returnCount>5)throw invalid('ENGINE_BUDGET_EXCEEDED');
  onStage('hallwayReturn');
  state.stage='hallwayReturn';write(state);
  state.callCount++;
  const reply=await call('hallwayReturn',{contextBlock:{...state.contextBlock,focus:'Review verified steps and unmet objectives'},verifiedResults:state.verifiedResults,resources:state.resources,contextData:state.contextData});
  if(!exact(reply,['plan','contextBlock'])||!planValid(reply.plan)||!blockValid(reply.contextBlock))throw invalid();
  state.plan=reply.plan;state.contextBlock=reply.contextBlock;state.planCursor=0;state.actionCursor=0;state.stage='workshop';write(state);
 }
 async function finish(state,onStage){
  onStage('output');state.stage='output';write(state);
  state.callCount++;
  const result=await call('output',{userRequest:state.request,contextBlock:{...state.contextBlock,focus:'Finalize verified outcomes'},contextData:state.contextData,verifiedResults:state.verifiedResults,resources:state.resources});
  if(!finalValid(result))throw invalid();
  state.stage='completed';state.contextBlock=result.contextBlock;state.contextData=result.contextData;
  state.answer=result.languageBlock;write(state);
  return {status:'completed',currentLayer:'output',result:{languageBlock:result.languageBlock,verifiedResults:copy(state.verifiedResults)},contextBlock:result.contextBlock,contextData:result.contextData};
 }
 async function progress(state,onStage){
  try{
   while(true){
    if(state.callCount>=40||state.actionCount>=24)throw invalid('ENGINE_BUDGET_EXCEEDED');
    if(state.planCursor>=state.plan.length){await nextPlan(state,onStage);continue;}
    const step=state.plan[state.planCursor],workshop=Object.keys(step)[0],detail=step[workshop];
    if(workshop==='terminate')return await finish(state,onStage);
    onStage('workshop');state.stage='workshop';
    const looked=await resolved({roomId:state.roomId,requestId:state.requestId,need:detail.need,resources:state.resources,request:state.request,contextData:state.contextData,chatHistory:state.chatHistory});
    const stepResources=requireLookup(looked);
    state.callCount++;
    const selection=await workshopExecutor.decide({workshop,objective:detail.objective,scope:state.roomId,request:state.request,contextBlock:state.contextBlock,resources:stepResources,verifiedResults:state.verifiedResults,answer:state.lastAnswer??null,focus:'Workshop '+workshop+' step '+state.planCursor});
    state.lastAnswer=null;
    if(selection.done){
      state.planCursor++;state.actionCursor=0;write(state);continue;
    }
    state.actionCount++;
    const operationId=state.requestId+':'+state.planCursor+':'+state.actionCursor++;
    state.pendingOperation={operationId,action:selection.action,args:copy(selection.args)};
    write(state); // intent before side effects
    if(selection.action==='question'||selection.action==='basicText'){
      const message={operationId,workshop,action:selection.action,status:'applied',text:selection.args.text};
      state.verifiedResults.push(message);state.pendingOperation=null;
      if(selection.action==='question'){
       state.status='awaiting_input';state.waiting={id:operationId,text:selection.args.text};write(state);
       return {status:'awaiting_input',currentLayer:'workshop',contextBlock:state.contextBlock,waiting:copy(state.waiting),verifiedResults:copy(state.verifiedResults)};
      }
      write(state);continue;
    }
    let outcome=workshopExecutor.apply({scope:state.roomId,requestId:state.requestId,operationId,action:selection.action,args:selection.args,expectedRevision:workshopExecutor.read({scope:state.roomId}).revision});
    state.verifiedResults.push({workshop,action:selection.action,operationId,outcome:copy(outcome)});
    state.pendingOperation=null;write(state);
    if(outcome.status!=='applied'){await nextPlan(state,onStage);continue;}
   }
  }catch(error){
   const failedAt=state.stage;
   if(state.stage==='output'||error.code==='UNSUPPORTED_ACTION'||error.code==='ENGINE_BUDGET_EXCEEDED'){
    if(state.stage==='output')state.failedStage='output';
    state.stage='failed';try{write(state);}catch{}
   }
   return errorResult(error,failedAt,state);
  }
 }
 async function run(snapshot,{onStage=()=>{}}={}){
  if(!snapshot?.request||!Array.isArray(snapshot.initialResources)||typeof onStage!=='function')throw invalid();
  const request=copy(snapshot.request),contextData=copy(snapshot.contextData),initialResources=copy(snapshot.initialResources),chatHistory=copy(snapshot.chatHistory??[]),recentConversation=recent(chatHistory);
  const gate=await call('gate',{userRequest:request,contextData,initialResources,availableHistory:{completedRequests:chatHistory.length},recentConversation});
  if(!exact(gate,['need'])||!needValid(gate.need))throw invalid();
  const resources=requireLookup(await resolved({roomId:snapshot.roomId,requestId:snapshot.requestId,need:gate.need,resources:initialResources,request,contextData,chatHistory}));
  onStage('hallwayInitial');
  const requiresWork=workIntent(request,chatHistory);
  let reply=await call('hallwayInitial',{userRequest:request,contextData,resources,recentConversation,requiresVerifiedWork:requiresWork});
  // One corrective model call, never accept a promise as evidence of a mutation.
  if((requiresWork&&finalValid(reply))||(!finalValid(reply)&&(!exact(reply,['plan','contextBlock'])||!planValid(reply.plan)||!blockValid(reply.contextBlock)))){
    const reason=requiresWork&&finalValid(reply)?'This request requires an actual verified Workshop action. A promise or acknowledgment is NOT completion.':'Return exactly one valid shape: languageBlock+contextBlock+contextData OR plan+contextBlock; all required fields must be present.';
    reply=await call('hallwayInitial',{userRequest:request,contextData,resources,recentConversation,requiresVerifiedWork:requiresWork,correction:reason});
  }
  if(finalValid(reply)){
    if(requiresWork)throw Object.assign(new Error('A verified action is required'),{code:'WORK_REQUIRED',detail:'hallwayInitial: direct reply cannot complete a requested Skill/Canvas change'});
    return {status:'completed',currentLayer:'hallwayInitial',result:{languageBlock:reply.languageBlock},contextBlock:reply.contextBlock,contextData:reply.contextData};
  }
  if(!exact(reply,['plan','contextBlock'])||!planValid(reply.plan)||!blockValid(reply.contextBlock))throw Object.assign(new Error('Invalid Hallway output'),{code:'ENGINE_OUTPUT_INVALID',detail:'hallwayInitial: expected plan+contextBlock or languageBlock+contextBlock+contextData'});
  if(requiresWork&&!reply.plan.some(step=>Object.keys(step)[0]!=='textGenerate'&&Object.keys(step)[0]!=='terminate'))throw Object.assign(new Error('No executable action planned'),{code:'WORK_REQUIRED',detail:'hallwayInitial: requested Skill/Canvas change has no corresponding Workshop'});

  if(!workshopExecutor||!checkpoints)return {status:'unsupported_workshop',currentLayer:'hallwayInitial',plan:reply.plan,contextBlock:reply.contextBlock};
  const state={roomId:snapshot.roomId,requestId:snapshot.requestId,request,contextData,chatHistory,resources,contextBlock:reply.contextBlock,plan:reply.plan,planCursor:0,actionCursor:0,callCount:2,actionCount:0,returnCount:0,verifiedResults:[],stage:'workshop',status:'running',waiting:null,pendingOperation:null};
  write(state);return progress(state,onStage);
 }
 async function resume(snapshot,{waitingId,text,onStage=()=>{}}={}){
  if(typeof waitingId!=='string'||typeof text!=='string'||!text.trim()||text.length>8000)throw new TypeError('Invalid resume input');
  const entry=checkpoints?.load({scope:snapshot.roomId,requestId:snapshot.requestId});
  if(!entry||entry.state?.status!=='awaiting_input'||entry.state.waiting?.id!==waitingId)throw new Error('Request is not waiting for this answer');
  const state=entry.state;
  state.status='running';state.waiting=null;state.lastAnswer=text;
  state.contextData=copy(snapshot.contextData??state.contextData);
  state.chatHistory=copy(snapshot.chatHistory??state.chatHistory);
  state.verifiedResults.push({action:'userAnswer',waitingId,text,status:'confirmed'});write(state);
  return progress(state,onStage);
 }
 async function retryOutput(snapshot,{onStage=()=>{}}={}){
  const entry=checkpoints?.load({scope:snapshot.roomId,requestId:snapshot.requestId});
  if(entry?.state?.stage!=='failed'||entry.state.failedStage!=='output')throw new Error('Output retry unavailable');
  const state=entry.state;state.status='running';
  try{return await finish(state,onStage);}
  catch(error){state.failedStage='output';state.stage='failed';write(state);return errorResult(error,'output',state);}
 }
 return Object.freeze({run,resume,retryOutput});
}