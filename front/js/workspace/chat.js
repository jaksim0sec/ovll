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
    let confirmed;
    if(value.confirmed!==undefined){
      if(value.role!=='assistant'||!Array.isArray(value.confirmed)||value.confirmed.length>30)throw new TypeError('Invalid verified actions');
      confirmed=value.confirmed.map(action=>{
        if(!action||typeof action.action!=='string'||!action.action||typeof action.id!=='string'||!action.id||typeof action.name!=='string'||!action.name||!Number.isSafeInteger(action.revision)||action.revision<1)throw new TypeError('Invalid verified action');
        return {action:action.action,id:action.id,name:action.name,revision:action.revision};
      });
    }
    return {id:value.id,role:value.role,text:value.text,
      ...(value.requestId!==undefined?{requestId:value.requestId}:{}),...(confirmed!==undefined?{confirmed}:{})};
  });
}
export function normalizeRequestActivities(items){
  if(!Array.isArray(items))throw new TypeError('Request activities must be an array');
  const seen=new Set();
  return items.map(value=>{
    if(!value||typeof value.requestId!=='string'||!value.requestId.trim()||seen.has(value.requestId)||
       typeof value.label!=='string'||!value.label.trim()||
       (value.detail!==undefined&&typeof value.detail!=='string')||
       (value.waiting!==undefined&&(!value.waiting||typeof value.waiting.id!=='string'||typeof value.waiting.text!=='string'))||
       (value.retryOutput!==undefined&&typeof value.retryOutput!=='boolean'))
      throw new TypeError('Invalid request activity');
    seen.add(value.requestId);
    return {requestId:value.requestId,label:value.label,
      ...(value.detail!==undefined?{detail:value.detail}:{}),...(value.waiting!==undefined?{waiting:{id:value.waiting.id,text:value.waiting.text}}:{}),...(value.retryOutput?{retryOutput:true}:{})};
  });
}
export function createChat({onOpenCanvas,onAnswer,onRetryOutput}={}){
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
  const assetsHost=document.createElement('section');assetsHost.className='workspace-server-assets';assetsHost.hidden=true;assetsHost.setAttribute('aria-label','서버 확정 스킬');
  const activityHost=document.createElement('div');activityHost.className='workspace-request-activities';
  activityHost.setAttribute('aria-label','진행 중 요청');feed.append(recordsHost,assetsHost,activityHost);
  const saveState=document.createElement('small');saveState.className='workspace-save-state';saveState.dataset.saveState='';
  saveState.setAttribute('role','status');saveState.textContent='불러오는 중';
  element.append(welcome,feed,saveState);
  const openCanvas=()=>onOpenCanvas?.();open.addEventListener('click',openCanvas);
  let records=[],activities=[],confirmedAssets=null,destroyed=false;
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
      if(record.confirmed?.length){
        const receipts=make('div','workspace-confirmed-actions','');
        receipts.append(make('span','workspace-confirmed-heading','서버에서 확인된 작업'));
        for(const action of record.confirmed){
          const entry=make('div','workspace-confirmed-action','');
          entry.append(make('strong','workspace-confirmed-name',action.name),make('span','workspace-confirmed-meta',action.action+' · rev '+action.revision));
          receipts.append(entry);
        }
        article.append(receipts);
      }
      return article;
    }));
    if(confirmedAssets){
      const header=make('div','workspace-assets-header','');
      header.append(make('strong','workspace-assets-title','서버 확정 자산'),make('small','workspace-assets-revision','rev '+confirmedAssets.revision+' · 스킬 '+confirmedAssets.skills.length+'개 · 블록 '+confirmedAssets.blocks.length+'개'));
      const entries=make('div','workspace-assets-items','');
      for(const skill of confirmedAssets.skills.slice(0,12)){
        const item=make('div','workspace-asset-item','');
        item.append(make('span','workspace-asset-name',skill.name),make('small','workspace-asset-version','v'+skill.revision));
        entries.append(item);
      }
      if(confirmedAssets.skills.length>12)entries.append(make('small','workspace-asset-extra','외 '+(confirmedAssets.skills.length-12)+'개'));
      const go=make('button','workspace-assets-open','캔버스 보기');go.type='button';go.addEventListener('click',()=>onOpenCanvas?.());
      assetsHost.replaceChildren(header,entries,go);
    }
    assetsHost.hidden=!confirmedAssets||(!confirmedAssets.skills.length&&!confirmedAssets.blocks.length);
    activityHost.replaceChildren(...activities.map(activity=>{
      const section=make('section','workspace-request-activity','');
      section.dataset.requestId=activity.requestId;section.setAttribute('role','status');
      section.append(make('span','workspace-request-activity-label',activity.label));
      if(activity.detail)section.append(make('p','workspace-request-activity-detail',activity.detail));
      if(activity.retryOutput){
        const retry=document.createElement('button');retry.type='button';retry.textContent='최종 응답만 다시 생성';
        retry.addEventListener('click',async()=>{
          retry.disabled=true;const result=await onRetryOutput?.({requestId:activity.requestId});
          if(!result?.accepted){retry.disabled=false;section.append(make('p','workspace-request-activity-detail',result?.message||'재시도 실패'));}
        });section.append(retry);
      }
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
    setConfirmedAssets(value){
      if(destroyed)throw new Error('Chat view has been destroyed');
      if(!value||!Number.isSafeInteger(value.revision)||!Array.isArray(value.skills)||!Array.isArray(value.blocks))throw new TypeError('Invalid confirmed assets');
      confirmedAssets={revision:value.revision,skills:value.skills.map(s=>({name:String(s.name),revision:s.revision,id:s.id})),blocks:value.blocks.map(b=>({id:b.id}))};render();
    },
    destroy(){if(destroyed)return;destroyed=true;open.removeEventListener('click',openCanvas);
      records=[];activities=[];element.remove();}
  };
}
