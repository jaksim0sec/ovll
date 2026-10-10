import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const window={};
for(const name of ['Projection','GraphPatch'])
  vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointer'+name+'.js',import.meta.url),'utf8'),{window});
const edge=(from,to,port='source',kind='data')=>({id:from+'_'+to+'_'+port+'_'+kind,kind,
  from:{nodeId:from,port:'result'},to:{nodeId:to,port}});
const canvasEdge=(from,to,port='source',kind='data')=>({from:{node:from,port:'result'},
  to:{node:to,port},data:{kind}});
function sample(){
  const definition={definitionId:'d',version:1,purpose:'Use sources',instruction:'Preserve evidence',
    executorKind:'model_task',inputs:['source','constant','established'].map(name=>({name,representation:'text'})),
    outputs:[{name:'result',representation:'text'}]};
  return {definitions:[definition],graph:{graphId:'g',revision:1,nodes:['a','b','other'].map(nodeId=>({
    nodeId,definitionRef:{definitionId:'d',version:1},settings:{},
    inputBindings:nodeId==='b'?{source:'Literal source',constant:'Keep this'}:{}})),
    connections:[edge('other','b','established')]}};
}
const workflow=snapshot=>clone(window.OvllPointerProjection.projectGraph(snapshot).workflow);
const build=(snapshot,view)=>clone(window.OvllPointerGraphPatch.build(snapshot,view).patch);
function repository(snapshot){const repo=new MemoryGraphRepository();repo.restore('w','g',snapshot);return repo;}
function apply(repo,patch){let id=0;return repo.apply('w',patch,()=>String(++id));}

test('manual research-to-export data link replaces the export literal in one valid patch',()=>{
  const snapshot={definitions:getPointerCatalog().definitions,graph:{graphId:'g',revision:1,nodes:[
    {nodeId:'a',definitionRef:{definitionId:'builtin:research',version:1},inputBindings:{in:{topic:'Research this'}},settings:{}},
    {nodeId:'b',definitionRef:{definitionId:'builtin:createFile',version:1},inputBindings:{in:{text:'Previous body'}},settings:{request:'Export PDF'}}
  ],connections:[]}};
  const view=workflow(snapshot);
  // A manual canvas gesture has no kind metadata; declared builtin ports infer data.
  view.connections.push({from:{node:'a',port:'result'},to:{node:'b',port:'in'}});
  const repo=repository(snapshot);apply(repo,build(snapshot,view));
  const graph=repo.get('w','g').graph;
  assert.equal(graph.revision,2);
  assert.deepEqual(graph.nodes[1].inputBindings,{});
  assert.deepEqual(graph.nodes[0].inputBindings,snapshot.graph.nodes[0].inputBindings);
  assert.deepEqual(graph.nodes[1].settings,{request:'Export PDF'});
  assert.equal(graph.connections[0].kind,'data');
  assert.equal(graph.connections[0].to.port,'in');
});

test('new data links preserve unrelated bindings, existing connections and caller objects',()=>{
  const snapshot=sample(),view=workflow(snapshot);
  view.connections.push(canvasEdge('a','b'));
  const before=clone({snapshot,view}),repo=repository(snapshot);
  apply(repo,build(snapshot,view));
  const graph=repo.get('w','g').graph;
  assert.deepEqual(graph.nodes[1].inputBindings,{constant:'Keep this'});
  assert.deepEqual(graph.connections[0],snapshot.graph.connections[0]);
  assert.equal(graph.connections.length,2);
  assert.deepEqual({snapshot,view},before);
});

test('new data links use persisted bindings when canvas metadata is absent',()=>{
  const snapshot=sample(),view=workflow(snapshot);
  delete view.nodes[1].data.pointer.inputBindings;
  view.connections.push(canvasEdge('a','b'));
  const repo=repository(snapshot);apply(repo,build(snapshot,view));
  assert.deepEqual(repo.get('w','g').graph.nodes[1].inputBindings,{constant:'Keep this'});
});

test('new destination nodes also replace only the newly linked literal binding',()=>{
  const snapshot=sample(),view=workflow(snapshot);
  view.nodes.push({id:'new',type:'pointer:d:1',data:{pointer:{inputBindings:{source:'Initial source',constant:'New constant'}}}});
  view.connections.push(canvasEdge('a','new'));
  const repo=repository(snapshot);apply(repo,build(snapshot,view));
  const node=repo.get('w','g').graph.nodes.at(-1);
  assert.deepEqual(node.inputBindings,{constant:'New constant'});
  assert.equal(repo.get('w','g').graph.connections.at(-1).to.nodeId,node.nodeId);
});

test('flow additions and unrelated edits preserve literal data bindings',()=>{
  const snapshot=sample(),view=workflow(snapshot);
  view.connections.push(canvasEdge('a','b','source','flow'));
  view.nodes[1].data.params={request:'Updated request'};
  const repo=repository(snapshot);apply(repo,build(snapshot,view));
  assert.deepEqual(repo.get('w','g').graph.nodes[1].inputBindings,snapshot.graph.nodes[1].inputBindings);
});

test('unchanged data links do not silently remove a conflicting new literal binding',()=>{
  const snapshot=sample(),view=workflow(snapshot);
  view.nodes[1].data.pointer.inputBindings.established='Conflicting edit';
  const repo=repository(snapshot);
  assert.throws(()=>apply(repo,build(snapshot,view)),error=>error.code==='AMBIGUOUS_INPUT_PRODUCERS');
  assert.deepEqual(repo.get('w','g'),snapshot);
});

test('two new data producers remain rejected atomically',()=>{
  const snapshot=sample(),view=workflow(snapshot);
  view.connections.push(canvasEdge('a','b'),canvasEdge('other','b'));
  const repo=repository(snapshot);
  assert.throws(()=>apply(repo,build(snapshot,view)),error=>error.code==='AMBIGUOUS_INPUT_PRODUCERS');
  assert.deepEqual(repo.get('w','g'),snapshot);
});
