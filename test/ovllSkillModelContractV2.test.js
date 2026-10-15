import test from 'node:test';
import assert from 'node:assert/strict';
import {localModelContract,phaseWireContract,decodePhaseOutput,actionModulesForKinds} from '../backend/ovllPointer/modelContract.js';
test('model instructions distinguish skills from skill nodes using the direct compiler contract',()=>{
 const prompt=localModelContract(undefined,{selectedModules:['action.skill-nodes','action.skills','action.links'],workshop:true});
 assert.match(prompt,/action-plan\.v3/);assert.match(prompt,/skillNode\.add/);assert.match(prompt,/skill\.define/);
 assert.match(prompt,/skillNodeId/);assert.doesNotMatch(prompt,/\bnodeId\b|node\.add|skill\.add/);
 const wire=phaseWireContract('turn');assert.equal(wire.name,'ovll_turn_action_plan_v3');
 assert.ok(wire.schema.properties.actions.items.properties.action.enum.includes('skillNode.add'));
 assert.ok(!wire.schema.properties.actions.items.properties.action.enum.includes('skill.add'));
});
test('action directory resolves definition and instance families without alias translation',()=>{
 assert.deepEqual(actionModulesForKinds(['skillNode.add','skill.define','link.add']),['action.skill-nodes','action.skills','action.links']);
 assert.throws(()=>actionModulesForKinds(['node.add']));
});
test('provider wire decodes to the native plan without another domain contract',()=>{
 const decoded=decodePhaseOutput({contract:'action-plan.v3',actions:[{action:'skillNode.add',payloadJson:JSON.stringify({alias:'a',definition:{kind:'builtin',type:'write'}})}],needs:[],message:null,executionIntent:null},'turn');
 assert.equal(decoded.actions[0].action,'skillNode.add');assert.equal(decoded.actions[0].definition.type,'write');
});
