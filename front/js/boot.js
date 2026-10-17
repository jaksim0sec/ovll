import { createAppShell } from './shell/appShell.js';
import { createPageHost } from './shell/pageHost.js';
import { createInputManager } from './input/inputManager.js';
import { createLocalDataStore } from './data/localDataStore.js';
import { createHostedSlides } from './shell/hostedSlides.js';
// TEMPORARY BETA ONLY: remove when actual Workspace is implemented.
import { mountUiTest } from './dev/uiTest.js';

const root=document.querySelector('#app');
const status=document.querySelector('#boot-status');
const lifetime=new AbortController();
const input=createInputManager();
const data=createLocalDataStore(); // existing data adapter: not used by fixture
let shell,pages,hosted,fixture;
function destroy(){
  lifetime.abort();
  try{pages?.destroy()}finally{
    hosted?.destroy();shell?.destroy();input.destroy();data.destroy();fixture?.destroy();
  }
}
try{
  pages=createPageHost({element:document.querySelector('#page-host'),onChange:id=>shell.setActivePage(id)});
  shell=createAppShell({element:root,onNavigate:id=>{input.cancel('page-change');hosted.cancel('page-change');pages.activate(id)},onMenuOpen:()=>{input.cancel('menu-open');hosted?.cancel('menu-open')}});
  hosted=createHostedSlides({pillHost:root.querySelector('[data-hosted-pill]'),stationaryHost:root.querySelector('[data-hosted-stationary]'),input,onLayout:mode=>shell.setPresentationMode(mode),isBlocked:()=>shell.isModalOpen()});
  const workspace=document.querySelector('#workspace-template').content.firstElementChild.cloneNode(true);
  fixture=mountUiTest({workspace});
  pages.register('workspace',{element:workspace,onEnter:({signal})=>fixture.setController(hosted.activateForPage({...fixture.getPresentation(),signal})),onLeave:()=>{fixture.setController(null)}});
  const library=document.querySelector('#library-template').content.firstElementChild.cloneNode(true);
  pages.register('library',{element:library,onEnter:()=>{shell.setPresentationMode('stacked');}});
  root.hidden=false;
  pages.activate('workspace');
  status.hidden=true;
  window.addEventListener('pagehide',event=>{
    if(event.persisted){input.cancel('page-hidden');hosted.cancel('page-hidden')}
    else destroy();
  },{signal:lifetime.signal});
}catch(error){
  destroy();root.hidden=true;status.hidden=false;
  status.textContent='Ovll을 불러오지 못했습니다. 새로고침해 주세요.';
  console.error('Ovll initialization failed',error);
}
