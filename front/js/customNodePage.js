(function(global){
"use strict";

const Navigation=
  global.OvllNavigation;
const createFunctionWorkspace=
  global.createOvllFunctionWorkspace;

const page=
  document.querySelector(
    "#custom-node-page"
  );

const host=
  page?.querySelector(
    "[data-function-workspace-host]"
  );

if(
  !Navigation||
  typeof createFunctionWorkspace!==
    "function"||
  !page||
  !host
){
  return;
}

const state={
  open:false,
  destroyed:false,
  controller:null,
  closeTimer:null,
  returnFocus:null
};

const listeners=[];

function listen(
  target,
  type,
  handler,
  options
){
  target.addEventListener(
    type,
    handler,
    options
  );

  listeners.push(
    ()=>target.removeEventListener(
      type,
      handler,
      options
    )
  );
}

function ensureController(){
  if(state.controller){
    return state.controller;
  }

  state.controller=
    createFunctionWorkspace(
      host,
      {
        onClose(){
          hide();
        }
      }
    );

  return state.controller;
}

function show(options={}){
  if(state.destroyed){
    return false;
  }

  global.OvllLibraryPage
    ?.hide?.({
      history:false
    });

  if(!state.open){
    state.returnFocus=
      document.activeElement
        instanceof HTMLElement
        ?document.activeElement
        :null;

    if(options.history!==false){
      if(options.history==="replace"){
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

      ensureController()
        .activate();
    }
  );

  return true;
}

function restoreFocus(){
  const target=
    state.returnFocus;

  state.returnFocus=null;

  if(
    target?.isConnected&&
    typeof target.focus===
      "function"
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

global.OvllCustomNodePage=
  Object.freeze({
    show,
    hide,
    isOpen(){
      return state.open;
    },
    newDraft(){
      show();
      return ensureController()
        .newDraft();
    },
    open(recordId){
      show();

      return recordId
        ?ensureController()
          .open(recordId)
        :ensureController()
          .newDraft();
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

      state.controller
        ?.destroy?.();

      state.controller=null;

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
