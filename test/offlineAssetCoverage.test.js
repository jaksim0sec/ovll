import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL('../front/'+p,import.meta.url),'utf8');
const origin='https://ovll.test';
const localPath=(ref,base='/home')=>new URL(ref,origin+base).pathname;

async function bootScripts(){
 const scripts=[],events=new Map();let done;
 const complete=new Promise(resolve=>done=resolve);
 const window={OVLL_RUNTIME:{},addEventListener:(event,fn)=>events.set(event,fn),setTimeout,clearTimeout,location:{reload(){throw new Error('unexpected reload');}}};
 const document={documentElement:{classList:{remove(){}},dataset:{}},querySelector:()=>null,
  createElement:()=>({addEventListener(type,fn){this[type]=fn;}}),body:{appendChild(script){scripts.push({src:script.src,async:script.async});script.load();}}};
 const context=vm.createContext({window,document,AbortController,console,fetch:async()=>({ok:true,json:async()=>({version:'test'})}),
  navigator:{serviceWorker:{register:async()=>{done();return {};}}},localStorage:{getItem:()=> 'test'},sessionStorage:{getItem:()=>null}});
 if(existsSync(new URL('../front/asset-manifest.js',import.meta.url)))vm.runInContext(read('asset-manifest.js'),context);
 vm.runInContext(read('js/boot.js'),context);
 await complete;return scripts;
}
function worker(){
 const events=new Map(),cache=new Map(),installed=[],requests=[];
 const self={location:{origin},addEventListener:(name,handler)=>events.set(name,handler),skipWaiting(){},clients:{claim(){}}};
 const sandbox={self,URL,fetch:async(request,options)=>{requests.push({request,options});throw new Error('offline');},
  caches:{open:async()=>({addAll:async keys=>{installed.push(...keys);for(const key of keys)cache.set(key,{ok:true,cached:key});},put:async()=>{}}),
   match:async key=>cache.get(typeof key==='string'?key:new URL(key.url).pathname),keys:async()=>[],delete:async()=>true},
  importScripts:(...paths)=>{for(const path of paths)vm.runInContext(read(path.slice(1)),context);}};
 const context=vm.createContext(sandbox);vm.runInContext(read('sw.js'),context);
 return {events,installed,requests,async install(){let done;events.get('install')({waitUntil:p=>done=p});await done;},
  async get(path,{mode='cors',method='GET'}={}){let result;events.get('fetch')({request:{url:origin+path,method,mode},respondWith:p=>result=p});return result&&await result;}};
}
function htmlAssets(){
 const html=read('index.html'),assets=[];
 for(const tag of html.matchAll(/<(?:script|link)\b[^>]*>/g)){
  const source=tag[0].match(/(?:src|href)="([^"]+)"/)?.[1];
  if(source&&!/^https?:/.test(source))assets.push(localPath(source));
 }
 return assets;
}
function localImports(scripts){
 const queue=scripts.map(s=>localPath(s.src)),visited=new Set();
 while(queue.length){
  const file=queue.shift();if(visited.has(file))continue;visited.add(file);
  const content=read(file.slice(1));
  const refs=[...content.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
   ...content.matchAll(/\b(?:from|import)\s+['"]([^'"]+)['"]/g)].map(m=>m[1]);
  for(const ref of refs)if(ref.startsWith('.')||ref.startsWith('/'))queue.push(localPath(ref,file));
 }
 return visited;
}
test('installed offline shell covers every boot script, HTML asset and transitive local module',async()=>{
 const scripts=await bootScripts(),sw=worker();await sw.install();
 const expected=new Set([...htmlAssets(),...localImports(scripts)]);
 const absent=[...expected].filter(path=>!sw.installed.includes(path));
 assert.deepEqual(absent,[],'uncached local dependencies');
 assert.equal(new Set(sw.installed).size,sw.installed.length,'precache contains no duplicates');
 for(const path of sw.installed)assert.ok(existsSync(new URL('../front/'+(path==='/home'?'index.html':path.slice(1)),import.meta.url)),path);
});
test('boot consumes ordered manifest scripts with Activity before application and ordered classic execution',async()=>{
 const scripts=await bootScripts(),paths=scripts.map(s=>s.src);
 assert.ok(paths.includes('./js/ovllPointerActivity.js'));
 assert.ok(paths.indexOf('./js/ovllPointerActivity.js')<paths.indexOf('./js/app.js'));
 assert.ok(paths.indexOf('./js/workspaceUi.js')<paths.indexOf('./js/ui.js'));
 assert.ok(paths.indexOf('./js/workspacePresence.js')<paths.indexOf('./js/ovllPresence.js'));
 assert.ok(paths.every((path,i)=>scripts[i].async===false));
 const window={};vm.runInNewContext(read('asset-manifest.js'),{window});
 assert.deepEqual(paths,Array.from(window.OVLL_ASSETS.scripts));
});
test('cached new assets remain network-first and work when requests are offline',async()=>{
 const sw=worker();await sw.install();
 for(const path of ['/css/customNode.css','/js/workspaceUi.js','/js/ovllPointerActivity.js','/js/ovllPointerResults.mjs','/asset-manifest.js']){
  assert.equal((await sw.get(path))?.cached,path,path);
  assert.equal(sw.requests.at(-1).options?.cache,'no-cache',path);
 }
 assert.equal(await sw.get('/api/ovllPointer/local-turn'),undefined,'API is never served from shell cache');
 assert.equal((await sw.get('/home',{mode:'navigate'})).cached,'/home');
});
