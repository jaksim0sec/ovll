(function(global){
"use strict";

const CSP=[
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "media-src data: blob:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join("; ");

const TEXT_FORMATS=
  new Set([
    "TXT",
    "MD",
    "JSON",
    "CSV",
    "RTF",
    "XML",
    "JS",
    "CSS",
    "HTML",
    "HTM"
  ]);

const CODE_FORMATS=
  new Set([
    "JS",
    "CSS",
    "JSON",
    "XML"
  ]);

const DOCUMENT_FORMATS=
  new Set([
    "MD",
    "DOC",
    "DOCX",
    "RTF"
  ]);

const BINARY_OFFICE_FORMATS=
  new Set([
    "DOC",
    "DOCX",
    "XLS",
    "XLSX",
    "PPT",
    "PPTX"
  ]);

function injectPolicy(source){
  const parser=
    new DOMParser();

  const doc=
    parser.parseFromString(
      String(source||""),
      "text/html"
    );

  const existingPolicies=
    doc.querySelectorAll?.(
      'meta[http-equiv="Content-Security-Policy" i]'
    )||[];

  for(
    const node
    of existingPolicies
  ){
    node.remove?.();
  }

  const charset=
    doc.createElement(
      "meta"
    );

  charset.setAttribute(
    "charset",
    "utf-8"
  );

  const policy=
    doc.createElement(
      "meta"
    );

  policy.setAttribute(
    "http-equiv",
    "Content-Security-Policy"
  );

  policy.setAttribute(
    "content",
    CSP
  );

  const referrer=
    doc.createElement(
      "meta"
    );

  referrer.setAttribute(
    "name",
    "referrer"
  );

  referrer.setAttribute(
    "content",
    "no-referrer"
  );

  doc.head.prepend(
    referrer
  );

  doc.head.prepend(
    policy
  );

  doc.head.prepend(
    charset
  );

  return (
    "<!doctype html>"+
    doc.documentElement
      .outerHTML
  );
}

function createFrame(
  source,
  {
    title="HTML 미리보기",
    className=""
  }={}
){
  const frame=
    document.createElement(
      "iframe"
    );

  frame.className=
    [
      "ovll-sandbox-frame",
      String(className||"")
    ]
      .filter(Boolean)
      .join(" ");

  frame.title=
    String(
      title||
      "HTML 미리보기"
    );

  frame.setAttribute(
    "sandbox",
    "allow-scripts"
  );

  frame.setAttribute(
    "referrerpolicy",
    "no-referrer"
  );

  frame.setAttribute(
    "loading",
    "lazy"
  );

  frame.srcdoc=
    injectPolicy(source);

  return frame;
}

async function createFrameFromBlob(
  blob,
  options={}
){
  if(!(blob instanceof Blob)){
    return createFrame(
      "",
      options
    );
  }

  const source=
    await blob.text();

  return createFrame(
    source,
    options
  );
}

function previewFormat(
  artifact
){
  if(
    global.OvllArtifactVisuals
      ?.format
  ){
    return global
      .OvllArtifactVisuals
      .format(artifact);
  }

  const explicit=
    String(
      artifact?.format||
      ""
    )
      .trim()
      .toUpperCase()
      .replace(/^\./,"");

  if(explicit){
    return explicit;
  }

  const name=
    String(
      artifact?.name||
      ""
    );

  const dot=
    name.lastIndexOf(".");

  return dot>0
    ?name
      .slice(dot+1)
      .toUpperCase()
    :"FILE";
}

function previewKind(
  artifact
){
  const declared=
    String(
      artifact?.previewKind||
      ""
    )
      .trim()
      .toLowerCase();

  if(
    [
      "html",
      "pdf",
      "image",
      "document",
      "text",
      "code",
      "spreadsheet"
    ].includes(declared)
  ){
    return declared;
  }

  const format=
    previewFormat(
      artifact
    );

  const mime=
    String(
      artifact?.mime||
      ""
    ).toLowerCase();

  if(
    format==="HTML"||
    format==="HTM"||
    mime.includes(
      "text/html"
    )
  ){
    return "html";
  }

  if(
    format==="PDF"||
    mime.includes(
      "application/pdf"
    )
  ){
    return "pdf";
  }

  if(
    mime.startsWith(
      "image/"
    )||
    [
      "PNG",
      "JPG",
      "JPEG",
      "WEBP",
      "GIF",
      "SVG"
    ].includes(format)
  ){
    return "image";
  }

  if(
    [
      "DOC",
      "DOCX",
      "RTF",
      "MD"
    ].includes(format)
  ){
    return "document";
  }

  if(
    [
      "CSV",
      "XLS",
      "XLSX"
    ].includes(format)
  ){
    return "spreadsheet";
  }

  if(
    CODE_FORMATS.has(
      format
    )
  ){
    return "code";
  }

  if(
    format==="TXT"||
    mime.startsWith(
      "text/plain"
    )
  ){
    return "text";
  }

  return "";
}

function isBinaryOffice(
  artifact
){
  return BINARY_OFFICE_FORMATS.has(
    previewFormat(
      artifact
    )
  );
}

function canPreview(
  artifact
){
  if(!artifact){
    return false;
  }

  const kind=
    previewKind(
      artifact
    );

  if(!kind){
    return false;
  }

  if(
    kind==="pdf"||
    kind==="image"||
    kind==="html"
  ){
    return !!(
      artifact.previewUrl||
      artifact.downloadUrl||
      artifact.localFileId||
      artifact.id||
      (
        kind==="html"&&
        artifact.previewText
      )
    );
  }

  return !!(
    artifact.previewText||
    artifact.localFileId||
    artifact.id||
    (
      !isBinaryOffice(
        artifact
      )&&
      (
        artifact.previewUrl||
        artifact.downloadUrl
      )
    )
  );
}

async function localBlob(
  artifact,
  fileStore
){
  if(
    !fileStore?.getBlob
  ){
    return null;
  }

  const ids=[
    artifact?.localFileId,
    artifact?.id
  ]
    .map(value=>
      String(value||"")
    )
    .filter(Boolean);

  for(const id of ids){
    try{
      const blob=
        await fileStore
          .getBlob(id);

      if(blob){
        return blob;
      }
    }catch{}
  }

  return null;
}

async function hydratePreview(
  artifact,
  fileStore
){
  if(
    !fileStore?.hydrate
  ){
    return artifact;
  }

  const ids=[
    artifact?.localFileId,
    artifact?.id
  ]
    .map(value=>
      String(value||"")
    )
    .filter(Boolean);

  for(const id of ids){
    try{
      const local=
        await fileStore
          .hydrate(id);

      if(local){
        return{
          ...local,
          ...artifact,
          name:
            artifact?.name||
            local.name,
          mime:
            artifact?.mime||
            local.mime,
          size:
            Number(
              artifact?.size||
              local.size||
              0
            ),
          previewKind:
            artifact?.previewKind||
            local.previewKind||
            "",
          previewText:
            artifact?.previewText||
            local.previewText||
            ""
        };
      }
    }catch{}
  }

  return artifact;
}

async function fetchText(
  url
){
  const value=
    String(url||"");

  if(!value){
    return "";
  }

  try{
    const response=
      await fetch(
        value,
        {
          cache:"no-store",
          credentials:"omit",
          referrerPolicy:"no-referrer"
        }
      );

    if(!response.ok){
      return "";
    }

    return await response.text();
  }catch{
    return "";
  }
}

async function htmlSource(
  artifact,
  fileStore
){
  const blob=
    await localBlob(
      artifact,
      fileStore
    );

  if(blob){
    try{
      const text=
        await blob.text();

      if(text){
        return text;
      }
    }catch{}
  }

  const remote=
    await fetchText(
      artifact?.previewUrl||
      artifact?.downloadUrl
    );

  if(remote){
    return remote;
  }

  return String(
    artifact?.previewText||
    ""
  );
}

async function semanticText(
  artifact,
  fileStore
){
  const direct=
    String(
      artifact?.previewText||
      ""
    );

  if(
    isBinaryOffice(
      artifact
    )
  ){
    return direct;
  }

  const format=
    previewFormat(
      artifact
    );

  if(
    format==="RTF"&&
    direct
  ){
    return direct;
  }

  const blob=
    await localBlob(
      artifact,
      fileStore
    );

  if(
    blob&&
    TEXT_FORMATS.has(
      format
    )
  ){
    try{
      const text=
        await blob.text();

      if(text){
        return text;
      }
    }catch{}
  }

  if(direct){
    return direct;
  }

  if(
    TEXT_FORMATS.has(
      format
    )
  ){
    return fetchText(
      artifact?.previewUrl||
      artifact?.downloadUrl
    );
  }

  return "";
}

function parseDelimitedRows(
  text,
  format
){
  const source=
    String(text||"")
      .replace(/^\uFEFF/,"");

  if(!source){
    return [];
  }

  if(
    format==="XLS"||
    format==="XLSX"
  ){
    return source
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0,120)
      .map(line=>
        line
          .split("\t")
          .slice(0,24)
      );
  }

  const rows=[];
  let row=[];
  let cell="";
  let quoted=false;

  for(
    let index=0;
    index<source.length;
    index++
  ){
    const char=
      source[index];

    if(char==='"'){
      if(
        quoted&&
        source[index+1]==='"'
      ){
        cell+='"';
        index++;
      }else{
        quoted=!quoted;
      }
      continue;
    }

    if(
      char===","&&
      !quoted
    ){
      row.push(cell);
      cell="";
      continue;
    }

    if(
      (char==="\n"||
      char==="\r")&&
      !quoted
    ){
      if(
        char==="\r"&&
        source[index+1]==="\n"
      ){
        index++;
      }

      row.push(cell);
      rows.push(
        row.slice(0,24)
      );

      row=[];
      cell="";

      if(rows.length>=120){
        break;
      }

      continue;
    }

    cell+=char;
  }

  if(
    rows.length<120&&
    (cell||row.length)
  ){
    row.push(cell);
    rows.push(
      row.slice(0,24)
    );
  }

  return rows;
}

function revokeRootUrls(
  root
){
  if(
    !global.URL
      ?.revokeObjectURL
  ){
    return;
  }

  const nodes=
    root.querySelectorAll?.(
      "[data-ovll-object-url]"
    )||[];

  for(
    const node
    of nodes
  ){
    const value=
      node.getAttribute?.(
        "data-ovll-object-url"
      );

    if(value){
      try{
        global.URL
          .revokeObjectURL(
            value
          );
      }catch{}
    }
  }
}

function clearRoot(
  root
){
  revokeRootUrls(root);
  root.replaceChildren();

  for(
    const className
    of [
      "is-html",
      "is-pdf",
      "is-image",
      "is-document",
      "is-text",
      "is-code",
      "is-spreadsheet"
    ]
  ){
    root.classList.remove(
      className
    );
  }
}

async function directUrl(
  artifact,
  fileStore
){
  const blob=
    await localBlob(
      artifact,
      fileStore
    );

  if(
    blob&&
    global.URL
      ?.createObjectURL
  ){
    const url=
      global.URL
        .createObjectURL(
          blob
        );

    return {
      url,
      objectUrl:true
    };
  }

  const url=
    String(
      artifact?.previewUrl||
      artifact?.downloadUrl||
      ""
    );

  return {
    url,
    objectUrl:false
  };
}

function attachObjectUrl(
  element,
  direct
){
  if(
    direct?.objectUrl&&
    direct.url
  ){
    element.setAttribute(
      "data-ovll-object-url",
      direct.url
    );
  }
}

function renderSpreadsheet(
  root,
  rows
){
  if(!rows.length){
    return false;
  }

  const wrap=
    document.createElement(
      "div"
    );

  wrap.className=
    "ovll-preview-sheet";

  const table=
    document.createElement(
      "table"
    );

  const body=
    document.createElement(
      "tbody"
    );

  rows.forEach(
    (row,rowIndex)=>{
      const tr=
        document.createElement(
          "tr"
        );

      row.forEach(
        value=>{
          const cell=
            document.createElement(
              rowIndex===0
                ?"th"
                :"td"
            );

          cell.textContent=
            String(value??"");

          tr.appendChild(
            cell
          );
        }
      );

      body.appendChild(
        tr
      );
    }
  );

  table.appendChild(body);
  wrap.appendChild(table);
  root.appendChild(wrap);

  return true;
}

async function renderPreview(
  root,
  artifact,
  {
    fileStore=
      global.OvllFileStore,
    renderDocument=null,
    textClassName=
      "ovll-preview-text"
  }={}
){
  if(
    !(root instanceof Element)||
    !artifact
  ){
    return false;
  }

  const hydrated=
    await hydratePreview(
      artifact,
      fileStore
    );

  const kind=
    previewKind(
      hydrated
    );

  if(!kind){
    return false;
  }

  clearRoot(root);

  if(kind==="html"){
    const source=
      await htmlSource(
        hydrated,
        fileStore
      );

    if(!source){
      return false;
    }

    root.classList.add(
      "is-html"
    );

    root.appendChild(
      createFrame(
        source,
        {
          title:
            hydrated.name||
            "HTML 미리보기"
        }
      )
    );

    return true;
  }

  if(kind==="image"){
    const direct=
      await directUrl(
        hydrated,
        fileStore
      );

    if(!direct.url){
      return false;
    }

    const image=
      document.createElement(
        "img"
      );

    image.src=
      direct.url;
    image.alt=
      String(
        hydrated.name||
        "이미지"
      );

    attachObjectUrl(
      image,
      direct
    );

    root.classList.add(
      "is-image"
    );

    root.appendChild(
      image
    );

    return true;
  }

  if(kind==="pdf"){
    const direct=
      await directUrl(
        hydrated,
        fileStore
      );

    if(!direct.url){
      return false;
    }

    const frame=
      document.createElement(
        "iframe"
      );

    frame.src=
      direct.url;
    frame.title=
      String(
        hydrated.name||
        "PDF 미리보기"
      );

    frame.setAttribute(
      "loading",
      "lazy"
    );

    attachObjectUrl(
      frame,
      direct
    );

    root.classList.add(
      "is-pdf"
    );

    root.appendChild(
      frame
    );

    return true;
  }

  const text=
    await semanticText(
      hydrated,
      fileStore
    );

  if(!text){
    return false;
  }

  const format=
    previewFormat(
      hydrated
    );

  if(kind==="spreadsheet"){
    const rows=
      parseDelimitedRows(
        text,
        format
      );

    if(
      renderSpreadsheet(
        root,
        rows
      )
    ){
      root.classList.add(
        "is-spreadsheet"
      );
      return true;
    }
  }

  if(
    kind==="document"&&
    typeof renderDocument===
      "function"
  ){
    const documentRoot=
      document.createElement(
        "div"
      );

    root.classList.add(
      "is-document"
    );

    renderDocument(
      documentRoot,
      text,
      hydrated
    );

    root.appendChild(
      documentRoot
    );

    return true;
  }

  const pre=
    document.createElement(
      "pre"
    );

  pre.className=
    String(
      textClassName||
      "ovll-preview-text"
    );

  let visibleText=
    text;
  let truncated=
    false;

  if(
    kind==="code"||
    kind==="spreadsheet"
  ){
    const lines=
      text.split("\n");

    if(lines.length>500){
      visibleText=
        lines
          .slice(0,500)
          .join("\n");
      truncated=true;
    }

    if(visibleText.length>40000){
      visibleText=
        visibleText.slice(
          0,
          40000
        );
      truncated=true;
    }
  }

  pre.textContent=
    visibleText;

  root.classList.add(
    kind==="code"
      ?"is-code"
      :"is-text"
  );

  root.appendChild(pre);

  if(truncated){
    const note=
      document.createElement(
        "div"
      );

    note.className=
      "ovll-preview-code-note";

    note.textContent=
      "미리보기는 일부만 표시 중";

    root.appendChild(note);
  }

  return true;
}

global.OvllPreviewEngine=
  Object.freeze({
    canPreview,
    kind:previewKind,
    render:renderPreview
  });

global.OvllPreviewSandbox=
  Object.freeze({
    createFrame,
    createFrameFromBlob,
    injectPolicy
  });

})(window);
