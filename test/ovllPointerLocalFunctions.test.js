import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const script=readFileSync(new URL('../front/js/ovllPointerFunctions.js',import.meta.url),'utf8');
test('locally saved function is a pinned immutable unverified draft and can be reused',()=>{
 const data=new Map(),localStorage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const window={localStorage,crypto:{randomUUID:()=> 'abcd'}};
 vm.runInNewContext(script,{window});
 const graph={graph:{graphId:'g',revision:1,nodes:[{nodeId:'n1'}],connections:[]},definitions:[]};
 const saved=window.OvllPointerFunctions.save({purpose:'Research',snapshot:graph,targets:['n1']});
 graph.graph.revision=3;
 assert.equal(window.OvllPointerFunctions.get(saved.id).snapshot.graph.revision,1);
 assert.equal(saved.verificationStatus,'draft');
 vm.runInNewContext(script,{window});
 assert.equal(window.OvllPointerFunctions.list()[0].id,saved.id);
});
test('saved functions reject dangling node targets',()=>{
 const window={localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=> 'abcd'}};
 vm.runInNewContext(script,{window});
 assert.throws(()=>window.OvllPointerFunctions.save({purpose:'no',snapshot:{
  graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]},targets:['unknown']}),
  /INVALID_LOCAL_FUNCTION/);
});
test('local application hooks model proposals to stored graph and executes model-only DAG',()=>{
 const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
 const boot=readFileSync(new URL('../front/js/boot.js',import.meta.url),'utf8');
 const config=readFileSync(new URL('../front/runtime-config.js',import.meta.url),'utf8');
 assert.match(app,/PointerAPI\.localTurn\(/);
 assert.match(app,/OvllPointerLocal\.turn\(/);
 assert.match(app,/OvllPointerLocal\.run\(/);
 assert.match(boot,/\.\/js\/ovllPointerFunctions\.js/);
 assert.match(config,/pointerEnabled:true/);
});

test('preserves saved function drafts created before OvllPointer rename',()=>{
  const cache=new Map(),storage={getItem:k=>cache.get(k)||null,setItem:(k,v)=>cache.set(k,v)};
  cache.set('ovll:vnext:functions:v1',JSON.stringify([{id:'fn_old',purpose:'기존 초안',version:1,
    snapshot:{graph:{graphId:'g_old',revision:1,nodes:[{nodeId:'a'}],connections:[]},definitions:[]},targets:['a']}]));
  const window={localStorage:storage,crypto:{randomUUID:()=> 'abcd'}};
  vm.runInNewContext(script,{window});
  assert.equal(window.OvllPointerFunctions.list()[0].purpose,'기존 초안');
  window.OvllPointerFunctions.save({purpose:'new',snapshot:{graph:{graphId:'g_new',revision:1,nodes:[{nodeId:'n'}],connections:[]},definitions:[]},targets:['n']});
  assert.equal(window.OvllPointerFunctions.list().length,2);
});
test('saved replay binds new inputs without rewriting purpose or remembered instructions',()=>{
 const data=new Map(),window={localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},crypto:{randomUUID:()=> 'replay'}};
 vm.runInNewContext(script,{window});const f=window.OvllPointerFunctions;
 const snapshot={graph:{graphId:'g',revision:1,nodes:[{nodeId:'n',definitionRef:{definitionId:'d',version:1},inputBindings:{source:'Old example'}}],connections:[]},definitions:[{definitionId:'d',version:1,purpose:'Summarize',instruction:'Preserve citations',inputs:[{name:'source',role:'자료',representation:'text',required:true}],outputs:[{name:'result',role:'summary',representation:'text'}]}]};
 const saved=f.save({purpose:'Summarize customer notes',snapshot,targets:['n'],invariants:['Preserve names']});
 assert.equal(typeof f.bind,'function');
 const rebound=f.bind(saved,{[saved.inputs[0].name]:'New notes'});
 assert.equal(rebound.snapshot.graph.nodes[0].inputBindings.source,'New notes');
 assert.equal(rebound.requestText,'Summarize customer notes');
 assert.equal(rebound.snapshot.definitions[0].instruction,'Preserve citations');
 assert.equal(rebound.invariants[0],'Preserve names');
 assert.equal(f.get(saved.id).snapshot.graph.nodes[0].inputBindings.source,'Old example');
 assert.throws(()=>f.bind(saved,{}),/FUNCTION_INPUT_REQUIRED/);
});
test('simple remembered model work saves and replays without editing the canvas',()=>{
 const values=new Map(),window={localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},crypto:{randomUUID:()=>Math.random().toString(36).slice(2)}};
 vm.runInNewContext(script,{window});const f=window.OvllPointerFunctions;
 assert.equal(typeof f.saveDraft,'function');
 const fn=f.saveDraft({purpose:'Summarize',inputs:[{name:'source',role:'notes',representation:'text'}],outputs:[{name:'result',role:'summary',representation:'text'}],invariants:['Preserve names'],procedure:{kind:'model_task',instruction:'Summarize supplied notes faithfully'}});
 assert.equal(fn.snapshot.graph.nodes.length,1);
 const bound=f.bind(fn,{source:'Fresh notes'});
 assert.equal(bound.snapshot.graph.nodes[0].inputBindings.source,'Fresh notes');
 assert.equal(bound.invariants[0],'Preserve names');
});
test('a remembered file workflow exposes fresh files instead of silently replaying the old source',()=>{
 const values=new Map(),window={localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},crypto:{randomUUID:()=> 'filefn'}};
 vm.runInNewContext(script,{window});const f=window.OvllPointerFunctions;
 const snapshot={graph:{graphId:'g',revision:1,nodes:[{nodeId:'file',definitionRef:{definitionId:'builtin:file',version:1},settings:{file:{name:'old.txt',textPreview:'Old notes'}}},{nodeId:'write',definitionRef:{definitionId:'d',version:1}}],connections:[{kind:'data',from:{nodeId:'file',port:'file'},to:{nodeId:'write',port:'in'}}]},definitions:[{definitionId:'builtin:file',version:1,executorKind:'tool_task',requiredCapabilities:['file.read_local'],inputs:[],outputs:[{name:'file',role:'file',representation:'json'}]},{definitionId:'d',version:1,inputs:[{name:'in',role:'material',representation:'json'}],outputs:[{name:'result',role:'report',representation:'json'}]}]};
 const fn=f.save({purpose:'Write from a file',snapshot,targets:['write']});
 assert.equal(fn.inputs.length,1);
 const bound=f.bind(fn,{[fn.inputs[0].name]:{name:'fresh.txt',textPreview:'Fresh notes'}});
 assert.equal(bound.snapshot.graph.nodes[0].settings.file.textPreview,'Fresh notes');
 assert.equal(f.get(fn.id).snapshot.graph.nodes[0].settings.file.name,'old.txt');
 assert.throws(()=>f.bind(fn,{[fn.inputs[0].name]:'Not a file'}),/FUNCTION_INPUT_TYPE_MISMATCH/);
});
test('optional fresh inputs can be omitted without reusing stale sample bindings',()=>{
 const window={localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=> 'optional'}};vm.runInNewContext(script,{window});const f=window.OvllPointerFunctions;
 const fn=f.saveDraft({purpose:'Write',inputs:[{name:'in',role:'optional material',representation:'text',required:false}],outputs:[{name:'result',role:'text',representation:'text'}],invariants:[],procedure:{kind:'model_task',instruction:'Write from supplied material when present'}});
 fn.snapshot.graph.nodes[0].inputBindings.in='Old sample';
 const run=f.bind(fn,{});assert.equal(run.snapshot.graph.nodes[0].inputBindings.in,undefined);
});
test('explicit file destination without a kind is normalized to file replacement',()=>{
 const window={localStorage:{getItem:()=>null,setItem:()=>{}},crypto:{randomUUID:()=> 'mapped'}};vm.runInNewContext(script,{window});const f=window.OvllPointerFunctions;
 const snapshot={definitions:[{definitionId:'f',version:1,executorKind:'tool_task',requiredCapabilities:['file.read_local'],inputs:[],outputs:[{name:'file',role:'file',representation:'json'}]}],graph:{graphId:'g',revision:1,nodes:[{nodeId:'n',definitionRef:{definitionId:'f',version:1},settings:{file:{name:'old.txt'}}}],connections:[]}};
 const fn=f.save({purpose:'Read file',snapshot,targets:['n'],inputs:[{name:'source',role:'file',representation:'json',required:true}],inputMap:{source:{nodeId:'n',port:'file'}}});
 assert.equal(f.bind(fn,{source:{name:'new.txt'}}).snapshot.graph.nodes[0].settings.file.name,'new.txt');
});
test('old-format saved functions infer only unambiguous scoped inputs and bind new material',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
 const input={name:'source',role:'notes',representation:'text',required:true};
 const old={id:'fn_old',version:1,purpose:'Summarize notes',inputs:[input],outputs:[],targets:['n'],invariants:['Preserve names'],
  snapshot:{graph:{graphId:'g_old',revision:1,nodes:[{nodeId:'n',definitionRef:{definitionId:'d',version:1},inputBindings:{source:'Old notes'}}],connections:[]},
   definitions:[{definitionId:'d',version:1,executorKind:'model_task',instruction:'Summarize faithfully',inputs:[input],outputs:[{name:'result',role:'summary',representation:'text'}]}]}};
 storage.setItem('ovll:vnext:functions:v1',JSON.stringify([old]));
 const window={localStorage:storage};vm.runInNewContext(script,{window});const f=window.OvllPointerFunctions;
 const bound=f.bind(f.get(old.id),{source:'New notes'});
 assert.equal(bound.snapshot.graph.nodes[0].inputBindings.source,'New notes');
 assert.equal(bound.requestText,old.purpose);assert.deepEqual(Array.from(bound.invariants),old.invariants);
 assert.equal(f.get(old.id).snapshot.graph.nodes[0].inputBindings.source,'Old notes');
 const ambiguous=structuredClone(old);ambiguous.targets.push('n2');ambiguous.snapshot.graph.nodes.push({...ambiguous.snapshot.graph.nodes[0],nodeId:'n2'});
 assert.throws(()=>f.bind(ambiguous,{source:'New notes'}),/FUNCTION_INPUT_MAPPING_REQUIRED/);
});
