(function(global){
"use strict";

function createCanvasSkillNodeBuilder(options={}){
  const document=options.document||global.document;
  const host=options.host;

  if(!host){
    throw new Error("Canvas Node Builder host가 없습니다.");
  }

  const SvgLibrary=options.svgLibrary||global.OvllSvgLibrary;
  const Navigation=
    options.navigation===undefined
      ?global.OvllNavigation
      :options.navigation;
  const historyEnabled=options.history!==false;
  const eventRoot=options.eventRoot||document;
  const listeners=[];

  let canvas=options.canvas||null;
  let canvasOff=null;

  const state={
    open:false,
    resetTimer:null,
    destroyed:false
  };

  function listen(target,type,handler,listenerOptions){
    if(!target||typeof target.addEventListener!=="function") return;
    target.addEventListener(type,handler,listenerOptions);
    listeners.push(()=>target.removeEventListener(type,handler,listenerOptions));
  }

  const sequence=
    (
      Number(
        global.__ovllCanvasSkillNodeBuilderSeq
      )||0
    )+1;

  global.__ovllCanvasSkillNodeBuilderSeq=
    sequence;

  const panelId=
    "canvas-skillNode-builder-panel-"+
    sequence;

  const root=document.createElement("div");
  root.className="canvas-skillNode-builder";
  root.dataset.canvasSkillNodeBuilder="";

  root.innerHTML=`
    <div id="${panelId}" class="canvas-skillNode-builder-panel" data-canvas-skillNode-builder-panel role="dialog" aria-label="노드 추가">
      <div class="canvas-skillNode-builder-header">노드 추가</div>
      <div class="canvas-skillNode-builder-list" data-canvas-skillNode-builder-list></div>
    </div>
    <div class="canvas-skillNode-builder-actions">
      <button data-canvas-skillNode-builder-toggle type="button" aria-expanded="false" aria-controls="${panelId}">
        <span class="canvas-skillNode-builder-action-icon" data-builder-icon="skillNodeAdd" aria-hidden="true"></span>
        <span>노드</span>
      </button>
      <button data-canvas-skillNode-builder-reset type="button" aria-label="캔버스 초기화" title="캔버스 초기화">
        <span class="canvas-skillNode-builder-action-icon" data-builder-icon="canvasReset" aria-hidden="true"></span>
        <span class="canvas-skillNode-builder-reset-label">초기화</span>
      </button>
      <button data-canvas-skillNode-builder-layout type="button" aria-label="노드 정리하기" title="노드 정리하기">
        <span class="canvas-skillNode-builder-action-icon" data-builder-icon="canvasLayout" aria-hidden="true"></span>
        <span>정리하기</span>
      </button>
    </div>
  `;

  for(const icon of root.querySelectorAll("[data-builder-icon]")){
    icon.innerHTML=
      SvgLibrary?.get?.(icon.dataset.builderIcon)||"";
    icon.querySelector("svg")?.classList.add("svg-icon");
  }

  host.appendChild(root);

  function skillDefinitions(){
    const direct=options.getDefinitions?.();
    if(direct&&typeof direct==="object") return direct;
    return canvas?.getSkillDefinitions?.()||{};
  }

  function render(){
    if(state.destroyed) return;
    const list=root.querySelector("[data-canvas-skillNode-builder-list]");
    if(!list) return;

    list.textContent="";
    const groups=new Map();

    for(const [type,definition] of Object.entries(skillDefinitions())){
      if(type==="start"||!definition) continue;

      if(
        typeof options.filter==="function"&&
        !options.filter(type,definition)
      ){
        continue;
      }

      const catalog=definition.catalog||{};
      const groupId=String(catalog.group||"builtin");

      if(!groups.has(groupId)){
        groups.set(groupId,{
          id:groupId,
          label:String(
            catalog.groupLabel||
            (groupId==="custom"?"내 노드":"기본 노드")
          ),
          custom:groupId==="custom",
          entries:[]
        });
      }

      groups.get(groupId).entries.push({type,definition});
    }

    const ordered=[...groups.values()].sort(
      (a,b)=>Number(b.custom)-Number(a.custom)
    );
    const showLabels=
      ordered.length>1||
      ordered.some(group=>group.custom);

    for(const group of ordered){
      const section=document.createElement("section");
      section.className="canvas-skillNode-builder-group";

      if(group.custom){
        section.classList.add("is-custom");
      }

      if(showLabels){
        const label=document.createElement("div");
        label.className="canvas-skillNode-builder-group-title";
        label.textContent=group.label;
        section.appendChild(label);
      }

      const grid=document.createElement("div");
      grid.className="canvas-skillNode-builder-options";

      for(const {type,definition} of group.entries){
        const button=document.createElement("button");
        button.type="button";
        button.className="canvas-skillNode-builder-option";
        button.dataset.nodeType=type;

        if(group.custom){
          button.classList.add("is-custom");
        }

        button.style.setProperty(
          "--builder-skillNode-color",
          definition.color||"var(--text)"
        );

        const icon=document.createElement("span");
        icon.className="canvas-skillNode-builder-icon";
        icon.innerHTML=SvgLibrary?.get?.(definition.iconKey)||definition.icon||"";
        icon.querySelector("svg")?.classList.add("svg-icon");

        const info=document.createElement("span");
        info.className="canvas-skillNode-builder-info";

        const name=document.createElement("strong");
        name.className="canvas-skillNode-builder-name";
        name.textContent=definition.name||type;
        info.appendChild(name);

        const description=String(definition.desc||"").trim();
        if(description){
          const detail=document.createElement("small");
          detail.className="canvas-skillNode-builder-description";
          detail.textContent=description;
          info.appendChild(detail);
        }

        button.append(icon,info);
        grid.appendChild(button);
      }

      section.appendChild(grid);
      list.appendChild(section);
    }

    if(!ordered.length){
      const empty=document.createElement("div");
      empty.className="canvas-skillNode-builder-empty";
      empty.textContent="추가할 노드를 불러오는 중이거나 현재 사용할 수 있는 노드가 없어요.";
      list.appendChild(empty);
    }
    root.classList.toggle("is-empty",ordered.length===0);
  }

  function setOpen(open,callOptions={}){
    if(state.destroyed) return false;

    const next=!!open;
    if(next===state.open) return state.open;

    if(
      next&&
      historyEnabled&&
      callOptions.history!==false
    ){
      Navigation?.open?.("skillNode-builder");
    }

    if(
      !next&&
      historyEnabled&&
      callOptions.history!==false&&
      Navigation?.isCurrent?.("skillNode-builder")
    ){
      Navigation.close(
        "skillNode-builder",
        ()=>setOpen(false,{history:false})
      );
      return state.open;
    }

    state.open=next;
    root.classList.toggle("is-open",state.open);

    root
      .querySelector("[data-canvas-skillNode-builder-toggle]")
      ?.setAttribute("aria-expanded",String(state.open));

    return state.open;
  }

  function resetConfirmUi(){
    clearTimeout(state.resetTimer);
    state.resetTimer=null;

    const reset=root.querySelector("[data-canvas-skillNode-builder-reset]");
    reset?.classList.remove("is-confirming");

    const label=reset?.querySelector(".canvas-skillNode-builder-reset-label");
    if(label) label.textContent="초기화";
  }

  function setCanvas(nextCanvas){
    canvasOff?.();
    canvasOff=null;
    canvas=nextCanvas||null;

    if(canvas&&typeof canvas.on==="function"){
      const off=canvas.on("definitionsChange",render);
      if(typeof off==="function") canvasOff=off;
    }

    render();
    return api;
  }

  listen(root,"click",event=>{
    const layout=event.target.closest("[data-canvas-skillNode-builder-layout]");
    if(layout){
      event.preventDefault();
      canvas?.layout?.();
      return;
    }

    const reset=event.target.closest("[data-canvas-skillNode-builder-reset]");
    if(reset){
      event.preventDefault();

      if(!canvas||typeof canvas.setState!=="function") return;

      const workflow=canvas.getWorkflow?.()||{
        skillNodes:[],
        connections:[]
      };

      const hasContent=
        (workflow.skillNodes?.length||0)>0||
        (workflow.connections?.length||0)>0;

      if(
        hasContent&&
        !reset.classList.contains("is-confirming")
      ){
        reset.classList.add("is-confirming");

        const label=reset.querySelector(".canvas-skillNode-builder-reset-label");
        if(label) label.textContent="한번 더";

        clearTimeout(state.resetTimer);
        state.resetTimer=setTimeout(resetConfirmUi,1800);
        return;
      }

      resetConfirmUi();
      options.beforeReset?.();

      canvas.setState({
        workflow:{
          skillNodes:[],
          connections:[]
        },
        viewport:{
          scale:1,
          offset:{x:0,y:0}
        }
      });

      options.afterReset?.();
      setOpen(false);
      return;
    }

    const toggle=event.target.closest("[data-canvas-skillNode-builder-toggle]");
    if(toggle){
      event.preventDefault();
      setOpen(!state.open);
      return;
    }

    const option=event.target.closest(".canvas-skillNode-builder-option");
    if(!option||!root.contains(option)) return;

    const type=option.dataset.nodeType;
    if(!type||!canvas||typeof canvas.addSkillNode!=="function") return;

    canvas.addSkillNode(type);
    setOpen(false);
  });

  listen(eventRoot,"pointerdown",event=>{
    if(state.open&&!root.contains(event.target)){
      setOpen(false);
    }
  });

  listen(eventRoot,"keydown",event=>{
    if(event.key==="Escape"&&state.open){
      setOpen(false);
    }
  });

  if(historyEnabled){
    listen(global,"ovll:navigation-back",event=>{
      if(
        event.detail?.layer==="skillNode-builder"&&
        state.open
      ){
        setOpen(false,{history:false});
      }
    });
  }

  const api={
    root,
    render,
    setOpen,
    isOpen(){
      return state.open;
    },
    setCanvas,
    destroy(){
      if(state.destroyed) return;

      state.destroyed=true;
      resetConfirmUi();
      canvasOff?.();
      canvasOff=null;

      listeners.splice(0).forEach(cleanup=>{
        try{cleanup();}catch{}
      });

      root.remove();
      canvas=null;
    }
  };

  setCanvas(canvas);
  return api;
}

global.createCanvasSkillNodeBuilder=createCanvasSkillNodeBuilder;

})(window);
