import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
let port;
const root=fileURLToPath(new URL('../../',import.meta.url));
const harness=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/front/css/base.css"><link rel="stylesheet" href="/front/css/canvas.css"><style>html,body,#host{width:100%;height:100%;margin:0}#host{position:relative}</style></head><body><div id="host"></div><script type="module">
import {createCanvas} from '/front/js/canvas/controller.js';
import {createWorkspaceModel} from '/front/js/workspace/model.js';
import {createInputManager} from '/front/js/input/inputManager.js';
window.model=createWorkspaceModel();model.addBlock('start');window.changes=[];model.subscribe(e=>changes.push(e.type));
window.notices=[];window.runs=[];window.input=createInputManager();window.canvas=createCanvas({model,input,onAttach:async(file,{metadata})=>({...metadata,blob:file}),onNotice:s=>notices.push(s),onRun:id=>{runs.push(id);return {accepted:false,message:'실행 연결은 준비 중입니다'}}});
document.querySelector('#host').append(canvas.element);canvas.activate();canvas.setViewport({x:120,y:150,zoom:1});window.ready=true;
</script></body></html>`;
let server,browser;
test.before(async()=>{
 server=createServer(async(req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname;
   if(pathname==='/canvas-harness'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(harness);return}
   if(!pathname.startsWith('/front/')||pathname.includes('..')){res.writeHead(404);res.end();return}
   try{const body=await readFile(root+pathname.slice(1));res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8');res.end(body)}catch{res.writeHead(404);res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));port=server.address().port;
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
});
test.after(async()=>{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve())});
async function setup(width=1200,height=800){
 const context=await browser.newContext({viewport:{width,height},hasTouch:width<500});
 const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/canvas-harness',route=>route.fulfill({contentType:'text/html',body:harness}));
 await page.goto(`http://127.0.0.1:${port}/canvas-harness`);
 await page.waitForFunction(()=>window.ready,{},{timeout:5000}).catch(()=>{});
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>!!window.ready),true,'canvas mounts successfully');
 return {page,context,errors};
}
async function addResearch(page){
 await page.getByRole('button',{name:'스킬블럭 추가',exact:true}).click();
 await page.locator('[data-skill-id=research]').click();
 return page.locator('.canvas-block').last();
}
test('canvas adds and edits local blocks, preserves native field input and never simulates execution',async()=>{
 const {page,context,errors}=await setup();
 assert.equal(await page.locator('.canvas-block').count(),1);
 const block=await addResearch(page);if(await block.getByRole('button',{name:'상세 내용 열기'}).count())await block.getByRole('button',{name:'상세 내용 열기'}).click();
 const field=block.getByRole('textbox',{name:'요청사항'});await field.fill('<img src=x onerror=alert(1)>');await field.press('Tab');
 assert.equal(await page.evaluate(()=>model.getBlocks()[1].values.request),'<img src=x onerror=alert(1)>');
 assert.equal(await page.locator('img').count(),0);
 await block.getByRole('button',{name:'이 스킬블럭부터 실행'}).click();
 assert.equal(await page.evaluate(()=>runs.length),1);assert.ok((await page.evaluate(()=>notices)).some(s=>s.includes('준비 중')),JSON.stringify(await page.evaluate(()=>notices)));
 assert.deepEqual(errors,[]);await context.close();
});
test('drag is a single history operation; ports connect by click, links delete and undo',async()=>{
 const {page,context,errors}=await setup();await addResearch(page);
 const header=page.locator('.canvas-block').first().locator('.canvas-block-head');const box=await header.boundingBox();
 await page.evaluate(()=>changes.length=0);await page.mouse.move(box.x+60,box.y+16);await page.mouse.down();await page.mouse.move(box.x+130,box.y+66,{steps:8});await page.mouse.up();
 assert.equal(await page.evaluate(()=>changes.filter(t=>t==='update-block').length),1);
 const start=page.locator('.canvas-block').first(),research=page.locator('.canvas-block').last();
 await start.locator('[data-direction="output"]').click();await research.locator('[data-direction="input"]').click();
 assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),1);
 await page.locator('.canvas-link-hit').click({force:true});await page.getByRole('button',{name:'선택한 연결 삭제'}).click();
 assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),0);
 await page.getByRole('button',{name:'실행 취소'}).click();assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),1);
 assert.deepEqual(errors,[]);await context.close();
});
test('mobile pinch keeps graph unchanged and lifecycle releases gesture ownership',async()=>{
 const {page,context,errors}=await setup(390,844);
 const result=await page.evaluate(()=>{
   const before=model.getSnapshot();const surface=document.querySelector('.canvas-surface');
   const dispatch=(type,id,x,y)=>surface.dispatchEvent(new PointerEvent(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,bubbles:true,button:0}));
   dispatch('pointerdown',1,100,400);dispatch('pointerdown',2,200,400);dispatch('pointermove',2,300,400);dispatch('pointerup',2,300,400);dispatch('pointerup',1,100,400);
   const viewport=canvas.getViewport();canvas.deactivate();dispatch('pointerdown',3,100,400);dispatch('pointermove',3,200,450);dispatch('pointerup',3,200,450);
   return {before,after:model.getSnapshot(),viewport,inactive:canvas.getViewport()};
 });
 assert.equal(result.viewport.zoom,2);assert.deepEqual(result.before,result.after);assert.deepEqual(result.viewport,result.inactive);
 assert.deepEqual(errors,[]);await context.close();
});
test('focused field edits persist after pause and flush when canvas leaves',async()=>{
 const {page,context,errors}=await setup();const block=await addResearch(page);if(await block.getByRole('button',{name:'상세 내용 열기'}).count())await block.getByRole('button',{name:'상세 내용 열기'}).click();
 const field=block.getByRole('textbox',{name:'요청사항'});await field.fill('아직 포커스가 있는 요청');
 await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>model.getBlocks()[1].values.request),'아직 포커스가 있는 요청');
 await field.fill('떠나기 직전 입력');await page.evaluate(()=>canvas.deactivate());
 assert.equal(await page.evaluate(()=>model.getBlocks()[1].values.request),'떠나기 직전 입력');
 assert.deepEqual(errors,[]);await context.close();
});
test('cancelling a block drag restores position; port dragging connects and reset requires a second click',async()=>{
 const {page,context,errors}=await setup();await addResearch(page);
 const header=page.locator('.canvas-block').first().locator('.canvas-block-head');const box=await header.boundingBox();
 const before=await page.evaluate(()=>model.getBlocks()[0]);await page.mouse.move(box.x+50,box.y+15);await page.mouse.down();await page.mouse.move(box.x+110,box.y+45,{steps:4});
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();assert.deepEqual(await page.evaluate(()=>model.getBlocks()[0]),before);
 const source=await page.locator('.canvas-block').first().locator('[data-direction="output"]').boundingBox(),target=await page.locator('.canvas-block').last().locator('[data-direction="input"]').boundingBox();
 await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:12});await page.mouse.up();
 assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),1);
 await page.getByRole('button',{name:'캔버스 초기화',exact:true}).click();assert.equal(await page.locator('.canvas-block').count(),2);
 await page.getByRole('button',{name:'캔버스 초기화 확인',exact:true}).click();assert.equal(await page.locator('.canvas-block').count(),0);
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await page.locator('.canvas-block').count(),2);assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),1);
 assert.deepEqual(errors,[]);await context.close();
});
test('menu handoff releases capture, cancels a drag and closes transient controls',async()=>{
 const {page,context,errors}=await setup();const start=page.locator('.canvas-block').first();const box=await start.locator('.canvas-block-head').boundingBox();
 const before=await page.evaluate(()=>model.getSnapshot());await page.mouse.move(box.x+50,box.y+15);await page.mouse.down();await page.mouse.move(box.x+100,box.y+40);
 await page.evaluate(()=>canvas.closeMenu());await page.mouse.up();assert.deepEqual(await page.evaluate(()=>model.getSnapshot()),before);
 await page.getByRole('button',{name:'스킬블럭 추가',exact:true}).click();await page.evaluate(()=>canvas.closeMenu());assert.equal(await page.locator('.canvas-palette').isVisible(),false);
 await page.getByRole('button',{name:'캔버스 초기화',exact:true}).click();await page.evaluate(()=>canvas.closeMenu());assert.equal(await page.getByRole('button',{name:'캔버스 초기화',exact:true}).count(),1);
 assert.deepEqual(errors,[]);await context.close();
});
test('palette adds expanded nonoverlapping blocks and connected ports toggle an existing link',async()=>{
 const {page,context,errors}=await setup();for(let i=0;i<6;i++)await addResearch(page);
 assert.equal(await page.locator('.canvas-block.is-expanded').count(),6);
 const boxes=await page.locator('.canvas-block').evaluateAll(nodes=>nodes.map(n=>({x:n.offsetLeft,y:n.offsetTop,width:n.offsetWidth,height:n.offsetHeight})));
 for(let i=0;i<boxes.length;i++)for(let j=0;j<i;j++){const a=boxes[i],b=boxes[j];assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y)}
 await page.evaluate(()=>canvas.setViewport({x:120,y:150,zoom:1}));
 const source=page.locator('.canvas-block').first().locator('[data-direction="output"]');
 const target=page.locator('.canvas-block').nth(1).locator('[data-direction="input"]');
 // Keyboard activation is independent of camera position and exercises accessible ports.
 await source.evaluate(n=>n.click());await target.evaluate(n=>n.click());
 assert.equal(await page.locator('.canvas-port.is-connected').count(),2);
 await source.evaluate(n=>n.click());await target.evaluate(n=>n.click());assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),0);assert.equal(await page.locator('.canvas-port.is-connected').count(),0);
 assert.deepEqual(errors,[]);await context.close();
});
test('request body stays compact, grows for content and shrinks after deletion at desktop and mobile widths',async()=>{
 for(const width of [1200,390]){
  const {page,context,errors}=await setup(width,844);const block=await addResearch(page);const field=block.getByRole('textbox',{name:'요청사항'});
  const read=()=>field.evaluate(node=>{const style=getComputedStyle(node),group=getComputedStyle(node.closest('label')),blockStyle=getComputedStyle(node.closest('.canvas-block'));return {height:node.offsetHeight,max:parseFloat(style.maxHeight),font:parseFloat(style.fontSize),lineHeight:parseFloat(style.lineHeight),border:parseFloat(group.borderTopWidth),rootFont:parseFloat(getComputedStyle(document.documentElement).fontSize),blockWidth:parseFloat(blockStyle.width)}});
  let empty=await read();assert.ok(empty.height>=25&&empty.height<=50,JSON.stringify(empty));assert.equal(empty.border,0);assert.ok(Math.abs(empty.font/empty.rootFont-.68)<.01);
  if(width<600)assert.ok(Math.abs(empty.blockWidth/empty.rootFont-11.125)<.01);
  assert.equal(await block.locator('.canvas-block-description').count(),0);assert.equal(await block.locator('.canvas-field-label').isVisible(),false);
  await field.fill('첫째 줄\n둘째 줄\n셋째 줄\n넷째 줄\n다섯째 줄\n여섯째 줄\n일곱째 줄\n여덟째 줄\n아홉째 줄\n열째 줄\n마지막 줄');
  let long=await read();assert.ok(long.height>empty.height);assert.ok(long.height<=long.max+1);
  await field.fill('');await field.press('Tab');let shrunk=await read();assert.ok(shrunk.height<=empty.height+1,JSON.stringify({empty,long,shrunk}));
  await block.getByRole('button',{name:'상세 내용 닫기'}).click();assert.equal(await field.isVisible(),false);await block.getByRole('button',{name:'상세 내용 열기'}).click();assert.equal(await field.isVisible(),true);
  await block.getByRole('button',{name:'스킬블럭 삭제',exact:true}).click();assert.equal(await page.locator('.canvas-block').count(),1);assert.deepEqual(errors,[]);await context.close();
 }
});
test('file attachment commits the enriched local file once and replacement undo restores its bytes',async()=>{
 const {page,context,errors}=await setup();await page.getByRole('button',{name:'스킬블럭 추가',exact:true}).click();
 const chooserReady=page.waitForEvent('filechooser');await page.locator('[data-skill-id=file]').click();const chooser=await chooserReady;
 await page.evaluate(()=>changes.length=0);await chooser.setFiles({name:'data.bin',mimeType:'application/octet-stream',buffer:Buffer.from('AAAA')});
 await page.waitForFunction(()=>model.getBlocks().at(-1).file?.name==='data.bin');assert.equal(await page.evaluate(()=>model.getBlocks().at(-1).file.blob instanceof Blob),true);
 assert.equal(await page.evaluate(()=>changes.filter(t=>t==='update-block').length),1);assert.equal(await page.evaluate(()=>model.getBlocks().at(-1).file.blob.text()),'AAAA');
 const replaceReady=page.waitForEvent('filechooser');await page.locator('.canvas-block').last().getByRole('button',{name:'다른 파일 선택',exact:true}).click();const replacement=await replaceReady;
 await page.evaluate(()=>changes.length=0);await replacement.setFiles({name:'data.bin',mimeType:'application/octet-stream',buffer:Buffer.from('BBBB')});
 await page.waitForFunction(async()=>await model.getBlocks().at(-1).file.blob.text()==='BBBB');assert.equal(await page.evaluate(()=>changes.filter(t=>t==='update-block').length),1);
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await page.evaluate(()=>model.getBlocks().at(-1).file.blob.text()),'AAAA');
 assert.deepEqual(errors,[]);await context.close();
});
test('programmatic file placement is one undoable add and local previews/downloads own their Blob URL lifetime',async()=>{
 const {page,context,errors}=await setup();
 await page.evaluate(()=>{
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);window.createdUrls=[];window.revokedUrls=[];
  URL.createObjectURL=blob=>{const url=create(blob);createdUrls.push(url);return url};URL.revokeObjectURL=url=>{revokedUrls.push(url);return revoke(url)};
 });
 const result=await page.evaluate(async()=>{
  changes.length=0;const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='),c=>c.charCodeAt(0));
  const block=await canvas.addFile(new File([bytes],'pixel.png',{type:'image/png'}));
  return {id:block.id,expanded:block.expanded,localId:block.file.localId,changes:[...changes],size:block.file.blob.size};
 });
 assert.equal(result.expanded,false);assert.ok(result.localId);assert.deepEqual(result.changes,['add-block']);assert.ok(result.size>0);
 const block=page.locator('.canvas-block').last();await block.getByRole('button',{name:'상세 내용 열기'}).click();
 const image=block.locator('.canvas-file-image-preview img');await image.waitFor({state:'visible'});assert.equal(await image.evaluate(n=>n.complete&&n.naturalWidth===1),true);
 const original=await image.getAttribute('src');assert.ok(original.startsWith('blob:'));
 await page.evaluate(()=>{canvas.deactivate();canvas.activate()});assert.equal(await block.locator('.canvas-file-image-preview img').getAttribute('src'),original);
 assert.equal(await page.evaluate(async url=>(await fetch(url)).ok,original),true);
 const downloadReady=page.waitForEvent('download');await block.getByRole('link',{name:'파일 다운로드',exact:true}).click();const download=await downloadReady;assert.equal(download.suggestedFilename(),'pixel.png');assert.equal((await readFile(await download.path())).length,result.size);
 const chooserReady=page.waitForEvent('filechooser');await block.getByRole('button',{name:'다른 파일 선택',exact:true}).click();const chooser=await chooserReady;
 await chooser.setFiles({name:'note.txt',mimeType:'text/plain',buffer:Buffer.from('<img src=x onerror=alert(1)>\n'+ '안전한 본문 '.repeat(200))});
 await page.waitForFunction(()=>!!document.querySelector('.canvas-file-preview'));
 assert.equal((await block.locator('.canvas-file-preview').textContent()).length,900);assert.equal(await block.locator('img').count(),0);
 assert.equal(await page.evaluate(url=>revokedUrls.includes(url),original),true);assert.equal(await page.evaluate(async url=>{try{await fetch(url);return false}catch{return true}},original),true);
 const replacement=await block.getByRole('link',{name:'파일 다운로드',exact:true}).getAttribute('href');
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await block.locator('.canvas-file-image-preview img').count(),1);assert.equal(await page.evaluate(url=>revokedUrls.includes(url),replacement),true);
 const restored=await block.getByRole('link',{name:'파일 다운로드',exact:true}).getAttribute('href');assert.notEqual(restored,original);
 await block.getByRole('button',{name:'스킬블럭 삭제',exact:true}).click();assert.equal(await page.evaluate(url=>revokedUrls.includes(url),restored),true);
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();const finalUrl=await page.locator('.canvas-block').last().getByRole('link',{name:'파일 다운로드',exact:true}).getAttribute('href');
 await page.evaluate(()=>canvas.destroy());assert.equal(await page.evaluate(url=>revokedUrls.includes(url),finalUrl),true);
 assert.deepEqual(errors,[]);await context.close();
});

