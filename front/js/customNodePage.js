(function(global){
"use strict";

const Store=
  global.OvllCustomNodeStore;

const CustomNodes=
  global.OvllCustomNodes;

const API=
  global.AstraAPI;

const Navigation=
  global.OvllNavigation;

const WorkspaceStore=
  global.OvllWorkspaceStore;

const mountCanvasNode=
  global.mountCanvasNode;

const page=
  document.querySelector(
    "#custom-node-page"
  );

if(
  !Store||
  !CustomNodes||
  !API||
  !Navigation||
  typeof mountCanvasNode!=="function"||
  !page
){
  return;
}

const list=
  page.querySelector(
    "[data-custom-node-list]"
  );

const palette=
  page.querySelector(
    "[data-custom-node-palette]"
  );

const canvasHost=
  page.querySelector(
    "[data-custom-node-canvas]"
  );

const nameInput=
  page.querySelector(
    "[data-custom-node-name]"
  );

const descriptionInput=
  page.querySelector(
    "[data-custom-node-description]"
  );

const saveButton=
  page.querySelector(
    "[data-custom-node-save]"
  );

const deleteButton=
  page.querySelector(
    "[data-custom-node-delete]"
  );

const newButton=
  page.querySelector(
    "[data-custom-node-new]"
  );

const backButton=
  page.querySelector(
    "[data-custom-node-back]"
  );

const status=
  page.querySelector(
    "[data-custom-node-status]"
  );

const colors=[
  "#7c6cf2",
  "#4f8ef7",
  "#10a77a",
  "#e9a63a",
  "#d96f83",
  "#6c7a89"
];

const state={
  open:false,
  destroyed:false,
  editingId:null,
  color:colors[0],
  canvas:null,
  definitions:null,
  closeTimer:null,
  returnFocus:null,
  deleteArmed:false,
  deleteTimer:null
};

const listeners=[];

function listen(
  node,
  type,
  handler,
  options
){
  if(!node){
    return;
  }

  node.addEventListener(
    type,
    handler,
    options
  );

  listeners.push(
    ()=>node.removeEventListener(
      type,
      handler,
      options
    )
  );
}

function setStatus(
  text,
  tone="neutral"
){
  if(!status){
    return;
  }

  status.textContent=
    String(text||"");

  status.dataset.tone=
    tone;
}

function setColor(color){
  state.color=
    colors.includes(color)
      ?color
      :colors[0];

  page
    .querySelectorAll(
      "[data-custom-node-color]"
    )
    .forEach(button=>{
      const active=
        button.dataset
          .customNodeColor===
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
}

function recordInUse(recordId){
  const type=
    CustomNodes
      .typeForRecord(
        recordId
      );

  const activeWorkflow=
    global.AstraApp
      ?.getWorkflow?.();

  if(
    activeWorkflow
      ?.nodes
      ?.some(
        node=>
          node?.type===type
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
              node?.type===type
          )
    );
}

function resetDeleteArm(){
  state.deleteArmed=false;
  clearTimeout(
    state.deleteTimer
  );

  if(deleteButton){
    deleteButton.textContent=
      "삭제";
  }
}

function renderList(){
  if(!list){
    return;
  }

  const records=
    Store.list();

  list.replaceChildren();

  if(!records.length){
    const empty=
      document.createElement(
        "div"
      );

    empty.className=
      "ovll-custom-empty";

    empty.textContent=
      "아직 만든 노드가 없어";

    list.appendChild(
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
      "ovll-custom-card";

    button.dataset
      .customNodeId=
      record.id;

    button.classList
      .toggle(
        "is-active",
        record.id===
        state.editingId
      );

    button.style
      .setProperty(
        "--custom-color",
        record.color||
        colors[0]
      );

    const count=
      record.workflow
        ?.nodes
        ?.length||0;

    button.innerHTML=`
      <span class="ovll-custom-card-orb"></span>
      <span class="ovll-custom-card-copy">
        <strong></strong>
        <small></small>
      </span>
    `;

    button.querySelector(
      "strong"
    ).textContent=
      record.name;

    button.querySelector(
      "small"
    ).textContent=
      `${count}개 노드 · v${record.revision}`;

    list.appendChild(
      button
    );
  }
}

function renderPalette(){
  if(
    !palette||
    !state.definitions
  ){
    return;
  }

  palette.replaceChildren();

  for(
    const [type,definition] of
    Object.entries(
      state.definitions
    )
  ){
    if(
      !definition||
      type==="start"||
      type==="file"||
      type==="createFile"||
      CustomNodes
        .isCustomType(type)
    ){
      continue;
    }

    const button=
      document.createElement(
        "button"
      );

    button.type="button";
    button.className=
      "ovll-custom-palette-item";

    button.dataset
      .nodeType=
      type;

    button.innerHTML=`
      <span class="ovll-custom-palette-icon"></span>
      <span class="ovll-custom-palette-name"></span>
    `;

    button.querySelector(
      ".ovll-custom-palette-icon"
    ).innerHTML=
      definition.icon||"";

    button.querySelector(
      ".ovll-custom-palette-name"
    ).textContent=
      definition.name||type;

    palette.appendChild(
      button
    );
  }
}

async function ensureCanvas(){
  if(state.canvas){
    return state.canvas;
  }

  const definitions=
    await API
      .getNodeDefinitions();

  state.definitions=
    definitions;

  state.canvas=
    await mountCanvasNode(
      canvasHost,
      {
        nodeDefinitions:
          definitions,
        refreshDefinitions:false,
        interactionEnabled:true
      }
    );

  renderPalette();

  state.canvas.on(
    "change",
    ()=>{
      setStatus(
        "저장 전 변경사항",
        "pending"
      );
    }
  );

  return state.canvas;
}

function emptyWorkflow(){
  return {
    nodes:[],
    connections:[]
  };
}

async function newDraft(){
  await ensureCanvas();

  state.editingId=null;

  if(nameInput){
    nameInput.value="";
  }

  if(descriptionInput){
    descriptionInput.value="";
  }

  setColor(
    colors[0]
  );

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

  resetDeleteArm();

  if(deleteButton){
    deleteButton.hidden=true;
  }

  renderList();

  setStatus(
    "노드를 이어서 하나의 기능으로 만들어",
    "neutral"
  );

  requestAnimationFrame(
    ()=>{
      nameInput?.focus?.();
    }
  );
}

async function loadRecord(recordId){
  const record=
    Store.get(
      recordId
    );

  if(!record){
    return false;
  }

  await ensureCanvas();

  state.editingId=
    record.id;

  if(nameInput){
    nameInput.value=
      record.name||"";
  }

  if(descriptionInput){
    descriptionInput.value=
      record.description||"";
  }

  setColor(
    record.color
  );

  state.canvas.setState({
    workflow:
      record.workflow,
    viewport:{
      scale:1,
      offset:{
        x:0,
        y:0
      }
    }
  });

  requestAnimationFrame(
    ()=>{
      state.canvas
        ?.layout?.();
    }
  );

  if(deleteButton){
    deleteButton.hidden=false;
  }

  resetDeleteArm();
  renderList();

  setStatus(
    `v${record.revision} · 저장됨`,
    "saved"
  );

  return true;
}

async function saveDraft(){
  await ensureCanvas();

  const name=
    String(
      nameInput?.value||""
    )
      .trim();

  if(!name){
    setStatus(
      "이름은 하나 붙여줘",
      "error"
    );

    nameInput?.focus?.();
    return false;
  }

  let validated;

  try{
    validated=
      CustomNodes
        .validateWorkflow(
          state.canvas
            .getWorkflow(),
          state.definitions
        );
  }catch(error){
    setStatus(
      error?.message||
      "흐름을 저장할 수 없어",
      "error"
    );

    return false;
  }

  const saved=
    Store.save({
      id:
        state.editingId||
        undefined,
      name,
      description:
        String(
          descriptionInput?.value||
          ""
        ).trim(),
      color:
        state.color,
      workflow:
        validated.workflow,
      boundary:
        validated.boundary
    });

  state.editingId=
    saved.id;

  if(deleteButton){
    deleteButton.hidden=false;
  }

  renderList();

  setStatus(
    `v${saved.revision} · 저장됨`,
    "saved"
  );

  return true;
}

function deleteCurrent(){
  const id=
    state.editingId;

  if(!id){
    return;
  }

  if(recordInUse(id)){
    setStatus(
      "캔버스에서 사용 중이라 먼저 빼야 해",
      "error"
    );

    return;
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

    return;
  }

  Store.remove(id);
  void newDraft();
}

function show(options={}){
  if(state.destroyed){
    return false;
  }

  global.OvllLibraryPage
    ?.hide?.({
      history:false
    });

  const wasOpen=
    state.open;

  if(!wasOpen){
    state.returnFocus=
      document.activeElement instanceof HTMLElement
        ?document.activeElement
        :null;

    if(
      options.history!==false
    ){
      if(
        options.history==="replace"
      ){
        Navigation.replace(
          "custom-nodes"
        );
      }else{
        Navigation.open(
          "custom-nodes"
        );
      }
    }
  }

  clearTimeout(
    state.closeTimer
  );

  state.open=true;
  page.hidden=false;

  document.documentElement
    .dataset.appPage=
    "custom-nodes";

  requestAnimationFrame(
    ()=>{
      page.classList.add(
        "is-open"
      );
    }
  );

  void ensureCanvas()
    .then(()=>{
      renderList();

      if(
        state.editingId&&
        Store.get(
          state.editingId
        )
      ){
        return loadRecord(
          state.editingId
        );
      }

      return newDraft();
    })
    .catch(error=>{
      setStatus(
        error?.message||
        "만들기 화면을 열지 못했어",
        "error"
      );
    });

  return true;
}

function restoreFocus(){
  const target=
    state.returnFocus;

  state.returnFocus=null;

  if(
    target?.isConnected&&
    typeof target.focus==="function"
  ){
    requestAnimationFrame(
      ()=>target.focus({
        preventScroll:true
      })
    );
  }
}

function hide(options={}){
  if(
    state.destroyed||
    !state.open
  ){
    return false;
  }

  if(
    options.history!==false&&
    Navigation.isCurrent(
      "custom-nodes"
    )
  ){
    Navigation.close(
      "custom-nodes",
      ()=>hide({
        history:false
      })
    );

    return true;
  }

  state.open=false;

  page.classList.remove(
    "is-open"
  );

  if(
    document.documentElement
      .dataset.appPage===
      "custom-nodes"
  ){
    delete document
      .documentElement
      .dataset
      .appPage;
  }

  clearTimeout(
    state.closeTimer
  );

  state.closeTimer=
    setTimeout(
      ()=>{
        if(!state.open){
          page.hidden=true;
          restoreFocus();
        }
      },
      190
    );

  return true;
}

listen(
  palette,
  "click",
  event=>{
    const button=
      event.target.closest(
        "[data-node-type]"
      );

    if(!button){
      return;
    }

    try{
      state.canvas
        ?.addNode?.(
          button.dataset.nodeType
        );
    }catch(error){
      setStatus(
        error?.message||
        "노드를 추가하지 못했어",
        "error"
      );
    }
  }
);

listen(
  list,
  "click",
  event=>{
    const button=
      event.target.closest(
        "[data-custom-node-id]"
      );

    if(!button){
      return;
    }

    void loadRecord(
      button.dataset
        .customNodeId
    );
  }
);

listen(
  page,
  "click",
  event=>{
    const color=
      event.target.closest(
        "[data-custom-node-color]"
      );

    if(color){
      setColor(
        color.dataset
          .customNodeColor
      );

      setStatus(
        "저장 전 변경사항",
        "pending"
      );
    }
  }
);

listen(
  newButton,
  "click",
  ()=>void newDraft()
);

listen(
  saveButton,
  "click",
  ()=>void saveDraft()
);

listen(
  deleteButton,
  "click",
  deleteCurrent
);

listen(
  backButton,
  "click",
  ()=>hide()
);

listen(
  nameInput,
  "input",
  ()=>setStatus(
    "저장 전 변경사항",
    "pending"
  )
);

listen(
  descriptionInput,
  "input",
  ()=>setStatus(
    "저장 전 변경사항",
    "pending"
  )
);

listen(
  global,
  "keydown",
  event=>{
    if(
      event.key==="Escape"&&
      state.open&&
      !global.OvllShellMenu
        ?.isOpen?.()
    ){
      event.preventDefault();
      hide();
    }
  }
);

listen(
  global,
  "ovll:navigation-back",
  event=>{
    if(
      event.detail?.layer===
        "custom-nodes"&&
      state.open
    ){
      hide({
        history:false
      });
    }
  }
);

const unsubscribe=
  Store.onChange(
    ()=>{
      renderList();
    }
  );

listeners.push(
  unsubscribe
);

for(const color of colors){
  const button=
    document.createElement(
      "button"
    );

  button.type="button";
  button.className=
    "ovll-custom-color";

  button.dataset
    .customNodeColor=
    color;

  button.style
    .setProperty(
      "--custom-color",
      color
    );

  button.setAttribute(
    "aria-label",
    "노드 색상"
  );

  button.setAttribute(
    "aria-pressed",
    "false"
  );

  page.querySelector(
    "[data-custom-node-colors]"
  )?.appendChild(
    button
  );
}

setColor(
  colors[0]
);

global.OvllCustomNodePage=
  Object.freeze({
    show,
    hide,
    isOpen(){
      return state.open;
    },
    newDraft,
    open(recordId){
      show();

      return recordId
        ?loadRecord(recordId)
        :newDraft();
    },
    destroy(){
      if(state.destroyed){
        return;
      }

      state.destroyed=true;
      state.open=false;

      clearTimeout(
        state.closeTimer
      );

      clearTimeout(
        state.deleteTimer
      );

      state.canvas
        ?.destroy?.();

      state.canvas=null;

      listeners
        .splice(0)
        .forEach(cleanup=>{
          try{
            cleanup();
          }catch{}
        });
    }
  });

})(window);
