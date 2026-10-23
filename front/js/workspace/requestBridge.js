import {prepareRequestInput} from './requestInput.js';

const stageLabel=record=>{
 if(record.status==='queued')return '대기열에 등록됨';
 if(record.status==='running')return ({gate:'Gate · 필요한 정보 확인 중',hallwayInitial:'Hallway · 응답 판단 중',workshop:'Workshop · 작업 수행 중',hallwayReturn:'Hallway · 후속 작업 판단 중',output:'Output · 결과 정리 중'})[record.currentLayer]||'요청 처리 중';
 if(record.status==='unsupported_workshop')return 'Workshop 실행 단계는 아직 미구현';
 if(record.status==='failed')return record.currentLayer==='output'?'Output · 최종 응답 생성 실패':'요청 처리 실패';
 return '요청 처리 중';
};
const confirmedActionReceipts=result=>{
 const receipts=[];
 for(const entry of result?.verifiedResults??[]){
   if(entry?.outcome?.status!=='applied'||!Array.isArray(entry.outcome.artifacts))continue;
   const artifact=entry.outcome.artifacts[0];
   if(!artifact||typeof artifact.id!=='string'||!artifact.id)continue;
   const name=typeof artifact.name==='string'&&artifact.name?artifact.name:artifact.id;
   receipts.push({action:entry.action,id:artifact.id,name,revision:Number.isSafeInteger(artifact.revision)&&artifact.revision>0?artifact.revision:entry.outcome.revision});
 }
 return receipts.filter(x=>typeof x.action==='string'&&Number.isSafeInteger(x.revision)&&x.revision>0);
};
const describeDraft=draft=>{
 const description=draft.parts.map(part=>part.type==='text'?part.text:'@'+part.label).join('').trim();
 const attached=draft.attachments.map(x=>x.name).filter(Boolean);
 return [description,...attached.map(name=>'📎 '+name)].filter(Boolean).join('\n')||'구조화 요청';
};

