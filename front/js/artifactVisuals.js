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

function framedIcon(
  body
){
  return `
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.15" y="3.15" width="13.7" height="13.7" rx="3.5" stroke="currentColor" stroke-width="1.45"/>
      ${body}
    </svg>
  `;
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
      icon:framedIcon(
        '<text x="10" y="11.35" text-anchor="middle" fill="currentColor" font-size="4.15" font-weight="800" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif" letter-spacing="-.16">PDF</text>'
      )
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
      "SVG",
      "AVIF",
      "HEIC",
      "HEIF",
      "BMP",
      "ICO"
    ].includes(fileFormat)
  ){
    return{
      kind:"image",
      color:"#65a978",
      icon:framedIcon(
        '<circle cx="7.15" cy="7.45" r="1.05" fill="currentColor"/>'+
        '<path d="m5.15 13.95 3.05-3.1 2.25 2.05 1.45-1.45 2.95 2.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    [
      "HTML",
      "HTM"
    ].includes(fileFormat)||
    mime.includes(
      "text/html"
    )
  ){
    return{
      kind:"html",
      color:"#df7b4f",
      icon:framedIcon(
        '<path d="m8.15 6.8-3 3.2 3 3.2M11.85 6.8l3 3.2-3 3.2M10.9 5.9 9.1 14.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    [
      "DOC",
      "DOCX",
      "RTF",
      "ODT",
      "PAGES"
    ].includes(fileFormat)||
    mime.includes(
      "wordprocessingml"
    )||
    mime.includes(
      "msword"
    )
  ){
    return{
      kind:"document",
      color:"#5d86d8",
      icon:framedIcon(
        '<path d="M6.1 6.5h7.8M6.1 9.1h7.8M6.1 11.7h5.8M6.1 14.3h4.1" stroke="currentColor" stroke-width="1.28" stroke-linecap="round"/>'
      )
    };
  }

  if(
    [
      "XLS",
      "XLSX",
      "CSV",
      "TSV",
      "ODS",
      "NUMBERS"
    ].includes(fileFormat)||
    mime.includes(
      "spreadsheet"
    )||
    mime.includes(
      "excel"
    )
  ){
    return{
      kind:"spreadsheet",
      color:"#52a56e",
      icon:framedIcon(
        '<path d="M5.65 6.05h8.7v7.9h-8.7zM5.65 8.7h8.7M5.65 11.35h8.7M8.55 6.05v7.9M11.45 6.05v7.9" stroke="currentColor" stroke-width="1.12" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    [
      "PPT",
      "PPTX",
      "ODP",
      "KEY"
    ].includes(fileFormat)||
    mime.includes(
      "presentation"
    )||
    mime.includes(
      "powerpoint"
    )
  ){
    return{
      kind:"presentation",
      color:"#d77b4d",
      icon:framedIcon(
        '<path d="M5.8 6.25h8.4v5.7H5.8zM10 11.95v2M7.8 14h4.4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>'+
        '<path d="m9.1 7.45 2.55 1.65-2.55 1.65v-3.3Z" fill="currentColor"/>'
      )
    };
  }

  if(
    [
      "ZIP",
      "RAR",
      "7Z",
      "TAR",
      "GZ",
      "TGZ",
      "BZ2",
      "XZ"
    ].includes(fileFormat)||
    mime.includes(
      "zip"
    )||
    mime.includes(
      "compressed"
    )||
    mime.includes(
      "archive"
    )
  ){
    return{
      kind:"archive",
      color:"#c4974f",
      icon:framedIcon(
        '<path d="M6 7.1h8v6.8H6zM7.1 5.3h5.8v1.8M10 7.1v6.8M9.2 8.2h1.6M9.2 10h1.6M9.2 11.8h1.6" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    mime.startsWith(
      "audio/"
    )||
    [
      "MP3",
      "WAV",
      "M4A",
      "AAC",
      "FLAC",
      "OGG",
      "OPUS"
    ].includes(fileFormat)
  ){
    return{
      kind:"audio",
      color:"#9974cf",
      icon:framedIcon(
        '<path d="M8.4 13.7V7.05l5-1.1v6.55M8.4 9.2l5-1.1" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'+
        '<circle cx="6.8" cy="13.7" r="1.6" fill="currentColor"/><circle cx="11.8" cy="12.5" r="1.6" fill="currentColor"/>'
      )
    };
  }

  if(
    mime.startsWith(
      "video/"
    )||
    [
      "MP4",
      "MOV",
      "WEBM",
      "MKV",
      "AVI",
      "M4V",
      "MPEG",
      "MPG"
    ].includes(fileFormat)
  ){
    return{
      kind:"video",
      color:"#579eb7",
      icon:framedIcon(
        '<path d="M6 6.45h8v7.1H6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'+
        '<path d="m9 8.1 3.15 1.9L9 11.9V8.1Z" fill="currentColor"/>'
      )
    };
  }

  if(
    [
      "JSON",
      "XML",
      "JS",
      "MJS",
      "CJS",
      "TS",
      "TSX",
      "JSX",
      "CSS",
      "SCSS",
      "SASS",
      "LESS",
      "PY",
      "JAVA",
      "C",
      "CPP",
      "H",
      "HPP",
      "GO",
      "RS",
      "PHP",
      "RB",
      "SWIFT",
      "KT",
      "KTS",
      "SH",
      "BASH",
      "ZSH",
      "PS1",
      "SQL",
      "YAML",
      "YML",
      "TOML",
      "INI"
    ].includes(fileFormat)
  ){
    return{
      kind:"code",
      color:"#8977cf",
      icon:framedIcon(
        '<path d="m8.1 6.7-3 3.3 3 3.3M11.9 6.7l3 3.3-3 3.3" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    [
      "TTF",
      "OTF",
      "WOFF",
      "WOFF2"
    ].includes(fileFormat)||
    mime.includes(
      "font"
    )
  ){
    return{
      kind:"font",
      color:"#738da8",
      icon:framedIcon(
        '<path d="M6.2 14 10 5.8 13.8 14M7.5 11.2h5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    fileFormat==="EPUB"||
    mime.includes(
      "epub"
    )
  ){
    return{
      kind:"ebook",
      color:"#9a8356",
      icon:framedIcon(
        '<path d="M5.65 6.1c1.55-.45 2.9-.25 4.35.65v7.15c-1.45-.9-2.8-1.1-4.35-.65V6.1Zm8.7 0c-1.55-.45-2.9-.25-4.35.65v7.15c1.45-.9 2.8-1.1 4.35-.65V6.1Z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/>'
      )
    };
  }

  if(
    mime.startsWith(
      "text/"
    )||
    [
      "TXT",
      "MD",
      "LOG"
    ].includes(fileFormat)
  ){
    return{
      kind:"text",
      color:"#5d8fd8",
      icon:framedIcon(
        '<path d="M6.25 7.25h7.5M6.25 10h7.5M6.25 12.75h5.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/>'
      )
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