test('inserting blocks and files leaves the camera fixed even when nearby slots overflow the view',async()=>{
 for(const width of [390,1200]){
  const {page,context}=await setup(width,844);
  const before=await page.evaluate(()=>canvas.getViewport());
  for(let i=0;i<5;i++){await addResearch(page);assert.deepEqual(await page.evaluate(()=>canvas.getViewport()),before,'insertion must not recenter or zoom');}
  await page.evaluate(()=>canvas.addFile(new File(['text'],'local.txt',{type:'text/plain'})));
  assert.deepEqual(await page.evaluate(()=>canvas.getViewport()),before,'file insertion must not recenter');await context.close();
 }
});
test('expansion preserves the block DOM and animates height with its connection anchor',async()=>{
 const {page,context}=await setup();const block=await addResearch(page);
 await block.evaluate(node=>window.originalBlock=node);
 const open=await block.evaluate(n=>n.offsetHeight);await block.getByRole('button',{name:'상세 내용 닫기'}).click();
 const middle=await block.evaluate(n=>({same:n===originalBlock,height:n.getBoundingClientRect().height}));
 assert.equal(middle.same,true,'toggle must preserve DOM and native editing history');
 assert.ok(middle.height>60,'collapse must start from expanded geometry');
 await page.waitForTimeout(440);const closed=await block.evaluate(n=>n.offsetHeight);assert.ok(closed<open);
 await block.getByRole('button',{name:'상세 내용 열기'}).click();await page.waitForTimeout(80);
 const partial=await block.evaluate(n=>n.offsetHeight);assert.ok(partial>closed&&partial<open,JSON.stringify({closed,partial,open}));
 await page.waitForTimeout(440);assert.equal(await block.evaluate(n=>n.offsetHeight),open);await context.close();
});
async function connectionFixture(page){
 await page.evaluate(()=>{
  model.clear();const a=model.addBlock('research',{x:30,y:30}),b=model.addBlock('research',{x:30,y:220}),c=model.addBlock('organize',{x:430,y:120});
  window.fixture={a:a.id,b:b.id,c:c.id};canvas.setViewport({x:60,y:60,zoom:1});
 });
 const port=async(id,direction)=>{const box=await page.locator(`[data-block-id="${id}"].canvas-block [data-direction="${direction}"]`).boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2}};
 const ids=await page.evaluate(()=>fixture);return {a:await port(ids.a,'output'),b:await port(ids.b,'output'),c:await port(ids.c,'input'),ids};
}
test('output drag collects another output after dwell, commits the group and double-tap disconnects a port',async()=>{
 const {page,context}=await setup();const {a,b,c,ids}=await connectionFixture(page);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:10});
 await page.waitForTimeout(240);assert.equal(await page.locator('.canvas-port.is-picked').count(),2);
 assert.equal(await page.locator('.canvas-link-preview').count(),2);
 await page.mouse.move(c.x,c.y,{steps:10});await page.mouse.up();
 assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),2);
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),0,'one undo removes the collected group');
 await page.getByRole('button',{name:'다시 실행',exact:true}).click();
 await page.mouse.dblclick(c.x,c.y,{delay:90});await page.waitForTimeout(180);
 assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),0,'input double-tap disconnects all incoming links');
 await page.getByRole('button',{name:'실행 취소',exact:true}).click();assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),2);
 await page.evaluate(({a,b,c})=>{model.disconnectPort({blockId:c,portId:'in'},'input');model.connect({blockId:a,portId:'result'},{blockId:b,portId:'in'});model.connect({blockId:a,portId:'result'},{blockId:c,portId:'in'})},ids);
 await page.mouse.dblclick(a.x,a.y,{delay:90});await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),0,'output double-tap disconnects fanout');
 await context.close();
});
test('pan continues with main damping after release and stops on menu handoff or reduced motion',async()=>{
 const {page,context}=await setup();
 await page.mouse.move(700,400);await page.mouse.down();
 for(let i=1;i<=6;i++){await page.mouse.move(700+i*15,400);await page.waitForTimeout(14)}
 await page.mouse.up();const released=await page.evaluate(()=>canvas.getViewport());await page.waitForTimeout(90);
 assert.ok((await page.evaluate(()=>canvas.getViewport())).x>released.x+2,'release should coast');
 await page.evaluate(()=>canvas.closeMenu());const stopped=await page.evaluate(()=>canvas.getViewport());await page.waitForTimeout(120);assert.deepEqual(await page.evaluate(()=>canvas.getViewport()),stopped);
 await page.emulateMedia({reducedMotion:'reduce'});await page.mouse.move(700,400);await page.mouse.down();await page.mouse.move(800,400,{steps:6});await page.mouse.up();const reduced=await page.evaluate(()=>canvas.getViewport());await page.waitForTimeout(100);assert.deepEqual(await page.evaluate(()=>canvas.getViewport()),reduced);await context.close();
});

