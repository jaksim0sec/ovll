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

global.OvllPreviewSandbox=
  Object.freeze({
    createFrame,
    createFrameFromBlob,
    injectPolicy
  });

})(window);
