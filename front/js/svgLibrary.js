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
      <circle cx="10" cy="10" r="6.35" fill="currentColor"/>
      <path d="m8.45 7.35 4.15 2.65-4.15 2.65Z" fill="var(--node)"/>
    </svg>
  `,
  research:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M8.55 3.35a5.2 5.2 0 1 0 3.24 9.27l2.9 2.9a.92.92 0 0 0 1.3-1.3l-2.9-2.9a5.2 5.2 0 0 0-4.68-7.83Zm0 1.58a3.62 3.62 0 1 0 0 7.24 3.62 3.62 0 0 0 0-7.24Z"/>
    </svg>
  `,
  organize:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3.7" y="4.1" width="12.6" height="3.05" rx="1.525" fill="currentColor"/>
      <rect x="3.7" y="8.48" width="8.85" height="3.05" rx="1.525" fill="currentColor"/>
      <rect x="3.7" y="12.85" width="10.65" height="3.05" rx="1.525" fill="currentColor"/>
    </svg>
  `,
  judge:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="6.35" fill="currentColor"/>
      <path d="m6.85 10.15 2.05 2.05 4.28-4.45" stroke="var(--node)" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  write:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M10 2.9c.44 0 .85.21 1.12.56l4.2 5.58c.35.47.39 1.1.09 1.61l-4.18 6.9c-.56.92-1.9.92-2.46 0l-4.18-6.9a1.5 1.5 0 0 1 .09-1.61l4.2-5.58c.27-.35.68-.56 1.12-.56Zm0 4.2a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Zm-.46 2.1h.92v6.05h-.92V9.2Z"/>
    </svg>
  `,
  file:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5.15 3.25h5.45l4.25 4.25v7.2a2.05 2.05 0 0 1-2.05 2.05H5.15A2.05 2.05 0 0 1 3.1 14.7V5.3a2.05 2.05 0 0 1 2.05-2.05Z" fill="currentColor"/>
      <path d="M10.6 3.25v2.72c0 .84.69 1.53 1.53 1.53h2.72M6.4 10.45h5.25M6.4 13h3.9" stroke="var(--node)" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `,
  createFile:`
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3.25c.45 3.36 2.79 5.7 6.15 6.15.8.11.8 1.19 0 1.3-3.36.45-5.7 2.79-6.15 6.15-.11.8-1.19.8-1.3 0-.45-3.36-2.79-5.7-6.15-6.15-.8-.11-.8-1.19 0-1.3 3.36-.45 5.7-2.79 6.15-6.15.11-.8 1.19-.8 1.3 0Z" fill="currentColor"/>
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