test('arrange interpolates the graph and camera together and settles at the actual connected anchors',async()=>{
 const {page,context}=await setup();await connectionFixture(page);
 const before=await page.evaluate(()=>({camera:canvas.getViewport(),box:document.querySelector('.canvas-block').offsetLeft}));
 await page.getByRole('button',{name:'스킬블럭 정리하기'}).click();
 const early=await page.evaluate(()=>({camera:canvas.getViewport(),box:document.querySelector('.canvas-block').offsetLeft}));
 await page.waitForTimeout(650);const final=await page.evaluate(()=>({camera:canvas.getViewport(),box:document.querySelector('.canvas-block').offsetLeft}));
 assert.notDeepEqual(early,final,'arrange must interpolate, not jump immediately');assert.notDeepEqual(before,final);assert.equal(final.box,0);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{model.updateBlock(model.getBlocks()[0].id,{x:220})});
 await page.getByRole('button',{name:'스킬블럭 정리하기'}).click();assert.equal(await page.locator('.canvas-block').first().evaluate(n=>n.offsetLeft),0);await context.close();
});
test('cancelled output collection clears its timer and preview without changing the graph',async()=>{
 const {page,context}=await setup();const {a,b,c}=await connectionFixture(page);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});
 await page.evaluate(()=>canvas.closeMenu());await page.waitForTimeout(250);await page.mouse.move(c.x,c.y);await page.mouse.up();
 assert.equal(await page.locator('.canvas-port.is-picked,.canvas-port.is-pickup-hover,.canvas-link-preview').count(),0);assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),0);await context.close();
});

