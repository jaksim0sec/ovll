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

function injectPolicy(source){
  const parser=
    new DOMParser();

  const doc=
    parser.parseFromString(
      String(source||""),
      "text/html"
    );

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
    document.createElement("iframe");

  frame.className=
    [
      "ovll-sandbox-frame",
      String(className||"")
    ]
      .filter(Boolean)
      .join(" ");

  frame.title=
    String(title||"HTML 미리보기");

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
    mime.startsWith(
      "text/"
    )||
    [
      "TXT",
      "MD",
      "JSON",
      "CSV",
      "RTF",
      "XML",
      "JS",
      "CSS",
      "DOC",
      "DOCX"
    ].includes(format)
  ){
    return "text";
  }

  return "";
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

  return !!(
    artifact.previewText||
    artifact.previewUrl||
    artifact.downloadUrl||
    artifact.localFileId||
    artifact.id
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
          ...artifact,
          ...local,
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

async function previewText(
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
      return await blob.text();
    }catch{}
  }

  const direct=
    String(
      artifact?.previewText||
      ""
    );

  if(direct){
    return direct;
  }

  return fetchText(
    artifact?.previewUrl||
    artifact?.downloadUrl
  );
}

async function renderPreview(
  root,
  artifact,
  {
    fileStore=
      global.OvllFileStore,
    renderDocument=null,
    textClassName="ovll-preview-text"
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

  root.replaceChildren();

  if(kind==="html"){
    const source=
      await previewText(
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
    const url=
      String(
        hydrated.previewUrl||
        hydrated.downloadUrl||
        ""
      );

    if(!url){
      return false;
    }

    const image=
      document.createElement(
        "img"
      );

    image.src=url;
    image.alt=
      String(
        hydrated.name||
        "이미지"
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
    const url=
      String(
        hydrated.previewUrl||
        hydrated.downloadUrl||
        ""
      );

    if(!url){
      return false;
    }

    const frame=
      document.createElement(
        "iframe"
      );

    frame.src=url;
    frame.title=
      String(
        hydrated.name||
        "PDF 미리보기"
      );

    frame.setAttribute(
      "loading",
      "lazy"
    );

    root.appendChild(
      frame
    );

    return true;
  }

  const text=
    await previewText(
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

  if(
    typeof renderDocument===
      "function"&&
    [
      "MD",
      "DOC",
      "DOCX",
      "RTF"
    ].includes(format)
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

  const codeFormats=
    new Set([
      "JS",
      "CSS",
      "JSON",
      "XML",
      "CSV"
    ]);

  const isCode=
    codeFormats.has(
      format
    );

  const pre=
    document.createElement(
      "pre"
    );

  pre.className=
    String(
      textClassName||
      "ovll-preview-text"
    );

  let visibleText=text;
  let truncated=false;

  if(isCode){
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
    "is-text"
  );

  if(isCode){
    root.classList.add(
      "is-code"
    );
  }

  root.appendChild(
    pre
  );

  if(truncated){
    const note=
      document.createElement(
        "div"
      );

    note.className=
      "ovll-library-preview-code-note";

    note.textContent=
      "미리보기는 일부만 표시 중";

    root.appendChild(
      note
    );
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
