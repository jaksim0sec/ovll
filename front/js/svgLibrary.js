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
      <rect x="6.35" y="6.35" width="9.15" height="9.15" rx="2.45"></rect>
      <path d="M12.7 6.35V5.4a1.9 1.9 0 0 0-1.9-1.9H5.4a1.9 1.9 0 0 0-1.9 1.9v5.4a1.9 1.9 0 0 0 1.9 1.9h.95"></path>
    </svg>
  `,
  messageRetry:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M15.45 7.35A5.75 5.75 0 1 0 15.5 12.55"></path>
      <path d="M15.45 3.9v3.45H12"></path>
    </svg>
  `,
  composerSend:`
    <svg viewBox="0 0 20 20" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d="M10 15V5.35"></path>
      <path d="m6.35 9 3.65-3.65L13.65 9"></path>
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
