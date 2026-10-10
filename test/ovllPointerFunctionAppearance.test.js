import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {iconSvg} from '../backend/ovllPointer/nodeCatalog.js';
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

class Element {
 constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.value='';this.listeners=new Map();this.styles={};this.style={setProperty:(k,v)=>this.styles[k]=v};this.classList={toggle:(k,v)=>{const keys=new Set((this.className||'').split(' '));v?keys.add(k):keys.delete(k);this.className=[...keys].join(' ');}};}
 appendChild(child){child.parent=this;this.children.push(child);return child;}
 replaceChildren(...children){this.children=[];children.forEach(c=>this.appendChild(c));}
 setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=v;if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}
 getAttribute(k){return k.startsWith('data-')?this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]??null:this.attributes[k]??null;}
 set innerHTML(html){this.html=html;this.children=[];for(const match of html.matchAll(/<(button|span|strong|small|input|textarea|div|label)\b([^>]*)>/g)){const el=new Element(match[1]);for(const a of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))el.setAttribute(a[1],a[2]||'');this.appendChild(el);}}
 get innerHTML(){return this.html||'';}
 matches(selector){return selector[0]==='['?this.getAttribute(selector.slice(1,-1))!==null:selector[0]==='.'?(this.className||'').split(' ').includes(selector.slice(1)):this.tagName===selector;}
 querySelectorAll(selector){return this.children.flatMap(c=>[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){return this.matches(selector)?this:this.parent?.closest(selector)||null;}
 addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
 removeEventListener(type,handler){this.listeners.set(type,(this.listeners.get(type)||[]).filter(h=>h!==handler));}
 dispatch(type,target=this){for(const handler of this.listeners.get(type)||[])handler({target,key:''});}
}
function browser(data=new Map()){
 const document=new Element('document');document.createElement=tag=>new Element(tag);
 const host=document.appendChild(new Element());
 const slots={headerStart:host.appendChild(new Element()),headerEnd:host.appendChild(new Element()),overlay:host.appendChild(new Element())};
 const canvas={on:()=>()=>{},setState(){},getWorkflow:()=>({nodes:[]}),render(){}};
 const workspace={slots,elements:{composerInput:new Element('input'),composerAttach:new Element(),composerSubmit:new Element()},
  mountCanvas:async()=>canvas,mountNodeBuilder(){},bindComposer(){},clearMessages(){},appendMessage(){},
  presence:{showStart(){},resetConversation(){}},ui:{on(){},setMode(){}},destroy(){}};
 let next=0;
 const window={document,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},crypto:{randomUUID:()=> 'appearance'+(++next)},
  AstraAPI:{getNodeDefinitions:async()=>({})},OvllCustomNodeStore:{list:()=>[],onChange:()=>()=>{},get:()=>null},
  OvllCustomNodes:{typeForRecord:id=>id,isCustomType:()=>false},createOvllWorkspace:()=>workspace,
  OvllPointerProjection:{projectGraph:()=>({workflow:{nodes:[]}}),applyGraph(){}}};
 for(const file of ['front/js/ovllPointerFunctions.js','front/js/svgLibrary.js','front/js/functionWorkspace.js'])
  vm.runInNewContext(read(file),{window,console,setTimeout,clearTimeout,requestAnimationFrame:fn=>fn()});
 window.OvllSvgLibrary.setServerIcons(iconSvg);
 const api=window.createOvllFunctionWorkspace(host,{document});
 return {api,window,document,data,query:s=>host.querySelector(s)};
}
const snapshot={graph:{graphId:'g',revision:1,nodes:[{nodeId:'n'}],connections:[]},definitions:[]};

test('builder restores arbitrary HEX and coordinates labeled picker, HEX validation and palette',async()=>{
 const b=browser();const fn=b.window.OvllPointerFunctions.save({purpose:'Purpose',snapshot,targets:['n'],presentation:{name:'Custom',color:'#123456',iconKey:'pencil'}});
 await b.api.open(fn.id);
 const hex=b.query('[data-function-color-hex]'),picker=b.query('[data-function-color-picker]');
 assert.ok(hex,'HEX field exists');assert.ok(picker,'native picker exists');
 assert.equal(picker.getAttribute('type'),'color');assert.equal(hex.value,'#123456');assert.equal(picker.value,'#123456');
 hex.value='#aBc';hex.dispatch('input');assert.equal(picker.value,'#aabbcc');assert.equal(hex.getAttribute('aria-invalid'),'false');
 hex.value='red';hex.dispatch('input');assert.equal(hex.getAttribute('aria-invalid'),'true');assert.equal(picker.value,'#aabbcc');
 picker.value='#c34567';picker.dispatch('input');assert.equal(hex.value,'#c34567');assert.equal(hex.getAttribute('aria-invalid'),'false');
 const palette=b.query('[data-function-colors]');palette.dispatch('click',palette.children[1]);assert.equal(hex.value,'#4f8ef7');
 assert.ok(palette.children.every(c=>c.getAttribute('aria-label').includes(c.dataset.functionColor)));
 b.api.destroy();const reloaded=browser(b.data);await reloaded.api.open(fn.id);assert.equal(reloaded.query('[data-function-color-hex]').value,'#123456');
});
test('searchable labeled icon choices use only server catalog and retain selected choice when filtered',async()=>{
 const b=browser();await b.api.ensureReady();
 const search=b.query('[data-function-icon-search]'),root=b.query('[data-function-icons]');
 assert.ok(search,'search field exists');assert.ok(root.children.length>=30,'expanded server icons');
 assert.ok(root.children.every(c=>c.querySelector('.ovll-function-icon-label')),'visible localized labels');
 search.value='일정';search.dispatch('input');assert.equal(root.children.length,1);assert.equal(root.children[0].dataset.functionIconKey,'calendar');
 root.dispatch('click',root.children[0]);assert.equal(root.children[0].getAttribute('aria-pressed'),'true');
 search.value='';search.dispatch('input');assert.equal(root.children.find(c=>c.dataset.functionIconKey==='calendar').getAttribute('aria-pressed'),'true');
 assert.equal(root.children.some(c=>c.dataset.functionIconKey==='composerSend'),false);
});

