import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness(reduced=false){
  let now=0,next=0;const timers=new Map(),handlers=new Map();
  class Element{
    constructor(){this.style={setProperty(k,v){this[k]=v}};this.dataset={};this.children=[];this.listeners=new Map();this.hidden=false;this.attrs={};this.value='';this.classes=new Set();this.classList={add:(...v)=>v.forEach(x=>this.classes.add(x)),remove:(...v)=>v.forEach(x=>this.classes.delete(x)),contains:v=>this.classes.has(v),toggle:(v,b)=>{if(b??!this.classes.has(v))this.classes.add(v);else this.classes.delete(v)}};}
    set className(v){this.classes=new Set(v.split(' '))}get className(){return [...this.classes].join(' ')}
    append(...v){v.forEach(x=>{x.parent=this;this.children.push(x)})}appendChild(v){this.append(v)}remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this)}
    setAttribute(k,v){this.attrs[k]=v}getAttribute(k){return this.attrs[k]}addEventListener(n,f){if(!this.listeners.has(n))this.listeners.set(n,new Set());this.listeners.get(n).add(f)}removeEventListener(n,f){this.listeners.get(n)?.delete(f)}
    dispatchEvent(e){e.target??=this;e.preventDefault??=()=>{};e.stopPropagation??=()=>{};for(const f of this.listeners.get(e.type)||[])f(e);return true}
    contains(n){return n===this||this.children.some(c=>c.contains(n))}focus(){document.activeElement=this}setPointerCapture(){}releasePointerCapture(){}
    querySelectorAll(s){return this.children.flatMap(c=>[...(s==='button'||s==='.vc-node'&&c.classes.has('vc-node')?[c]:[]),...c.querySelectorAll(s)])}
    querySelector(s){return this.querySelectorAll(s)[0]||null}
    getBoundingClientRect(){const left=this.rect?.left??parseFloat(this.style.left??0),top=this.rect?.top??parseFloat(this.style.top??0),width=this.rect?.width??32,height=this.rect?.height??32;return {left,top,width,height,right:left+width,bottom:top+height}}
  }
  const document=new Element();document.readyState='loading';document.head=new Element();document.createElement=()=>new Element();document.getElementById=()=>null;document.querySelector=()=>null;document.hidden=false;
  const viewport=new Element();viewport.rect={left:0,top:0,width:800,height:550};const world=new Element();const a=new Element();a.className='vc-node';a.dataset.nodeId='a';a.rect={left:200,top:230,width:190,height:120};const b=new Element();b.className='vc-node';b.dataset.nodeId='b';b.rect={left:480,top:230,width:190,height:120};world.append(a,b);viewport.append(world);
  const composer=new Element();composer.rect={left:0,top:550,width:800,height:50};const input=new Element();composer.querySelector=()=>input;
  document.querySelector=s=>s==='#composer-form'?composer:s==='#composer-input'?input:null;
  const canvas={root:viewport,on:(n,f)=>{handlers.set(n,f);return()=>handlers.delete(n)},getNode:id=>({id,type:'research',title:'자료 조사'}),getWorkflow:()=>({nodes:[{id:'a'},{id:'b'}],connections:[{from:{node:'a'},to:{node:'b'}}]})},UI={getMode:()=>"canvas",on:()=>()=>{}},App={isBusy:()=>false};
  const context={document,performance:{now:()=>now},console,Math,DOMMatrix:class{inverse(){return this}},DOMPoint:class{constructor(x,y){this.x=x;this.y=y}matrixTransform(){return this}},getComputedStyle:()=>({transform:'none',getPropertyValue:()=>''}),setTimeout:(f,delay=0)=>{const id=++next;timers.set(id,{f,t:now+delay});return id},clearTimeout:id=>timers.delete(id),requestAnimationFrame:f=>context.setTimeout(()=>f(now),16),cancelAnimationFrame:id=>timers.delete(id),Event:class{constructor(type,options){this.type=type;Object.assign(this,options)}}};context.window=context;context.addEventListener=()=>{};context.removeEventListener=()=>{};context.matchMedia=()=>({matches:reduced,addEventListener(){},removeEventListener(){}});vm.runInNewContext(fs.readFileSync(new URL('../front/js/mascot.js',import.meta.url),'utf8'),context);
  const mascot=context.mountOvllCanvasMascot(world,canvas,{ui:UI,app:App,composer});
  function advance(ms){const end=now+ms;let count=0;while(true){const entry=[...timers].filter(([,v])=>v.t<=end).sort((a,b)=>a[1].t-b[1].t)[0];if(!entry)break;if(++count>10000)throw Error('timer runaway');now=entry[1].t;timers.delete(entry[0]);entry[1].f()}now=end;}
  const position=()=>({x:parseFloat(mascot.element.style.left),y:parseFloat(mascot.element.style.top)});
  return {mascot,advance,position,handlers,world,input,context,document,nodes:[a,b],click:()=>{mascot.element.dispatchEvent({type:'pointerdown',pointerId:1,clientX:400,clientY:100,button:0});mascot.element.dispatchEvent({type:'pointerup',pointerId:1})}};
}

