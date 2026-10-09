(function(global){
"use strict";

const VERSION_KEY="ovll:app-version";
const RELOAD_KEY="ovll:version-reload";
const VERSION_CHECK_TIMEOUT=1600;

const RUNTIME=
  global.OVLL_RUNTIME||{};

const IS_NATIVE=
  RUNTIME.native===true;

const API_ORIGIN=
  typeof RUNTIME.apiOrigin==="string"
    ?RUNTIME.apiOrigin.trim().replace(/\/+$/,"")
    :"";

function finishBoot(){
  const root=
    document.documentElement;

  const screen=
    document.querySelector(
      "#boot-screen"
    );

  root.classList.remove(
    "ovll-booting"
  );

  if(!screen){
    return;
  }

  screen.classList.add(
    "is-ready"
  );

  global.setTimeout(
    ()=>screen.remove(),
    220
  );
}

function failBoot(){
  const screen=
    document.querySelector(
      "#boot-screen"
    );

  if(screen){
    screen.classList.add(
      "is-error"
    );
  }
}

global.addEventListener(
  "ovll:app-ready",
  finishBoot,
  {once:true}
);

global.addEventListener(
  "ovll:app-error",
  failBoot,
  {once:true}
);

document
  .querySelector("#boot-retry")
  ?.addEventListener(
    "click",
    ()=>global.location.reload()
  );

function apiUrl(path){
  return `${API_ORIGIN}/api/${path}`;
}

const APP_SCRIPTS=[
  "./js/functions.js",
  "./js/fileStore.js",
  "./js/artifactVisuals.js",
  "./js/artifactRequest.js",
  "./js/svgLibrary.js",
  "./js/previewSandbox.js",
  "./js/api.js",
  "./js/vnextApi.js",
  "./js/vnextProjection.js",
  "./js/vnextGraphPatch.js",
  "./js/canvasNode.js",
  "./js/runtimeEngine.js",
  "./js/navigation.js",
  "./js/workspaceUi.js",
  "./js/ui.js",
  "./js/workspaceStore.js",
  "./js/vnextLocal.js",
  "./js/vnextFunctions.js",
  "./js/customNodeStore.js",
  "./js/customNodes.js",
  "./js/canvasNodeBuilder.js",
  "./js/ovllWorkspace.js",
  "./js/functionWorkspace.js",
  "./js/libraryPage.js",
  "./js/customNodePage.js",
  "./js/shellMenu.js",
  "./js/workspacePresence.js",
  "./js/ovllPresence.js",
  "./js/runtimeFinalization.js",
  "./js/mascot.js",
  "./js/app.js"
];

async function getServerVersion(){
  const controller=
    new AbortController();

  const timeout=
    global.setTimeout(
      ()=>controller.abort(),
      VERSION_CHECK_TIMEOUT
    );

  try{
    const response=
      await fetch(
        apiUrl("version"),
        {
          cache:"no-store",
          signal:
            controller.signal,
          headers:{
            Accept:"application/json"
          }
        }
      );

    if(!response.ok){
      throw new Error(
        `Version check failed: ${response.status}`
      );
    }

    const data=
      await response.json();

    const version=
      String(
        data?.version||""
      ).trim();

    if(!version){
      throw new Error(
        "Server version is empty."
      );
    }

    return version;
  }finally{
    global.clearTimeout(
      timeout
    );
  }
}

async function clearAppCaches(){
  if(!("caches" in global)){
    return;
  }

  const keys=
    await caches.keys();

  await Promise.all(
    keys.map(
      key=>caches.delete(key)
    )
  );
}

function loadScript(src){
  return new Promise(
    (resolve,reject)=>{
      const script=
        document.createElement(
          "script"
        );

      script.src=src;
      script.async=false;

      script.addEventListener(
        "load",
        ()=>resolve(),
        {once:true}
      );

      script.addEventListener(
        "error",
        ()=>reject(
          new Error(
            `Failed to load ${src}`
          )
        ),
        {once:true}
      );

      document.body.appendChild(
        script
      );
    }
  );
}

async function loadApp(){
  await Promise.all(
    APP_SCRIPTS.map(
      loadScript
    )
  );
}

async function registerServiceWorker(){
  if(IS_NATIVE){
    return;
  }

  if(!("serviceWorker" in navigator)){
    return;
  }

  try{
    const registration=
      await navigator.serviceWorker.register(
        "/sw.js",
        {
          scope:"/"
        }
      );

    registration.update?.();
  }catch(error){
    console.warn(
      "Service worker registration failed:",
      error
    );
  }
}

async function syncVersion(){
  const serverVersion=
    await getServerVersion();

  document.documentElement.dataset.serverVersion=
    serverVersion;

  if(IS_NATIVE){
    document.documentElement.dataset.appVersion=
      serverVersion;
    return true;
  }

  const localVersion=
    localStorage.getItem(
      VERSION_KEY
    );

  document.documentElement.dataset.appVersion=
    serverVersion;

  if(localVersion===serverVersion){
    if(
      sessionStorage.getItem(
        RELOAD_KEY
      )===serverVersion
    ){
      sessionStorage.removeItem(
        RELOAD_KEY
      );
    }

    return true;
  }

  if(localVersion===null){
    const cacheKeys=
      "caches" in global
        ?await caches.keys()
        :[];

    const hasLegacyCache=
      cacheKeys.some(
        key=>
          key.startsWith(
            "ovll-shell-"
          )
      );

    const hasController=
      !!navigator.serviceWorker?.controller;

    localStorage.setItem(
      VERSION_KEY,
      serverVersion
    );

    if(
      !hasLegacyCache&&
      !hasController
    ){
      return true;
    }

    await clearAppCaches();
  }else{
    localStorage.setItem(
      VERSION_KEY,
      serverVersion
    );

    await clearAppCaches();
  }

  const alreadyReloaded=
    sessionStorage.getItem(
      RELOAD_KEY
    )===serverVersion;

  if(alreadyReloaded){
    return true;
  }

  sessionStorage.setItem(
    RELOAD_KEY,
    serverVersion
  );

  global.location.reload();

  return false;
}

async function start(){
  let canStart=true;

  try{
    canStart=
      await syncVersion();
  }catch(error){
    console.warn(
      "App version check failed:",
      error
    );
  }

  if(!canStart){
    return;
  }

  await loadApp();
  await registerServiceWorker();
}

global.addEventListener(
  "beforeinstallprompt",
  ()=>{
    document.documentElement.dataset.pwaInstallable=
      "true";

    console.info(
      "[PWA] installable"
    );
  }
);

global.addEventListener(
  "appinstalled",
  ()=>{
    document.documentElement.dataset.pwaInstalled=
      "true";

    console.info(
      "[PWA] installed"
    );
  }
);

start().catch(error=>{
  console.error(
    "ovll bootstrap failed:",
    error
  );

  failBoot();
});

})(window);
