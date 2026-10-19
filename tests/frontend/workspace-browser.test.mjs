import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../../front/',import.meta.url));

test('workspace restores rich drafts and graph, owns no server traffic, survives page navigation',async()=>{
 const server=createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;if(p==='/')p='/index.html';const data=await readFile(root+p);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(data);}catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();
 const errors=[],api=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
 try{
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.getByRole('textbox',{name:'작업 입력',exact:true}).waitFor({timeout:5000});
 assert.equal(await page.locator('.canvas-block').count(),0,'main starts with an empty editable canvas');
 // Drawer surfaces finish their own motion while accessibility and input state
 // change immediately. Cancellation must return a dragged drawer to open.
 await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();
 const opening=await page.evaluate(()=>{
  const menu=document.querySelector('.shell-menu'),backdrop=document.querySelector('.shell-backdrop'),trigger=document.querySelector('[data-menu-trigger]');
  const transitions=menu.getAnimations();const moving=transitions.find(a=>a.transitionProperty==='transform');
  moving?.pause();if(moving)moving.currentTime=80;
  const fade=backdrop.getAnimations().find(a=>a.transitionProperty==='opacity');fade?.pause();if(fade)fade.currentTime=80;
  return {duration:moving?.effect.getTiming().duration,opacity:Number(getComputedStyle(backdrop).opacity),triggerHidden:trigger.hidden,triggerInert:trigger.inert,modal:menu.getAttribute('aria-modal')};
 });
 assert.equal(opening.duration,380);assert.ok(opening.opacity>0&&opening.opacity<1,'backdrop fades rather than appearing instantly');assert.equal(opening.triggerHidden,false);assert.equal(opening.triggerInert,true);assert.equal(opening.modal,'true');
 await page.evaluate(()=>document.getAnimations().forEach(a=>a.finish()));
 await page.locator('.shell-menu').evaluate(menu=>{
  menu.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:41,pointerType:'touch',button:0,clientX:260,clientY:400}));
  window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:41,pointerType:'touch',clientX:80,clientY:400}));
  window.dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:41,pointerType:'touch',clientX:80,clientY:400}));
 });
 assert.equal(await page.locator('#app').evaluate(node=>node.classList.contains('menu-open')),true,'cancelled drawer drag rolls back to open');
 await page.keyboard.press('Escape');
 const closing=await page.evaluate(()=>{
  const backdrop=document.querySelector('.shell-backdrop'),menu=document.querySelector('.shell-menu');
  return {hidden:backdrop.hidden,inert:backdrop.inert,pointerEvents:getComputedStyle(backdrop).pointerEvents,menuInert:menu.inert,focused:document.activeElement===document.querySelector('[data-menu-trigger]'),animation:menu.getAnimations().some(a=>a.transitionProperty==='transform')};
 });
 assert.deepEqual(closing,{hidden:false,inert:true,pointerEvents:'none',menuInert:true,focused:true,animation:true});
 await page.waitForFunction(()=>getComputedStyle(document.querySelector('.shell-menu')).visibility==='hidden');
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();await page.keyboard.press('Escape');
 assert.equal(await page.locator('.shell-menu').evaluate(menu=>getComputedStyle(menu).visibility),'hidden','reduced motion closes immediately');
 await page.emulateMedia({reducedMotion:'no-preference'});
 // A scrollable slide is the browser's nearest touch-action boundary. Exercise
 // trusted touches rather than synthetic pointer dispatch, which cannot cancel.
 const swipeCdp=await context.newCDPSession(page);
 async function bodySwipe(fromX,toX,y){
  await swipeCdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:fromX,y,id:1}]});
  for(let i=1;i<=8;i++){
   await swipeCdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:fromX+(toX-fromX)*i/8,y,id:1}]});
   await page.waitForTimeout(18);
  }
  await swipeCdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(400);
 }
 await bodySwipe(300,55,260);
 assert.equal(await page.locator('[data-active-slide]').getAttribute('data-active-slide'),'canvas','chat body must swipe into a canvas that refuses swipe initiation');
 await bodySwipe(55,300,600);
 assert.equal(await page.locator('[data-active-slide]').getAttribute('data-active-slide'),'canvas','canvas body owns pan and must not initiate a slide swipe');
 await page.getByRole('tab',{name:'채팅',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.hosted-viewport').classList.contains('is-dragging'));

 const composerBox=await page.locator('.workspace-composer').boundingBox();assert.ok(composerBox.x>=8 && composerBox.x+composerBox.width<=382,'composer keeps the main-style mobile side gutters');
 const editor=page.getByRole('textbox',{name:'작업 입력',exact:true});await editor.fill('초안 @조사');
 await page.getByRole('option').filter({hasText:'조사하기'}).first().click();
 assert.equal(await editor.locator('[data-ref-kind="skill"]').count(),1);
 await page.waitForFunction(async()=>{const {createLocalDataStore}=await import('/js/data/localDataStore.js');const d=createLocalDataStore();try{const e=await d.cache.read('chatDraft','beta-local-workspace','state');return e?.value?.parts?.some(p=>p.type==='skill');}finally{d.destroy();}});
 await page.getByRole('button',{name:'요청 보내기',exact:true}).click();assert.equal(await editor.locator('[data-ref-kind]').count(),1);
 await page.getByRole('tab',{name:'캔버스',exact:true}).click();await page.getByRole('button',{name:'스킬블럭 추가',exact:true}).click();
 await page.getByRole('button',{name:'조사하기 찾아볼 내용을 자연스럽게 요청합니다.'}).click();
 assert.equal(await page.locator('.canvas-block').count(),1);
 await page.waitForFunction(async()=>{const {createLocalDataStore}=await import('/js/data/localDataStore.js');const d=createLocalDataStore();try{const e=await d.cache.read('canvasState','beta-local-workspace','state');return e?.value?.blocks?.length===1;}finally{d.destroy();}});
 await page.reload();await page.getByRole('textbox',{name:'작업 입력',exact:true}).waitFor();assert.equal(await page.locator('[data-ref-kind="skill"]').count(),1);
 await page.getByRole('tab',{name:'캔버스',exact:true}).click();assert.equal(await page.locator('.canvas-block').count(),1);
 await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();await page.getByRole('button',{name:'라이브러리',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'작업 입력',exact:true}).count(),0);
 await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();await page.getByRole('button',{name:'워크스페이스',exact:true}).click();
 assert.equal(await page.getByRole('textbox',{name:'작업 입력',exact:true}).locator('[data-ref-kind]').count(),1);
 await page.getByRole('tab',{name:'캔버스',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.hosted-viewport').classList.contains('is-dragging'));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:45,y:560,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:45,y:560,id:1},{x:145,y:560,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:45,y:560,id:1},{x:245,y:560,id:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.ok(parseInt(await page.locator('.canvas-zoom-label').innerText())>120,'trusted two-finger touch zooms the canvas');
 assert.equal(await page.evaluate(()=>visualViewport.scale),1,'canvas pinch does not zoom the whole browser');
 assert.equal(await page.locator('.canvas-block').count(),1);
 assert.equal(await page.locator('[data-active-slide]').getAttribute('data-active-slide'),'canvas');
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{value:430,configurable:true});Object.defineProperty(visualViewport,'offsetTop',{value:28,configurable:true});visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>{const r=document.querySelector('#app').getBoundingClientRect();return r.top>=27.9&&r.bottom<=458.1;});
 const visibleComposer=await page.locator('.workspace-composer').boundingBox();assert.ok(visibleComposer.y+visibleComposer.height<=458.1,'composer stays in the measured visible frame');
 await page.evaluate(()=>{delete visualViewport.height;delete visualViewport.offsetTop;visualViewport.dispatchEvent(new Event('resize'));});
 await page.getByRole('tab',{name:'채팅',exact:true}).click();
 await page.locator('.workspace-composer input[type="file"]').setInputFiles({name:'메모.txt',mimeType:'text/plain',buffer:Buffer.from('<b>일반 텍스트</b>')});
 await page.waitForFunction(()=>document.querySelector('[data-active-slide]')?.dataset.activeSlide==='canvas' && document.querySelectorAll('.canvas-block').length===2);
 assert.equal(await page.locator('.ovll-rich-attachment').count(),0,'composer transfers local files to Canvas without duplicate draft attachments');
 const fileBlock=page.locator('.canvas-block').filter({hasText:'메모.txt'});await fileBlock.getByRole('button',{name:'상세 내용 열기'}).click();
 assert.equal(await fileBlock.locator('.canvas-file-preview').innerText(),'<b>일반 텍스트</b>');assert.equal(await fileBlock.locator('b').count(),0);
 await page.waitForFunction(async()=>{const {createLocalDataStore}=await import('/js/data/localDataStore.js');const d=createLocalDataStore();try{const e=await d.cache.read('canvasState','beta-local-workspace','state');const file=e?.value?.blocks?.find(b=>b.file?.name==='메모.txt')?.file;return file?.blob && await file.blob.text()==='<b>일반 텍스트</b>';}finally{d.destroy();}});
 await page.reload();await page.getByRole('tab',{name:'캔버스',exact:true}).click();
 assert.equal(await page.locator('.canvas-file-preview').innerText(),'<b>일반 텍스트</b>','file previews survive IDB restoration with actual local Blob');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(api,[]);assert.deepEqual(errors,[]);
 // External callers use Workspace API, never Canvas DOM or an invented backend IR.
 const externalBoundary=await page.evaluate(async()=>{
   const {createWorkspace}=await import('/js/workspace/controller.js');
   const {createInputManager}=await import('/js/input/inputManager.js');
   const input=createInputManager(),root=document.createElement('section');document.body.append(root);
   const data={cache:{read:async()=>null,write:async()=>({written:true}),list:async()=>[]},local:{read:async()=>null,write:async()=>{}}};
   const workspace=await createWorkspace({root,data,input}),presentation=workspace.getPresentation();
   root.append(...presentation.slides.map(slide=>slide.element),...presentation.stationary.map(item=>item.element));
   const commands=workspace.getCanvasCommands();
   const first=commands.addBlock('write',{x:15,y:30});
   commands.updateBlock(first.id,{x:55});
   const exported=JSON.parse(workspace.getDataAccess().exportCanvasJSON());
   commands.deleteBlock(first.id);
   const after=JSON.parse(workspace.getDataAccess().exportCanvasJSON());
   const answer={source:exported.source,format:exported.format,count:exported.snapshot.blocks.length,x:exported.snapshot.blocks[0]?.x,after:after.snapshot.blocks.length};
   await workspace.flush();workspace.destroy();input.destroy();root.remove();
   return answer;
 });
 assert.deepEqual(externalBoundary,{source:'local-view',format:'beta-local-edit-graph-v1',count:1,x:55,after:0});
 // Two independent rooms must never share graph/cache data or stale external handles.
 const scopedWorkspaces=await page.evaluate(async()=>{
   const {createWorkspace}=await import('/js/workspace/controller.js');
   const {createInputManager}=await import('/js/input/inputManager.js');
   const input=createInputManager();
   const roots=[document.createElement('section'),document.createElement('section')];document.body.append(...roots);
   const stored=new Map();
   const data={cache:{read:async(k,r,i)=>stored.get([k,r,i].join('/'))??null,
     write:async(k,r,i,v)=>{stored.set([k,r,i].join('/'),{value:v});return {written:true};},list:async()=>[]},
     local:{read:async()=>null,write:async()=>{}}};
   const a=await createWorkspace({root:roots[0],data,input,roomId:'infra-a'});
   const b=await createWorkspace({root:roots[1],data,input,roomId:'infra-b'});
   const commands=a.getCanvasCommands(),block=commands.addBlock('write',{x:11,y:22});
   commands.updateBlock(block.id,{x:45});
   const graphA=JSON.parse(a.getDataAccess().exportCanvasJSON());
   const graphB=JSON.parse(b.getDataAccess().exportCanvasJSON());
   await Promise.all([a.flush(),b.flush()]);
   const oldReader=a.getDataAccess();a.destroy();
   let commandRejected=false,readerRejected=false;
   try{commands.addBlock('write')}catch(error){commandRejected=error.message.includes('destroyed');}
   try{oldReader.exportCanvasJSON()}catch(error){readerRejected=error.message.includes('destroyed');}
   const answer={a:graphA.snapshot.blocks.length,b:graphB.snapshot.blocks.length,x:graphA.snapshot.blocks[0].x,
     roomA:graphA.roomId,roomB:graphB.roomId,
     storedA:stored.get('canvasState/infra-a/state')?.value.blocks.length,
     storedB:stored.get('canvasState/infra-b/state')?.value.blocks.length,
     commandRejected,readerRejected,stillAlive:b.getRoomId()};
   b.destroy();input.destroy();roots.forEach(root=>root.remove());return answer;
 });
 assert.deepEqual(scopedWorkspaces,{a:1,b:0,x:45,roomA:'infra-a',roomB:'infra-b',
   storedA:1,storedB:0,commandRejected:true,readerRejected:true,stillAlive:'infra-b'});
 // A successful viewport save must not hide an unsuccessful graph save.
 const failureState=await page.evaluate(async()=>{
   const {createWorkspace}=await import('/js/workspace/controller.js');const {createInputManager}=await import('/js/input/inputManager.js');
   const input=createInputManager(),root=document.createElement('section');document.body.append(root);
   const data={cache:{read:async()=>null,write:async kind=>{if(kind==='canvasState')throw new Error('quota test');}},local:{read:async()=>null,write:async()=>{}}};
   const workspace=await createWorkspace({root,data,input});const presentation=workspace.getPresentation();root.append(...presentation.slides.map(s=>s.element),...presentation.stationary.map(s=>s.element));
   workspace.activate({signal:new AbortController().signal,controller:{goTo(){}}});await workspace.flush();
   const status=root.querySelector('[data-save-state]').textContent;workspace.destroy();input.destroy();root.remove();return status;
 });
 assert.notEqual(failureState,'이 기기에 임시 저장됨','viewport persistence must not conceal lost graph writes');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});
