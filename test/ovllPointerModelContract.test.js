import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createContractValidation,splitModelMetadata} from '../backend/ovllPointer/validation.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';
const repo=new MemoryGraphRepository();
repo.create('local','g');
const snapshot=repo.get('local','g');
const validPatch={graphId:'g',expectedGraphRevision:0,definitions:[
  {localKey:'d1',purpose:'요약',executorKind:'model_task',instruction:'요약하기',
    inputs:[],outputs:[{name:'result',role:'결과',representation:'text'}]}],
  operations:[{op:'node.add',localNodeKey:'n1',definitionRef:{localDefinitionKey:'d1'}}]};
const valid={message:'워크플로우를 구성했어.',actions:[
  {localKey:'p1',kind:'ir.applyPatch',args:{patch:validPatch}}]};
const create=(responses,received)=>createLocalPointerHost({
  gateway:{complete:async options=>{received.push(options);return {text:JSON.stringify(responses.shift())};}},
  resolveModel:async()=>({providerId:'mock',model:'test',maxOutputTokens:2048})
});
test('workflow contract includes executable graph patch port and target examples',async()=>{
  const received=[],host=create([valid],received);
  const turn=await host.turn({snapshot,requestRef:'req1',requestText:'요약 워크플로우 만들어'});
  assert.deepEqual(splitModelMetadata(turn).domain,valid);
  assert.equal(received.length,1);
  const developer=received[0].messages.find(x=>x.role==='developer'&&x.content.includes('GraphPatch'));
  assert.match(developer.content,/representation/);
  assert.match(developer.content,/localDefinitionKey/);
  assert.match(developer.content,/dependsOn/);
});
test('model JSON with incorrect GraphPatch ports is rejected and repaired once before commit',async()=>{
  const bad=structuredClone(valid);delete bad.actions[0].args.patch.definitions[0].outputs[0].role;
  const received=[],host=create([bad,valid],received);
  const turn=await host.turn({snapshot,requestRef:'req2',requestText:'워크플로우 만들어'});
  assert.deepEqual(splitModelMetadata(turn).domain,valid);
  assert.equal(received.length,2);
  const correction=received[1].messages.at(-1);
  assert.match(correction.content,/Schema issues:/);
  assert.match(correction.content,/missing/);
  assert.equal(repo.get('local','g').graph.revision,0);
});
test('persistent contract mismatch fails closed after one repair without creating graph data',async()=>{
  const bad={mode:'workflow',nodes:[]},received=[],host=create([bad,bad],received);
  const originalWarn=console.warn;const warnings=[];console.warn=(...args)=>warnings.push(args);
  try{await assert.rejects(
    host.turn({snapshot,requestRef:'req3',requestText:'워크플로우 만들어'}),
    error=>error.code==='INVALID_MODEL_TURN');
  }finally{console.warn=originalWarn;}
  assert.equal(received.length,2);
  assert.equal(warnings.length,1);
  assert.equal(repo.get('local','g').graph.nodes.length,0);
});
test('ordinary chat remains one request with no unnecessary correction',async()=>{
  const received=[],host=create([{message:'안녕!'}],received);
  assert.equal((await host.turn({snapshot,requestRef:'req4',requestText:'안녕'})).message,'안녕!');
  assert.equal(received.length,1);
});
test('validator explains the missing schema member without including user text',()=>{
  const validator=createContractValidation();
  const bad=structuredClone(valid);delete bad.actions[0].args.patch.definitions[0].outputs[0].role;
  assert.equal(validator.validateTurn(bad),false);
  const errors=validator.explainTurn(bad);
  assert.ok(errors.length>0);
  assert.ok(errors.some(x=>x.rule==='required'));
  assert.equal(validator.explainTurn(valid).length,0);
});
test('local wire examples include existing reuse, dynamic work, scoped requests and supported replay',async()=>{
 const received=[];await create([{message:'가능해'}],received).turn({snapshot,requestRef:'r5',requestText:'할 수 있는 일 알려줘'});
 const text=received[0].messages.filter(m=>m.role==='developer').map(m=>m.content).join('\n');
 assert.match(text,/builtin:write/);assert.match(text,/settings/);assert.match(text,/function.run/);
 assert.match(text,/localDefinitionKey/);assert.doesNotMatch(text,/Use only model_task executors/);
 const core=received[0].messages[0].content;
 assert.match(core,/capabilit/i);assert.match(core,/internal implementation/i);
});

