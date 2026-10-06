(function(global){
"use strict";

const ICONS=Object.freeze({
  nodeAdd:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect x="4.25" y="4.25" width="11.5" height="11.5" rx="3.6"></rect>
      <path d="M10 7.15v5.7M7.15 10h5.7"></path>
    </svg>
  `,
  canvasReset:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M6.35 6.15A5.35 5.35 0 1 1 5.25 12.8"></path>
      <path d="M6.35 3.95v2.2h2.2"></path>
    </svg>
  `,
  canvasLayout:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect x="7.55" y="3.3" width="4.9" height="3.6" rx="1.55"></rect>
      <rect x="3.3" y="13.1" width="4.9" height="3.6" rx="1.55"></rect>
      <rect x="11.8" y="13.1" width="4.9" height="3.6" rx="1.55"></rect>
      <path d="M10 6.9v3.1M5.75 13.1V10h8.5v3.1"></path>
    </svg>
  `,
  messageCopy:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <rect x="7" y="7" width="8" height="8" rx="2.2"></rect><path d="M5.2 12.7H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.7a2 2 0 0 1 2 2v.2"></path>
    </svg>
  `,
  messageRetry:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M15.1 7.2A6 6 0 1 0 15.5 12"></path><path d="M15.1 3.8v3.4h-3.4"></path>
    </svg>
  `,
  composerSend:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M6.35 8.75 10 5.1l3.65 3.65" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="M10 5.35v9.55" stroke="currentColor" stroke-width="1.55" stroke-linecap="round"></path>
    </svg>
  `
});

function get(name){
  return ICONS[
    String(name||"")
  ]||"";
}

function has(name){
  return Object.prototype
    .hasOwnProperty.call(
      ICONS,
      String(name||"")
    );
}

global.OvllSvgLibrary=
  Object.freeze({
    get,
    has,
    icons:ICONS
  });

})(window);
