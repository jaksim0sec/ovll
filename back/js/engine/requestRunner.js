/** Gate -> Hallway -> Action shell coordinator. Mutating Workshop execution intentionally absent. */
import {createActionShell} from './actionShell.js';
import {createCallManager} from './callManager.js';
export function createRequestRunner({composer,modelCaller,dataProvider,actionShell=createActionShell(),callManager}={}){
 const calls=callManager??createCallManager({composer,modelCaller});
 if(!composer?.compose||!modelCaller?.generate||!dataProvider?.resolveNeed||!actionShell?.accepts||!actionShell?.enter)throw new TypeError('Engine ports required');
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
 const recent=history=>history.slice(-4).map(({request,assistantResponse,contextBlock,verifiedResults=[],status,error})=>({request,assistantResponse:assistantResponse??'',status:status??'completed',error:error?{code:error.code??'FAILED'}:null,contextBlock,verifiedResults:verifiedResults.filter(x=>x?.outcome?.status==='applied').map(x=>({action:x.action,artifacts:x.outcome.artifacts}))}));
 const unresolvedRequest=(request,history=[])=>{
   const text=(request?.parts??[]).filter(p=>p.type==='text').map(p=>p.text).join(' ').trim();
   const last=history.at(-1);
   if(last?.status!=='failed'||!last.request)return null;
   // A follow-up explicitly pointing to the failed attempt resumes that objective.
   // Diagnostic questions remain direct questions; they must not execute a retry.
   if(/(?:왜|어떻게|무슨|원인|실패\s*이유|why|how|what)/i.test(text))return null;
   if(!/(?:방금|아까|그거|그걸|말했잖아|했잖아|라니까|보라니까|다시\s*해|재시도|try again|do it again)/i.test(text))return null;
   return {request:copy(last.request),requestId:last.requestId??null,error:last.error??null,verifiedResults:copy(last.verifiedResults??[])};
 };
 const workIntent=(request,history=[])=>{
   if(unresolvedRequest(request,history))return true;
   const text=(request?.parts??[]).filter(x=>x.type==='text').map(x=>x.text).join(' ').trim();
   const action=/만들어\s*(줘|주세요|봐|달라)|생성해\s*(줘|주세요)|정의해\s*(줘|주세요)|추가해\s*(줘|주세요)|배치해\s*(줘|주세요)|수정해\s*(줘|주세요)|삭제해\s*(줘|주세요)|바꿔\s*(줘|주세요)|옮겨\s*(줘|주세요)|(?:create|add|edit|delete|remove|update)\b/i;
   const target=/(?:스킬|skill|캔버스|블[록럭]|block|노드|node)/i;
   const explicit=target.test(text)&&action.test(text)&&!/(?:방법|예시|설명|알려|어떻게|가능해|can you|how to)/i.test(text);
   if(explicit)return true;
   if(!/^(?:응|ㅇㅇ|그래|좋아|네|예|yes|yep|do it|해줘|진행해)$/i.test(text))return false;
   const last=history.at(-1);
   const asked=last?.assistantResponse??'';
   const previous=(last?.request?.parts??[]).filter(x=>x.type==='text').map(x=>x.text).join(' ');
   return /(?:할까\?|해\s*줄까\?|진행할까\?|만들까\?|shall i\?|should i\?)/i.test(asked)&&target.test(previous+' '+asked)&&(action.test(previous+' '+asked)||/만들까\?/.test(asked));
 };

 const planValid=plan=>Array.isArray(plan)&&plan.length>0&&plan.every((step,index)=>{
  if(!obj(step)||Object.keys(step).length!==1)return false;
  const [action]=Object.keys(step),detail=step[action];
  return (action==='terminate'||actionShell.accepts(action))&&(action!=='terminate'||index===plan.length-1)&&exact(detail,['objective','need'])&&typeof detail.objective==='string'&&!!detail.objective.trim()&&needValid(detail.need);
 });
 const finalValid=out=>exact(out,['languageBlock','contextBlock','contextData'])&&typeof out.languageBlock==='string'&&!!out.languageBlock.trim()&&blockValid(out.contextBlock)&&dataValid(out.contextData);
 async function call(layer,context,snapshot){
  const route=layer==='hallwayInitial'?{layer:'hallway',phase:'initial'}:{layer};
  const response=await calls.invoke({roomId:snapshot.roomId,requestId:snapshot.requestId,requestRevision:snapshot.revision??0,route,context,bindings:{languageSettings:'',interfaceSyntax:''},format:'json'});
  try{return JSON.parse(response.jsonText);}catch{throw Object.assign(invalid(),{detail:layer+': invalid JSON returned by model'});}
 }
 function requireLookup(lookup){
  if(!Array.isArray(lookup?.resources)||!Array.isArray(lookup?.missing))throw invalid();
  if(lookup.missing.length)throw Object.assign(new Error('Required data unavailable'),{code:'DATA_UNAVAILABLE',missing:lookup.missing});
  return lookup.resources;
 }
 async function run(snapshot,{onStage=()=>{}}={}){
  if(!snapshot?.request||!Array.isArray(snapshot.initialResources)||typeof onStage!=='function')throw invalid();
  const request=copy(snapshot.request),contextData=copy(snapshot.contextData),initialResources=copy(snapshot.initialResources),chatHistory=copy(snapshot.chatHistory??[]),recentConversation=recent(chatHistory),unresolved=unresolvedRequest(request,chatHistory);
  const gate=await call('gate',{userRequest:request,contextData,initialResources,availableHistory:{completedRequests:chatHistory.length},recentConversation,unresolvedRequest:unresolved},snapshot);
  if(!exact(gate,['need'])||!needValid(gate.need))throw invalid();
  const resources=requireLookup(await dataProvider.resolveNeed({roomId:snapshot.roomId,requestId:snapshot.requestId,need:gate.need,availableResources:initialResources,request,contextData,chatHistory}));
  onStage('hallwayInitial');
  const requiresWork=workIntent(request,chatHistory);
  const hallwayContext={userRequest:request,unresolvedRequest:unresolved,contextData,resources,recentConversation,requiresVerifiedWork:requiresWork};
  let reply,retried=false;
  try{reply=await call('hallwayInitial',hallwayContext,snapshot);}
  catch(error){
   if(error?.code!=='ENGINE_OUTPUT_INVALID')throw error;
   retried=true;reply=await call('hallwayInitial',{...hallwayContext,correction:'Return exactly a valid plan+contextBlock or languageBlock+contextBlock+contextData. For a Skill/Canvas change, plan named actions instead of merely promising.'},snapshot);
  }
  if(!retried&&((requiresWork&&finalValid(reply))||(!finalValid(reply)&&(!exact(reply,['plan','contextBlock'])||!planValid(reply.plan)||!blockValid(reply.contextBlock))))){
   reply=await call('hallwayInitial',{...hallwayContext,correction:requiresWork&&finalValid(reply)?'A promise is not an applied change. Return a plan of qualified action names, not a successful reply.':'Return exactly a valid direct reply or an action plan.'},snapshot);
  }
  if(finalValid(reply)){
   if(requiresWork)throw Object.assign(new Error('Action required'),{code:'WORK_REQUIRED',detail:'hallwayInitial: a reply cannot finish a requested Skill/Canvas change'});
   return {status:'completed',currentLayer:'hallwayInitial',result:{languageBlock:reply.languageBlock},contextBlock:reply.contextBlock,contextData:reply.contextData};
  }
  if(!exact(reply,['plan','contextBlock'])||!planValid(reply.plan)||!blockValid(reply.contextBlock))throw Object.assign(new Error('Invalid Hallway output'),{code:'ENGINE_OUTPUT_INVALID',detail:'hallwayInitial: plan must contain qualified actions'});
  const [action,detail]=Object.entries(reply.plan[0])[0];
  if(action==='terminate')throw Object.assign(new Error('Cannot terminate unexecuted plan'),{code:'WORK_REQUIRED',detail:'No verified action was executed'});
  if(requiresWork&&!reply.plan.some(step=>Object.keys(step)[0]!=='terminate'&&!Object.keys(step)[0].startsWith('textGenerate.')))
   throw Object.assign(new Error('No mutation action planned'),{code:'WORK_REQUIRED',detail:'Skill/Canvas change requires an action'});
  const available=requireLookup(await dataProvider.resolveNeed({roomId:snapshot.roomId,requestId:snapshot.requestId,need:detail.need,availableResources:resources,request,contextData,chatHistory}));
  onStage('actionShell');
  const handoff=actionShell.enter({action,objective:detail.objective,need:detail.need,resources:available});
  return {status:'unsupported_workshop',currentLayer:'actionShell',plan:copy(reply.plan),handoff:copy(handoff),contextBlock:copy(reply.contextBlock)};
 }
 return Object.freeze({run});
}
