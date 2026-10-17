import { createAppShell } from './shell/appShell.js';
import { createThemeSettings } from './settings/theme.js';
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
const theme=createThemeSettings();
const themeSelect=root.querySelector('[data-theme-select]');
themeSelect.value=theme.getTheme();
themeSelect.addEventListener('change',()=>theme.setTheme(themeSelect.value),{signal:lifetime.signal});
const releaseTheme=theme.subscribe(value=>{themeSelect.value=value;});
const data=createLocalDataStore(); // existing data adapter: not used by fixture
let shell,pages,hosted,fixture;
function destroy(){
  lifetime.abort();
  try{pages?.destroy()}finally{
    hosted?.destroy();shell?.destroy();input.destroy();data.destroy();fixture?.destroy();releaseTheme();theme.destroy();
  }
}
try{
  pages=createPageHost({element:document.querySelector('#page-host'),onChange:id=>shell.setActivePage(id)});
  shell=createAppShell({element:root,onNavigate:id=>{input.cancel('page-change');hosted.cancel('page-change');pages.activate(id)},onMenuOpen:()=>{input.cancel('menu-open');hosted?.cancel('menu-open')}});
  hosted=createHostedSlides({pillHost:root.querySelector('[data-hosted-pill]'),stationaryHost:root.querySelector('[data-hosted-stationary]'),input,onLayout:mode=>shell.setPresentationMode(mode),onPillVisibilityChange:visible=>shell.setHostedPillVisible(visible),isBlocked:()=>shell.isModalOpen()});
  const workspace=document.querySelector('#workspace-template').content.firstElementChild.cloneNode(true);
  fixture=mountUiTest({workspace,theme});
  pages.register('workspace',{element:workspace,onEnter:({signal})=>fixture.setController(hosted.activateForPage({...fixture.getPresentation(),signal})),onLeave:()=>{fixture.setController(null)}});
  const library=document.querySelector('#library-template').content.firstElementChild.cloneNode(true);
  const libraryContent=library.querySelector('.library-demo-inner');
  const librarySlide=document.createElement('div');
  librarySlide.className='demo-library-slide';
  librarySlide.append(libraryContent);
  pages.register('library',{element:library,onEnter:({signal})=>{
    hosted.activateForPage({root:library,layout:'stacked',pill:{visible:false},slides:[{id:'library',label:'라이브러리',element:librarySlide}],signal});
  }});
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