test('header dragging temporarily folds a block, reopening without a separate history entry',async()=>{
 const {page,context}=await setup();const block=await addResearch(page);const before=await block.evaluate(n=>n.offsetHeight),header=await block.locator('.canvas-block-head').boundingBox();
 await page.evaluate(()=>changes.length=0);await page.mouse.move(header.x+45,header.y+12);await page.mouse.down();await page.mouse.move(header.x+90,header.y+18,{steps:4});
 assert.ok(await block.evaluate(n=>n.offsetHeight)<before,'header drag folds the body');assert.equal(await page.evaluate(()=>model.getBlocks().at(-1).expanded),true,'temporary fold is view state');
 await page.mouse.up();await page.waitForTimeout(440);assert.equal(await block.evaluate(n=>n.offsetHeight),before);assert.deepEqual(await page.evaluate(()=>changes),['update-block']);await context.close();
});
test('leaving during bulk disconnect cancels both the fade and delayed graph edit',async()=>{
 const {page,context}=await setup();const {a,c,ids}=await connectionFixture(page);
 await page.evaluate(({a,c})=>model.connect({blockId:a,portId:'result'},{blockId:c,portId:'in'}),ids);
 await page.mouse.dblclick(a.x,a.y,{delay:60});await page.evaluate(()=>{canvas.deactivate();canvas.activate()});await page.waitForTimeout(200);
 assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),1);assert.equal(await page.locator('.canvas-link.is-removing').count(),0);assert.equal(await page.locator('.canvas-link').evaluate(n=>getComputedStyle(n).opacity),'1');await context.close();
});

