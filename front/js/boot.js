import { createAppShell } from './shell/appShell.js';
import { createThemeSettings } from './settings/theme.js';
import { createPageHost } from './shell/pageHost.js';
import { createInputManager } from './input/inputManager.js';
import { createLocalDataStore } from './data/localDataStore.js';
import { createHostedSlides } from './shell/hostedSlides.js';
import { createWorkspace } from './workspace/controller.js';

const root=document.querySelector('#app');
const status=document.querySelector('#boot-status');
const lifetime=new AbortController();
const input=createInputManager();
const theme=createThemeSettings();
const themeSelect=root.querySelector('[data-theme-select]');
themeSelect.value=theme.getTheme();
themeSelect.addEventListener('change',()=>theme.setTheme(themeSelect.value),{signal:lifetime.signal});
const releaseTheme=theme.subscribe(value=>{themeSelect.value=value;});
const data=createLocalDataStore();
let shell,pages,hosted,workspaceController;
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
    if(slide&&hosted.hasSlide(slide))hosted.goTo(slide,{immediate:true});
  }finally{applyingRoute=false;}
}
function destroy(){
  lifetime.abort();
  try{pages?.destroy()}finally{
    hosted?.destroy();shell?.destroy();input.destroy();workspaceController?.destroy();releaseTheme();theme.destroy();
    // Pending IDB writes finish before closing their adapter.
    Promise.resolve(workspaceController?.flush()).finally(()=>data.destroy());
  }
}
try{
  pages=createPageHost({element:document.querySelector('#page-host'),onChange:id=>{shell.setActivePage(id);if(id)writeRoute();}});
  shell=createAppShell({element:root,onNavigate:id=>{input.cancel('page-change');hosted.cancel('page-change');pages.activate(id)},onMenuOpen:()=>{input.cancel('menu-open');hosted?.cancel('menu-open');workspaceController?.closeTransientUI()}});
  hosted=createHostedSlides({pillHost:root.querySelector('[data-hosted-pill]'),stationaryHost:root.querySelector('[data-hosted-stationary]'),input,onLayout:mode=>shell.setPresentationMode(mode),onPillVisibilityChange:visible=>shell.setHostedPillVisible(visible),onSlideChange:()=>writeRoute(),onSwipePastStart:()=>{if(!shell.getMenuOpen())shell.setMenuOpen(true)},isBlocked:()=>shell.isModalOpen()});
  const workspace=document.querySelector('#workspace-template').content.firstElementChild.cloneNode(true);
  workspaceController=await createWorkspace({root:workspace,data,input});
  pages.register('workspace',{element:workspace,onEnter:({signal})=>{
    const controller=hosted.activateForPage({...workspaceController.getPresentation(),signal});
    workspaceController.activate({signal,controller});
  },onLeave:()=>workspaceController.deactivate()});
  const library=document.querySelector('#library-template').content.firstElementChild.cloneNode(true);
  const libraryContent=library.querySelector('.library-demo-inner');
  const librarySlide=document.createElement('div');
  librarySlide.className='demo-library-slide';
  librarySlide.append(libraryContent);
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
  destroy();root.hidden=true;status.hidden=false;
  status.textContent='Ovll을 불러오지 못했습니다. 새로고침해 주세요.';
  console.error('Ovll initialization failed',error);
}
