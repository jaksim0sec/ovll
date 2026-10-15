import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
import {normalizeModelTurn} from '../backend/ovllPointer/turnNormalizer.js';
import {getPointerCatalog} from '../backend/ovllPointer/skillCatalog.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {skillNodeSemanticFingerprint} from '../front/js/ovllPointerResults.mjs';
import {semanticFingerprint as backendFingerprint} from '../backend/ovllPointer/executionPlan.js';

const draft=(name='일본어 단어장 생성기')=>({
  localKey:'vocab',purpose:'일본어 단어장 작성',instruction:'단어·읽기·뜻을 정리한다.',
  presentation:{name}
});
const make=()=>{const repo=new MemoryGraphRepository();repo.create('local','g');return repo;};
const patch=(rev,skillDefinitions=[],operations=[])=>({graphId:'g',expectedGraphRevision:rev,skillDefinitions,operations});
const turn=p=>({actions:[{kind:'ir.applyPatch',localKey:'edit',args:{patch:p}}]});

test('small custom definition defaults to flexible JSON input/output with valid model contract',()=>{
  const normalized=normalizeModelTurn(turn(patch(0,[draft()],[
    {op:'skillNode.add',localSkillNodeKey:'one',skillDefinitionRef:{localDefinitionKey:'vocab'}}])));
  const validation=createContractValidation();
  assert.equal(validation.validateTurn(normalized),true);
  const repo=make(),result=repo.apply('local',normalized.actions[0].args.patch,()=> '1');
  assert.equal(result.graphRef.revision,1);
  const definition=repo.get('local','g').skillDefinitions[0];
  assert.equal(definition.executorKind,'model_task');
  assert.deepEqual(definition.inputs,[{name:'in',role:'입력',representation:'json',required:false}]);
  assert.deepEqual(definition.outputs,[{name:'result',role:'결과',representation:'json',required:false}]);
});

test('rename only changes custom skillNode presentation without restating its task or IO',()=>{
  const repo=make();
  const created=repo.apply('local',patch(0,[draft()],[
    {op:'skillNode.add',localSkillNodeKey:'one',skillDefinitionRef:{localDefinitionKey:'vocab'}}]),()=> '1');
  const definitionId=created.createdRefs['definition:vocab'];
  const skillNodeId=created.createdRefs['skillNode:one'];
  const renamed=turn(patch(1,[],[
    {op:'skill.appearance',skillDefinitionRef:{definitionId,version:1},
      presentation:{name:'일본어 단어장'}}]));
  assert.equal(createContractValidation().validateTurn(renamed),true);
  repo.apply('local',renamed.actions[0].args.patch,()=> '2');
  const next=repo.get('local','g');
  const versions=next.skillDefinitions.filter(d=>d.definitionId===definitionId);
  assert.equal(versions.length,1,'rename must not create a second visible definition');
  assert.equal(versions[0].presentation.name,'일본어 단어장');
  assert.equal(versions[0].version,1);
  assert.equal(versions[0].instruction,'단어·읽기·뜻을 정리한다.');
  assert.equal(next.graph.skillNodes.find(n=>n.skillNodeId===skillNodeId).skillDefinitionRef.version,1);
  assert.equal(repo.getRevision('local','g',1).skillDefinitions.find(d=>d.definitionId===definitionId).presentation.name,
    '일본어 단어장 생성기','past graph revision remains immutable');
});

test('builtin skillDefinitions cannot be renamed or superseded, but their instance settings stay editable',()=>{
  const repo=make();
  const b=getPointerCatalog().skillDefinitions.find(d=>d.definitionId==='builtin:write');
  repo.restore('local','g',{graph:{graphId:'g',revision:0,skillNodes:[{
    skillNodeId:'existing',skillDefinitionRef:{definitionId:b.definitionId,version:b.version},
    settings:{request:'old'},inputBindings:{}}],connections:[]},skillDefinitions:[b]});
  for(const [skillDefinitions,operations] of [
    [[],[{op:'skill.appearance',skillDefinitionRef:{definitionId:b.definitionId,version:1},
      presentation:{name:'변경 금지'}}]],
    [[{...draft(),supersedes:{definitionId:b.definitionId,version:1},
      executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'결과',representation:'json'}]}],[]]
  ]){
    assert.throws(()=>repo.apply('local',patch(0,skillDefinitions,operations)),
      e=>e.code==='BUILTIN_DEFINITION_IMMUTABLE');
    assert.equal(repo.get('local','g').graph.revision,0);
  }
  repo.apply('local',patch(0,[],[{op:'skillNode.update',skillNodeId:'existing',
    settings:{request:'new'}}]));
  assert.equal(repo.get('local','g').graph.skillNodes[0].settings.request,'new');
});

test('appearance changes reject stale refs and invalid cosmetic values atomically',()=>{
  const repo=make();
  const created=repo.apply('local',patch(0,[draft()],[]),()=> '1');
  const definitionId=created.createdRefs['definition:vocab'];
  repo.apply('local',patch(1,[],[{op:'skill.appearance',
    skillDefinitionRef:{definitionId,version:1},presentation:{name:'단어장'}}]));
  assert.throws(()=>repo.apply('local',patch(1,[],[{op:'skill.appearance',
    skillDefinitionRef:{definitionId,version:1},presentation:{name:'과거'}}])),
    e=>e.code==='STALE_REVISION');
  assert.throws(()=>repo.apply('local',patch(2,[],[{op:'skill.appearance',
    skillDefinitionRef:{definitionId,version:1},presentation:{name:'  '}}])),
    e=>e.code==='BAD_PRESENTATION');
  assert.equal(repo.get('local','g').graph.revision,2);
});

