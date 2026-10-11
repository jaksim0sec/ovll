import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as graphCore from '../front/js/ovllPointerGraphCore.mjs';
import * as planCore from '../front/js/ovllPointerPlanCore.mjs';
import * as resultCore from '../front/js/ovllPointerResults.mjs';

const read=name=>readFileSync(new URL('../front/js/'+name,import.meta.url),'utf8');
test('source comparison saves once and reuses with new materials without graph reauthoring',async()=>{
 const savedBytes=new Map();
 const window={crypto:{randomUUID:()=>String(savedBytes.size+1)+'-saved'},
  localStorage:{getItem:key=>savedBytes.get(key)||null,setItem:(key,value)=>savedBytes.set(key,value)}};
 vm.runInNewContext(read('ovllPointerFunctions.js'),{window});
 const defA={definitionId:'d_extract',version:1,purpose:'Extract claims',
  instruction:'Extract actual claims and their evidence',executorKind:'model_task',
  inputs:[{name:'in',role:'Source',representation:'text',required:true}],
  outputs:[{name:'result',role:'Evidence',representation:'text'}]};
 const defB={definitionId:'d_compare',version:1,purpose:'Compare',
  instruction:'Compare both source-backed outputs',executorKind:'model_task',
  inputs:[{name:'in',role:'Evidence items',representation:'text',multiple:true,required:true}],
  outputs:[{name:'result',role:'Comparison',representation:'text'}]};
 const snapshot={graph:{graphId:'g_compare',revision:1,nodes:[
   {nodeId:'a',definitionRef:{definitionId:'d_extract',version:1},
    settings:{request:'Analyze first source'},inputBindings:{in:'Saved old A'}},
   {nodeId:'b',definitionRef:{definitionId:'d_extract',version:1},
    settings:{request:'Analyze second source'},inputBindings:{in:'Saved old B'}},
   {nodeId:'compare',definitionRef:{definitionId:'d_compare',version:1},
    settings:{request:'Compare claims without dropping provenance'},inputBindings:{}}
  ],connections:[
   {id:'a-to-compare',kind:'data',from:{nodeId:'a',port:'result'},to:{nodeId:'compare',port:'in'}},
   {id:'b-to-compare',kind:'data',from:{nodeId:'b',port:'result'},to:{nodeId:'compare',port:'in'}}
  ]},definitions:[defA,defB]};
 const f=window.OvllPointerFunctions;
 const fn=f.save({purpose:'Reusable two-source comparison',snapshot,targets:['compare'],
  invariants:['Keep the source of each claim']});
 assert.equal(fn.inputs.length,2,'replay should require only two new source values');
 assert.equal(fn.snapshot.graph.connections.length,2,'saved procedure retains its data links');
 vm.runInNewContext(read('ovllPointerFunctions.js'),{window});
 const revived=window.OvllPointerFunctions.get(fn.id);
 assert.ok(revived,'saved procedure survives reopening');
 const state={pointerGraph:snapshot,pointerRuns:[]};
 const workspaceStore={getConversation:()=>({state}),
  updateConversationPointerRuns:(_id,runs)=>{state.pointerRuns=runs},
  getPointerDefinitions:()=>[],updateConversationPointerGraph:()=>{}};
 window.OvllWorkspaceStore=workspaceStore;
 vm.runInNewContext(read('ovllPointerLocal.js'),{window,console});
 const local=window.createOvllPointerLocal({workspaceStore,
  loadCore:async()=>graphCore,loadPlan:async()=>planCore,
  loadResults:async()=>resultCore,loadCatalog:async()=>({definitions:[defA,defB]})});
 const app=read('app.js'),start=app.indexOf('async function runSavedLocalFunction(fn,bindings){'),
  end=app.indexOf('  async function runLocalPrompt(',start);
 assert.ok(start>=0&&end>start,'production replay entry point');
 const calls=[];
 const replay=new Function('global','runLocalNodes',app.slice(start,end)+
  ';return runSavedLocalFunction')(window,async args=>local.run({...args,
    conversationId:'compare-workspace',executeNode:async step=>{
     const node=step.snapshot.graph.nodes.find(n=>n.nodeId===step.nodeId);
     const incoming=Array.from(step.inputArtifacts,x=>x.value);
     calls.push({nodeId:step.nodeId,request:step.requestText,incoming});
     const value=step.nodeId==='compare'?
       'Comparison: '+incoming.join(' / '):
       'Evidence '+step.nodeId+': '+node.inputBindings.in;
     return {status:'success',outputs:{status:'produced',values:{result:{inline:value}}}};
    }}));
 const results=[];
 for(const [first,second] of [['A1','A2'],['B1','B2'],['C1','C2']]){
  const startCall=calls.length;
  const bindings={[revived.inputs.find(i=>i.name==='a:in').name]:first,
    [revived.inputs.find(i=>i.name==='b:in').name]:second};
  const run=await replay(revived,bindings);
  assert.equal(run.status,'completed');
  const attempts=calls.slice(startCall);
  assert.deepEqual(attempts.map(x=>x.nodeId),['a','b','compare']);
  assert.deepEqual(attempts.map(x=>x.request),
    ['Analyze first source','Analyze second source','Compare claims without dropping provenance']);
  assert.deepEqual(attempts[2].incoming,['Evidence a: '+first,'Evidence b: '+second]);
  const report=run.nodes.find(x=>x.nodeId==='compare')?.outputs?.values?.result?.inline;
  assert.equal(report,'Comparison: Evidence a: '+first+' / Evidence b: '+second);
  results.push(report);
 }
 assert.equal(new Set(results).size,3,'each new source pair gets its own results');
 assert.equal(f.get(fn.id).snapshot.graph.nodes[0].inputBindings.in,'Saved old A');
 assert.equal(f.get(fn.id).snapshot.graph.nodes[1].inputBindings.in,'Saved old B');
 assert.equal(revived.verificationStatus,'draft','successful mock execution is not model quality verification');
});
