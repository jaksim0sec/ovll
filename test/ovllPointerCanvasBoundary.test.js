import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../front/js/canvasNode.js',import.meta.url),'utf8');
const block=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
function boundary(){
 const state={nodes:[],connections:[],runtimeNodes:new Map()},events=[];
 const definition={inputs:[{id:'in',type:'text',accepts:['text']}],outputs:[{id:'out',type:'text'}]};
 const context={state,clone:structuredClone,registry:new Map([['work',definition]]),getDefinition:()=>definition,
  normalizeNode:structuredClone,render(){},getNodeElement:()=>null,positionPorts(){},renderConnections(){},centerWorkflow(){},
  emit:(name,payload)=>events.push({name,payload}),endpoint:value=>{const dot=value.lastIndexOf('.');return {node:value.slice(0,dot),port:value.slice(dot+1)};},
  compatible:(a,b)=>a.type===b.type};
 vm.createContext(context);
 vm.runInContext(block('    function getWorkflow() {','    function getWorkflowIR() {')+block('    function applyWorkflowIR(spec, options = {}) {','    function findNewNodePosition('),context);
 return {context,state,events,apply:context.applyWorkflowIR,get:context.getWorkflow};
}
const nodes=()=>['a','b'].map(id=>({id,type:'work',x:0,y:0}));
test('actual canvas IR boundary retains original link identity and logical metadata through round trips and layout',()=>{
 const x=boundary(),connection={id:'logical_link',from:{node:'a',port:'out'},to:{node:'b',port:'in'},
  data:{kind:'flow',pointer:{linkId:'logical_link',from:{nodeId:'a',port:'summary'},to:{nodeId:'b',port:'source'}}}};
 x.apply({nodes:nodes(),links:[['a.out','b.in']],connections:[connection]},{center:false});
 assert.equal(x.get().connections[0].id,'logical_link');assert.deepEqual(x.get().connections[0].data,connection.data);
 const snapshot=x.get();snapshot.connections[0].data.pointer.from.port='External mutation';
 assert.equal(x.get().connections[0].data.pointer.from.port,'summary','workflow snapshot is isolated');
 x.apply({nodes:nodes(),links:[['a.out','b.in']]},{center:false});
 assert.equal(x.get().connections[0].id,'logical_link');assert.equal(x.get().connections[0].data.pointer.from.port,'summary');
});
test('legacy IR still constructs connections and preserves separate data and flow identities',()=>{
 const x=boundary();x.apply({nodes:nodes(),links:[['a.out','b.in']],data:[['a.out','b.in']],connections:[
  {id:'flow',from:{node:'a',port:'out'},to:{node:'b',port:'in'},data:{kind:'flow'}},
  {id:'data',from:{node:'a',port:'out'},to:{node:'b',port:'in'},data:{kind:'data'}}]},{center:false});
 assert.deepEqual(Array.from(x.get().connections,p=>p.id),['flow','data']);
 const legacy=boundary();legacy.apply({nodes:nodes(),links:[['a.out','b.in']]},{center:false});assert.equal(legacy.get().connections.length,1);
});
test('stale runtime state has an explicit reexecution label',()=>{
 const context={};vm.createContext(context);vm.runInContext(block('    function runtimeStatusLabel(status) {','    function compactRuntimeReport('),context);
 assert.equal(context.runtimeStatusLabel('STALE'),'재실행 필요');
});
test('delegated runtime-result click emits an isolated full runtime payload',()=>{
 const runtime={status:'SUCCESS',result:{outputs:{status:'produced',values:{out:{inline:'Full output '.repeat(200)}}},provenance:{providerId:'offline'}}};
 const node={id:'a',type:'work',data:{}},state={runtimeNodes:new Map([['a',runtime]])},events=[];
 const context={state,nodesLayer:{},clone:structuredClone,getNode:id=>id==='a'?node:null,emit:(name,payload)=>events.push({name,payload}),
  listen:(_element,type,handler)=>{if(type==='click')context.click=handler;}};
 vm.createContext(context);
 const start=source.indexOf("    listen(\n      nodesLayer,\n      'click',");
 const end=source.indexOf("    listen(\n  nodesLayer,\n  'input',",start);
 vm.runInContext(source.slice(start,end),context);
 const element={dataset:{nodeId:'a'}},action={dataset:{action:'runtime-result'},closest:()=>element};
 context.click({target:{closest:selector=>selector==='.vc-file-download'?null:action},preventDefault(){},stopPropagation(){}});
 assert.equal(events[0]?.name,'nodeResult');assert.deepEqual(events[0].payload.runtime,runtime);
 events[0].payload.runtime.result.outputs.values.out.inline='Changed';assert.notEqual(runtime.result.outputs.values.out.inline,'Changed');
 events[0].payload.node.data.changed=true;assert.equal(node.data.changed,undefined);
});
test('getWorkflow serialization reapplies exact topology and identity through IR boundary',()=>{
 const x=boundary();x.apply({nodes:nodes(),links:[['a.out','b.in']],connections:[{id:'logical',from:{node:'a',port:'out'},to:{node:'b',port:'in'},data:{kind:'flow',pointer:{linkId:'logical'}}}]},{center:false});
 const serialized=x.get(),restored=boundary();restored.apply(serialized,{center:false});
 assert.equal(restored.get().connections.length,1);assert.deepEqual(restored.get().connections,serialized.connections);
});