test('empty optional action and need arrays do not invalidate a useful direct reply',async()=>{
  const received=[];
  const host=create([{message:'새 파일 요청을 확인했어.',actions:[],needs:[],outputs:null}],received);
  const result=await host.turn({snapshot,requestRef:'r_empty_optional',requestText:'앞의 요청을 계속해'});
  assert.deepEqual(splitModelMetadata(result).domain,{message:'새 파일 요청을 확인했어.'});
  assert.equal(received.length,1,'no unnecessary repair request');
});
test('failed contract retains only safe schema issues and never applies invalid actions',async()=>{
  const received=[],host=create([{actions:[{kind:'ir.applyPatch',localKey:'p',args:{patch:{
    graphId:'g',expectedGraphRevision:0,definitions:[{localKey:'x',purpose:'write',
      executorKind:'model_task',instruction:'write',inputs:[],outputs:[{
        name:'result',representation:'text'}]}],operations:[]}}}]},
    {message:'ok',actions:[{kind:'ir.applyPatch',localKey:'p',args:{patch:{
      graphId:'g',expectedGraphRevision:0,definitions:[{localKey:'x',purpose:'write',
        executorKind:'model_task',instruction:'write',inputs:[],outputs:[{
          name:'result',representation:'text'}]}],operations:[]}}}]}],received);
  await assert.rejects(host.turn({snapshot,requestRef:'r_missing_role',requestText:'workflow'}),
    error=>error.code==='INVALID_MODEL_TURN'&&
      Array.isArray(error.validationIssues)&&error.validationIssues.length>0&&
      error.validationIssues.every(item=>typeof item.path==='string'&&typeof item.rule==='string'));
  assert.equal(received.length,2);
  assert.equal(repo.get('local','g').graph.nodes.length,0);
});

test('GraphPatch without optional empty definitions list is normalized only when operations exist',async()=>{
 const received=[];
 const patch={graphId:'g',expectedGraphRevision:0,operations:[
   {op:'node.add',localNodeKey:'n',definitionRef:{definitionId:'builtin:write',version:1}}]};
 const turn={actions:[{kind:'ir.applyPatch',localKey:'patch',args:{patch}}]};
 const actual=await create([turn],received).turn({snapshot,requestRef:'no_defs',requestText:'기본 노드 추가'});
 assert.equal(received.length,1,'no avoidable second model request');
 assert.deepEqual(actual.actions[0].args.patch.definitions,[]);
 assert.deepEqual(patch.definitions,undefined,'source JSON left unchanged');
});
test('deleting an unused custom definition is a valid GraphPatch ModelTurn proposal',async()=>{
 const received=[];
 const patch={graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
   {op:'definition.delete',definitionRef:{definitionId:'d_unused',version:1}}]};
 const turn={actions:[{kind:'ir.applyPatch',localKey:'remove',args:{patch}}]};
 const actual=await create([turn],received).turn({
   snapshot,requestRef:'delete_unused',requestText:'중복 정의 하나 삭제해'});
 assert.equal(actual.actions[0].args.patch.operations[0].op,'definition.delete');
 assert.equal(received.length,1);
});

test('single unnamed node.add gets a safe patch-local key without a second model call',async()=>{
 const received=[];
 const turn={actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{
  graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
   {op:'node.add',definitionRef:{definitionId:'builtin:write',version:1}}
  ]}}}]};
 const actual=await create([turn],received).turn({snapshot,requestRef:'safe_key',requestText:'기존 작성 노드로 만들어'});
 assert.equal(received.length,1);
 assert.equal(actual.actions[0].args.patch.operations[0].localNodeKey,'node1');
 assert.equal(turn.actions[0].args.patch.operations[0].localNodeKey,undefined);
 assert.equal(createContractValidation().validateTurn(splitModelMetadata(actual).domain),true);
});
test('new node temporary key is inferred only from one unambiguous run target',async()=>{
 const received=[];
 const turn={actions:[
  {localKey:'p',kind:'ir.applyPatch',args:{patch:{
   graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
    {op:'node.add',definitionRef:{definitionId:'builtin:write',version:1}}
   ]}}},
  {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[
   {fromAction:'p',localNodeKey:'vocab'}
  ],damMode:'closed'}}
 ]};
 const result=await create([turn],received).turn({snapshot,requestRef:'key_referenced',requestText:'작성해서 실행해'});
 assert.equal(result.actions[0].args.patch.operations[0].localNodeKey,'vocab');
 assert.equal(createContractValidation().validateTurn(splitModelMetadata(result).domain),true);
 assert.equal(received.length,1);
});
test('ambiguous temporary node references still fail closed rather than invent a mapping',async()=>{
 const bad={actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{
  graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
   {op:'node.add',definitionRef:{definitionId:'builtin:write',version:1}},
   {op:'link.add',localLinkKey:'connect',kind:'data',from:{node:{localNodeKey:'one'},port:'result'},
    to:{node:{localNodeKey:'two'},port:'in'}}
  ]}}}]};
 const received=[],old=console.warn;console.warn=()=>{};
 try{
  await assert.rejects(create([bad,bad],received).turn({snapshot,requestRef:'ambiguous_key',
   requestText:'복잡한 연결'}),e=>e.code==='INVALID_MODEL_TURN');
 }finally{console.warn=old;}
 assert.equal(received.length,2);
 assert.match(received[1].messages.at(-1).content,/localNodeKey/);
 assert.equal(repo.get('local','g').graph.revision,0);
});
test('entry model contract instructs existing instance and definition reuse before new definitions',async()=>{
 const received=[];await create([{message:'네'}],received).turn({
  snapshot,requestRef:'reuse_policy',requestText:'기존 노드 재사용'});
 const prompts=received[0].messages.map(m=>m.content).join(' ');
 assert.match(prompts,/existing instances/);
 assert.match(prompts,/existing compatible definition/);
 assert.match(prompts,/ONLY if none/);
 assert.match(prompts,/localNodeKey/);
});

