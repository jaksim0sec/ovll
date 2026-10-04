(function(global){
"use strict";

const UI=
  global.AstraUI;

const FileStore=
  global.OvllFileStore;

const Sandbox=
  global.OvllPreviewSandbox;

const page=
  document.querySelector(
    "#library-page"
  );

const grid=
  page?.querySelector(
    "[data-library-grid]"
  );

const content=
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

if(
  !UI||
  !FileStore||
  !Sandbox||
  !page||
  !grid||
  !content||
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
  destroyed:false
};

function listen(
  node,
  type,
  handler,
  options
){
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

function formatSize(value){
  const size=
    Number(value||0);

  if(size<1024){
    return size+" B";
  }

  if(size<1048576){
    return (
      size/1024
    ).toFixed(1)+" KB";
  }

  return (
    size/1048576
  ).toFixed(1)+" MB";
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
  const name=
    String(
      file?.name||""
    );

  const dot=
    name.lastIndexOf(".");

  if(dot>0){
    return name
      .slice(dot+1)
      .toUpperCase()
      .slice(0,8);
  }

  const mime=
    String(
      file?.mime||""
    );

  if(mime.includes("/")){
    return mime
      .split("/")
      .pop()
      .toUpperCase()
      .slice(0,8);
  }

  return "FILE";
}

function isHtml(file){
  const format=
    formatOf(file);

  const mime=
    String(
      file?.mime||""
    ).toLowerCase();

  return (
    format==="HTML"||
    format==="HTM"||
    mime.includes(
      "text/html"
    )
  );
}

function isImage(file){
  return String(
    file?.mime||""
  )
    .toLowerCase()
    .startsWith("image/");
}

function isPdf(file){
  return (
    formatOf(file)==="PDF"||
    String(
      file?.mime||""
    )
      .toLowerCase()
      .includes(
        "application/pdf"
      )
  );
}

function isText(file){
  const format=
    formatOf(file);

  return (
    String(
      file?.mime||""
    )
      .toLowerCase()
      .startsWith("text/")||
    [
      "TXT",
      "MD",
      "JSON",
      "CSV",
      "RTF",
      "XML",
      "JS",
      "CSS"
    ].includes(format)
  );
}

function fileIcon(){
  return `
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5.2 3.2h6l3.6 3.6v10H5.2z"></path>
      <path d="M11.2 3.2v3.7h3.6"></path>
      <path d="M7.4 10h5.2M7.4 12.6h4.1"></path>
    </svg>
  `;
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
  const button=
    document.createElement(
      "button"
    );

  button.type="button";
  button.className=
    "ovll-library-card";
  button.dataset.libraryId=
    file.id;

  if(
    file.id===
    state.selectedId
  ){
    button.classList.add(
      "is-selected"
    );
  }

  const head=
    document.createElement(
      "span"
    );

  head.className=
    "ovll-library-card-head";

  const icon=
    document.createElement(
      "span"
    );

  icon.className=
    "ovll-library-file-icon";
  icon.innerHTML=
    fileIcon();

  const format=
    document.createElement(
      "span"
    );

  format.className=
    "ovll-library-format";
  format.textContent=
    formatOf(file);

  head.append(
    icon,
    format
  );

  const spacer=
    document.createElement(
      "span"
    );

  const copy=
    document.createElement(
      "span"
    );

  copy.className=
    "ovll-library-card-copy";

  const name=
    document.createElement(
      "strong"
    );

  name.textContent=
    file.name||"파일";

  const meta=
    document.createElement(
      "span"
    );

  meta.textContent=
    [
      formatSize(file.size),
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

  button.append(
    head,
    spacer,
    copy
  );

  return button;
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

  content.classList.remove(
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
  button.innerHTML=svg;

  return button;
}

async function renderPreview(
  root,
  file
){
  if(isHtml(file)){
    const blob=
      await FileStore.getBlob(
        file.id
      );

    if(!blob){
      return false;
    }

    const frame=
      await Sandbox
        .createFrameFromBlob(
          blob,
          {
            title:
              file.name||
              "HTML 미리보기"
          }
        );

    root.appendChild(
      frame
    );

    return true;
  }

  const hydrated=
    await FileStore.hydrate(
      file.id
    );

  if(!hydrated){
    return false;
  }

  if(
    isImage(hydrated)&&
    hydrated.previewUrl
  ){
    const image=
      document.createElement(
        "img"
      );

    image.src=
      hydrated.previewUrl;
    image.alt=
      hydrated.name||
      "이미지";

    root.appendChild(
      image
    );

    return true;
  }

  if(
    isPdf(hydrated)&&
    hydrated.previewUrl
  ){
    const frame=
      document.createElement(
        "iframe"
      );

    frame.src=
      hydrated.previewUrl;
    frame.title=
      hydrated.name||
      "PDF 미리보기";
    frame.setAttribute(
      "loading",
      "lazy"
    );

    root.appendChild(
      frame
    );

    return true;
  }

  if(isText(hydrated)){
    let text=
      String(
        hydrated.previewText||
        ""
      );

    if(!text){
      const blob=
        await FileStore.getBlob(
          hydrated.id
        );

      if(blob){
        text=
          await blob.text();
      }
    }

    const pre=
      document.createElement(
        "pre"
      );

    pre.className=
      "ovll-library-preview-text";
    pre.textContent=
      text||
      "미리볼 내용이 없어";

    root.appendChild(
      pre
    );

    return true;
  }

  return false;
}

async function selectFile(
  fileId
){
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
    await FileStore.getMetadata(
      id
    );

  if(!file){
    closeDetail();
    return false;
  }

  state.selectedId=id;
  renderGrid();

  content.classList.add(
    "has-selection"
  );

  const token=
    ++state.detailToken;

  detail.replaceChildren();

  const header=
    document.createElement(
      "header"
    );

  header.className=
    "ovll-library-detail-header";

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
    file.name||"파일";

  const meta=
    document.createElement(
      "small"
    );

  meta.textContent=
    [
      formatOf(file),
      formatSize(file.size),
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

  const actions=
    document.createElement(
      "div"
    );

  actions.className=
    "ovll-library-detail-actions";

  const hydrated=
    await FileStore.hydrate(
      id
    );

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

  const remove=
    actionButton(
      "삭제",
      `
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M6 6.2h8M8 6.2V4.7h4v1.5"></path>
          <path d="m7.2 8 .5 7h4.6l.5-7"></path>
        </svg>
      `,
      "delete"
    );

  const close=
    actionButton(
      "닫기",
      `
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m6.2 6.2 7.6 7.6M13.8 6.2l-7.6 7.6"></path>
        </svg>
      `,
      "close"
    );

  actions.append(
    remove,
    close
  );

  header.append(
    copy,
    actions
  );

  const preview=
    document.createElement(
      "div"
    );

  preview.className=
    "ovll-library-preview";

  const placeholder=
    document.createElement(
      "div"
    );

  placeholder.className=
    "ovll-library-preview-placeholder";
  placeholder.textContent=
    "미리보기 불러오는 중";

  preview.appendChild(
    placeholder
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
  }else{
    renderGrid();
  }
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

if(search){
  listen(
    search,
    "input",
    ()=>{
      state.query=
        search.value||"";

      renderGrid();
    }
  );
}

listen(
  global,
  "ovll:files-changed",
  ()=>void refresh()
);

const offModeChange=
  UI.on(
    "modechange",
    ({mode})=>{
      if(mode==="library"){
        void refresh();
      }
    }
  );

if(
  typeof offModeChange===
    "function"
){
  listeners.push(
    offModeChange
  );
}

const api={
  async open(fileId){
    UI.setMode(
      "library"
    );

    if(
      !state.files.length
    ){
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
    state.detailToken++;

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

if(
  UI.getMode?.()===
    "library"
){
  void refresh();
}

})(window);
