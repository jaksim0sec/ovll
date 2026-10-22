import { createAppShell } from './shell/appShell.js';
import { createThemeSettings } from './settings/theme.js';
import { createPageHost } from './shell/pageHost.js';
import { createInputManager } from './input/inputManager.js';
import { createLocalDataStore } from './data/localDataStore.js';
import { createHostedSlides } from './shell/hostedSlides.js';
import { createWorkspace } from './workspace/controller.js';
import { createRequestBridge } from './workspace/requestBridge.js';
import { createLibraryPage } from './library/controller.js';

const root=document.querySelector('#app');
const status=document.querySelector('#boot-status');
const lifetime=new AbortController();
let input,theme,releaseTheme,data,shell,pages,hosted,workspaceController,libraryController,requestBridge;
let disposed=false,closePromise=null;
const validPages=new Set(['workspace','library']);
let applyingRoute=true;
function readRoute(){
  const params=new URLSearchParams(window.location.search);
  return {page:validPages.has(params.get('page'))?params.get('page'):'workspace',slide:params.get('slide')};
}
function writeRoute({replace=false}={}){
  if(applyingRoute)return;
  const page=pages?.getActivePage(),slide=hosted?.getCurrentSlide();
  if(!page||!slide)return;
  const url=new URL(window.location.href);
  if(url.searchParams.get('page')===page && url.searchParams.get('slide')===slide)return;
  url.searchParams.set('page',page);
  url.searchParams.set('slide',slide);
  window.history[replace?'replaceState':'pushState'](window.history.state,'',url);
}
function applyRoute(){
  const {page,slide}=readRoute();
  applyingRoute=true;
  try{
    input.cancel('route-change');
    hosted?.cancel('route-change');
    pages.activate(page);
    const target=slide&&hosted.hasSlide(slide)?slide:hosted.getFirstSlide();
    if(target)hosted.goTo(target,{immediate:true});
  }finally{applyingRoute=false;}
}
function destroy(){
  if(disposed)return closePromise ?? Promise.resolve();
  disposed=true;
  lifetime.abort();
  // A failing page leave hook must not leak the remaining application owners.
  for(const [name,dispose] of [
    ['pages',()=>pages?.destroy()],
    ['hosted',()=>hosted?.destroy()],
    ['shell',()=>shell?.destroy()],
    ['input',()=>input?.destroy()],
    ['request bridge',()=>requestBridge?.destroy()],
    ['workspace',()=>workspaceController?.destroy()],
    ['library',()=>libraryController?.destroy()],
    ['theme listener',()=>releaseTheme?.()],
    ['theme',()=>theme?.destroy()]
  ]){
    try{dispose();}catch(error){console.error(`Ovll ${name} cleanup failed`,error);}
  }
  // Page deactivation / Canvas destroy may commit a final buffered textarea edit.
  // Read the save queue only after those owners have completed their cleanup.
  let writes;
  try{writes=workspaceController?.flush();}catch(error){console.error('Workspace flush failed',error);}
  closePromise=Promise.resolve(writes).catch(error=>{
    console.error('Workspace pending save failed',error);
  }).then(()=>{
    try{data?.destroy();}catch(error){console.error('Local data cleanup failed',error);}
  });
  return closePromise;
}
try{
  input=createInputManager();
  theme=createThemeSettings();
  const themeSelect=root.querySelector('[data-theme-select]');
  themeSelect.value=theme.getTheme();
  themeSelect.addEventListener('change',()=>theme.setTheme(themeSelect.value),{signal:lifetime.signal});
  releaseTheme=theme.subscribe(value=>{themeSelect.value=value;});
  data=createLocalDataStore();
  pages=createPageHost({element:document.querySelector('#page-host'),onChange:id=>{shell.setActivePage(id);if(id)writeRoute();}});
  shell=createAppShell({element:root,onNavigate:id=>{input.cancel('page-change');hosted.cancel('page-change');pages.activate(id)},onMenuOpen:()=>{input.cancel('menu-open');hosted?.cancel('menu-open');workspaceController?.closeTransientUI()}});
  hosted=createHostedSlides({pillHost:root.querySelector('[data-hosted-pill]'),stationaryHost:root.querySelector('[data-hosted-stationary]'),input,onLayout:mode=>shell.setPresentationMode(mode),onPillVisibilityChange:visible=>shell.setHostedPillVisible(visible),onSlideChange:()=>writeRoute(),onSwipePastStart:()=>{if(!shell.getMenuOpen())shell.setMenuOpen(true)},isBlocked:()=>shell.isModalOpen()});
  const workspace=document.querySelector('#workspace-template').content.firstElementChild.cloneNode(true);
  requestBridge=createRequestBridge({
    onRecords:records=>workspaceController?.setConfirmedChatRecords(records),
    onActivities:items=>workspaceController?.setRequestActivities(items),
    onAccepted:()=>{try{if(hosted?.hasSlide('chat'))hosted.goTo('chat');}catch(error){console.warn('Unable to show chat slide',error);}}
  });
  workspaceController=await createWorkspace({
    root:workspace,data,input,
    onSubmitRequest:draft=>requestBridge.submit({
      draft,roomId:workspaceController.getRoomId(),dataAccess:workspaceController.getDataAccess()
    })
  });
  pages.register('workspace',{element:workspace,onEnter:({signal})=>{
    const controller=hosted.activateForPage({...workspaceController.getPresentation(),signal});
    workspaceController.activate({signal,controller});
  },onLeave:()=>workspaceController.deactivate()});
  libraryController=createLibraryPage();
  const library=libraryController.element;
  const librarySlide=document.createElement('div');librarySlide.className='library-slide';
  librarySlide.append(library.firstElementChild);
  pages.register('library',{element:library,onEnter:({signal})=>{
    hosted.activateForPage({root:library,layout:'stacked',pill:{visible:false},slides:[{id:'library',label:'라이브러리',element:librarySlide}],signal});
  }});
  root.hidden=false;
  applyRoute();
  writeRoute({replace:true});
  status.hidden=true;
  window.addEventListener('popstate',()=>{applyRoute();writeRoute({replace:true});},{signal:lifetime.signal});
  window.addEventListener('pagehide',event=>{
    if(event.persisted){input.cancel('page-hidden');hosted.cancel('page-hidden');workspaceController.closeTransientUI()}
    else destroy();
  },{signal:lifetime.signal});
}catch(error){
  void destroy();root.hidden=true;status.hidden=false;
  status.textContent='Ovll을 불러오지 못했습니다. 새로고침해 주세요.';
  console.error('Ovll initialization failed',error);
}
