import test from 'node:test';
import assert from 'node:assert/strict';
import * as contracts from '../backend/ovllPointer/modelContract.js';
import {createContractValidation,splitModelMetadata} from '../backend/ovllPointer/validation.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';
import {withPointerCatalog} from '../backend/ovllPointer/skillCatalog.js';

test('complete teaching examples cover explanation, edit without run, new definition without run and composed execution',async()=>{
 const examples=contracts.canonicalTurnExamples?.()||[{id:'compose-run',turn:contracts.canonicalTurnExample()}];
 assert.deepEqual(examples.map(e=>e.id),['chat','edit-only','new-kind','compose-run']);
 const validation=createContractValidation();
 for(const example of examples){
  assert.equal(validation.validateTurn(example.turn),true,example.id);
  assert.deepEqual(contracts.decodePhaseOutput(contracts.toWireTurnExample(example.turn),'turn'),example.turn);
  assert.deepEqual(contracts.phaseOutputIssues(example.turn,'turn'),[]);
  const repo=new MemoryGraphRepository(),snapshot=withPointerCatalog(example.snapshot);
  repo.restore('example',snapshot.graph.graphId,snapshot);
  const resolved=new Map();
  for(const action of example.turn.actions||[]){
   if(action.kind==='ir.applyPatch')resolved.set(action.localKey,repo.apply('example',action.args.patch));
   if(action.kind==='run.start')for(const target of action.args.targets){
    assert.ok(action.dependsOn.includes(target.fromAction));
    const nodeId=resolved.get(target.fromAction).createdRefs['node:'+target.localNodeKey];
    assert.ok(repo.get('example',snapshot.graph.graphId).graph.nodes.some(n=>n.nodeId===nodeId));
   }
  }
  for(const wire of [false,true]){
   const calls=[];
   const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),
    gateway:{capabilities:()=>({structuredOutput:wire}),complete:async request=>{
     calls.push(request);return {text:JSON.stringify(wire?contracts.toWireTurnExample(example.turn):example.turn)};
    }}});
   const output=await host.turn({snapshot:example.snapshot,requestRef:'example_'+example.id,requestText:example.requestText,extraContext:{selectedModules:['action.nodes','action.definitions','action.execution']}});
   assert.deepEqual(splitModelMetadata(output).domain,example.turn);
   assert.equal(calls.length,1,'valid examples need no repair');
   assert.ok(calls[0].messages.some(m=>m.content.includes('CORRIDOR SELECTION')));
   const workshop=contracts.localModelContract(undefined,{wire,selectedModules:['action.nodes','action.definitions','action.execution']});
   for(const taught of contracts.semanticTurnExamples().filter(e=>e.id!=='chat')){
    const json=JSON.stringify(wire?contracts.toWireActionPlan(taught.plan):taught.plan);
    assert.ok(workshop.includes(json),'selected '+(wire?'wire':'canonical')+' teaching example '+taught.id);
   }
  }
 }
 const noRun=examples.filter(e=>e.id!=='compose-run');
 for(const e of noRun){assert.equal(e.turn.executionIntent,undefined);assert.ok(!(e.turn.actions||[]).some(a=>a.kind==='run.start'));}
 const fresh=examples.find(e=>e.id==='new-kind').turn.actions[0].args.patch;
 assert.equal(fresh.definitions.length,1);
 assert.equal(fresh.operations[0].definitionRef.localDefinitionKey,fresh.definitions[0].localKey);
});
