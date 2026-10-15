import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PATCH_OPERATION_CONTRACTS,PATCH_OPERATION_KINDS,createContractValidation,splitModelMetadata} from '../backend/ovllPointer/validation.js';
import {diagnoseModelTurn,normalizeModelTurn} from '../backend/ovllPointer/turnNormalizer.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {localModelContract} from '../backend/ovllPointer/modelContract.js';

const skillNode=key=>({op:'skillNode.add',localSkillNodeKey:key,
  skillDefinitionRef:{definitionId:'builtin:write',version:1},settings:{request:key}});
const link={op:'link.add',localLinkKey:'connect',kind:'data',
  from:{skillNode:{localSkillNodeKey:'first'},port:'result'},
  to:{skillNode:{localSkillNodeKey:'second'},port:'in'}};
const turn=last=>({actions:[{kind:'ir.applyPatch',localKey:'p',args:{patch:{
  graphId:'g',expectedGraphRevision:0,skillDefinitions:[],
  operations:[skillNode('first'),skillNode('second'),last]
}}}]});

test('semantic commands retain all canonical graph operation kinds without teaching internal fields',()=>{
  assert.deepEqual(PATCH_OPERATION_KINDS,['skillNode.add','skillNode.update','skillNode.delete','skill.appearance','skill.delete','link.add','link.remove']);
  const instruction=localModelContract(undefined,{selectedModules:['action.skill-nodes','action.skills','action.links']});
  for(const op of PATCH_OPERATION_KINDS)assert.ok(instruction.includes(op+':'),op);
  for(const field of ['expectedGraphRevision','localSkillNodeKey','localDefinitionKey','dependsOn'])assert.ok(!instruction.includes(field),field);
});

test('third unsupported graph operation reports invalidOperation with the actual allowed vocabulary',()=>{
  const invalid=turn({...link,op:'skillNode.connect'});
  assert.equal(createContractValidation().validateTurn(invalid),false);
  const errors=diagnoseModelTurn(invalid,createContractValidation().explainTurn(invalid));
  assert.equal(errors[0].path,'/actions/0/args/patch/operations/2/op');
  assert.equal(errors[0].rule,'invalidOperation');
  assert.deepEqual(errors[0].allowed,PATCH_OPERATION_KINDS);
});

test('valid operation missing a required member is reported as missing member, not invalid op',()=>{
  const invalid=turn({...link});
  delete invalid.actions[0].args.patch.operations[2].localLinkKey;
  assert.equal(createContractValidation().validateTurn(invalid),false);
  const errors=diagnoseModelTurn(invalid,createContractValidation().explainTurn(invalid));
  assert.equal(errors[0].path,'/actions/0/args/patch/operations/2/localLinkKey');
  assert.equal(errors[0].rule,'required');
});

test('invalid operation receives actionable correction and only a valid proposal can be returned',async()=>{
  const requests=[],bad=turn({...link,op:'skillNode.connect'}),good=turn(link);
  const host=createLocalPointerHost({
    gateway:{complete:async params=>{
      requests.push(params);
      return {text:JSON.stringify(requests.length===1?bad:good)};
    }},
    resolveModel:async()=>({providerId:'fixture',model:'fixture',maxOutputTokens:2048})
  });
  const response=await host.turn({
    snapshot:{graph:{graphId:'g',revision:0,skillNodes:[],connections:[]},skillDefinitions:[]},
    requestRef:'patch_repair',requestText:'두 노드를 연결해줘'
  });
  assert.equal(requests.length,2);
  assert.equal(response.actions[0].args.patch.operations[2].op,'link.add');
  const retry=requests[1].messages.at(-1).content;
  assert.match(retry,/invalidOperation/);
  assert.match(retry,/link.add/);
  assert.equal(createContractValidation().validateTurn(normalizeModelTurn(splitModelMetadata(response).domain)),true);
});

test('an empty skillNode picker cannot hide the canvas Node / Reset / Arrange toolbar',()=>{
  const css=readFileSync(new URL('../front/css/ui.css',import.meta.url),'utf8');
  const js=readFileSync(new URL('../front/js/canvasSkillBuilder.js',import.meta.url),'utf8');
  assert.doesNotMatch(css,/\[data-canvas-skillNode-builder\]\)\.is-empty\s*\{\s*display:\s*none/);
  assert.match(js,/data-canvas-skillNode-builder-toggle/);
  assert.match(js,/data-canvas-skillNode-builder-reset/);
  assert.match(js,/data-canvas-skillNode-builder-layout/);
  assert.match(js,/canvas-skillNode-builder-empty/);
  assert.match(css,/\.canvas-skillNode-builder-empty\s*\{/);
});
