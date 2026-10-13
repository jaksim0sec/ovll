import test from 'node:test';
import assert from 'node:assert/strict';
import {localModelContract,phaseWireContract,decodePhaseOutput,actionModulesForKinds}
 from '../backend/ovllPointer/modelContract.js';
import {toLegacySkillActionPlan} from '../backend/ovllPointer/skillActionContract.js';
test('new planner advertises Skill v2 semantic actions and exact selector shapes',()=>{
 const selected=['action.nodes','action.links','action.definitions','action.execution'];
 const prompt=localModelContract(undefined,{skillV2:true,selectedModules:selected,workshop:true});
 assert.match(prompt,/action-plan\.v2/);
 assert.match(prompt,/skill\.add/);
 assert.match(prompt,/skill\.delete/);
 assert.match(prompt,/skill\.define/);
 assert.match(prompt,/skillId:actual_id/);
 assert.match(prompt,/from\/to:\{skill:SkillSelector,port:declared_port\}/);
 assert.doesNotMatch(prompt,/node\.add/);
 const schema=phaseWireContract('turn',null,{skillV2:true});
 assert.equal(schema.name,'ovll_turn_action_plan_v2');
 assert.deepEqual(schema.schema.properties.contract.enum,['action-plan.v2']);
 assert.ok(schema.schema.properties.actions.items.properties.action.enum.includes('skill.add'));
 assert.ok(!schema.schema.properties.actions.items.properties.action.enum.includes('node.add'));
});
test('Skill action directory routes to existing proven compiler modules',()=>{
 assert.deepEqual(actionModulesForKinds(['skill.add','skill.define','link.add']),
  ['action.nodes','action.definitions','action.links']);
});
test('provider wire v2 decodes and leaves canonical identity visible until ingress adapter',()=>{
 const decoded=decodePhaseOutput({contract:'action-plan.v2',
  actions:[{action:'skill.add',payloadJson:JSON.stringify({
   alias:'writer',definition:{kind:'builtin',type:'write'}})}],
  needs:[],message:null,executionIntent:null},'turn');
 assert.equal(decoded.contract,'action-plan.v2');
 assert.equal(decoded.actions[0].action,'skill.add');
 assert.equal(toLegacySkillActionPlan(decoded).actions[0].action,'node.add');
});
