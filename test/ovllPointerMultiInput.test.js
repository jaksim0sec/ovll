import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import * as core from '../front/js/ovllPointerGraphCore.mjs';
import * as plan from '../front/js/ovllPointerPlanCore.mjs';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';

test('two source nodes connect to one built-in input, execute independently, and reach the consumer',async()=>{
  const values=new Map(),localStorage={getItem:key=>values.get(key)||null,
    setItem:(key,value)=>values.set(key,value)};
  const window={crypto:{randomUUID},localStorage};
  for(const name of ['workspaceStore','ovllPointerLocal','ovllPointerProjection','ovllPointerGraphPatch'])
    vm.runInNewContext(readFileSync(new URL('../front/js/'+name+'.js',import.meta.url),'utf8'),
      {window,localStorage,console});
  const store=window.OvllWorkspaceStore,conversationId=store.getActiveConversation().id;
  const local=window.createOvllPointerLocal({workspaceStore:store,loadCore:async()=>core,
    loadPlan:async()=>plan,loadResults:()=>import('../front/js/ovllPointerResults.mjs'),
    loadCatalog:async()=>getPointerCatalog()});
  const graphId=local.graphId(conversationId);
  const node=key=>({op:'node.add',localNodeKey:key,
    definitionRef:{definitionId:'builtin:write',version:1},
    settings:{request:key+' request'}});
  const link=(key,from)=>({op:'link.add',localLinkKey:key,kind:'data',
    from:{node:{localNodeKey:from},port:'result'},
    to:{node:{localNodeKey:'combined'},port:'in'}});
  const patch={graphId,expectedGraphRevision:0,definitions:[],
    operations:[node('first'),node('second'),node('combined'),
      link('firstToCombined','first'),link('secondToCombined','second')]};
  const edited=await local.turn({conversationId,graphId,
    actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch}}]});
  assert.equal(edited.results[0].status,'applied');
  const refs=edited.results[0].createdRefs;
  const target=refs['node:combined'];
  const snapshot=(await local.state(conversationId)).graph;
  const projected=window.OvllPointerProjection.projectGraph(snapshot);
  assert.equal(projected.definitions.write.inputs[0].multiple,true);
  assert.equal(projected.workflow.connections.filter(c=>c.to.node===target&&c.to.port==='in').length,2);
  assert.equal(window.OvllPointerGraphPatch.build(snapshot,projected.workflow),null);

  const invoked=[];
  const run=await local.run({conversationId,targets:[target],
    executeNode:async args=>{
      invoked.push({id:args.nodeId,inputs:args.inputArtifacts});
      if(args.nodeId===target){
        assert.equal(args.inputArtifacts.length,2);
        assert.deepEqual(Array.from(args.inputArtifacts,x=>x.port),['in','in']);
        assert.deepEqual(Array.from(args.inputArtifacts,x=>x.value).sort(),['First material','Second material']);
        assert.equal(new Set(args.inputArtifacts.map(x=>x.sourceNodeId)).size,2);
      }
      const value=args.nodeId===target?'Combined material':
        args.nodeId===refs['node:first']?'First material':'Second material';
      return {status:'success',outputs:{status:'produced',values:{result:{inline:value}}}};
    }});
  assert.equal(run.status,'completed');
  assert.equal(invoked.length,3);
  assert.equal(run.nodes.find(x=>x.nodeId===target).outputs.values.result.inline,'Combined material');
});

test('explicit exclusive port cannot accept multi-fan-in and literal binding cannot coexist with a wire',()=>{
  const definition={definitionId:'single',version:1,executorKind:'model_task',
    purpose:'Only one',instruction:'Use one',inputs:[{name:'in',representation:'json',multiple:false}],
    outputs:[{name:'result',representation:'json'}]};
  const graph={graphId:'g',revision:0,nodes:['a','b','consumer'].map(nodeId=>({
    nodeId,definitionRef:{definitionId:'single',version:1},settings:{},inputBindings:{}})),
    connections:['a','b'].map((nodeId,i)=>({id:'l'+i,kind:'data',
      from:{nodeId,port:'result'},to:{nodeId:'consumer',port:'in'}}))};
  const repo=new core.MemoryGraphRepository();
  assert.throws(()=>repo.restore('w','g',{graph,definitions:[definition]}),
    e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
  definition.inputs[0].multiple=true;
  graph.nodes[2].inputBindings={in:'fixed value'};
  assert.throws(()=>repo.restore('w','g',{graph,definitions:[definition]}),
    e=>e.code==='AMBIGUOUS_INPUT_PRODUCERS');
});

test('the same exact source-to-port connection is never duplicated accidentally',()=>{
  const definition={definitionId:'d',version:1,purpose:'merge',instruction:'merge',
    executorKind:'model_task',inputs:[{name:'in',representation:'json'}],
    outputs:[{name:'result',representation:'json'}]};
  const graph={graphId:'g',revision:0,nodes:['a','target'].map(nodeId=>({
    nodeId,definitionRef:{definitionId:'d',version:1},inputBindings:{},settings:{}})),
    connections:['l1','l2'].map(id=>({id,kind:'data',
      from:{nodeId:'a',port:'result'},to:{nodeId:'target',port:'in'}}))};
  assert.throws(()=>new core.MemoryGraphRepository().restore('w','g',{graph,definitions:[definition]}),
    e=>e.code==='DUPLICATE_INPUT_SOURCE');
});

test('custom definitions may expose multiple separately named input ports',()=>{
  const definition={definitionId:'custom:compare',version:1,purpose:'Compare',instruction:'Compare inputs',
    executorKind:'model_task',inputs:[
      {name:'source',role:'자료',representation:'json'},
      {name:'criteria',role:'기준',representation:'json',multiple:false},
      {name:'reference',role:'참고',representation:'json'}],
    outputs:[{name:'result',role:'결과',representation:'json'}]};
  const graph={graphId:'named',revision:0,nodes:['sourceA','sourceB','target'].map(nodeId=>({
    nodeId,definitionRef:{definitionId:'custom:compare',version:1},settings:{},inputBindings:{}})),
    connections:[
      {id:'one',kind:'data',from:{nodeId:'sourceA',port:'result'},to:{nodeId:'target',port:'source'}},
      {id:'two',kind:'data',from:{nodeId:'sourceB',port:'result'},to:{nodeId:'target',port:'reference'}}]};
  new core.MemoryGraphRepository().restore('w','named',{graph,definitions:[definition]});
  const window={};
  vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerProjection.js',import.meta.url),'utf8'),{window});
  const projected=window.OvllPointerProjection.projectGraph({graph,definitions:[definition]});
  const inputs=projected.definitions['pointer:custom:compare:1'].inputs;
  assert.deepEqual(inputs.map(p=>p.id),['source','criteria','reference']);
  assert.deepEqual(inputs.map(p=>p.multiple),[true,false,true]);
});
