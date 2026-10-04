(function(global){
"use strict";

function format(
  artifact
){
  const direct=
    String(
      artifact?.format||""
    ).trim();

  if(direct){
    return direct.toUpperCase();
  }

  const name=
    String(
      artifact?.name||""
    );

  const dot=
    name.lastIndexOf(".");

  return dot>0
    ?name
      .slice(dot+1)
      .toUpperCase()
    :"FILE";
}

function formatSize(
  value
){
  const size=
    Number(value||0);

  if(size<1024){
    return `${size} B`;
  }

  if(size<1048576){
    return `${(size/1024).toFixed(1)} KB`;
  }

  return `${(size/1048576).toFixed(1)} MB`;
}

function visual(
  artifact
){
  const fileFormat=
    format(artifact);

  const mime=
    String(
      artifact?.mime||""
    ).toLowerCase();

  if(
    fileFormat==="PDF"||
    mime.includes(
      "application/pdf"
    )
  ){
    return{
      kind:"pdf",
      color:"#e36f63",
      icon:`
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3.15" y="3.15" width="13.7" height="13.7" rx="3.5" stroke="currentColor" stroke-width="1.45"/>
          <text x="10" y="11.35" text-anchor="middle" fill="currentColor" font-size="4.15" font-weight="800" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" letter-spacing="-.16">PDF</text>
        </svg>
      `
    };
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
    ].includes(fileFormat)
  ){
    return{
      kind:"image",
      color:"#65a978",
      icon:`
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3.15" y="3.15" width="13.7" height="13.7" rx="3.5" stroke="currentColor" stroke-width="1.45"/>
          <circle cx="7.15" cy="7.45" r="1.05" fill="currentColor"/>
          <path d="m5.15 13.95 3.05-3.1 2.25 2.05 1.45-1.45 2.95 2.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `
    };
  }

  if(
    mime.startsWith(
      "text/"
    )||
    [
      "TXT",
      "MD",
      "DOC",
      "DOCX",
      "RTF",
      "HTML",
      "HTM",
      "CSV",
      "JSON",
      "XML",
      "JS",
      "CSS"
    ].includes(fileFormat)
  ){
    return{
      kind:"text",
      color:"#5d8fd8",
      icon:`
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3.15" y="3.15" width="13.7" height="13.7" rx="3.5" stroke="currentColor" stroke-width="1.45"/>
          <path d="M6.25 7.25h7.5M6.25 10h7.5M6.25 12.75h5.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>
        </svg>
      `
    };
  }

  return{
    kind:"file",
    color:"#8b7fd1",
    icon:`
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5 2.8h5.9l4.1 4.05V17.2H5V2.8Z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>
        <path d="M10.75 2.8v4.25H15" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
      </svg>
    `
  };
}


const DOWNLOAD_ICON =
  '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true">' +
  '<path d="M9 3.1v7m0 0 2.45-2.45M9 10.1 6.55 7.65M4.2 13.55h9.6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

function createCard(
  artifact,
  {
    tagName="a",
    className="",
    metaText="",
    action="download",
    inlinePreview=true
  }={}
){
  const visualValue=
    visual(artifact);

  const isButton=
    String(tagName)
      .toLowerCase()===
      "button";

  const card=
    document.createElement(
      isButton
        ?"button"
        :"a"
    );

  if(isButton){
    card.type="button";
  }else{
    card.href=
      String(
        artifact?.downloadUrl||
        "#"
      );

    card.download=
      String(
        artifact?.name||
        "result"
      );
  }

  card.className=
    [
      "astra-artifact-card",
      "astra-artifact-"+visualValue.kind,
      String(className||"")
    ]
      .filter(Boolean)
      .join(" ");

  card.style.setProperty(
    "--artifact-accent",
    visualValue.color
  );

  const icon=
    document.createElement(
      "span"
    );

  icon.className=
    "astra-artifact-icon";

  icon.innerHTML=
    visualValue.icon;

  const info=
    document.createElement(
      "span"
    );

  info.className=
    "astra-artifact-info";

  const name=
    document.createElement(
      "span"
    );

  name.className=
    "astra-artifact-name";

  name.textContent=
    String(
      artifact?.name||
      "결과물"
    );

  const meta=
    document.createElement(
      "span"
    );

  meta.className=
    "astra-artifact-meta";

  meta.textContent=
    String(
      metaText||
      [
        format(artifact),
        formatSize(
          artifact?.size
        )
      ]
        .filter(Boolean)
        .join(" · ")
    );

  info.append(
    name,
    meta
  );

  let actionNode=null;

  if(action==="download"){
    actionNode=
      document.createElement(
        "span"
      );

    actionNode.className=
      "astra-artifact-download";

    actionNode.innerHTML=
      DOWNLOAD_ICON;
  }else if(action==="format"){
    actionNode=
      document.createElement(
        "span"
      );

    actionNode.className=
      "ovll-library-card-format";

    actionNode.textContent=
      format(artifact);
  }

  const inline=
    document.createElement(
      "span"
    );

  inline.className=
    "astra-artifact-inline-preview";

  if(inlinePreview){
    const inlineText=
      String(
        artifact?.previewText||
        ""
      )
        .trim()
        .slice(
          0,
          520
        );

    if(
      visualValue.kind===
        "image"&&
      artifact?.previewUrl
    ){
      const image=
        document.createElement(
          "img"
        );

      image.src=
        String(
          artifact.previewUrl
        );

      image.alt="";

      inline.classList.add(
        "is-image"
      );

      inline.appendChild(
        image
      );
    }else if(inlineText){
      inline.classList.add(
        "is-text"
      );

      inline.textContent=
        inlineText;
    }
  }

  card.append(
    icon,
    info
  );

  if(actionNode){
    card.appendChild(
      actionNode
    );
  }

  if(
    inline.childNodes.length||
    inline.textContent
  ){
    card.classList.add(
      "has-inline-preview"
    );

    card.appendChild(
      inline
    );
  }

  return{
    element:card,
    action:actionNode,
    visual:visualValue
  };
}

global.OvllArtifactVisuals=
  Object.freeze({
    format,
    formatSize,
    visual,
    createCard
  });

})(window);
