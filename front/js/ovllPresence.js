(function(global){
"use strict";

const UI=global.AstraUI;
const WorkspaceStore=
  global.OvllWorkspaceStore;
const chatPage=document.querySelector("#chat-page");
const chatMessages=document.querySelector("#chat-messages");
const composerInput=
  document.querySelector("#composer-input");
const canvasPage=document.querySelector("#canvas-page");
const canvasWorld=document.querySelector("#canvas-world");

if(!chatPage||!chatMessages||!canvasPage||!canvasWorld){
  throw new Error("OvllPresence DOM 구조가 올바르지 않습니다.");
}

const PHASES=new Set([
  "start",
  "idle",
  "thinking",
  "speaking"
]);

const state={
  phase:"idle",
  mode:UI?.getMode?.()||"chat",
  previousMode:null,
  started:false,
  startView:null,
  startOrb:null,
  chatRow:null,
  chatOrb:null,
  canvasMascot:null,
  canvasSpeech:null,
  speechText:null,
  speechTimer:null,
  settleTimer:null,
  destroyed:false
};

const events=new Map();
const listeners=[];

function on(name,handler){
  if(typeof handler!=="function") return()=>{};
  if(!events.has(name)) events.set(name,new Set());
  events.get(name).add(handler);
  return()=>events.get(name)?.delete(handler);
}

function emit(name,payload){
  for(const handler of events.get(name)||[]){
    try{handler(payload,api);}catch(error){console.error(error);}
  }
}

function listen(element,type,handler,options){
  element.addEventListener(type,handler,options);
  listeners.push(()=>element.removeEventListener(type,handler,options));
}

function setPhase(next,detail={}){
  if(!PHASES.has(next)) next="idle";
  const previous=state.phase;
  state.phase=next;

  if(previous!==next){
    emit("phasechange",{
      phase:next,
      previous,
      ...detail
    });
  }
}

function ensureChatPresence(){
  if(state.chatRow?.isConnected){
    return state.chatRow;
  }

  const row=document.createElement("div");
  row.id="chat-ovll-presence";
  row.className=
    "astra-message astra-message-assistant astra-message-ovll-presence";
  row.dataset.ovllPresence="true";

  const body=document.createElement("div");
  body.className=
    "astra-message-body astra-message-ovll-body";

  const orb=document.createElement("button");
  orb.type="button";
  orb.className="chat-ovll-presence";
  orb.setAttribute("aria-label","오블");
  orb.innerHTML=
    '<span class="chat-ovll-presence-eye" aria-hidden="true"></span>';

  body.appendChild(orb);
  row.appendChild(body);
  chatMessages.appendChild(row);

  state.chatRow=row;
  state.chatOrb=orb;

  listen(orb,"click",event=>{
    event.preventDefault();
    reactChat();
  });

  return row;
}

function startConversationHasWork(
  conversation
){
  if(
    !conversation ||
    typeof conversation!=="object"
  ){
    return false;
  }

  const messages=
    conversation.state
      ?.messages;

  const nodes=
    conversation.state
      ?.canvas
      ?.workflow
      ?.nodes;

  return (
    (
      Array.isArray(messages)&&
      messages.length>0
    )||
    (
      Array.isArray(nodes)&&
      nodes.length>0
    )||
    !!String(
      conversation.state
        ?.lastUserRequest||
      ""
    ).trim()
  );
}

function compactStartText(
  value,
  max=64
){
  const text=
    String(value||"")
      .replace(/\s+/g," ")
      .trim();

  if(text.length<=max){
    return text;
  }

  return (
    text.slice(
      0,
      Math.max(
        1,
        max-1
      )
    )+
    "…"
  );
}

function startViewData(){
  if(
    !WorkspaceStore?.search
  ){
    return {
      primary:null,
      prompts:[]
    };
  }

  const activeId=
    WorkspaceStore
      .getActiveConversation?.()
      ?.id||
    "";

  const recent=
    WorkspaceStore
      .search("")
      .filter(item=>
        item?.id!==activeId&&
        startConversationHasWork(
          item
        )
      );

  const primary=
    recent[0]||null;

  const prompts=[];
  const seen=
    new Set();

  for(const item of recent){
    const value=
      compactStartText(
        item?.state
          ?.lastUserRequest,
        72
      );

    if(
      !value||
      seen.has(value)
    ){
      continue;
    }

    seen.add(value);
    prompts.push(value);

    if(prompts.length>=2){
      break;
    }
  }

  return {
    primary,
    prompts
  };
}

function refreshStartView(){
  const view=
    state.startView;

  if(!view?.isConnected){
    return;
  }

  const data=
    startViewData();

  const primary=
    view.querySelector(
      ".ovll-chat-start-primary"
    );

  const title=
    view.querySelector(
      ".ovll-chat-start-title"
    );

  const resume=
    view.querySelector(
      ".ovll-chat-start-resume"
    );

  const suggestions=
    view.querySelector(
      ".ovll-chat-start-suggestions"
    );

  const primaryTitle=
    data.primary
      ? compactStartText(
          data.primary.title!=="새 대화"
            ? data.primary.title
            : data.primary.state
                ?.lastUserRequest,
          48
        )
      : "";

  primary.hidden=
    !primaryTitle;

  if(primaryTitle){
    title.textContent=
      primaryTitle;

    resume.dataset
      .conversationId=
      String(
        data.primary.id||
        ""
      );
  }else{
    title.textContent="";
    delete resume.dataset
      .conversationId;
  }

  suggestions
    .replaceChildren();

  for(const prompt of data.prompts){
    const button=
      document.createElement(
        "button"
      );

    button.type="button";
    button.className=
      "ovll-chat-start-suggestion";
    button.dataset.prompt=
      prompt;
    button.textContent=
      prompt;

    suggestions.appendChild(
      button
    );
  }

  suggestions.hidden=
    !data.prompts.length;

  view.classList.toggle(
    "has-context",
    !!primaryTitle||
    data.prompts.length>0
  );
}

function reactStartOrb(){
  const orb=
    state.startOrb;

  if(!orb){
    return;
  }

  orb.classList.remove(
    "is-reacting"
  );

  void orb.offsetWidth;

  orb.classList.add(
    "is-reacting"
  );

  setTimeout(()=>{
    orb.classList.remove(
      "is-reacting"
    );
  },280);
}

function ensureStartView(){
  if(state.startView?.isConnected){
    refreshStartView();
    return state.startView;
  }

  const view=document.createElement("div");
  view.id="ovll-chat-start";
  view.className="ovll-chat-start";
  view.setAttribute(
    "aria-label",
    "새 대화"
  );

  view.innerHTML=`
    <button
      type="button"
      class="ovll-chat-start-orb"
      aria-label="오블"
    >
      <span
        class="ovll-chat-start-eye"
        aria-hidden="true"
      ></span>
    </button>

    <section
      class="ovll-chat-start-primary"
      hidden
    >
      <div class="ovll-chat-start-kicker">
        최근 작업
      </div>
      <strong class="ovll-chat-start-title"></strong>
      <button
        type="button"
        class="ovll-chat-start-resume"
      >
        이어가기
      </button>
    </section>

    <div
      class="ovll-chat-start-suggestions"
      hidden
      aria-label="최근 요청"
    ></div>
  `;

  chatPage.appendChild(view);

  state.startView=view;
  state.startOrb=
    view.querySelector(
      ".ovll-chat-start-orb"
    );

  listen(view,"click",event=>{
    const orb=
      event.target.closest(
        ".ovll-chat-start-orb"
      );

    if(orb){
      event.preventDefault();
      reactStartOrb();
      return;
    }

    const resume=
      event.target.closest(
        ".ovll-chat-start-resume"
      );

    if(resume){
      event.preventDefault();

      const id=
        String(
          resume.dataset
            .conversationId||
          ""
        );

      if(id){
        void global.AstraApp
          ?.openConversation?.(
            id
          );
      }

      return;
    }

    const suggestion=
      event.target.closest(
        ".ovll-chat-start-suggestion"
      );

    if(
      suggestion&&
      composerInput
    ){
      event.preventDefault();

      composerInput.value=
        String(
          suggestion.dataset
            .prompt||
          suggestion.textContent||
          ""
        );

      composerInput.dispatchEvent(
        new Event(
          "input",
          {
            bubbles:true
          }
        )
      );

      composerInput.focus({
        preventScroll:true
      });
    }
  });

  refreshStartView();

  return view;
}

function showStart(){
  if(state.started){
    return null;
  }

  const view=ensureStartView();

  view.classList.remove(
    "is-leaving",
    "is-hidden"
  );

  setPhase("start");

  return view;
}

function hideStart(){
  const view=state.startView;

  if(!view?.isConnected) return;

  view.classList.add(
    "is-leaving"
  );

  setTimeout(()=>{
    if(
      state.started&&
      view.isConnected
    ){
      view.remove();
    }
  },220);
}

function moveToEnd(){
  const row=ensureChatPresence();
  chatMessages.appendChild(row);
  return row;
}

function beginConversation(){
  if(!state.started){
    state.started=true;
    hideStart();
  }

  if(state.phase==="start"){
    setPhase("idle");
  }
}

function reactChat(){
  const orb=state.chatOrb||ensureChatPresence().querySelector(".chat-ovll-presence");
  if(!orb) return;

  orb.classList.remove("is-reacting");
  void orb.offsetWidth;
  orb.classList.add("is-reacting");

  setTimeout(()=>{
    orb.classList.remove("is-reacting");
  },300);
}

function settleChat(){
  const orb=
    state.chatOrb||
    ensureChatPresence().querySelector(".chat-ovll-presence");

  if(!orb) return;

  orb.classList.remove("is-thinking");
  orb.classList.add("is-settling");
  orb.setAttribute("aria-label","오블");

  clearTimeout(state.settleTimer);
  state.settleTimer=setTimeout(()=>{
    orb.classList.remove("is-settling");
  },520);
}

function ensureCanvasSpeech(){
  if(state.canvasSpeech?.isConnected){
    return state.canvasSpeech;
  }

  const bubble=document.createElement("div");
  bubble.id="ovll-canvas-speech";
  bubble.setAttribute("role","status");
  bubble.setAttribute("aria-live","polite");
  bubble.innerHTML=
    '<div class="ovll-canvas-speech-body"></div>';

  canvasWorld.appendChild(bubble);
  state.canvasSpeech=bubble;

  return bubble;
}

function canvasMascotElement(){
  return(
    state.canvasMascot?.element||
    global.ovllCanvasMascot?.element||
    null
  );
}

function showCanvasSpeech(text,{thinking=false,hold=7600}={}){
  const bubble=ensureCanvasSpeech();
  const body=bubble.querySelector(
    ".ovll-canvas-speech-body"
  );

  if(!body) return;

  clearTimeout(state.speechTimer);

  bubble.classList.toggle(
    "is-thinking",
    !!thinking
  );

  if(thinking){
    body.innerHTML=
      '<span class="ovll-speech-dot"></span><span class="ovll-speech-dot"></span><span class="ovll-speech-dot"></span>';
  }else{
    body.textContent=
      String(text??"").trim();
  }

  state.speechText=
    thinking
      ?null
      :String(text??"").trim();

  bubble.classList.remove(
    "is-visible"
  );

  requestAnimationFrame(()=>{
    bubble.classList.add(
      "is-visible"
    );
  });

  if(!thinking&&hold>0){
    state.speechTimer=setTimeout(
      hideCanvasSpeech,
      hold
    );
  }
}

function canvasStatus(
  text,
  options={}
){
  const value=
    String(text??"")
      .replace(/\s+/g," ")
      .trim();

  if(!value) return api;

  showCanvasSpeech(
    value,
    {
      thinking:false,
      hold:
        Number.isFinite(
          options.hold
        )
          ?options.hold
          :2200
    }
  );

  return api;
}

function hideCanvasSpeech(){
  clearTimeout(state.speechTimer);
  state.speechTimer=null;

  state.canvasSpeech?.classList.remove(
    "is-visible",
    "is-thinking"
  );

  if(state.phase==="speaking"){
    setPhase("idle");
  }
}

function thinking(){
  beginConversation();

  const row=moveToEnd();
  const orb=
    state.chatOrb||
    row.querySelector(".chat-ovll-presence");

  clearTimeout(state.settleTimer);

  orb?.classList.remove(
    "is-settling"
  );

  orb?.classList.add(
    "is-thinking"
  );

  orb?.setAttribute(
    "aria-label",
    "오블이 생각 중"
  );

  hideCanvasSpeech();
  state.canvasMascot?.setThinking?.(true);

  setPhase("thinking");
  return row;
}

function settle(){
  settleChat();
  state.canvasMascot?.setThinking?.(false);

  if(state.phase==="thinking"){
    setPhase("idle");
  }
}

function speak(text,options={}){
  beginConversation();

  const value=
    String(text??"").trim();

  if(!value) return;

  moveToEnd();
  settleChat();
  state.canvasMascot?.setThinking?.(false);

  showCanvasSpeech(
    value,
    {
      thinking:false,
      hold:
        Number.isFinite(options.hold)
          ?options.hold
          :7600
    }
  );

  setPhase("speaking",{
    text:value
  });
}

function resetConversation({
  started=false
}={}){
  clearTimeout(
    state.speechTimer
  );
  clearTimeout(
    state.settleTimer
  );

  state.speechTimer=null;
  state.settleTimer=null;

  state.chatRow?.remove();
  state.startView?.remove();
  state.canvasSpeech?.remove();

  state.chatRow=null;
  state.chatOrb=null;
  state.startView=null;
  state.startOrb=null;
  state.canvasSpeech=null;
  state.speechText=null;
  state.started=false;

  setPhase(
    "idle"
  );

  if(started){
    beginConversation();
    moveToEnd();
    settleChat();
  }else{
    showStart();
  }

  return api;
}

function workAtNode(
  id,
  active=true
){
  return state.canvasMascot
    ?.workAtNode?.(
      id,
      active
    );
}

function mascotState(
  name,
  detail={}
){
  return state.canvasMascot
    ?.setSituation?.(
      name,
      detail
    );
}

function attachCanvasMascot(mascot){
  state.canvasMascot=mascot||null;

  if(state.phase==="thinking"){
    state.canvasMascot?.setThinking?.(true);
  }

  return api;
}

function handleModeChange({
  mode,
  previous
}={}){
  state.previousMode=
    previous||state.mode;

  state.mode=
    mode||UI?.getMode?.()||"chat";

  if(
    state.previousMode==="canvas"&&
    state.mode==="chat"&&
    !state.started
  ){
    showStart();
  }

}

const offModeChange=
  UI?.on?.(
    "modechange",
    handleModeChange
  );

if(typeof offModeChange==="function"){
  listeners.push(offModeChange);
}

const offWorkspaceChange=
  WorkspaceStore?.on?.(
    "change",
    ()=>{
      if(
        !state.started&&
        state.startView
          ?.isConnected
      ){
        refreshStartView();
      }
    }
  );

if(
  typeof offWorkspaceChange===
    "function"
){
  listeners.push(
    offWorkspaceChange
  );
}

const api={
  showStart,
  beginConversation,
  moveToEnd,
  thinking,
  settle,
  speak,
  canvasStatus,
  hideCanvasSpeech,
  resetConversation,
  workAtNode,
  mascotState,
  attachCanvasMascot,
  react(){
    if(
      state.mode==="chat"&&
      !state.started
    ){
      state.startOrb?.click();
      return;
    }

    reactChat();
    state.canvasMascot?.react?.();
  },
  getState(){
    return{
      phase:state.phase,
      mode:state.mode,
      previousMode:state.previousMode,
      started:state.started,
      speechText:state.speechText
    };
  },
  on,
  destroy(){
    if(state.destroyed) return;
    state.destroyed=true;

    clearTimeout(state.speechTimer);
    clearTimeout(state.settleTimer);

    listeners
      .splice(0)
      .forEach(cleanup=>{
        try{cleanup();}catch{}
      });

    events.clear();
    state.canvasSpeech?.remove();
    state.chatRow?.remove();
    state.startView?.remove();
  }
};

global.OvllPresence=api;

})(window);
