import {icon} from './icons.js';

/** Frontend presentation records. NOT backend messages or an execution protocol. */
export function normalizeConfirmedChatRecords(records){
  if(!Array.isArray(records))throw new TypeError('Confirmed records must be an array');
  const seen=new Set();
  return records.map(value=>{
    if(!value||typeof value.id!=='string'||!value.id.trim()||seen.has(value.id)||
       !['user','assistant'].includes(value.role)||typeof value.text!=='string'||
       (value.requestId!==undefined&&(typeof value.requestId!=='string'||!value.requestId.trim())))
      throw new TypeError('Invalid confirmed chat record');
    seen.add(value.id);
    return {id:value.id,role:value.role,text:value.text,
      ...(value.requestId!==undefined?{requestId:value.requestId}:{})};
  });
}
export function normalizeRequestActivities(items){
  if(!Array.isArray(items))throw new TypeError('Request activities must be an array');
  const seen=new Set();
  return items.map(value=>{
    if(!value||typeof value.requestId!=='string'||!value.requestId.trim()||seen.has(value.requestId)||
       typeof value.label!=='string'||!value.label.trim()||
       (value.detail!==undefined&&typeof value.detail!=='string')||
       (value.waiting!==undefined&&(!value.waiting||typeof value.waiting.id!=='string'||typeof value.waiting.text!=='string')))
      throw new TypeError('Invalid request activity');
    seen.add(value.requestId);
    return {requestId:value.requestId,label:value.label,
      ...(value.detail!==undefined?{detail:value.detail}:{}),...(value.waiting!==undefined?{waiting:{id:value.waiting.id,text:value.waiting.text}}:{})};
  });
}
export function createChat({onOpenCanvas,onAnswer}={}){
  const element=document.createElement('section');element.className='workspace-chat';
  element.setAttribute('aria-label','채팅');
  const welcome=document.createElement('div');welcome.className='workspace-welcome';
  const wordmark=document.createElement('span');wordmark.className='workspace-wordmark';
  wordmark.append('ovll');const beta=document.createElement('span');beta.textContent='beta';wordmark.append(beta);
  const title=document.createElement('h1');title.textContent='무엇부터 시작할까요?';
  const desc=document.createElement('p');desc.textContent='스킬을 연결하고 작업을 이어가세요.';
  const open=document.createElement('button');open.type='button';open.className='workspace-open-canvas';
  open.innerHTML=icon('canvas');const label=document.createElement('span');label.textContent='캔버스 열기';open.append(label);
  welcome.append(wordmark,title,desc,open);
  const feed=document.createElement('div');feed.className='workspace-chat-feed';feed.hidden=true;feed.setAttribute('aria-label','대화 기록');
  const recordsHost=document.createElement('div');recordsHost.className='workspace-chat-history';
  const activityHost=document.createElement('div');activityHost.className='workspace-request-activities';
  activityHost.setAttribute('aria-label','진행 중 요청');feed.append(recordsHost,activityHost);
  const saveState=document.createElement('small');saveState.className='workspace-save-state';saveState.dataset.saveState='';
  saveState.setAttribute('role','status');saveState.textContent='불러오는 중';
  element.append(welcome,feed,saveState);
  const openCanvas=()=>onOpenCanvas?.();open.addEventListener('click',openCanvas);
  let records=[],activities=[],destroyed=false;
  const make=(tag,css,text)=>{const node=document.createElement(tag);node.className=css;node.textContent=text;return node};
  function render(){
    if(destroyed)return;
    const nearEnd=element.scrollHeight-element.scrollTop-element.clientHeight<90;
    recordsHost.replaceChildren(...records.map(record=>{
      const article=make('article','workspace-message is-'+record.role,'');
      article.dataset.messageId=record.id;
      if(record.requestId)article.dataset.requestId=record.requestId;
      article.append(make('span','workspace-message-speaker',record.role==='user'?'나':'오블'),
                     make('p','workspace-message-text',record.text));
      return article;
    }));
    activityHost.replaceChildren(...activities.map(activity=>{
      const section=make('section','workspace-request-activity','');
      section.dataset.requestId=activity.requestId;section.setAttribute('role','status');
      section.append(make('span','workspace-request-activity-label',activity.label));
      if(activity.detail)section.append(make('p','workspace-request-activity-detail',activity.detail));
      if(activity.waiting){
        const form=document.createElement('form');form.className='workspace-answer-form';
        const question=make('p','workspace-request-question',activity.waiting.text);
        const input=document.createElement('input');input.type='text';input.maxLength=8000;input.required=true;input.placeholder='답변을 입력해 줘';
        const send=document.createElement('button');send.type='submit';send.textContent='답변 보내기';
        form.append(question,input,send);
        form.addEventListener('submit',async event=>{
          event.preventDefault();const text=input.value.trim();if(!text)return;
          send.disabled=true;
          try{const result=await onAnswer?.({requestId:activity.requestId,waitingId:activity.waiting.id,text});
            if(result?.accepted){input.disabled=true;send.textContent='답변 전송됨';}
            else {send.disabled=false;section.append(make('p','workspace-request-activity-detail',result?.message||'답변을 전달하지 못했어.'));}
          }catch{send.disabled=false;}
        });
        section.append(form);
      }
      return section;
    }));
    const visible=records.length>0||activities.length>0;
    welcome.hidden=visible;feed.hidden=!visible;element.classList.toggle('has-feed',visible);
    if(nearEnd)element.scrollTop=element.scrollHeight;
  }
  return {element,saveState,
    setConfirmedRecords(value){if(destroyed)throw new Error('Chat view has been destroyed');records=normalizeConfirmedChatRecords(value);render();},
    setRequestActivities(value){if(destroyed)throw new Error('Chat view has been destroyed');activities=normalizeRequestActivities(value);render();},
    destroy(){if(destroyed)return;destroyed=true;open.removeEventListener('click',openCanvas);
      records=[];activities=[];element.remove();}
  };
}