test('selection approaches above the node and continues orbiting',()=>{const h=harness();h.handlers.get('select')('a');h.advance(4000);const a=h.position();h.advance(1500);const b=h.position();assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>1,'orbit should move around the selected node');assert.ok(b.y+16<230,'orbit should clear the node body');h.mascot.destroy()});
test('collaboration prepares a node question without replacing an existing draft',()=>{const h=harness();h.handlers.get('select')('a');h.advance(2000);h.click();const menu=h.world.children.find(e=>e.className==='ovll-mascot-menu');assert.ok(menu&&!menu.hidden,'click should open collaboration controls');const question=menu.children.find(e=>e.dataset.mascotAction==='question');question.dispatchEvent({type:'click'});assert.match(h.input.value,/자료 조사/);h.input.value='내가 작성한 요청';h.click();question.dispatchEvent({type:'click'});assert.equal(h.input.value,'내가 작성한 요청');h.mascot.destroy();assert.ok(!h.world.children.includes(menu),'destroy should remove collaboration controls')});
test('errors pause orbital movement until new activity',()=>{const h=harness();h.mascot.workAtNode('a',true);h.advance(2000);h.mascot.setSituation('nodeError',{nodeId:'a'});h.advance(500);const a=h.position();h.advance(1500);assert.deepEqual(h.position(),a);h.mascot.destroy()});
test('clicking a working mascot keeps its task reaction active',()=>{const h=harness();h.mascot.workAtNode('a',true);h.advance(2000);h.click();assert.ok(h.mascot.element.classList.contains('working'),'collaboration must not erase the active task reaction');h.mascot.destroy()});
test('reduced motion keeps orbital position stationary',()=>{const h=harness(true);h.handlers.get('select')('a');h.advance(4000);const a=h.position();h.advance(1500);assert.deepEqual(h.position(),a);h.mascot.destroy()});

test('approaching a node avoids an occupied observation position',()=>{const h=harness();h.nodes[1].rect={left:330,top:145,width:100,height:85};h.handlers.get('select')('a');h.advance(3500);const p=h.position();assert.ok(!(p.x+16>330&&p.x-16<430&&p.y+16>145&&p.y-16<230),'mascot must not land inside the upper neighboring node');h.mascot.destroy()});
test('connection dragging pauses both approach and orbit even far from mascot',()=>{const h=harness();h.handlers.get('select')('a');h.advance(100);h.handlers.get('connectionDragStart')({anchor:{node:'a'},x:750,y:500});h.handlers.get('connectionDragMove')({x:750,y:500});const p=h.position();h.advance(2000);assert.deepEqual(h.position(),p);h.mascot.destroy()});
