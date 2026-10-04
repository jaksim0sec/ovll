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
  const html=
    String(source||"");

  const guard=
    `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP.replace(/"/g,"&quot;")}"><meta name="referrer" content="no-referrer">`;

  if(/<head[\s>]/i.test(html)){
    return html.replace(
      /<head([^>]*)>/i,
      match=>match+guard
    );
  }

  if(/<html[\s>]/i.test(html)){
    return html.replace(
      /<html([^>]*)>/i,
      match=>match+"<head>"+guard+"</head>"
    );
  }

  return "<!doctype html><html><head>"+
    guard+
    "</head><body>"+
    html+
    "</body></html>";
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

global.OvllPreviewSandbox=
  Object.freeze({
    createFrame,
    createFrameFromBlob,
    injectPolicy
  });

})(window);
