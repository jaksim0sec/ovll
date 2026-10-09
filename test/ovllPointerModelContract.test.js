import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
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
  assert.deepEqual(turn,valid);
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
  assert.deepEqual(turn,valid);
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
  assert.deepEqual(result,{message:'새 파일 요청을 확인했어.'});
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