test('server catalog extends rounded work icons while retaining original SVG bytes',()=>{
 for(const key of ['document','spreadsheet','chart-line','checklist','calendar','clock','search','link','code','database','users','shield','mail','translate']){
  assert.ok(iconSvg[key],key);assert.match(iconSvg[key],/viewBox="0 0 20 20"/);assert.match(iconSvg[key],/stroke-width="1\.28"/);
  assert.doesNotMatch(iconSvg[key],/<(?:script|foreignObject)|\bon\w+=|(?:href|src)=/);
 }
 for(const [key,hash] of Object.entries(ORIGINAL_ICON_HASHES))assert.equal(createHash('sha256').update(iconSvg[key]).digest('hex'),hash,key);
});

const ORIGINAL_ICON_HASHES={
  "play": "c9c58d5e370ed1f5899a79d9e0d5452128740d0f1e94282b855c913564fca796",
  "globe": "729d288d4c7b0a20f241573d82e3a2d6060a4659878c248f558cd8a3e426ed7d",
  "notebook": "3c7a812447060378915623c62ef392ef1e05573154f5a66c9a28a71bc2c6a886",
  "scales": "7bce1e3b0b8edd39156246985d91c540e65d216da2de330549cb5f4e71f39c70",
  "pen": "0008fa6cd33f514fe5f61d5440154a959088674b6ec41a10a1902709f3b6e762",
  "folder": "d0c542c8662131119357f3959363b88b7cb7f75904c14a51d7e498bed9e26371",
  "sparkle": "ee997de103a4331ec34b5fbd808cfa363aed4eb38bedeabd006d010b846e4faa",
  "custom": "baa070704a658ad0dfcead4346ea543afd02bf549eaee0d3992e0799547550ce",
  "open-book": "77817caff8f5e06fa58f591961c3b44360f5c0d9cfd7229ccd3edda722dd0330",
  "flask": "035442051b866adeb0476cb900f0e8b7f39a47750ace08c8335c516b4ff44e2d",
  "potted-plant": "4a56972bfab4e37165a61a15339d129a81ec517a432d9c2a24c3c94784bfe262",
  "graduation-cap": "c9608a97485ab547caa2c678ca7912bdc094d54169d8419403e0a9c50424c311",
  "pencil": "88f2374ec535a12aee68fcba6f9b120b138a04e6ffab9862debb60948cd54e00",
  "lightbulb": "f13ff25de490251c9813349b484f447c7c89a637ea73314b150a58f2a60363c8",
  "hourglass": "cca8a23080c523ad755ae1848fb66b37fe86aabb0e64c8f51bead24594fa7f45",
  "planet": "d4a6debdd82fd99ddde51ac961853ffb48d72e7804cf31b739e180cdc76f39c5",
  "headphones": "53a6153fedf6e78bb23ad23e1ba3e2eb2f2132ad7e1f9ebe626ee2d3c2f9e934",
  "coffee-cup": "e29ff577feac87bf9468a088b120bb5779b8077a7693008c843bdfc89829750c",
  "compass": "d7386138591cbd4a2ca14e08d9f2b5de4c68e59b8a348312615e164457424192"
};

test('builder edits revise identity while preserving purpose, invariants and input contract',async()=>{
 const b=browser(),store=b.window.OvllPointerFunctions;
 const input={name:'notes',role:'notes',representation:'text',required:true};
 const graph={graph:{graphId:'g_edit',revision:1,nodes:[{nodeId:'n',definitionRef:{definitionId:'d',version:1},inputBindings:{notes:'old'}}],connections:[]},
  definitions:[{definitionId:'d',version:1,inputs:[input],outputs:[]}]};
 const first=store.save({purpose:'Original purpose',invariants:['Preserve sources'],snapshot:graph,targets:['n'],inputs:[input],presentation:{name:'Before',color:'#abc',iconKey:'pencil'}});
 const state={editingId:first.id,baseFunctionRef:{id:first.id,version:1},pointerDraft:graph};
 const source=read('front/js/functionWorkspace.js');
 const body=source.slice(source.indexOf('  async function saveDraft(){'),source.indexOf('  async function draftRepository(){'));
 const save=vm.runInNewContext(body+';saveDraft;',{
  global:b.window,colorHex:null,ensureReady:async()=>{},nameInput:{value:'Changed display name'},descriptionInput:{value:'Updated appearance'},state,
  draftRepository:async()=>({repo:{get:()=>graph},id:'g_edit'}),deleteButton:{},renderRecords(){},syncIdentity(){},setStatus(){},
  workspace:{ui:{setMode(){}},...{canvas:undefined}},console
 });
 state.canvas={getWorkflow:()=>({nodes:[{id:'n',x:10,y:20}]})};state.color='#123456';state.iconKey='calendar';
 assert.equal(await save(),true);
 assert.equal(store.list().length,1);assert.equal(store.get(first.id).version,2);
 assert.equal(store.get(first.id).purpose,'Original purpose');assert.deepEqual(Array.from(store.get(first.id).invariants),['Preserve sources']);
 assert.equal(store.get(first.id).inputs[0].name,'notes');assert.equal(store.get(first.id).presentation.name,'Changed display name');
 assert.equal(store.get(first.id,1).presentation.name,'Before');assert.equal(state.baseFunctionRef.version,2);
});
