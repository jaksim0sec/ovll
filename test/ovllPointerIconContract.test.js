import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {iconSvg} from '../backend/ovllPointer/skillCatalog.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
import {normalizeModelTurn} from '../backend/ovllPointer/turnNormalizer.js';
import {localModelContract} from '../backend/ovllPointer/modelContract.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';

const patch=(skillDefinitions=[],operations=[],rev=0)=>({
  graphId:'g',expectedGraphRevision:rev,skillDefinitions,operations});
const turn=change=>({actions:[{localKey:'edit',kind:'ir.applyPatch',args:{patch:change}}]});
const appearance=iconKey=>({
  op:'skill.appearance',skillDefinitionRef:{definitionId:'d_custom',version:1},
  presentation:{iconKey}
});
const draft=iconKey=>({
  localKey:'d',purpose:'Reusable analysis',instruction:'Analyze the evidence',
  presentation:{name:'Analysis',iconKey}
});

test('every server-owned SVG key is valid in both new skillDefinitions and appearance patches',()=>{
  const keys=Object.keys(iconSvg);
  assert.ok(keys.length>19,'regression: the original enum covered only 19 keys');
  const contract=createContractValidation();
  for(const iconKey of keys){
    assert.equal(contract.validate('SkillNodePresentation',{iconKey}),true,iconKey);
    assert.equal(contract.validateTurn(normalizeModelTurn(turn(patch([draft(iconKey)])))),true,
      'new definition '+iconKey);
    assert.equal(contract.validateTurn(normalizeModelTurn(turn(patch([],[
      appearance(iconKey)])))),true,'appearance '+iconKey);
  }
  assert.equal(contract.validate('SkillNodePresentation',{iconKey:'<svg onload=alert(1)>'}),false);
  assert.equal(contract.validate('SkillNodePresentation',{iconKey:15}),false);
});

test('unknown cosmetic icon gracefully becomes a canonical fallback without losing the edit',()=>{
  const raw=turn(patch([],[
    {op:'skill.appearance',skillDefinitionRef:{definitionId:'d_custom',version:1},
      presentation:{name:'일본어 단어장',iconKey:'book-open'}}
  ]));
  const normalized=normalizeModelTurn(raw),edited=normalized.actions[0].args.patch.operations[0];
  assert.equal(edited.presentation.iconKey,'custom');
  assert.equal(edited.presentation.name,'일본어 단어장');
  assert.equal(raw.actions[0].args.patch.operations[0].presentation.iconKey,'book-open');
  assert.equal(createContractValidation().validateTurn(normalized),true);
  const repo=new MemoryGraphRepository();
  repo.create('local','g');
  const created=repo.apply('local',patch([draft('document')]),()=> '1');
  const definitionId=created.createdRefs['definition:d'];
  repo.apply('local',patch([],[{...edited,
    skillDefinitionRef:{definitionId,version:1}}],1));
  const saved=repo.get('local','g').skillDefinitions[0];
  assert.equal(saved.presentation.iconKey,'custom');
  assert.equal(saved.presentation.name,'일본어 단어장');
  assert.equal(saved.instruction,'Analyze the evidence');
  assert.equal(saved.version,1);
});

test('unknown icons in brand-new skillDefinitions are normalized without affecting skillNode creation',()=>{
  const raw=turn(patch([draft('alien-unknown')],[{
    op:'skillNode.add',localSkillNodeKey:'first',skillDefinitionRef:{localDefinitionKey:'d'}
  }]));
  const normalized=normalizeModelTurn(raw);
  assert.equal(normalized.actions[0].args.patch.skillDefinitions[0].presentation.iconKey,'custom');
  assert.equal(normalized.actions[0].args.patch.operations[0].op,'skillNode.add');
  assert.equal(createContractValidation().validateTurn(normalized),true);
});

test('turn guidance lists SVG identifiers from the live server catalog',()=>{
  const instructions=localModelContract(undefined,{selectedModules:['action.skills']});
  for(const key of Object.keys(iconSvg))
    assert.ok(instructions.includes(key),'missing catalog icon '+key);
  assert.ok(instructions.includes('Unknown icons use custom'));
});

test('canvas projection keeps known keys and displays fallback for stale or unknown ones',()=>{
  const window={OvllSvgLibrary:{has:key=>Object.hasOwn(iconSvg,key)}};
  vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerProjection.js',
    import.meta.url),'utf8'),{window});
  const project=iconKey=>window.OvllPointerProjection.projectGraph({
    skillDefinitions:[{definitionId:'d_custom',version:1,purpose:'Review',
      executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'json'}],
      presentation:{name:'Review',iconKey}}],
    graph:{graphId:'g',revision:0,skillNodes:[{skillNodeId:'n',skillDefinitionRef:{
      definitionId:'d_custom',version:1},settings:{},inputBindings:{}}],connections:[]}
  }).skillDefinitions['pointer:d_custom:1'].iconKey;
  assert.equal(project('document'),'document');
  assert.equal(project('book-open'),'custom');
});

test('the real model turn path accepts a newly catalogued icon without an extra repair call',async()=>{
  let calls=0;
  const raw=turn(patch([],[appearance('document')]));
  const host=createLocalPointerHost({
    gateway:{complete:async()=>{calls++;return {text:JSON.stringify(raw)};}},
    resolveModel:async()=>({providerId:'fixture',model:'fixture'})
  });
  const response=await host.turn({
    snapshot:{graph:{graphId:'g',revision:0,skillNodes:[],connections:[]},skillDefinitions:[]},
    requestText:'노드 문서 아이콘으로 바꿔줘',requestRef:'icon_change'
  });
  assert.equal(calls,1);
  assert.equal(response.actions[0].args.patch.operations[0].presentation.iconKey,'document');
});
