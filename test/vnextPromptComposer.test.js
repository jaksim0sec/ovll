import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptComposer } from '../backend/vnext/promptComposer.js';
import { createModelNodeExecutor } from '../backend/vnext/modelExecutor.js';
import { createVNextRuntime } from '../backend/vnext/runtime.js';

const context={requestRef:'r1',objective:'Summarize notes',constraints:['Preserve sources'],
  capabilities:[],outputContract:'NodeOutput',requestText:'Summarize these notes',
  materials:[{ref:'source1',kind:'text',source:'user_input',content:'Actual source text',
    truncated:false,provenanceRefs:['user:r1']}]};
const definition={definitionId:'d1',version:1,executorKind:'model_task',
  purpose:'Summarize',instruction:'One sentence',inputs:[{name:'source',role:'source',representation:'text'}],
  outputs:[{name:'result',role:'result',representation:'text',required:true}]};
const node={nodeId:'n1',definitionRef:{definitionId:'d1',version:1}},job={runRef:'r1'};
const good=JSON.stringify({outputs:{status:'produced',values:{result:{inline:'summary'}}}});
const composer=createPromptComposer();

test('composer resolves only required registry modules, with stable Core and separate data',()=>{
  const a=composer.assemble({moduleIds:['run.perform'],context});
  const b=composer.assemble({moduleIds:['run.perform'],context:{...context,requestText:'Different request'}});
  assert.deepEqual(a.moduleIds,['core','layer.run','run.perform']);
  assert.equal(a.messages[0].content,b.messages[0].content);
  assert.equal(a.messages[1].content,b.messages[1].content);
  assert.deepEqual(a.messages.map(x=>x.role),['system','developer','user']);
  assert.ok(!a.messages[0].content.includes('Actual source text'));
  assert.ok(a.messages[2].content.includes('Actual source text'));
  assert.ok(!a.moduleIds.includes('layer.ir'));
});
test('plain entry does not force IR or node-output behavior',()=>{
  const a=composer.assemble({context});
  assert.deepEqual(a.moduleIds,['core','layer.entry']);
  assert.ok(!a.messages[1].content.includes('NodeOutput produced/blocked'));
});
test('unknown module and forged or oversized context are refused',()=>{
  assert.throws(()=>composer.assemble({context,moduleIds:['nonexistent']}),e=>e.code==='UNKNOWN_PROMPT_MODULE');
  assert.throws(()=>composer.assemble({context:{...context,actorRef:'fake'}}),e=>e.code==='INVALID_CONTEXT_BUNDLE');
  assert.throws(()=>composer.assemble({context:{...context,materials:[{...context.materials[0],content:'x'.repeat(35000)}]}}),
    e=>e.code==='INVALID_CONTEXT_BUNDLE');
});
function fixture(text=good,providedContext=context){
  const calls=[],gateway={complete:async x=>{calls.push(x);return {text,usage:{total_tokens:9},
    providerId:x.providerId,model:x.model,providerRequestId:'p1'};}};
  const execute=createModelNodeExecutor({gateway,composer,loadContext:async()=>providedContext,
    resolveModel:async()=>({providerId:'mock',model:'fixture',output:'text'})});
  return {execute,calls,gateway};
}
test('model node adapter assembles exact inputs and validates real output contract',async()=>{
  const f=fixture();
  const response=await f.execute({job,node,definition,inputBindings:{source:'abc'},
    inputArtifacts:[{port:'source',value:'trusted upstream',valueRef:'v1',
      representation:'text',sourceNodeId:'n0',sourcePort:'result'}]});
  assert.deepEqual(response,JSON.parse(good).outputs);
  assert.equal(f.calls.length,1);
  assert.match(f.calls[0].messages[2].content,/trusted upstream/);
  assert.match(f.calls[0].messages[1].content,/PERFORM/);
});
test('invalid model JSON, invented port, actions and wrong types never become success',async()=>{
  const failures=[
    ['not json','MODEL_INVALID_JSON'],
    [JSON.stringify({outputs:{status:'produced',values:{fictional:{inline:'x'}}}}),'UNKNOWN_OUTPUT_PORT'],
    [JSON.stringify({message:'finished'}),'MODEL_NODE_OUTPUT_REQUIRED'],
    [JSON.stringify({outputs:{status:'produced',values:{result:{inline:7}}}}),'OUTPUT_REPRESENTATION_MISMATCH']
  ];
  for(const [response,code] of failures) {
    const f=fixture(response);
    await assert.rejects(f.execute({job,node,definition}),e=>e.code===code);
  }
});
test('invalid trusted context prevents any provider call; blocked output stays blocked',async()=>{
  const f=fixture(good,{...context,actorRef:'user-supplied'});
  await assert.rejects(f.execute({job,node,definition}),e=>e.code==='INVALID_CONTEXT_BUNDLE');
  assert.equal(f.calls.length,0);
  const b=fixture(JSON.stringify({outputs:{status:'blocked',reason:'Missing source'}}));
  assert.deepEqual(await b.execute({job,node,definition}),{status:'blocked',reason:'Missing source'});
});
test('vNext runtime can optionally wire model adapter without touching legacy service',()=>{
  const f=fixture();
  const runtime=createVNextRuntime({pool:{connect:async()=>{throw Error('DB unexpectedly accessed');}},
    modelGateway:f.gateway,loadModelContext:async()=>context,
    resolveModel:async()=>({providerId:'mock',model:'fixture'}),
    workerRef:'worker',authenticate:async()=>({workspaceRef:'w',actorRef:'a'}),verifyMutation:async()=>true});
  assert.ok(runtime.prompts.assemble({context}).moduleIds.includes('layer.entry'));
  assert.equal(f.calls.length,0);
});