test('safe key and missing empty definitions normalize in one pass',async()=>{
 const received=[];
 const action={localKey:'p',kind:'ir.applyPatch',args:{patch:{
  graphId:'g',expectedGraphRevision:0,operations:[
   {op:'node.add',definitionRef:{definitionId:'builtin:write',version:1}}
  ]}}};
 const result=await create([{actions:[action]}],received).turn({
  snapshot,requestRef:'both_missing',requestText:'기존 정의로 생성'});
 assert.equal(received.length,1);
 assert.deepEqual(result.actions[0].args.patch.definitions,[]);
 assert.equal(result.actions[0].args.patch.operations[0].localNodeKey,'node1');
 assert.equal(createContractValidation().validateTurn(splitModelMetadata(result).domain),true);
});

test('unique run.start target safely inherits the sole created node key',async()=>{
 const received=[];
 const turn={actions:[
  {localKey:'p',kind:'ir.applyPatch',args:{patch:{
   graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
    {op:'node.add',localNodeKey:'one',definitionRef:{definitionId:'builtin:write',version:1}}
   ]}}},
  {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[
    {fromAction:'p'}],damMode:'closed'}}
 ]};
 const actual=await create([turn],received).turn({snapshot,requestRef:'run_missing_key',
  requestText:'이 노드 생성하고 실행'});
 assert.equal(received.length,1);
 assert.equal(actual.actions[1].args.targets[0].localNodeKey,'one');
 assert.equal(createContractValidation().validateTurn(splitModelMetadata(actual).domain),true);
});
test('ambiguous run targets are never mapped to a guessed new node',async()=>{
 const received=[];
 const turn={actions:[
  {localKey:'p',kind:'ir.applyPatch',args:{patch:{
   graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
    {op:'node.add',localNodeKey:'one',definitionRef:{definitionId:'builtin:write',version:1}},
    {op:'node.add',localNodeKey:'two',definitionRef:{definitionId:'builtin:write',version:1}}
   ]}}},
  {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[
    {fromAction:'p'}],damMode:'closed'}}
 ]};
 const old=console.warn;console.warn=()=>{};
 try{await assert.rejects(create([turn,turn],received).turn({snapshot,
  requestRef:'ambiguous_run',requestText:'둘 중 하나 실행'}),e=>e.code==='INVALID_MODEL_TURN');
 }finally{console.warn=old;}
 assert.equal(received.length,2);
});

test('two independent existing-definition instances need no model-generated temporary keys',async()=>{
  const received=[],turn={actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{
    graphId:'g',expectedGraphRevision:0,operations:[
      {op:'node.add',definitionRef:{definitionId:'builtin:write',version:1}},
      {op:'node.add',definitionRef:{definitionId:'builtin:organize',version:1}}
    ]}}}]};
  const result=await create([turn],received).turn({snapshot,requestRef:'multi_independent',
    requestText:'기존 노드 둘 추가해'});
  assert.equal(received.length,1);
  assert.deepEqual(result.actions[0].args.patch.operations.map(op=>op.localNodeKey),
    ['node1','node2']);
  assert.deepEqual(result.actions[0].args.patch.definitions,[]);
  assert.equal(createContractValidation().validateTurn(splitModelMetadata(result).domain),true);
});
test('malformed link endpoint cannot be mislabeled as an unnamed node.add',async()=>{
  const received=[],bad={actions:[{localKey:'p',kind:'ir.applyPatch',args:{patch:{
    graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
      {op:'link.add',localLinkKey:'link',kind:'data',
        from:{node:{},port:'result'},to:{node:{nodeId:'existing'},port:'in'}}
    ]}}}]};
  const old=console.warn;console.warn=()=>{};
  try{
    await assert.rejects(create([bad,bad],received).turn({snapshot,
      requestRef:'malformed_link_endpoint',requestText:'기존 포트 연결'}),
      e=>e.code==='INVALID_MODEL_TURN'&&
        e.validationIssues?.[0]?.path==='/actions/0/args/patch/operations/0/from/node'&&
        e.validationIssues?.[0]?.missing!=='localNodeKey');
  }finally{console.warn=old;}
  assert.equal(received.length,2);
  assert.match(received[1].messages.at(-1).content,/JSON path/);
});
