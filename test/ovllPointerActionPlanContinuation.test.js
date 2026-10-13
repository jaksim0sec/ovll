import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLocalPointerHost,compileLocalActionPlan} from '../backend/ovllPointer/localHost.js';
import {compileActionPlan} from '../backend/ovllPointer/actionCompiler.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';
import {withPointerCatalog} from '../backend/ovllPointer/skillCatalog.js';
const created=alias=>({kind:'created',alias});
const fn={purpose:'Compare two outputs',inputs:[],outputs:[{name:'first',role:'First',representation:'json'},{name:'second',role:'Second',representation:'json'}],invariants:['Keep both'],procedure:{kind:'graph'},outputMap:{first:{node:created('one'),port:'result'},second:{node:created('two'),port:'result'}}};
const plan={contract:'action-plan.v1',actions:['one','two'].map(alias=>({action:'node.add',alias,definition:{kind:'builtin',type:'write'}})).concat({action:'function.save',function:fn})};
const initial=()=>withPointerCatalog({graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]});
test('new-node function maps defer only mechanical binding until actual commit refs exist',()=>{
 const continuation={},s=initial();
 const turn=compileActionPlan(plan,{snapshot:s,capabilities:['ir.applyPatch','function.save'],continuation});
 assert.equal(turn.actions.length,1);assert.equal(turn.actions[0].kind,'ir.applyPatch');
 assert.deepEqual(continuation.plan.actions,[plan.actions[2]]);
 assert.deepEqual(Object.keys(continuation.aliasTargets),['one','two']);
 assert.equal(s.graph.nodes.length,0);
});
test('invalid deferred function contracts fail before any actual graph write',()=>{
 const bad=structuredClone(plan);delete bad.actions[2].function.invariants;
 assert.throws(()=>compileActionPlan(bad,{snapshot:initial(),capabilities:['ir.applyPatch','function.save'],continuation:{}}),e=>e.code==='INVALID_FUNCTION_DRAFT');
});
test('a deferred question still creates the existing persistent checkpoint',async()=>{
 const withQuestion=structuredClone(plan);withQuestion.actions.push({action:'question.ask',question:'다음 자료는 무엇인가요?'});
 const repo=new MemoryGraphRepository();repo.restore('w','g',initial());
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async()=>({text:JSON.stringify(withQuestion)})}});
 const global={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),{window:global,console});
 let checkpoints=0;
 const result=await global.OvllPointerLocalActions.coordinate({getContext:async()=>({snapshot:repo.get('w','g')}),
  request:args=>host.turn({...JSON.parse(JSON.stringify(args)),requestRef:'q',requestText:'Create two nodes, save function, and ask for the next source'}),
  requestCompile:args=>compileLocalActionPlan({...JSON.parse(JSON.stringify(args)),requestRef:'qc',requestText:'Create two nodes, save function, and ask for the next source'}),
  onCheckpoint:async()=>{checkpoints++;},handlers:{'ir.applyPatch':async a=>({status:'applied',...repo.apply('w',a.args.patch)}),
   'function.save':async()=>({status:'saved'}),'question.ask':async a=>({status:'waiting',question:a.args.question,questionId:'next'})}
 });
 assert.equal(checkpoints,1);assert.equal(result.checkpoint.questionId,'next');assert.equal(result.checkpoint.graphRef.revision,1);
});
test('patch, exact function mapping and save complete without a second model call',async()=>{
 let modelCalls=0,compileCalls=0,saved;
 const repo=new MemoryGraphRepository();repo.restore('w','g',initial());
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async()=>{modelCalls++;return {text:JSON.stringify(plan)};}}});
 const global={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),{window:global,console});
 const result=await global.OvllPointerLocalActions.coordinate({
  getContext:async()=>({snapshot:repo.get('w','g')}),
  request:args=>host.turn({...JSON.parse(JSON.stringify(args)),requestRef:'create_save',requestText:'Create two writing nodes and save the graph function'}),
  requestCompile:args=>{compileCalls++;return compileLocalActionPlan({...JSON.parse(JSON.stringify(args)),requestRef:'compile_save',requestText:'Create two writing nodes and save the graph function'});},
  handlers:{'ir.applyPatch':async a=>({status:'applied',...repo.apply('w',a.args.patch)}),
   'function.save':async a=>{saved=a.args.function;return {status:'saved',functionRef:'fn'};}}
 });
 assert.equal(modelCalls,1);assert.equal(compileCalls,1);
 assert.deepEqual(Array.from(result.facts,f=>f.status),['applied','saved']);
 const nodes=repo.get('w','g').graph.nodes;
 assert.equal(saved.outputMap.first.nodeId,nodes[0].nodeId);assert.equal(saved.outputMap.second.nodeId,nodes[1].nodeId);
 assert.deepEqual(saved.outputs,fn.outputs);assert.deepEqual(saved.invariants,fn.invariants);
 assert.equal(saved.procedure.graphRef.revision,1);
});
test('failed patches never compile or save their deferred function',async()=>{
 let compileCalls=0,saveCalls=0;
 const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{complete:async()=>({text:JSON.stringify(plan)})}});
 const global={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),{window:global,console});
 const result=await global.OvllPointerLocalActions.coordinate({getContext:async()=>({snapshot:initial()}),
  request:args=>host.turn({...JSON.parse(JSON.stringify(args)),requestRef:'failure',requestText:'Create two writing nodes and save function'}),
  requestCompile:async()=>{compileCalls++;},handlers:{'ir.applyPatch':async()=>({status:'failed',error:'STALE_REVISION'}),'function.save':async()=>{saveCalls++;}}
 });
 assert.equal(compileCalls,0);assert.equal(saveCalls,0);assert.ok(result.facts.every(f=>f.status==='failed'));
});
test('explicit mapped graph outputs select saved targets without guessing among repeated ports',()=>{
 const storage=new Map(),global={crypto,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerFunctions.js',import.meta.url),'utf8'),{window:global,console});
 const s=initial();s.graph.nodes=['one','two'].map(nodeId=>({nodeId,definitionRef:{definitionId:'builtin:write',version:1},settings:{},inputBindings:{}}));
 const draft={...fn,procedure:{kind:'graph',graphRef:{graphId:'g',revision:0}},outputMap:{first:{nodeId:'one',port:'result'},second:{nodeId:'two',port:'result'}}};
 const saved=global.OvllPointerFunctions.saveDraft(draft,s);
 assert.deepEqual(Array.from(saved.targets),['one','two']);assert.equal(saved.outputMap.first.nodeId,'one');
 assert.equal(saved.verificationStatus,'draft');
});
test('canonical function-save IDs retain the existing function version history',()=>{
 const storage=new Map(),global={crypto,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)}};
 vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerFunctions.js',import.meta.url),'utf8'),{window:global,console});
 const f=global.OvllPointerFunctions,draft={purpose:'Reusable write',inputs:[],outputs:[{name:'result',role:'Output',representation:'text'}],invariants:[],procedure:{kind:'model_task',instruction:'Write'}};
 const first=f.saveDraft(draft);
 const second=f.saveDraft({...draft,purpose:'Revised write'},null,{baseFunctionRef:first.id});
 assert.equal(second.id,first.id);assert.equal(second.version,2);assert.equal(f.get(first.id,1).purpose,'Reusable write');
});
