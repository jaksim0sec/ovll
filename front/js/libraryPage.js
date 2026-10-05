(function(global){
"use strict";

const FileStore=
  global.OvllFileStore;

const Navigation=
  global.OvllNavigation;

const ArtifactVisuals=
  global.OvllArtifactVisuals;

const page=
  document.querySelector(
    "#library-page"
  );

const grid=
  page?.querySelector(
    "[data-library-grid]"
  );

const search=
  page?.querySelector(
    "[data-library-search-input]"
  );

if(
  !FileStore||
  !Navigation||
  !ArtifactVisuals||
  !page||
  !grid
){
  return;
}

const listeners=[];

const state={
  files:[],
  query:"",
  loading:false,
  open:false,
  closeTimer:null,
  returnFocus:null,
  destroyed:false
};

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

function focusLibraryEntry(){
  const target=
    search||
    page;

  if(
    !target||
    typeof target.focus!=="function"
  ){
    return;
  }

  try{
    target.focus({
      preventScroll:true
    });
  }catch{
    target.focus();
  }
}

function restorePageFocus(){
  let target=
    state.returnFocus;

  state.returnFocus=null;

  const sidebarPanel=
    target
      ?.closest?.(
        "#ovll-shell-menu-panel"
      );

  if(
    sidebarPanel
      ?.getAttribute(
        "aria-hidden"
      )==="true"
  ){
    target=
      document.querySelector(
        "#ovll-shell-menu-trigger"
      );
  }

  if(
    !target||
    !target.isConnected||
    typeof target.focus!=="function"
  ){
    return;
  }

  requestAnimationFrame(
    ()=>{
      try{
        target.focus({
          preventScroll:true
        });
      }catch{
        target.focus();
      }
    }
  );
}

function handlePageKeydown(event){
  if(
    event.key!=="Escape"||
    !state.open||
    event.defaultPrevented
  ){
    return;
  }

  if(
    document.querySelector(
      ".astra-artifact-preview-root.is-open"
    )
  ){
    return;
  }

  if(
    global.OvllShellMenu
      ?.isOpen?.()
  ){
    return;
  }

  event.preventDefault();
  hide();
}

function formatDate(value){
  const date=
    new Date(
      Number(value||0)
    );

  if(
    Number.isNaN(
      date.getTime()
    )
  ){
    return "";
  }

  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      month:"short",
      day:"numeric",
      hour:"2-digit",
      minute:"2-digit"
    }
  ).format(date);
}

function formatOf(file){
  return ArtifactVisuals
    .format(file);
}

function visibleFiles(){
  const query=
    state.query
      .trim()
      .toLowerCase();

  if(!query){
    return state.files;
  }

  return state.files.filter(
    file=>{
      const haystack=
        [
          file.name,
          file.mime,
          formatOf(file),
          ...(Array.isArray(file.tags)
            ?file.tags
            :[])
        ]
          .join(" ")
          .toLowerCase();

      return haystack.includes(
        query
      );
    }
  );
}

function cardFor(file){
  const metaText=
    [
      formatOf(file),
      ArtifactVisuals
        .formatSize(
          file.size
        ),
      formatDate(
        file.updatedAt||
        file.createdAt
      )
    ]
      .filter(Boolean)
      .join(" · ");

  const {
    element:card
  }=
    ArtifactVisuals
      .createCard(
        file,
        {
          tagName:"button",
          className:
            "ovll-library-artifact-card",
          metaText,
          action:null,
          inlinePreview:false
        }
      );

  card.type="button";
  card.dataset.libraryId=
    file.id;

  card.setAttribute(
    "aria-label",
    (file.name||"파일")+
    " 미리보기"
  );

  return card;
}

function renderGrid(){
  const files=
    visibleFiles();

  grid.replaceChildren();

  if(state.loading){
    const empty=
      document.createElement(
        "div"
      );

    empty.className=
      "ovll-library-empty";

    empty.textContent=
      "파일 불러오는 중";

    grid.appendChild(
      empty
    );

    return;
  }

  if(!files.length){
    const empty=
      document.createElement(
        "div"
      );

    empty.className=
      "ovll-library-empty";

    empty.textContent=
      state.query
        ?"검색 결과가 없어"
        :"저장된 파일이 없어";

    grid.appendChild(
      empty
    );

    return;
  }

  for(const file of files){
    grid.appendChild(
      cardFor(file)
    );
  }
}

async function previewFile(
  fileId
){
  const id=
    String(fileId||"");

  if(!id){
    return false;
  }

  const artifact=
    await FileStore
      .hydrate(id);

  if(!artifact){
    return false;
  }

  const preview=
    global.AstraApp
      ?.previewArtifact;

  if(
    typeof preview!=="function"
  ){
    console.warn(
      "ovll shared artifact preview is unavailable"
    );

    return false;
  }

  return await preview(
    artifact
  );
}

async function refresh(){
  if(state.destroyed){
    return;
  }

  state.loading=true;
  renderGrid();

  try{
    state.files=
      await FileStore.list();
  }catch(error){
    console.warn(
      "ovll library load failed:",
      error
    );

    state.files=[];
  }finally{
    state.loading=false;
  }

  renderGrid();
}

function show(options={}){
  if(state.destroyed){
    return false;
  }

  const wasOpen=
    state.open;

  if(!wasOpen){
    state.returnFocus=
      document.activeElement instanceof HTMLElement
        ?document.activeElement
        :null;

    if(
      options.history !==
        false
    ){
      if(
        options.history ===
          "replace"
      ){
        Navigation.replace(
          "library"
        );
      }else{
        Navigation.open(
          "library"
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
    "library";

  requestAnimationFrame(
    ()=>{
      page.classList.add(
        "is-open"
      );

      if(!wasOpen){
        focusLibraryEntry();
      }
    }
  );

  void refresh();

  return true;
}

function hide(options={}){
  if(
    state.destroyed||
    !state.open
  ){
    return false;
  }

  if(
    options.history !==
      false &&
    Navigation.isCurrent(
      "library"
    )
  ){
    Navigation.close(
      "library",
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
      "library"
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
          restorePageFocus();
        }
      },
      190
    );

  return true;
}

listen(
  grid,
  "click",
  event=>{
    const card=
      event.target.closest(
        "[data-library-id]"
      );

    if(!card){
      return;
    }

    void previewFile(
      card.dataset.libraryId
    );
  }
);

if(search){
  listen(
    search,
    "input",
    ()=>{
      state.query=
        search.value||
        "";

      renderGrid();
    }
  );
}

listen(
  global,
  "keydown",
  handlePageKeydown
);

listen(
  global,
  "ovll:files-changed",
  ()=>{
    if(state.open){
      void refresh();
    }
  }
);

listen(
  global,
  "ovll:navigation-back",
  event=>{
    if(
      event.detail?.layer===
        "library" &&
      state.open
    ){
      hide({
        history:false
      });
    }
  }
);

const api={
  show,
  hide,

  isOpen(){
    return state.open;
  },

  async open(fileId){
    show();

    if(!state.files.length){
      await refresh();
    }

    if(fileId){
      return await previewFile(
        fileId
      );
    }

    return true;
  },

  refresh,
  previewFile,

  destroy(){
    if(state.destroyed){
      return;
    }

    state.destroyed=true;
    state.open=false;
    state.returnFocus=null;

    clearTimeout(
      state.closeTimer
    );

    delete document
      .documentElement
      .dataset
      .appPage;

    listeners
      .splice(0)
      .forEach(
        cleanup=>{
          try{
            cleanup();
          }catch{}
        }
      );
  }
};

global.OvllLibraryPage=
  Object.freeze(api);

})(window);