/** Browser-side request/display adapter. Does not own engine or Canvas internals. */
export function createRequestBridge({fetchImpl=globalThis.fetch,promptForToken=()=>globalThis.prompt('Render에 설정한 OVLL_TEST_TOKEN을 입력하세요.\nGemini API 키가 아닌 별도의 테스트 접근키입니다.'),onRecords=()=>{},onActivities=()=>{},onAssets=()=>{},onAccepted=()=>{},pollDelay=900}={}){
 if(typeof fetchImpl!=='function'||typeof promptForToken!=='function')throw new TypeError('Browser transport requires fetch and token prompt');
 const records=[],activities=new Map(),timers=new Set();let token='abcd',destroyed=false;
 const refresh=()=>{if(!destroyed){onRecords(records.map(x=>({...x})));onActivities([...activities.values()].map(x=>({...x})));}};
 async function loadAssets(roomId){const res=await fetchImpl('/api/rooms/'+encodeURIComponent(roomId)+'/assets',{headers:authHeaders(),cache:'no-store'});if(!res.ok)return false;const state=await readResponse(res);if(!destroyed&&Array.isArray(state.skills))onAssets(state);return true;}
 const requestLabel=id=>(records.find(record=>record.id===id+':user')?.text||'구조화 요청').split('\n')[0].slice(0,100);
 const report=(id,label,detail)=>activities.set(id,{requestId:id,label:label+' · '+id.slice(0,8),detail:'요청: '+requestLabel(id)+' · '+detail});
 const diagnostic=error=>{
   if(error?.code==='DATA_UNAVAILABLE'&&Array.isArray(error.missing)){
     const missing=error.missing.slice(0,8).filter(x=>Array.isArray(x)&&x.length===2).map(x=>x[0]+': '+x[1]);
     return missing.length?'필요한 자료 없음 ('+missing.join(', ')+')':'자료를 찾을 수 없습니다 (DATA_UNAVAILABLE)';
   }
   return (error?.code?error.code+' · ':'')+(error?.message||'서버 오류')+(error?.detail?' · '+error.detail:'');
 };
 const authorize=async()=>{
  const typed=await promptForToken();
  if(typeof typed!=='string'||!typed.trim())return false;
  token=typed.trim();return true;
 };
 const authHeaders=()=>token?{authorization:'Bearer '+token}:{};
 async function readResponse(response){
  try{return await response.json();}catch{return {};}
 }
 function schedule(fn){
  const timer=setTimeout(()=>{timers.delete(timer);if(!destroyed)void fn();},pollDelay);
  timers.add(timer);
 }
 async function poll(roomId,requestId,retry=0){
  if(destroyed)return;
  let next;
  try{
   const response=await fetchImpl('/api/requests/'+encodeURIComponent(requestId)+'?roomId='+encodeURIComponent(roomId),{
    headers:authHeaders(),cache:'no-store'
   });
   if(!response.ok){
    if(response.status===401)token='';
    const error=new Error(response.status===404?'서버 재시작 또는 기록 만료로 요청을 찾을 수 없습니다.':response.status===401?'접근키 인증이 만료되었습니다.':'상태 조회 HTTP '+response.status);
    error.permanent=[401,404].includes(response.status);throw error;
   }
   next=await readResponse(response);
   if(next.requestId!==requestId||next.roomId!==roomId||typeof next.status!=='string')throw new Error('요청 상태 응답이 올바르지 않습니다.');
  }catch(error){
   if(destroyed)return;
   report(requestId,error.permanent?'상태 조회 불가':'서버 연결 재확인 중',error.message);refresh();
   if(!error.permanent)schedule(()=>poll(roomId,requestId,retry+1));
   return;
  }
  if(destroyed)return;
  if(next.status==='completed'){
   void loadAssets(roomId).catch(()=>{});
   if(typeof next.result?.languageBlock==='string'){
     const id=requestId+':assistant';
     const confirmed=confirmedActionReceipts(next.result);
     if(!records.some(record=>record.id===id))records.push({id,requestId,role:'assistant',text:next.result.languageBlock,...(confirmed.length?{confirmed}:{})});
   }
   else report(requestId,'응답 검증 실패','완료 상태에 응답 본문이 없습니다.');
   if(typeof next.result?.languageBlock==='string')activities.delete(requestId);
  }else if(next.status==='awaiting_input'){
   activities.set(requestId,{requestId,label:'사용자 답변 대기 · '+requestId.slice(0,8),detail:'요청: '+requestLabel(requestId),waiting:next.waiting});
   void loadAssets(roomId).catch(()=>{});
  }else if(['failed','unsupported_workshop'].includes(next.status)){
   void loadAssets(roomId).catch(()=>{});
   const applied=Array.isArray(next.verifiedResults)&&next.verifiedResults.some(x=>x.outcome?.status==='applied');
   const detail=(next.status==='failed'?diagnostic(next.error):'Workshop을 실행할 수 없습니다.')+(applied?' · 일부 자산 변경은 실제 적용됐어.':'');
   activities.set(requestId,{requestId,label:stageLabel(next)+' · '+requestId.slice(0,8),detail:'요청: '+requestLabel(requestId)+' · '+detail,...(next.status==='failed'&&next.currentLayer==='output'?{retryOutput:true}:{})});
  }else{
   report(requestId,stageLabel(next),next.currentLayer||'queued');
   schedule(()=>poll(roomId,requestId));
  }
  refresh();
 }
 async function submit({draft,roomId,dataAccess}){
  if(destroyed)return {accepted:false,message:'작업실이 닫혔습니다.'};
  let body;
  try{body=prepareRequestInput({draft,dataAccess});}
  catch{return {accepted:false,message:'첨부된 Skill 또는 Canvas 자료를 읽지 못했습니다.'};}
  let response,payload;
  try{
   const send=()=>fetchImpl('/api/requests',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({roomId,...body}),cache:'no-store'});
   response=await send();
   if(response.status===401){
    token='';
    if(!await authorize())return {accepted:false,message:'접근키가 없어 전송하지 않았습니다.'};
    response=await send();
   }
   payload=await readResponse(response);
  }catch{return {accepted:false,message:'서버에 연결할 수 없습니다. 잠시 후 다시 전송해 주세요.'};}
  if(destroyed)return {accepted:false,message:'작업실이 닫혔습니다.'};
  if(!response.ok){
   if(response.status===401)token='';
   return {accepted:false,message:response.status===401?'접근키가 일치하지 않습니다. 다시 입력해 주세요.':response.status===429?'서버 대기열이 가득 찼습니다.':'요청 접수 실패 ('+(payload.error||response.status)+')'};
  }
  if(payload.roomId!==roomId||typeof payload.requestId!=='string'||!payload.requestId)return {accepted:false,message:'서버 접수 응답이 올바르지 않습니다.'};
  records.push({id:payload.requestId+':user',requestId:payload.requestId,role:'user',text:describeDraft(draft)});
  report(payload.requestId,'대기열에 등록됨','서버 응답을 기다리고 있습니다.');
  refresh();try{onAccepted();}catch{/* UI navigation must not undo server acceptance. */}schedule(()=>poll(roomId,payload.requestId));
  return {accepted:true};
 }
 async function retryOutput({roomId,requestId}){
   if(destroyed)return {accepted:false,message:'작업실이 닫혔어.'};
   let response;
   try{response=await fetchImpl('/api/requests/'+encodeURIComponent(requestId)+'/retry-output',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({roomId}),cache:'no-store'});}
   catch{return {accepted:false,message:'서버 연결에 실패했어.'};}
   if(!response.ok)return {accepted:false,message:'최종 응답만 재시도할 수 없는 상태야.'};
   report(requestId,'Output 재시도 중','이미 적용된 자산은 다시 실행하지 않아.');
   refresh();schedule(()=>poll(roomId,requestId));return {accepted:true};
 }
 async function answer({roomId,requestId,waitingId,text}){
   if(destroyed||typeof text!=='string'||!text.trim())return {accepted:false,message:'유효한 답변을 입력해 줘.'};
   let response;
   try{response=await fetchImpl('/api/requests/'+encodeURIComponent(requestId)+'/answer',{method:'POST',headers:{'content-type':'application/json',...authHeaders()},body:JSON.stringify({roomId,waitingId,text}),cache:'no-store'});}
   catch{return {accepted:false,message:'서버 연결에 실패했어.'};}
   if(!response.ok)return {accepted:false,message:'이 질문은 이미 처리됐거나 요청을 재개할 수 없어.'};
   const id=requestId+':answer:'+waitingId;
   if(!records.some(r=>r.id===id))records.push({id,role:'user',requestId,text});
   activities.set(requestId,{requestId,label:'답변 처리 중 · '+requestId.slice(0,8),detail:'요청: '+requestLabel(requestId)});
   refresh();schedule(()=>poll(roomId,requestId));
   return {accepted:true};
 }
 return Object.freeze({submit,answer,retryOutput,loadAssets,destroy(){destroyed=true;for(const timer of timers)clearTimeout(timer);timers.clear();token='';activities.clear();records.length=0;}});
}
