(function(global){
"use strict";

const API=
  global.AstraAPI;
const Store=
  global.OvllCustomNodeStore;
const CustomNodes=
  global.OvllCustomNodes;
const SvgLibrary=
  global.OvllSvgLibrary;
const WorkspaceStore=
  global.OvllWorkspaceStore;
const createWorkspace=
  global.createOvllWorkspace;

if(
  !API||
  !Store||
  !CustomNodes||
  typeof createWorkspace!=="function"
){
  return;
}

const COLORS=[
  "#7c6cf2",
  "#4f8ef7",
  "#10a77a",
  "#e9a63a",
  "#d96f83",
  "#6c7a89"
];
const DEFAULT_ICON_KEY="pencil";
const ICON_LABELS={
  play:"시작",globe:"지구본",notebook:"정리",scales:"저울",
  pen:"펜",folder:"폴더",sparkle:"생성",
  "open-book":"펼쳐진 책",flask:"플라스크",
  "potted-plant":"화분","graduation-cap":"학사모",
  pencil:"연필",lightbulb:"전구",hourglass:"모래시계",
  planet:"행성",headphones:"헤드폰",
  "coffee-cup":"커피잔",compass:"나침반"
};

function clone(value){
  return value==null
    ?value
    :JSON.parse(
      JSON.stringify(value)
    );
}

function emptyWorkflow(){
  return {
    nodes:[],
    connections:[]
  };
}

function createOvllFunctionWorkspace(
  host,
  options={}
){
  const document=
    options.document||
    global.document;

  if(!host){
    throw new Error(
      "함수 Workspace host가 없습니다."
    );
  }

  const state={
    destroyed:false,
    ready:false,
    editingId:null,
    canvas:null,
    definitions:null,
    color:COLORS[0],
    iconKey:DEFAULT_ICON_KEY,
    recordsOpen:false,
    messages:[],
    dirty:false,
    busy:false,
    inspectorOpen:false,
    deleteArmed:false,
    deleteTimer:null,
    canvasOffs:[]
  };

  const workspace=
    createWorkspace(
      host,
      {
        document,
        history:false,
        navigation:false,
        navigationEvents:false,
        initialMode:"chat",
        pluginContext:
          "custom-builder",
        globalMascotFallback:false,
        presenceOptions:{
          startGreeting:
            "어떤 함수를 만들까?"
        }
      }
    );

  workspace.elements
    .composerInput
    .placeholder=
    "함수 흐름을 어떻게 만들까?";

  if(
    workspace.elements
      .composerAttach
  ){
    workspace.elements
      .composerAttach
      .hidden=true;
  }

  const sendIcon=
    SvgLibrary?.get?.(
      "composerSend"
    );

  if(sendIcon){
    workspace.elements
      .composerSubmit
      .innerHTML=
      sendIcon;
  }

  const headerStart=
    workspace.slots
      .headerStart;

  const headerEnd=
    workspace.slots
      .headerEnd;

  const overlay=
    workspace.slots
      .overlay;

  const backButton=
    document.createElement(
      "button"
    );

  backButton.type="button";
  backButton.className=
    "ovll-function-back";
  backButton.dataset
    .functionBack="";
  backButton.setAttribute(
    "aria-label",
    "함수 만들기 닫기"
  );
  backButton.innerHTML=`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="m12.4 5.5-4.5 4.5 4.5 4.5" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  headerStart?.appendChild(
    backButton
  );

  const context=
    document.createElement(
      "div"
    );

  context.className=
    "ovll-function-context";

  context.innerHTML=`
    <button
      class="ovll-function-identity"
      data-function-inspector-toggle
      type="button"
      aria-expanded="false"
    >
      <span class="ovll-function-icon" data-function-icon-preview aria-hidden="true"></span>
      <span class="ovll-function-identity-copy">
        <strong data-function-title>새 함수</strong>
        <small data-function-save-state>새 함수</small>
      </span>
    </button>
  `;

  overlay?.appendChild(
    context
  );

  const saveButton=
    document.createElement(
      "button"
    );

  saveButton.type="button";
  saveButton.className=
    "ovll-function-save";
  saveButton.dataset
    .functionSave="";
  saveButton.textContent=
    "저장";

  headerEnd?.appendChild(
    saveButton
  );

  const inspector=
    document.createElement(
      "div"
    );

  inspector.className=
    "ovll-function-inspector";

  inspector.hidden=true;

  inspector.innerHTML=`
    <div class="ovll-function-inspector-head">
      <strong>함수 설정</strong>
      <button data-function-records-open type="button">내 함수</button>
    </div>

    <label class="ovll-function-field">
      <span>이름</span>
      <input data-function-name maxlength="50" placeholder="새 함수" autocomplete="off">
    </label>

    <label class="ovll-function-field">
      <span>설명</span>
      <textarea data-function-description maxlength="220" rows="2" placeholder="언제, 무슨 일을 하는 함수인지"></textarea>
    </label>

    <div class="ovll-function-field">
      <span>아이콘</span>
      <div class="ovll-function-icons" data-function-icons role="group" aria-label="노드 아이콘 선택"></div>
    </div>

    <div class="ovll-function-field">
      <span>색상</span>
      <div class="ovll-function-colors" data-function-colors></div>
    </div>

    <button class="ovll-function-delete" data-function-delete type="button" hidden>삭제</button>
  `;

  overlay?.appendChild(
    inspector
  );

  const recordsPanel=
    document.createElement("div");

  recordsPanel.className=
    "ovll-function-records-panel";
  recordsPanel.hidden=true;
  recordsPanel.innerHTML=`
    <div class="ovll-function-inspector-head">
      <strong>내 함수</strong>
      <div class="ovll-function-records-actions">
        <button data-function-new type="button">새 함수</button>
        <button data-function-records-close type="button" aria-label="내 함수 닫기">닫기</button>
      </div>
    </div>
    <div class="ovll-function-list" data-function-list></div>
  `;

  overlay?.appendChild(recordsPanel);

  const nameInput=
    inspector.querySelector(
      "[data-function-name]"
    );

  const descriptionInput=
    inspector.querySelector(
      "[data-function-description]"
    );

  const colorsRoot=
    inspector.querySelector(
      "[data-function-colors]"
    );

  const iconsRoot=
    inspector.querySelector(
      "[data-function-icons]"
    );

  const listRoot=
    recordsPanel.querySelector(
      "[data-function-list]"
    );

  const deleteButton=
    inspector.querySelector(
      "[data-function-delete]"
    );

  const title=
    context.querySelector(
      "[data-function-title]"
    );

  const saveState=
    context.querySelector(
      "[data-function-save-state]"
    );

  const iconPreview=
    context.querySelector(
      "[data-function-icon-preview]"
    );

  const inspectorToggle=
    context.querySelector(
      "[data-function-inspector-toggle]"
    );

  const listeners=[];

  function listen(
    target,
    type,
    handler,
    listenerOptions
  ){
    if(!target){
      return;
    }

    target.addEventListener(
      type,
      handler,
      listenerOptions
    );

    listeners.push(
      ()=>target.removeEventListener(
        type,
        handler,
        listenerOptions
      )
    );
  }

  function setStatus(
    text,
    tone="neutral"
  ){
    saveState.textContent=
      String(text||"");

    saveState.dataset.tone=
      tone;
  }

  function displayName(){
    const name=
      String(
        nameInput?.value||
        ""
      ).trim();

    return name||
      "새 함수";
  }

  function syncIdentity(){
    if(title){
      title.textContent=
        displayName();
    }

    if(iconPreview){
      iconPreview.style.setProperty(
        "--function-color",
        state.color
      );
      iconPreview.innerHTML=
        SvgLibrary?.get?.(state.iconKey)||
        SvgLibrary?.get?.("custom")||
        "";
    }
  }

  function setIconKey(key){
    state.iconKey=
      SvgLibrary?.has?.(key)
        ?String(key)
        :"custom";

    iconsRoot?.querySelectorAll("[data-function-icon-key]")
      .forEach(button=>{
        const active=button.dataset.functionIconKey===state.iconKey;
        button.classList.toggle("is-active",active);
        button.setAttribute("aria-pressed",String(active));
      });

    syncIdentity();
  }

  function renderIconChoices(){
    iconsRoot?.replaceChildren();

    for(const key of SvgLibrary?.getServerKeys?.()||[]){
      const svg=SvgLibrary.get(key);
      if(!svg)continue;

      const button=document.createElement("button");
      const name=ICON_LABELS[key]||key;
      button.type="button";
      button.className="ovll-function-icon-option";
      button.dataset.functionIconKey=key;
      button.setAttribute("aria-label",name);
      button.setAttribute("title",name);
      button.setAttribute("aria-pressed","false");
      button.innerHTML=svg;
      iconsRoot?.appendChild(button);
    }

    setIconKey(state.iconKey);
  }

  function setColor(color){
    state.color=
      COLORS.includes(color)
        ?color
        :COLORS[0];

    colorsRoot
      ?.querySelectorAll(
        "[data-function-color]"
      )
      .forEach(button=>{
        const active=
          button.dataset
            .functionColor===
          state.color;

        button.classList
          .toggle(
            "is-active",
            active
          );

        button.setAttribute(
          "aria-pressed",
          String(active)
        );
      });

    syncIdentity();
  }

  function markDirty(){
    state.dirty=true;
    setStatus(
      "저장 전 변경사항",
      "pending"
    );
  }

  function resetDeleteArm(){
    state.deleteArmed=false;

    clearTimeout(
      state.deleteTimer
    );

    state.deleteTimer=null;

    if(deleteButton){
      deleteButton.textContent=
        "삭제";
    }
  }

  function recordInUse(recordId){
    const type=
      CustomNodes
        .typeForRecord(
          recordId
        );

    const active=
      global.AstraApp
        ?.getWorkflow?.();

    if(
      active?.nodes?.some(
        node=>node?.type===type
      )
    ){
      return true;
    }

    const snapshot=
      WorkspaceStore
        ?.getSnapshot?.();

    return !!snapshot
      ?.conversations
      ?.some(
        conversation=>
          conversation
            ?.state
            ?.canvas
            ?.workflow
            ?.nodes
            ?.some(
              node=>
                node?.type===
                type
            )
      );
  }

  function renderRecords(){
    if(!listRoot){
      return;
    }

    const records=
      Store.list();

    listRoot.replaceChildren();

    if(!records.length){
      const empty=
        document.createElement(
          "div"
        );

      empty.className=
        "ovll-function-list-empty";

      empty.textContent=
        "아직 저장한 함수가 없어";

      listRoot.appendChild(
        empty
      );

      return;
    }

    for(const record of records){
      const button=
        document.createElement(
          "button"
        );

      button.type="button";
      button.className=
        "ovll-function-list-item";
      button.dataset
        .functionRecordId=
        record.id;

      button.classList.toggle(
        "is-active",
        record.id===
        state.editingId
      );

      button.style.setProperty(
        "--function-color",
        record.color||
        COLORS[0]
      );

      const count=
        record.workflow
          ?.nodes
          ?.length||0;

      button.innerHTML=`
        <span class="ovll-function-list-icon" aria-hidden="true"></span>
        <span class="ovll-function-list-copy">
          <strong></strong>
          <small></small>
        </span>
      `;

      button.querySelector(
        ".ovll-function-list-icon"
      ).innerHTML=
        SvgLibrary?.get?.(record.iconKey)||
        SvgLibrary?.get?.("custom")||
        "";

      button.querySelector(
        "strong"
      ).textContent=
        record.name;

      button.querySelector(
        "small"
      ).textContent=
        count+
        "개 노드 · v"+
        record.revision;

      listRoot.appendChild(
        button
      );
    }
  }

  function setInspectorOpen(open){
    if(open&&state.recordsOpen)setRecordsOpen(false);
    state.inspectorOpen=
      !!open;

    inspector.hidden=
      !state.inspectorOpen;

    inspector.classList.toggle(
      "is-open",
      state.inspectorOpen
    );

    inspectorToggle
      ?.setAttribute(
        "aria-expanded",
        String(
          state.inspectorOpen
        )
      );

    return state.inspectorOpen;
  }

  function setRecordsOpen(open){
    state.recordsOpen=!!open;
    recordsPanel.hidden=!state.recordsOpen;
    recordsPanel.classList.toggle("is-open",state.recordsOpen);
    if(state.recordsOpen){
      setInspectorOpen(false);
      renderRecords();
    }
  }

  function renderMessages(){
    workspace.clearMessages();

    for(const message of state.messages){
      workspace.appendMessage(
        message.role,
        message.text,
        {
          presence:false,
          instant:true
        }
      );
    }

    if(state.messages.length){
      workspace.presence
        .resetConversation?.({
          started:true
        });
    }else{
      workspace.presence
        .showStart?.();
    }
  }

  function history(){
    return state.messages
      .filter(item=>
        item.role==="user"||
        item.role==="assistant"
      )
      .slice(-12)
      .map(item=>({
        role:item.role,
        text:item.text
      }));
  }

  function pushMessage(
    role,
    text,
    options={}
  ){
    const value=
      String(text||"")
        .trim();

    if(!value){
      return;
    }

    state.messages.push({
      role,
      text:value
    });

    state.messages=
      state.messages.slice(-48);

    workspace.appendMessage(
      role,
      value,
      options
    );
  }

  function setBusy(busy){
    state.busy=!!busy;

    workspace.setBusy(
      state.busy
    );

    saveButton.disabled=
      state.busy;

    return state.busy;
  }

  async function ensureReady(){
    if(state.ready){
      return api;
    }

    state.definitions=
      await API
        .getNodeDefinitions();

    renderIconChoices();

    state.canvas=
      await workspace
        .mountCanvas({
          nodeDefinitions:
            state.definitions,
          refreshDefinitions:
            false,
          pluginContext:
            "custom-builder",
          interactionEnabled:
            true
        });

    workspace
      .mountNodeBuilder({
        history:false,
        svgLibrary:
          SvgLibrary,
        eventRoot:
          document,
        filter(
          type
        ){
          return (
            type!=="start"&&
            type!=="file"&&
            type!=="createFile"&&
            !CustomNodes
              .isCustomType(type)
          );
        },
        beforeReset(){
          workspace.presence
            .hideCanvasSpeech?.();
        },
        afterReset(){
          markDirty();
        }
      });

    const offChange=
      state.canvas.on(
        "change",
        ()=>{
          if(!state.ready){
            return;
          }

          markDirty();
        }
      );

    if(typeof offChange==="function"){
      state.canvasOffs.push(
        offChange
      );
    }

    const offDefinitions=
      state.canvas.on(
        "definitionsChange",
        definitions=>{
          state.definitions=
            definitions;
        }
      );

    if(
      typeof offDefinitions===
        "function"
    ){
      state.canvasOffs.push(
        offDefinitions
      );
    }

    const offMode=
      workspace.ui.on?.(
        "modechange",
        ({mode})=>{
          if(mode==="canvas"){
            requestAnimationFrame(
              ()=>state.canvas
                ?.render?.()
            );
          }
        }
      );

    if(typeof offMode==="function"){
      state.canvasOffs.push(
        offMode
      );
    }

    workspace.bindComposer({
      onSubmit:
        (
          value
        )=>{
          void submitPrompt(
            value
          );
        }
    });

    state.ready=true;

    await newDraft();

    return api;
  }

  async function newDraft(){
    await ensureReady();

    state.editingId=null;
    state.messages=[];
    state.color=COLORS[0];
    state.iconKey=DEFAULT_ICON_KEY;
    state.dirty=false;

    if(nameInput){
      nameInput.value="";
    }

    if(descriptionInput){
      descriptionInput.value="";
    }

    setColor(
      COLORS[0]
    );
    setIconKey(DEFAULT_ICON_KEY);

    state.canvas.setState({
      workflow:
        emptyWorkflow(),
      viewport:{
        scale:1,
        offset:{
          x:0,
          y:0
        }
      }
    });

    state.dirty=false;
    state.messages=[];
    renderMessages();
    renderRecords();
    resetDeleteArm();

    if(deleteButton){
      deleteButton.hidden=true;
    }

    syncIdentity();
    setStatus(
      "새 함수",
      "neutral"
    );

    setInspectorOpen(
      false
    );
    setRecordsOpen(false);

    return true;
  }

  async function loadRecord(recordId){
    await ensureReady();

    const record=
      Store.get(
        recordId
      );

    if(!record){
      return false;
    }

    state.editingId=
      record.id;
    state.color=
      record.color||
      COLORS[0];
    state.iconKey=
      record.iconKey||
      "custom";
    state.messages=
      clone(
        record.builder
          ?.messages||
        []
      );
    state.dirty=false;

    nameInput.value=
      record.name||"";

    descriptionInput.value=
      record.description||"";

    setColor(
      state.color
    );
    setIconKey(state.iconKey);

    state.canvas.setState({
      workflow:
        record.workflow,
      viewport:
        record.builder
          ?.viewport||{
            scale:1,
            offset:{
              x:0,
              y:0
            }
          }
    });

    state.dirty=false;
    renderMessages();
    renderRecords();
    resetDeleteArm();

    if(deleteButton){
      deleteButton.hidden=false;
    }

    syncIdentity();

    setStatus(
      "v"+
      record.revision+
      " · 저장됨",
      "saved"
    );

    setInspectorOpen(
      false
    );
    setRecordsOpen(false);

    requestAnimationFrame(
      ()=>state.canvas
        ?.render?.()
    );

    return true;
  }

  async function saveDraft(){
    await ensureReady();

    const name=
      String(
        nameInput?.value||
        ""
      ).trim()||
      "새 함수";

    let validated;

    try{
      validated=
        CustomNodes
          .validateWorkflow(
            state.canvas
              .getWorkflow(),
            state.canvas
              .getNodeDefinitions()
          );
    }catch(error){
      setStatus(
        error?.message||
        "함수 흐름을 저장할 수 없어",
        "error"
      );

      workspace.ui.setMode(
        "canvas"
      );

      return false;
    }

    const description=
      String(
        descriptionInput
          ?.value||
        ""
      )
        .trim()
        .slice(0,220);

    const canvasState=
      state.canvas
        .getState();

    let saved;

    try{
      saved=
        Store.save({
          id:
            state.editingId||
            undefined,
          name,
          description,
          llmdesc:
            description||
            name+
            " 작업을 수행하는 사용자 정의 함수.",
          color:
            state.color,
          iconKey:
            state.iconKey,
          workflow:
            validated.workflow,
          boundary:
            validated.boundary,
          builder:{
            messages:
              state.messages,
            viewport:
              canvasState
                .viewport
          }
        });
    }catch(error){
      console.error(
        "Function Workspace save error:",
        error
      );

      setStatus(
        error?.message||
        "함수를 저장하지 못했어",
        "error"
      );

      return false;
    }

    state.editingId=
      saved.id;

    if(nameInput){
      nameInput.value=
        saved.name;
    }
    state.dirty=false;

    if(deleteButton){
      deleteButton.hidden=false;
    }

    renderRecords();
    syncIdentity();

    setStatus(
      "v"+
      saved.revision+
      " · 저장됨",
      "saved"
    );

    return true;
  }

  async function submitPrompt(
    raw
  ){
    if(
      state.busy||
      state.destroyed
    ){
      return;
    }

    const text=
      String(raw||"")
        .trim();

    if(!text){
      return;
    }

    workspace.elements
      .composerInput
      .value="";

    workspace
      .resizeComposer();

    pushMessage(
      "user",
      text
    );

    setBusy(true);

    workspace.presence
      .thinking?.();

    try{
      const result=
        await API
          .planWorkflow(
            text,
            state.canvas
              .getWorkflowIR(),
            null,
            {
              history:
                history(),
              purpose:
                "function-builder"
            }
          );

      if(
        result?.mode===
          "workflow"&&
        result.workflow
      ){
        state.canvas
          .applyWorkflowIR(
            result.workflow,
            {
              center:true
            }
          );

        markDirty();
      }

      const answer=
        [
          String(
            result?.message||
            ""
          ).trim(),
          String(
            result?.question||
            ""
          ).trim()
        ]
          .filter(Boolean)
          .join("\n");

      if(answer){
        pushMessage(
          "assistant",
          answer
        );
      }else{
        workspace.presence
          .settle?.();
      }
    }catch(error){
      console.error(
        "Function Workspace planner error:",
        error
      );

      workspace.presence
        .settle?.();

      pushMessage(
        "assistant",
        "함수 흐름을 수정하지 못했어. 다시 말해줘."
      );
    }finally{
      setBusy(false);
    }
  }

  function deleteCurrent(){
    const id=
      state.editingId;

    if(!id){
      return false;
    }

    if(recordInUse(id)){
      setStatus(
        "캔버스에서 사용 중이라 먼저 빼야 해",
        "error"
      );

      return false;
    }

    if(!state.deleteArmed){
      state.deleteArmed=true;

      deleteButton.textContent=
        "한 번 더";

      state.deleteTimer=
        setTimeout(
          resetDeleteArm,
          1800
        );

      return false;
    }

    Store.remove(id);

    void newDraft();

    return true;
  }

  function activate(){
    if(state.destroyed){
      return;
    }

    void ensureReady()
      .then(()=>{
        workspace.ui
          .syncViewport?.();

        requestAnimationFrame(
          ()=>state.canvas
            ?.render?.()
        );
      });
  }

  for(const color of COLORS){
    const button=
      document.createElement(
        "button"
      );

    button.type="button";
    button.className=
      "ovll-function-color";
    button.dataset
      .functionColor=
      color;
    button.style.setProperty(
      "--function-color",
      color
    );
    button.setAttribute(
      "aria-label",
      "함수 색상"
    );
    button.setAttribute(
      "aria-pressed",
      "false"
    );

    colorsRoot?.appendChild(
      button
    );
  }

  setColor(
    COLORS[0]
  );

  listen(
    backButton,
    "click",
    ()=>{
      options.onClose?.();
    }
  );

  listen(
    inspectorToggle,
    "click",
    ()=>{
      setInspectorOpen(
        !state.inspectorOpen
      );
    }
  );

  listen(
    saveButton,
    "click",
    ()=>void saveDraft()
  );

  listen(
    inspector.querySelector(
      "[data-function-records-open]"
    ),
    "click",
    ()=>setRecordsOpen(true)
  );

  listen(
    recordsPanel.querySelector(
      "[data-function-new]"
    ),
    "click",
    ()=>void newDraft()
  );

  listen(
    recordsPanel.querySelector(
      "[data-function-records-close]"
    ),
    "click",
    ()=>setRecordsOpen(false)
  );

  listen(
    deleteButton,
    "click",
    deleteCurrent
  );

  listen(
    listRoot,
    "click",
    event=>{
      const item=
        event.target.closest(
          "[data-function-record-id]"
        );

      if(!item){
        return;
      }

      void loadRecord(
        item.dataset
          .functionRecordId
      );
    }
  );

  listen(
    nameInput,
    "input",
    ()=>{
      syncIdentity();
      markDirty();
    }
  );

  listen(
    descriptionInput,
    "input",
    markDirty
  );

  listen(
    iconsRoot,
    "click",
    event=>{
      const button=event.target.closest("[data-function-icon-key]");
      if(!button)return;
      setIconKey(button.dataset.functionIconKey);
      markDirty();
    }
  );

  listen(
    colorsRoot,
    "click",
    event=>{
      const button=
        event.target.closest(
          "[data-function-color]"
        );

      if(!button){
        return;
      }

      setColor(
        button.dataset
          .functionColor
      );

      markDirty();
    }
  );

  listen(
    document,
    "keydown",
    event=>{
      if(event.key!=="Escape")return;
      if(state.recordsOpen){
        setRecordsOpen(false);
      }else if(state.inspectorOpen){
        setInspectorOpen(false);
      }
    }
  );

  const unsubscribeStore=
    Store.onChange(
      renderRecords
    );

  listeners.push(
    unsubscribeStore
  );

  const api={
    workspace,
    activate,
    ensureReady,
    newDraft,
    open:
      loadRecord,
    save:
      saveDraft,
    isDirty(){
      return state.dirty;
    },
    getState(){
      return {
        editingId:
          state.editingId,
        dirty:
          state.dirty,
        busy:
          state.busy
      };
    },
    destroy(){
      if(state.destroyed){
        return;
      }

      state.destroyed=true;

      clearTimeout(
        state.deleteTimer
      );

      state.canvasOffs
        .splice(0)
        .forEach(off=>{
          try{off();}catch{}
        });

      listeners
        .splice(0)
        .forEach(cleanup=>{
          try{
            cleanup();
          }catch{}
        });

      workspace.destroy();
      state.canvas=null;
      state.ready=false;
    }
  };

  return api;
}

global.createOvllFunctionWorkspace=
  createOvllFunctionWorkspace;

})(window);
