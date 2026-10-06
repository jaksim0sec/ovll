(function(global){
"use strict";

function createShell(host,options={}){
  const document=options.document||global.document;
  const shell=document.createElement("div");

  shell.className="ovll-workspace-shell ovll-workspace-instance";
  shell.dataset.ovllWorkspaceShell="";

  shell.innerHTML=`
    <header data-ovll-topbar>
      <div class="ovll-workspace-slot ovll-workspace-slot-start" data-ovll-slot="headerStart"></div>
      <div data-ovll-mode-switch role="tablist" aria-label="화면 모드">
        <button type="button" role="tab" aria-selected="true" data-mode="chat">채팅</button>
        <button type="button" role="tab" aria-selected="false" data-mode="canvas">캔버스</button>
      </div>
      <div class="ovll-workspace-slot ovll-workspace-slot-end" data-ovll-slot="headerEnd"></div>
    </header>

    <main data-ovll-workspace>
      <section class="page" data-ovll-chat-page aria-label="채팅">
        <div data-ovll-chat-content>
          <div data-ovll-chat-messages></div>
        </div>
      </section>

      <section class="page" data-ovll-canvas-page aria-label="캔버스">
        <div data-ovll-canvas-viewport data-canvas-viewport>
          <div data-ovll-canvas-world data-canvas-world>
            <svg data-ovll-canvas-connections data-canvas-connections aria-hidden="true"></svg>
            <div data-ovll-canvas-nodes data-canvas-nodes></div>
          </div>
        </div>
      </section>
    </main>

    <div class="ovll-workspace-overlay-slot" data-ovll-slot="overlay"></div>

    <footer data-ovll-composer>
      <div data-ovll-slot="composerBefore"></div>
      <form data-ovll-composer-form>
        <input data-ovll-composer-file-input type="file" hidden>
        <button data-ovll-composer-attach type="button" aria-label="파일 추가" title="파일 추가">
          <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <path d="M10 5v10M5 10h10"></path>
          </svg>
        </button>
        <textarea
          data-ovll-composer-input
          name="message"
          rows="1"
          autocomplete="off"
          autocapitalize="sentences"
          spellcheck="true"
          placeholder="무엇을 할까요?"
        ></textarea>
        <button data-ovll-composer-submit type="submit" aria-label="전송"></button>
      </form>
      <div data-ovll-slot="composerAfter"></div>
    </footer>
  `;

  host.appendChild(shell);
  return shell;
}

function resolveElements(root,supplied={}){
  const q=(value,selector)=>value||root.querySelector(selector);
  const modeSwitch=q(
    supplied.modeSwitch,
    "#mode-switch,[data-ovll-mode-switch]"
  );

  return {
    shell:supplied.shell||root,
    topbar:q(supplied.topbar,"#topbar,[data-ovll-topbar]"),
    modeSwitch,
    modeChat:
      supplied.modeChat||
      modeSwitch?.querySelector('[data-mode="chat"]'),
    modeCanvas:
      supplied.modeCanvas||
      modeSwitch?.querySelector('[data-mode="canvas"]'),
    workspace:q(supplied.workspace,"#workspace,[data-ovll-workspace]"),
    chatPage:q(supplied.chatPage,"#chat-page,[data-ovll-chat-page]"),
    chatContent:q(supplied.chatContent,"#chat-content,[data-ovll-chat-content]"),
    chatMessages:q(supplied.chatMessages,"#chat-messages,[data-ovll-chat-messages]"),
    canvasPage:q(supplied.canvasPage,"#canvas-page,[data-ovll-canvas-page]"),
    canvasViewport:q(supplied.canvasViewport,"#canvas-viewport,[data-ovll-canvas-viewport]"),
    canvasWorld:q(supplied.canvasWorld,"#canvas-world,[data-ovll-canvas-world]"),
    composer:q(supplied.composer,"#composer,[data-ovll-composer]"),
    composerForm:q(supplied.composerForm,"#composer-form,[data-ovll-composer-form]"),
    composerInput:q(supplied.composerInput,"#composer-input,[data-ovll-composer-input]"),
    composerAttach:q(supplied.composerAttach,"#composer-attach,[data-ovll-composer-attach]"),
    composerFileInput:q(supplied.composerFileInput,"#composer-file-input,[data-ovll-composer-file-input]"),
    composerSubmit:q(supplied.composerSubmit,"#composer-submit,[data-ovll-composer-submit]")
  };
}

function createOvllWorkspace(host,options={}){
  const document=options.document||global.document;

  if(!host){
    throw new Error("Ovll Workspace host가 없습니다.");
  }

  const ownsShell=!options.elements;
  const shell=
    options.elements
      ?(options.elements.shell||host)
      :createShell(host,{document});

  const elements=resolveElements(
    shell,
    options.elements||{}
  );

  for(const key of [
    "topbar",
    "modeSwitch",
    "workspace",
    "chatPage",
    "chatMessages",
    "canvasPage",
    "canvasViewport",
    "canvasWorld",
    "composer",
    "composerForm",
    "composerInput",
    "composerSubmit"
  ]){
    if(!elements[key]){
      if(ownsShell) shell.remove();
      throw new Error("Ovll Workspace DOM 누락: "+key);
    }
  }

  const createUI=global.createOvllWorkspaceUI;
  const createPresence=global.createOvllPresence;

  if(
    typeof createUI!=="function"||
    typeof createPresence!=="function"
  ){
    if(ownsShell) shell.remove();
    throw new Error("Ovll Workspace controller가 준비되지 않았습니다.");
  }

  const ownsUI=!options.ui;
  const ownsPresence=!options.presence;
  const listeners=[];

  const busyTarget=
    options.busyTarget||
    (
      typeof global.EventTarget==="function"
        ?new global.EventTarget()
        :global
    );

  let busy=false;
  let canvas=null;
  let mascot=null;
  let mascotUiCleanup=null;
  let nodeBuilder=null;
  let destroyed=false;

  const ui=
    options.ui||
    createUI({
      document,
      root:shell,
      workspace:elements.workspace,
      chatPage:elements.chatPage,
      canvasPage:elements.canvasPage,
      modeSwitch:elements.modeSwitch,
      modeChat:elements.modeChat,
      modeCanvas:elements.modeCanvas,
      history:options.history===true,
      navigation:options.navigation,
      navigationEvents:options.navigationEvents===true,
      initialMode:options.initialMode||"chat",
      viewportRoot:options.viewportRoot||shell,
      scopeViewportToWorkspace:true,
      themeRoot:document.documentElement
    });

  const presence=
    options.presence||
    createPresence({
      document,
      root:shell,
      ui,
      chatPage:elements.chatPage,
      chatMessages:elements.chatMessages,
      canvasPage:elements.canvasPage,
      canvasWorld:elements.canvasWorld,
      globalMascotFallback:options.globalMascotFallback===true,
      ...(options.presenceOptions||{})
    });

  const slots={};
  for(const name of [
    "headerStart",
    "headerEnd",
    "overlay",
    "composerBefore",
    "composerAfter"
  ]){
    slots[name]=
      shell.querySelector(
        '[data-ovll-slot="'+name+'"]'
      )||null;
  }

  function listen(target,type,handler,listenerOptions){
    if(!target||typeof target.addEventListener!=="function") return;
    target.addEventListener(type,handler,listenerOptions);
    listeners.push(()=>target.removeEventListener(type,handler,listenerOptions));
  }

  function setBusy(next){
    busy=!!next;

    try{
      busyTarget.dispatchEvent(
        new global.CustomEvent(
          "ovll:busychange",
          {detail:{busy}}
        )
      );
    }catch{}

    elements.composerForm.classList.toggle("is-busy",busy);
    elements.composerSubmit.disabled=busy;
    return api;
  }

  function appendMessage(
    role,
    text,
    messageOptions={}
  ){
    const value=
      String(text??"").trim();

    if(!value){
      return null;
    }

    const normalizedRole=
      role==="user"
        ?"user"
        :role==="system"
          ?"system"
          :"assistant";

    if(
      normalizedRole==="user"&&
      messageOptions.presence!==
        false
    ){
      presence.beginConversation?.();
    }

    const row=
      document.createElement(
        "div"
      );

    row.className=
      "astra-message astra-message-"+
      normalizedRole;

    const body=
      document.createElement(
        "div"
      );

    body.className=
      "astra-message-body";
    body.textContent=
      value;

    row.appendChild(
      body
    );

    elements.chatMessages
      .appendChild(
        row
      );

    if(
      normalizedRole==="assistant"&&
      messageOptions.presence!==
        false
    ){
      presence.moveToEnd?.();
      presence.settle?.();
    }

    elements.chatContent
      ?.scrollTo?.({
        top:
          elements.chatContent
            .scrollHeight,
        behavior:
          messageOptions
            .instant
            ?"auto"
            :"smooth"
      });

    return row;
  }

  function clearMessages(){
    for(
      const child of
      [
        ...elements
          .chatMessages
          .children
      ]
    ){
      if(
        child.dataset
          ?.ovllPresence===
        "true"
      ){
        continue;
      }

      child.remove();
    }

    presence.resetConversation?.({
      started:false
    });

    return api;
  }

  function resizeComposer(){
    const form=
      elements.composerForm;
    const input=
      elements.composerInput;

    form.classList.remove(
      "is-expanded"
    );

    input.style.height=
      "auto";

    const inputStyle=
      global.getComputedStyle(
        input
      );

    const inputMinHeight=
      parseFloat(
        inputStyle.minHeight
      )||34;

    const collapsedHeight=
      Math.min(
        input.scrollHeight,
        136
      );

    const expanded=
      collapsedHeight>
      inputMinHeight+1;

    form.classList.toggle(
      "is-expanded",
      expanded
    );

    input.style.height=
      "auto";

    const height=
      Math.min(
        input.scrollHeight,
        136
      );

    input.style.height=
      height+"px";

    const styleRoot=
      options.composerStyleRoot||
      shell;

    const rootStyle=
      styleRoot.style;

    const rootComputed=
      global.getComputedStyle(
        document.documentElement
      );

    const composerHeightValue=
      rootComputed
        .getPropertyValue(
          "--composer-height"
        )
        .trim();

    const composerHeightNumber=
      parseFloat(
        composerHeightValue
      );

    const rootFontSize=
      parseFloat(
        rootComputed.fontSize
      )||16;

    const baseComposerHeight=
      Number.isFinite(
        composerHeightNumber
      )
        ?composerHeightValue.endsWith(
            "rem"
          )
          ?composerHeightNumber*
            rootFontSize
          :composerHeightNumber
        :88;

    const formHeight=
      form
        .getBoundingClientRect()
        .height;

    rootStyle.setProperty(
      "--composer-input-height",
      height+"px"
    );

    rootStyle.setProperty(
      "--composer-form-height",
      formHeight+"px"
    );

    rootStyle.setProperty(
      "--composer-live-height",
      Math.max(
        baseComposerHeight,
        formHeight
      )+"px"
    );

    return api;
  }

  function bindComposer(adapter={}){
    listen(elements.composerForm,"submit",event=>{
      event.preventDefault();
      adapter.onSubmit?.(
        elements.composerInput.value,
        event,
        api
      );
    });

    listen(
      elements.composerInput,
      "input",
      event=>{
        resizeComposer();
        adapter.onInput
          ?.(event,api);
      }
    );

    if(adapter.onKeydown){
      listen(elements.composerInput,"keydown",event=>adapter.onKeydown(event,api));
    }

    if(adapter.onAttach&&elements.composerAttach){
      listen(elements.composerAttach,"click",event=>{
        event.preventDefault();
        adapter.onAttach(event,api);
      });
    }

    resizeComposer();

    return api;
  }

  function attachMascot(mascotOptions={}){
    if(
      !canvas||
      options.mascot===false||
      mascotOptions.enabled===false||
      typeof global.mountOvllCanvasMascot!=="function"
    ){
      return null;
    }

    mascotUiCleanup?.();
    mascot?.destroy?.();

    mascot=global.mountOvllCanvasMascot(
      elements.canvasWorld,
      canvas,
      {
        ...mascotOptions,
        document,
        ui,
        app:{isBusy:()=>busy},
        busyTarget,
        composer:elements.composerForm,
        topbar:elements.topbar
      }
    );

    presence.attachCanvasMascot(mascot);

    if(typeof global.bindOvllCanvasMascotUI==="function"){
      mascotUiCleanup=
        global.bindOvllCanvasMascotUI(
          mascot,
          ui
        );
    }

    return mascot;
  }

  function bindCanvas(nextCanvas,bindOptions={}){
    canvas=nextCanvas||null;
    ui.bindCanvas(canvas);
    nodeBuilder?.setCanvas(canvas);

    if(
      canvas&&
      bindOptions.mascot!==false&&
      options.mascot!==false
    ){
      attachMascot(
        bindOptions.mascotOptions||{}
      );
    }

    return api;
  }

  async function mountCanvas(mountOptions={}){
    const mount=options.mountCanvas||global.mountCanvasNode;

    if(typeof mount!=="function"){
      throw new Error("Canvas mount 함수가 없습니다.");
    }

    const mounted=await mount(
      elements.canvasViewport,
      {
        ...mountOptions,
        pluginContext:
          mountOptions.pluginContext||
          options.pluginContext||
          "workspace"
      }
    );

    bindCanvas(
      mounted,
      {
        mascot:mountOptions.mascot!==false,
        mascotOptions:mountOptions.mascotOptions
      }
    );

    return mounted;
  }

  function mountNodeBuilder(builderOptions={}){
    if(nodeBuilder) return nodeBuilder;

    if(typeof global.createCanvasNodeBuilder!=="function"){
      return null;
    }

    nodeBuilder=global.createCanvasNodeBuilder({
      document,
      host:elements.canvasPage,
      canvas,
      navigation:builderOptions.navigation,
      history:builderOptions.history===true,
      svgLibrary:builderOptions.svgLibrary,
      filter:builderOptions.filter,
      beforeReset:builderOptions.beforeReset,
      afterReset:builderOptions.afterReset,
      eventRoot:builderOptions.eventRoot||document
    });

    return nodeBuilder;
  }

  const api={
    root:shell,
    elements,
    slots,
    ui,
    presence,
    busyTarget,
    appendMessage,
    clearMessages,
    resizeComposer,
    bindComposer,
    bindCanvas,
    mountCanvas,
    mountNodeBuilder,
    attachMascot,
    setBusy,
    isBusy(){
      return busy;
    },
    getCanvas(){
      return canvas;
    },
    getMascot(){
      return mascot;
    },
    destroy(){
      if(destroyed) return;
      destroyed=true;

      nodeBuilder?.destroy?.();
      nodeBuilder=null;

      mascotUiCleanup?.();
      mascotUiCleanup=null;

      mascot?.destroy?.();
      mascot=null;

      listeners.splice(0).forEach(cleanup=>{
        try{cleanup();}catch{}
      });

      if(ownsPresence) presence.destroy?.();
      if(ownsUI) ui.destroy?.();
      if(ownsShell) shell.remove();

      canvas=null;
    }
  };

  return api;
}

global.createOvllWorkspace=createOvllWorkspace;

})(window);
