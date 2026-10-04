(function(global){
"use strict";

const FileStore=
  global.OvllFileStore;

const PreviewEngine=
  global.OvllPreviewEngine;

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

const contentRoot=
  page?.querySelector(
    "[data-library-content]"
  );

const detail=
  page?.querySelector(
    "[data-library-detail]"
  );

const search=
  page?.querySelector(
    "[data-library-search-input]"
  );

const count=
  page?.querySelector(
    "[data-library-count]"
  );

const back=
  page?.querySelector(
    "[data-library-back]"
  );

if(
  !FileStore||
  !PreviewEngine||
  !ArtifactVisuals||
  !page||
  !grid||
  !contentRoot||
  !detail
){
  return;
}

const listeners=[];

const state={
  files:[],
  query:"",
  selectedId:"",
  loading:false,
  detailToken:0,
  open:false,
  closeTimer:null,
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
          action:"format",
          inlinePreview:false
        }
      );

  card.dataset.libraryId=
    file.id;

  if(
    file.id===
    state.selectedId
  ){
    card.classList.add(
      "is-selected"
    );
  }

  return card;
}

function renderGrid(){
  const files=
    visibleFiles();

  grid.replaceChildren();

  if(count){
    count.textContent=
      state.loading
        ?""
        :`${files.length}개`;
  }

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

function closeDetail(){
  state.selectedId="";
  state.detailToken++;

  contentRoot.classList
    .remove(
      "has-selection"
    );

  detail.replaceChildren();

  renderGrid();
}

function actionButton(
  label,
  svg,
  action
){
  const button=
    document.createElement(
      "button"
    );

  button.type="button";
  button.className=
    "ovll-library-detail-action";

  button.dataset.libraryAction=
    action;

  button.setAttribute(
    "aria-label",
    label
  );

  button.innerHTML=
    svg;

  return button;
}

async function renderPreview(
  root,
  file
){
  return PreviewEngine
    .render(
      root,
      {
        ...file,
        localFileId:
          file.localFileId||
          file.id
      },
      {
        fileStore:
          FileStore,
        textClassName:
          "ovll-library-preview-text"
      }
    );
}

async function selectFile(fileId){
  const id=
    String(fileId||"");

  if(!id){
    closeDetail();
    return false;
  }

  const file=
    state.files.find(
      item=>item.id===id
    )||
    await FileStore
      .getMetadata(id);

  if(!file){
    closeDetail();
    return false;
  }

  state.selectedId=id;
  renderGrid();

  contentRoot.classList
    .add(
      "has-selection"
    );

  const token=
    ++state.detailToken;

  detail.replaceChildren();

  const visual=
    ArtifactVisuals
      .visual(file);

  const header=
    document.createElement(
      "header"
    );

  header.className=
    "ovll-library-detail-header";

  const identity=
    document.createElement(
      "div"
    );

  identity.className=
    "ovll-library-detail-identity";

  const icon=
    document.createElement(
      "span"
    );

  icon.className=
    "astra-artifact-icon";

  icon.style.setProperty(
    "--artifact-accent",
    visual.color
  );

  icon.innerHTML=
    visual.icon;

  const copy=
    document.createElement(
      "div"
    );

  copy.className=
    "ovll-library-detail-copy";

  const name=
    document.createElement(
      "strong"
    );

  name.textContent=
    file.name||
    "파일";

  const meta=
    document.createElement(
      "small"
    );

  meta.textContent=
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

  copy.append(
    name,
    meta
  );

  identity.append(
    icon,
    copy
  );

  const actions=
    document.createElement(
      "div"
    );

  actions.className=
    "ovll-library-detail-actions";

  const hydrated=
    await FileStore.hydrate(id);

  if(
    state.destroyed||
    token!==state.detailToken
  ){
    return false;
  }

  if(hydrated?.downloadUrl){
    const download=
      document.createElement(
        "a"
      );

    download.className=
      "ovll-library-detail-action";

    download.href=
      hydrated.downloadUrl;

    download.download=
      hydrated.name||
      "file";

    download.setAttribute(
      "aria-label",
      "다운로드"
    );

    download.innerHTML=`
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 3.8v8m0 0 2.7-2.7M10 11.8 7.3 9.1"></path>
        <path d="M4.8 15h10.4"></path>
      </svg>
    `;

    actions.appendChild(
      download
    );
  }

  actions.append(
    actionButton(
      "삭제",
      `
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6 6.2h8M8 6.2V4.7h4v1.5"></path>
          <path d="m7.2 8 .5 7h4.6l.5-7"></path>
        </svg>
      `,
      "delete"
    ),
    actionButton(
      "닫기",
      `
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m6.2 6.2 7.6 7.6M13.8 6.2l-7.6 7.6"></path>
        </svg>
      `,
      "close"
    )
  );

  header.append(
    identity,
    actions
  );

  const preview=
    document.createElement(
      "div"
    );

  preview.className=
    "ovll-library-preview";

  const loading=
    document.createElement(
      "div"
    );

  loading.className=
    "ovll-library-preview-placeholder";

  loading.textContent=
    "미리보기 불러오는 중";

  preview.appendChild(
    loading
  );

  detail.append(
    header,
    preview
  );

  try{
    preview.replaceChildren();

    const shown=
      await renderPreview(
        preview,
        file
      );

    if(
      state.destroyed||
      token!==state.detailToken
    ){
      return false;
    }

    if(!shown){
      const empty=
        document.createElement(
          "div"
        );

      empty.className=
        "ovll-library-preview-placeholder";

      empty.textContent=
        "이 형식은 아직 미리보기를 지원하지 않아";

      preview.appendChild(
        empty
      );
    }
  }catch(error){
    console.warn(
      "ovll library preview failed:",
      error
    );

    preview.replaceChildren();

    const empty=
      document.createElement(
        "div"
      );

    empty.className=
      "ovll-library-preview-placeholder";

    empty.textContent=
      "미리보기를 불러오지 못했어";

    preview.appendChild(
      empty
    );
  }

  return true;
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

  if(
    state.selectedId&&
    !state.files.some(
      file=>
        file.id===
        state.selectedId
    )
  ){
    closeDetail();
    return;
  }

  renderGrid();
}

function show(){
  if(state.destroyed){
    return false;
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
    }
  );

  void refresh();

  return true;
}

function hide(){
  if(
    state.destroyed||
    !state.open
  ){
    return false;
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

    void selectFile(
      card.dataset.libraryId
    );
  }
);

listen(
  detail,
  "click",
  event=>{
    const action=
      event.target.closest(
        "[data-library-action]"
      )
        ?.dataset
        ?.libraryAction;

    if(!action){
      return;
    }

    if(action==="close"){
      closeDetail();
      return;
    }

    if(
      action==="delete"&&
      state.selectedId
    ){
      const id=
        state.selectedId;

      closeDetail();

      void FileStore
        .remove(id)
        .then(refresh);
    }
  }
);

listen(
  back,
  "click",
  hide
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
  "ovll:files-changed",
  ()=>{
    if(state.open){
      void refresh();
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

    return selectFile(
      fileId
    );
  },

  refresh,
  closeDetail,

  destroy(){
    if(state.destroyed){
      return;
    }

    state.destroyed=true;
    state.open=false;
    state.detailToken++;

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
