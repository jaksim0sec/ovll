import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium }=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../../front/',import.meta.url));
let server,browser;
before(async()=>{
  server=createServer(async(req,res)=>{
    if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<html lang="en"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/composer.css"><body><main></main></body></html>');return;}
    try{res.setHeader('Content-Type',req.url.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(root+new URL(req.url,'http://localhost').pathname));}catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(existsSync('/tmp/chromium')?'/tmp/chromium':undefined),args:['--no-sandbox','--disable-dev-shm-usage']});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});
async function fixture({mobile=false,onAttachMode}={}){
  const page=await browser.newPage(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});
  await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
  await page.evaluate(async mode=>{
    const {createComposer}=await import('/js/composer/controller.js');
    const onAttach=mode?async files=>{
      window.receivedFile=files[0];
      if(mode==='pending')return new Promise(resolve=>{window.resolveAttachment=resolve;});
      if(mode==='failed')throw new Error('파일을 캔버스에 추가하지 못했습니다.');
      return {handled:true};
    }:undefined;
    window.inputCount=0;window.composer=createComposer({onAttach});
    window.composer.element.addEventListener('input',()=>window.inputCount++);
    document.querySelector('main').append(window.composer.element);window.composer.activate();
  },onAttachMode);
  return {page,editor:page.getByRole('textbox',{name:'작업 입력'})};
}
const plain=page=>page.evaluate(()=>window.composer.getDraft().parts.map(part=>part.text??part.label).join(''));
async function paste(editor,text){await editor.evaluate((node,text)=>{const data=new DataTransfer();data.setData('text/plain',text);data.setData('text/html','<b>never insert HTML</b>');node.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);}

test('native mobile blank and trailing paragraphs survive draft roundtrip',async()=>{
  const {page,editor}=await fixture({mobile:true});
  try{
    await editor.fill('first');await editor.press('Enter');await editor.press('Enter');await editor.pressSequentially('second');
    assert.equal(await plain(page),'first\n\nsecond');
    await editor.press('Enter');await editor.press('Enter');
    assert.equal(await plain(page),'first\n\nsecond\n\n');
    await page.evaluate(()=>window.composer.setDraft(window.composer.getDraft()));
    assert.equal(await plain(page),'first\n\nsecond\n\n');
    await editor.fill('');await editor.press('Enter');await editor.press('Enter');await editor.pressSequentially('third');
    assert.equal(await plain(page),'\n\nthird',await editor.innerHTML());
  }finally{await page.close();}
});

test('Shift Enter participates in native undo and redo without reordering text',async()=>{
  const {page,editor}=await fixture();
  try{
    await editor.focus();await editor.pressSequentially('hello');await editor.press('Shift+Enter');
    assert.equal(await plain(page),'hello\n');
    await editor.press('Control+z');
    assert.ok(['hello',''].includes(await plain(page)),'undo leaves a valid preceding edit state');
    await editor.press('Control+Shift+z');assert.equal(await plain(page),'hello\n');
  }finally{await page.close();}
});

test('plain paste participates in native undo and redo without leaving an orphaned insertion',async()=>{
  const {page,editor}=await fixture();
  try{
    await editor.focus();await editor.pressSequentially('hello');await paste(editor,' pasted\ntext');
    assert.equal(await plain(page),'hello pasted\ntext');assert.equal(await editor.locator('b').count(),0);
    await editor.press('Control+z');
    assert.ok(['hello',''].includes(await plain(page)),'undo removes the pasted edit together with its native transaction');
    await editor.press('Control+Shift+z');assert.equal(await plain(page),'hello pasted\ntext');
  }finally{await page.close();}
});

test('rich token insertion and atomic deletion survive native undo and redo',async()=>{
  const {page,editor}=await fixture();
  try{
    await editor.focus();await editor.pressSequentially('hello @');await editor.press('Enter');
    const withToken=await page.evaluate(()=>window.composer.getDraft());
    assert.equal(withToken.parts.filter(part=>part.type==='skill').length,1);
    await editor.press('Control+z');
    assert.equal((await page.evaluate(()=>window.composer.getDraft())).parts.some(part=>part.type==='skill'),false);
    await editor.press('Control+Shift+z');assert.deepEqual(await page.evaluate(()=>window.composer.getDraft()),withToken);
    await editor.press('Control+End');
    const caret=await editor.evaluate(node=>({html:node.innerHTML,anchor:document.getSelection().anchorNode?.nodeName,offset:document.getSelection().anchorOffset}));await editor.press('Backspace');assert.equal(await editor.locator('[data-ref-kind]').count(),0,JSON.stringify(caret));
    await editor.press('Control+z');assert.deepEqual(await page.evaluate(()=>window.composer.getDraft()),withToken);
    await editor.press('Control+Shift+z');assert.equal(await editor.locator('[data-ref-kind]').count(),0);
  }finally{await page.close();}
});


test('an external attachment handler receives the File and consumes it without changing draft',async()=>{
  const {page}=await fixture({onAttachMode:'handled'});
  try{
    await page.locator('input[type=file]').setInputFiles({name:'handled.txt',mimeType:'text/plain',buffer:Buffer.from('file bytes')});
    await page.waitForFunction(()=>Boolean(window.receivedFile));
    assert.equal(await page.evaluate(()=>window.receivedFile instanceof File),true);
    assert.equal(await page.evaluate(()=>window.receivedFile.text()),'file bytes');
    assert.deepEqual(await page.evaluate(()=>window.composer.getDraft()),{parts:[],attachments:[]});
    assert.equal(await page.getByRole('button',{name:'handled.txt 첨부 제거'}).count(),0);
    assert.equal(await page.evaluate(()=>window.inputCount),0);
  }finally{await page.close();}
});

test('a failed external attachment handler retains the local File and reports the failure',async()=>{
  const {page}=await fixture({onAttachMode:'failed'});
  try{
    await page.locator('input[type=file]').setInputFiles({name:'retained.txt',mimeType:'text/plain',buffer:Buffer.from('retained bytes')});
    await page.getByRole('status').filter({hasText:'파일을 캔버스에 추가하지 못했습니다.'}).waitFor();
    assert.equal(await page.evaluate(()=>window.composer.getDraft().attachments[0].file.text()),'retained bytes');
    assert.equal(await page.getByRole('button',{name:'retained.txt 첨부 제거'}).isVisible(),true);
  }finally{await page.close();}
});

test('a pending attachment callback cannot mutate a destroyed composer',async()=>{
  const {page}=await fixture({onAttachMode:'pending'});
  try{
    await page.locator('input[type=file]').setInputFiles({name:'pending.txt',mimeType:'text/plain',buffer:Buffer.from('pending bytes')});
    await page.waitForFunction(()=>Boolean(window.resolveAttachment));
    await page.evaluate(async()=>{window.composer.destroy();window.resolveAttachment({handled:false});await new Promise(resolve=>requestAnimationFrame(resolve));});
    assert.equal(await page.evaluate(()=>window.inputCount),0);
    assert.deepEqual(await page.evaluate(()=>window.composer.getDraft()),{parts:[],attachments:[]});
  }finally{await page.close();}
});