test('existing explicit semantic ports and tool-task capabilities remain unchanged',()=>{
  const repo=make();
  const tool={...draft(),executorKind:'tool_task',requiredCapabilities:['artifact.create'],
    inputs:[{name:'content',role:'content',representation:'json'}],
    outputs:[{name:'artifact',role:'파일',representation:'json'}]};
  const r=repo.apply('local',patch(0,[tool],[]));
  const saved=repo.get('local','g').skillDefinitions[0];
  assert.deepEqual(saved.requiredCapabilities,['artifact.create']);
  assert.equal(saved.outputs[0].name,'artifact');
  assert.equal(r.graphRef.revision,1);
});

test('model may use compact semantic ports, but invalid or explicit tool ports are not invented',()=>{
  const compact=normalizeModelTurn(turn(patch(0,[{
    ...draft(),inputs:[{name:'source'}],outputs:[{name:'vocab'}]
  }],[])));
  const d=compact.actions[0].args.patch.skillDefinitions[0];
  assert.deepEqual(d.inputs,[{name:'source',role:'source',representation:'json'}]);
  assert.deepEqual(d.outputs,[{name:'vocab',role:'vocab',representation:'json'}]);
  assert.equal(createContractValidation().validateTurn(compact),true);
  const invalidTool=normalizeModelTurn(turn(patch(0,[{
    ...draft(),executorKind:'tool_task',requiredCapabilities:['artifact.create']
  }],[])));
  assert.equal(createContractValidation().validateTurn(invalidTool),false,
    'tool tasks must declare their real IO and capabilities');
});

test('one-word custom rename passes model contract without model repair calls',async()=>{
  const repo=make(),created=repo.apply('local',patch(0,[draft()],[
    {op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{localDefinitionKey:'vocab'}}]),()=> '1');
  const id=created.createdRefs['definition:vocab'];
  const proposal=turn(patch(1,[{
    localKey:'rename',supersedes:{definitionId:id,version:1},
    presentation:{name:'일본어 단어장'}
  }],[]));
  let calls=0;
  const host=createLocalPointerHost({
    gateway:{complete:async()=>{calls++;return {text:JSON.stringify(proposal)};}},
    resolveModel:async()=>({providerId:'mock',model:'mock'})
  });
  const response=await host.turn({snapshot:repo.get('local','g'),
    requestRef:'rename_1',requestText:'이름에서 생성기만 빼 줘'});
  assert.equal(calls,1);
  assert.deepEqual(response.actions[0].args.patch.skillDefinitions,[]);
  assert.equal(response.actions[0].args.patch.operations[0].op,'skill.appearance');
  assert.deepEqual(response.actions[0].args.patch.operations[0].presentation,
    {name:'일본어 단어장'});
});

test('appearance-only edit keeps current result and backend execution identity',()=>{
  const repo=make();
  const refs=repo.apply('local',patch(0,[draft()],[
    {op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{localDefinitionKey:'vocab'}}
  ]),()=> '1').createdRefs;
  const id=refs['definition:vocab'],skillNodeId=refs['skillNode:n'];
  const before=repo.get('local','g');
  const opts={requestText:'N4 vocabulary',taskConstraints:['retain meanings']};
  const earlier=skillNodeSemanticFingerprint(before,skillNodeId,opts);
  const serverBefore=backendFingerprint({snapshot:before,skillNode:before.graph.skillNodes[0],
    definition:before.skillDefinitions.find(d=>d.definitionId===id),inputRefs:[]});
  repo.apply('local',patch(1,[],[{op:'skill.appearance',
    skillDefinitionRef:{definitionId:id,version:1},presentation:{name:'일본어 단어장'}}]));
  const after=repo.get('local','g');
  assert.equal(after.skillDefinitions.filter(d=>d.definitionId===id).length,1);
  assert.equal(after.skillDefinitions.find(d=>d.definitionId===id).version,1);
  assert.equal(skillNodeSemanticFingerprint(after,skillNodeId,opts),earlier);
  assert.equal(backendFingerprint({snapshot:after,skillNode:after.graph.skillNodes[0],
    definition:after.skillDefinitions.find(d=>d.definitionId===id&&d.version===1),inputRefs:[]}),serverBefore);
});

test('tool_task declaration must include both explicit inputs and outputs',()=>{
 const make=(port)=>normalizeModelTurn(turn(patch(0,[{
   ...draft(),executorKind:'tool_task',requiredCapabilities:['artifact.create'],
   ...(port==='inputs'?{inputs:[]}:{outputs:[{name:'artifact',role:'artifact',representation:'json'}]})
 }],[])));
 const validator=createContractValidation();
 assert.equal(validator.validateTurn(make('inputs')),false,'outputs still required');
 assert.equal(validator.validateTurn(make('outputs')),false,'inputs still required');
});
