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

const NODE_ICONS=Object.freeze({
  start:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.2" stroke="currentColor" stroke-width="1.55"/>
      <path d="M8.45 7.55c0-.58.64-.92 1.12-.6l3.38 2.22c.42.28.42.9 0 1.18l-3.38 2.22c-.48.32-1.12-.02-1.12-.6V7.55Z" fill="currentColor"/>
    </svg>
  `,
  research:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.2" stroke="currentColor" stroke-width="1.55"/>
      <path d="M4.2 10h11.6M10 3.8c1.48 1.72 2.25 3.79 2.25 6.2S11.48 14.48 10 16.2M10 3.8C8.52 5.52 7.75 7.59 7.75 10s.77 4.48 2.25 6.2" stroke="currentColor" stroke-width="1.42" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  organize:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.7" y="3.7" width="12.6" height="12.6" rx="3" stroke="currentColor" stroke-width="1.5"/>
      <rect x="6.05" y="6.15" width="7.9" height="1.8" rx=".9" fill="currentColor"/>
      <rect x="6.05" y="9.1" width="5.4" height="1.8" rx=".9" fill="currentColor"/>
      <rect x="6.05" y="12.05" width="6.65" height="1.8" rx=".9" fill="currentColor"/>
    </svg>
  `,
  judge:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.2" stroke="currentColor" stroke-width="1.55"/>
      <path d="M6.8 10.15 9 12.3l4.3-4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  write:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4.15" y="3.8" width="9.2" height="12.4" rx="2.3" stroke="currentColor" stroke-width="1.45"/>
      <path d="M7.7 14.15 13.9 7.95" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"/>
      <path d="m13.2 7.25 1.55 1.55" stroke="currentColor" stroke-width="2.15" stroke-linecap="round"/>
    </svg>
  `,
  file:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.45 3.65h5.2l3.9 3.9v7.05a1.75 1.75 0 0 1-1.75 1.75H5.45A1.75 1.75 0 0 1 3.7 14.6V5.4a1.75 1.75 0 0 1 1.75-1.75Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M10.65 3.65v2.9a1 1 0 0 0 1 1h2.9M6.8 10.4h4.9M6.8 12.95h3.65" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  createFile:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3.55c.43 3.2 2.65 5.42 5.85 5.85.75.1.75 1.1 0 1.2-3.2.43-5.42 2.65-5.85 5.85-.1.75-1.1.75-1.2 0-.43-3.2-2.65-5.42-5.85-5.85-.75-.1-.75-1.1 0-1.2 3.2-.43 5.42-2.65 5.85-5.85.1-.75 1.1-.75 1.2 0Z" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/>
    </svg>
  `
});

function get(name){
  return ICONS[String(name||"")]||"";
}

function has(name){
  return Object.prototype.hasOwnProperty.call(
    ICONS,
    String(name||"")
  );
}

function getNodeIcon(type){
  return NODE_ICONS[String(type||"")]||"";
}

function hasNodeIcon(type){
  return Object.prototype.hasOwnProperty.call(
    NODE_ICONS,
    String(type||"")
  );
}

global.OvllSvgLibrary=Object.freeze({
  get,
  has,
  getNodeIcon,
  hasNodeIcon,
  icons:ICONS,
  nodeIcons:NODE_ICONS
});

})(window);
