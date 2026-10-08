(function(global){
"use strict";

function createCanvasNodeBuilder(options={}){
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
        global.__ovllCanvasNodeBuilderSeq
      )||0
    )+1;

  global.__ovllCanvasNodeBuilderSeq=
    sequence;

  const panelId=
    "canvas-node-builder-panel-"+
    sequence;

  const root=document.createElement("div");
  root.className="canvas-node-builder";
  root.dataset.canvasNodeBuilder="";

  root.innerHTML=`
    <div id="${panelId}" class="canvas-node-builder-panel" data-canvas-node-builder-panel role="dialog" aria-label="노드 추가">
      <div class="canvas-node-builder-header">
        <span>노드 추가</span>
        <span class="canvas-node-builder-hint">워크플로우를 직접 조립해봐요</span>
      </div>
      <div class="canvas-node-builder-list" data-canvas-node-builder-list></div>
    </div>
    <div class="canvas-node-builder-actions">
      <button data-canvas-node-builder-toggle type="button" aria-expanded="false" aria-controls="${panelId}">
        <span class="canvas-node-builder-action-icon" data-builder-icon="nodeAdd" aria-hidden="true"></span>
        <span>노드</span>
      </button>
      <button data-canvas-node-builder-reset type="button" aria-label="캔버스 초기화" title="캔버스 초기화">
        <span class="canvas-node-builder-action-icon" data-builder-icon="canvasReset" aria-hidden="true"></span>
        <span class="canvas-node-builder-reset-label">초기화</span>
      </button>
      <button data-canvas-node-builder-layout type="button" aria-label="노드 정리하기" title="노드 정리하기">
        <span class="canvas-node-builder-action-icon" data-builder-icon="canvasLayout" aria-hidden="true"></span>
        <span>정리하기</span>
      </button>
    </div>
  `;

  for(const icon of root.querySelectorAll("[data-builder-icon]")){
    icon.innerHTML=
      SvgLibrary?.get?.(icon.dataset.builderIcon)||"";
  }

  host.appendChild(root);

  function definitions(){
    const direct=options.getDefinitions?.();
    if(direct&&typeof direct==="object") return direct;
    return canvas?.getNodeDefinitions?.()||{};
  }

  function render(){
    if(state.destroyed) return;
    const list=root.querySelector("[data-canvas-node-builder-list]");
    if(!list) return;

    list.textContent="";
    const groups=new Map();

    for(const [type,definition] of Object.entries(definitions())){
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
      section.className="canvas-node-builder-group";

      if(group.custom){
        section.classList.add("is-custom");
      }

      if(showLabels){
        const label=document.createElement("div");
        label.className="canvas-node-builder-group-title";
        label.textContent=group.label;
        section.appendChild(label);
      }

      const grid=document.createElement("div");
      grid.className="canvas-node-builder-options";

      for(const {type,definition} of group.entries){
        const button=document.createElement("button");
        button.type="button";
        button.className="canvas-node-builder-option";
        button.dataset.nodeType=type;

        if(group.custom){
          button.classList.add("is-custom");
        }

        button.style.setProperty(
          "--builder-node-color",
          definition.color||"var(--text)"
        );

        const icon=document.createElement("span");
        icon.className="canvas-node-builder-icon";
        icon.innerHTML=SvgLibrary?.get?.(definition.iconKey)||definition.icon||"";

        const name=document.createElement("span");
        name.className="canvas-node-builder-name";
        name.textContent=definition.name||type;

        button.append(icon,name);
        grid.appendChild(button);
      }

      section.appendChild(grid);
      list.appendChild(section);
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
      Navigation?.open?.("node-builder");
    }

    if(
      !next&&
      historyEnabled&&
      callOptions.history!==false&&
      Navigation?.isCurrent?.("node-builder")
    ){
      Navigation.close(
        "node-builder",
        ()=>setOpen(false,{history:false})
      );
      return state.open;
    }

    state.open=next;
    root.classList.toggle("is-open",state.open);

    root
      .querySelector("[data-canvas-node-builder-toggle]")
      ?.setAttribute("aria-expanded",String(state.open));

    return state.open;
  }

  function resetConfirmUi(){
    clearTimeout(state.resetTimer);
    state.resetTimer=null;

    const reset=root.querySelector("[data-canvas-node-builder-reset]");
    reset?.classList.remove("is-confirming");

    const label=reset?.querySelector(".canvas-node-builder-reset-label");
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
    const layout=event.target.closest("[data-canvas-node-builder-layout]");
    if(layout){
      event.preventDefault();
      canvas?.layout?.();
      return;
    }

    const reset=event.target.closest("[data-canvas-node-builder-reset]");
    if(reset){
      event.preventDefault();

      if(!canvas||typeof canvas.setState!=="function") return;

      const workflow=canvas.getWorkflow?.()||{
        nodes:[],
        connections:[]
      };

      const hasContent=
        (workflow.nodes?.length||0)>0||
        (workflow.connections?.length||0)>0;

      if(
        hasContent&&
        !reset.classList.contains("is-confirming")
      ){
        reset.classList.add("is-confirming");

        const label=reset.querySelector(".canvas-node-builder-reset-label");
        if(label) label.textContent="한번 더";

        clearTimeout(state.resetTimer);
        state.resetTimer=setTimeout(resetConfirmUi,1800);
        return;
      }

      resetConfirmUi();
      options.beforeReset?.();

      canvas.setState({
        workflow:{
          nodes:[],
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

    const toggle=event.target.closest("[data-canvas-node-builder-toggle]");
    if(toggle){
      event.preventDefault();
      setOpen(!state.open);
      return;
    }

    const option=event.target.closest(".canvas-node-builder-option");
    if(!option||!root.contains(option)) return;

    const type=option.dataset.nodeType;
    if(!type||!canvas||typeof canvas.addNode!=="function") return;

    canvas.addNode(type);
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
        event.detail?.layer==="node-builder"&&
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

global.createCanvasNodeBuilder=createCanvasNodeBuilder;

})(window);