test('a held port does not count toward the double-tap disconnect gesture',async()=>{
 const {page,context}=await setup();const {a,ids}=await connectionFixture(page);
 await page.evaluate(({a,c})=>model.connect({blockId:a,portId:'result'},{blockId:c,portId:'in'}),ids);
 await page.mouse.move(a.x,a.y);await page.mouse.down();await page.waitForTimeout(360);await page.mouse.up();
 await page.mouse.click(a.x,a.y);await page.waitForTimeout(180);assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),1,'a hold followed by one tap must not disconnect');await context.close();
});

test('native touch collects multiple outputs and releases into one input on a zoomed mobile canvas',async()=>{
 const {page,context}=await setup(390,844);await connectionFixture(page);await page.evaluate(()=>canvas.setViewport({x:10,y:130,zoom:.5}));
 const points=await page.evaluate(()=>{const center=(id,direction)=>{const n=document.querySelector(`.canvas-block[data-block-id="${id}"] [data-direction="${direction}"]`),r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:1,radiusX:2,radiusY:2}};return {a:center(fixture.a,'output'),b:center(fixture.b,'output'),c:center(fixture.c,'input')}});
 const cdp=await context.newCDPSession(page);
 const touch=(type,point)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:point?[point]:[]});
 await touch('touchStart',points.a);await touch('touchMove',points.b);await page.waitForTimeout(250);assert.equal(await page.locator('.canvas-link-preview').count(),2);
 await touch('touchMove',points.c);await touch('touchEnd');assert.equal(await page.evaluate(()=>model.getSnapshot().links.length),2);await context.close();
});
