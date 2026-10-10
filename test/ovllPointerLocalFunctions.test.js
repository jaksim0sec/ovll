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
 const assets=readFileSync(new URL('../front/asset-manifest.js',import.meta.url),'utf8');
 const config=readFileSync(new URL('../front/runtime-config.js',import.meta.url),'utf8');
 assert.match(app,/PointerAPI\.localTurn\(/);
 assert.match(app,/OvllPointerLocal\.turn\(/);
 assert.match(app,/OvllPointerLocal\.run\(/);
 assert.match(assets,/\.\/js\/ovllPointerFunctions\.js/);
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

function functionStore(){
 const data=new Map();let next=0;
 const window={localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},crypto:{randomUUID:()=> 'fn'+(++next)}};
 const reload=()=>{vm.runInNewContext(script,{window});return window.OvllPointerFunctions;};
 return {f:reload(),reload,data};
}
function reusableGraph(){
 return {graph:{graphId:'g_contract',revision:1,nodes:[
  {nodeId:'source',definitionRef:{definitionId:'d_source',version:1},inputBindings:{fresh:'old sample',secret:'unexposed sample',constant:'old constant'}},
  {nodeId:'result',definitionRef:{definitionId:'d_result',version:1}},
  {nodeId:'unrelated_sink',definitionRef:{definitionId:'d_other',version:1},settings:{request:'Send unrelated mail'}}
 ],connections:[{kind:'data',from:{nodeId:'source',port:'out'},to:{nodeId:'result',port:'in'}}]},definitions:[
  {definitionId:'d_source',version:1,inputs:['fresh','secret','constant'].map(name=>({name,role:name,representation:'text',required:false})),outputs:[{name:'out',role:'out',representation:'text'}]},
  {definitionId:'d_result',version:1,inputs:[{name:'in',role:'in',representation:'text'}],outputs:[{name:'out',role:'out',representation:'text'}]},
  {definitionId:'d_other',version:1,inputs:[],outputs:[]}
 ]};
}
test('saved target closure excludes unrelated sinks and their definitions',()=>{
 const {f}=functionStore();const snapshot=reusableGraph();
 const fn=f.save({purpose:'Reuse just the selected result',snapshot,targets:['result']});
 assert.deepEqual(Array.from(fn.snapshot.graph.nodes,n=>n.nodeId),['source','result']);
 assert.deepEqual(Array.from(fn.snapshot.definitions,d=>d.definitionId),['d_source','d_result']);
 assert.equal(snapshot.graph.nodes.length,3);
});
test('partial function contracts clear hidden samples and preserve only explicit fixed values',()=>{
 const {f,reload}=functionStore();
 const fn=f.save({purpose:'Fresh notes',snapshot:reusableGraph(),targets:['result'],
  inputs:[{name:'material',role:'fresh',representation:'text',required:true}],
  inputMap:{material:{nodeId:'source',port:'fresh'}},fixedInputs:{'source:constant':'intentional constant'}});
 const rebound=reload().bind(reload().get(fn.id),{material:'new notes'});
 const bindings=rebound.snapshot.graph.nodes[0].inputBindings;
 assert.equal(bindings.fresh,'new notes');assert.equal(bindings.secret,undefined);
 assert.equal(bindings.constant,'intentional constant');
});
test('new explicit no-input contracts discard samples while old no-input functions remain executable',()=>{
 const {f}=functionStore();
 const fresh=f.save({purpose:'No sample input',snapshot:reusableGraph(),targets:['result'],inputs:[],fixedInputs:{'source:constant':'fixed'}});
 const bindings=f.bind(fresh).snapshot.graph.nodes[0].inputBindings;
 assert.equal(bindings.fresh,undefined);assert.equal(bindings.constant,'fixed');
 const legacy={...fresh};delete legacy.contractVersion;delete legacy.fixedInputs;
 legacy.snapshot.graph.nodes[0].inputBindings.fresh='historical constant';
 assert.equal(f.bind(legacy).snapshot.graph.nodes[0].inputBindings.fresh,'historical constant');
});
test('editing creates pinned immutable versions and inherits semantic contract across reload',()=>{
 const {f,reload}=functionStore();
 const first=f.save({purpose:'Preserve original purpose',invariants:['Keep citations'],snapshot:reusableGraph(),targets:['result'],
  inputs:[{name:'material',role:'material',representation:'text',required:true}],inputMap:{material:{nodeId:'source',port:'fresh'}},
  presentation:{name:'Original',color:'#abc',iconKey:'pencil'}});
 const second=f.save({baseFunctionRef:{id:first.id,version:1},snapshot:reusableGraph(),targets:['result'],presentation:{name:'New name',color:'#12abEF',iconKey:'calendar'}});
 assert.equal(second.id,first.id);assert.equal(second.version,2);
 assert.equal(second.purpose,first.purpose);assert.deepEqual(Array.from(second.invariants),['Keep citations']);
 assert.equal(second.inputs[0].name,'material');
 const current=reload();assert.equal(current.get(first.id,1).presentation.name,'Original');
 assert.equal(current.get(first.id).presentation.name,'New name');assert.equal(current.list().length,1);
 assert.equal(current.get(first.id,99),null);
 assert.throws(()=>current.save({baseFunctionRef:{id:first.id,version:1},snapshot:reusableGraph(),targets:['result']}),/FUNCTION_VERSION_CONFLICT/);
});
test('color HEX normalizes and revisions accept canonical model functionId references',()=>{
 const {f}=functionStore();
 const fn=f.save({purpose:'Color',snapshot:reusableGraph(),targets:['result'],presentation:{name:'Color',color:'#AbC',iconKey:'calendar'}});
 assert.equal(fn.presentation.color,'#aabbcc');
 const revision=f.save({baseFunctionRef:{functionId:fn.id,version:1},presentation:{name:'Revised',color:'#123456',iconKey:'calendar'}});
 assert.equal(revision.version,2);
 assert.throws(()=>f.save({purpose:'Bad color',snapshot:reusableGraph(),targets:['result'],presentation:{color:'url(evil)'}}),/INVALID_FUNCTION_COLOR/);
});
test('explicit constants cannot overlap exposed inputs or name missing ports',()=>{
 const {f}=functionStore();
 assert.throws(()=>f.save({purpose:'Conflict',snapshot:reusableGraph(),targets:['result'],fixedInputs:{'source:fresh':'fixed'}}),/FUNCTION_FIXED_INPUT_CONFLICT/);
 assert.throws(()=>f.save({purpose:'Unknown',snapshot:reusableGraph(),targets:['result'],inputs:[],fixedInputs:{'unknown:port':'fixed'}}),/FUNCTION_FIXED_INPUT_MAPPING_REQUIRED/);
});

test('revising a legacy no-input function makes its historical constants explicit',()=>{
 const {f,data,reload}=functionStore();const snapshot=reusableGraph();
 const old={id:'fn_old_constants',version:1,purpose:'Fixed legacy work',snapshot,targets:['result'],inputs:[],outputs:[],invariants:['Keep purpose']};
 data.set(f.storageKey,JSON.stringify([old]));
 const revised=reload().save({baseFunctionRef:{id:old.id,version:1},presentation:{name:'New name',color:'#abc',iconKey:'pencil'}});
 assert.equal(revised.fixedInputs['source:fresh'],'old sample');
 assert.equal(f.bind(revised).snapshot.graph.nodes[0].inputBindings.fresh,'old sample');
});
test('remembered model-task revisions retain input mapping and immutable instructions',()=>{
 const {f}=functionStore();
 const draft={purpose:'Reuse',inputs:[{name:'source',role:'notes',representation:'text',required:true}],outputs:[],invariants:['Cite'],procedure:{kind:'model_task',instruction:'Original instruction'}};
 const first=f.saveDraft(draft);
 const second=f.saveDraft({...draft,baseFunctionRef:{id:first.id,version:1},procedure:{kind:'model_task',instruction:'Revised instruction'}});
 assert.equal(second.id,first.id);assert.equal(second.version,2);
 assert.equal(f.bind(second,{source:'fresh'}).snapshot.graph.nodes[0].inputBindings.source,'fresh');
 assert.equal(f.get(first.id,1).snapshot.definitions[0].instruction,'Original instruction');
 assert.equal(second.snapshot.definitions[0].instruction,'Revised instruction');
});

test('legacy functions with exposed inputs clear unrelated samples before binding fresh material',()=>{
 const {f}=functionStore();
 const fn={id:'old_partial',version:1,purpose:'Legacy partial',snapshot:reusableGraph(),targets:['result'],
  inputs:[{name:'fresh',role:'fresh',representation:'text',required:true}]};
 const bound=f.bind(fn,{fresh:'Fresh material'});
 assert.equal(bound.snapshot.graph.nodes[0].inputBindings.fresh,'Fresh material');
 assert.equal(bound.snapshot.graph.nodes[0].inputBindings.secret,undefined);
});
test('new replay also removes undeclared stale bindings without mutating saved samples',()=>{
 const {f}=functionStore();const snapshot=reusableGraph();snapshot.graph.nodes[0].inputBindings.undeclared='Old hidden material';
 const fn=f.save({purpose:'Clean input',snapshot,targets:['result']});
 const bound=f.bind(fn,{});
 assert.equal(bound.snapshot.graph.nodes[0].inputBindings.undeclared,undefined);
 assert.equal(fn.snapshot.graph.nodes[0].inputBindings.undeclared,'Old hidden material');
});

test('appearance-only revision retains fields and legacy missing input contract remains no-input',()=>{
 const {f,data,reload}=functionStore();const snapshot=reusableGraph();
 const old={id:'old_implicit',version:1,purpose:'Legacy constants',snapshot,targets:['result'],presentation:{name:'Same name',description:'Same description',iconKey:'pencil',color:'#123456'}};
 data.set(f.storageKey,JSON.stringify([old]));
 const changed=reload().save({baseFunctionRef:{id:old.id,version:1},presentation:{color:'#abc'}});
 assert.equal(changed.inputs.length,0);assert.equal(changed.presentation.name,'Same name');
 assert.equal(changed.presentation.iconKey,'pencil');assert.equal(changed.presentation.color,'#aabbcc');
 assert.equal(f.bind(changed).snapshot.graph.nodes[0].inputBindings.fresh,'old sample');
});

test('graph draft requires explicit selection when unrelated sinks make its result ambiguous',()=>{
 const {f}=functionStore(),snapshot=reusableGraph();
 const draft={purpose:'Selected work',inputs:[],outputs:[],invariants:[],procedure:{kind:'graph',graphRef:{graphId:snapshot.graph.graphId,revision:1}}};
 assert.throws(()=>f.saveDraft(draft,snapshot),/FUNCTION_TARGET_SELECTION_REQUIRED/);
 const fn=f.saveDraft(draft,snapshot,{targets:['result']});
 assert.deepEqual(Array.from(fn.snapshot.graph.nodes,n=>n.nodeId),['source','result']);
 const revised=f.saveDraft({...draft,purpose:'Revised work'},snapshot,{targets:['result'],baseFunctionRef:{functionId:fn.id,version:1}});
 assert.equal(revised.id,fn.id);assert.equal(revised.version,2);
});
