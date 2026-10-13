import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLocalActionPlan} from '../backend/ovllPointer/localHost.js';
import {toLegacySkillActionPlan,toSkillCompiledTurn}
 from '../backend/ovllPointer/skillActionContract.js';
const snapshot=()=>({graph:{graphId:'g',revision:0,skills:[],connections:[]},skillDefinitions:[]});
test('v2 semantic plan generates only canonical Skill patch fields',()=>{
 const value=compileLocalActionPlan({snapshot:snapshot(),requestRef:'r',
  requestText:'Add a Skill',
  plan:{contract:'action-plan.v2',actions:[{
   action:'skill.add',alias:'writer',
   definition:{kind:'builtin',type:'write'},request:'Hello'
  }] }});
 assert.equal(value._meta.providerCalls,0);
 const op=value.actions[0].args.patch.operations[0];
 assert.equal(op.op,'skill.add');
 assert.equal(op.localSkillKey,'n1');
 assert.equal('localNodeKey' in op,false);
 assert.equal(value.actions[0].args.patch.graphId,'g');
 assert.ok(Array.isArray(value.actions[0].args.patch.skillDefinitions));
});
test('direct v2 answers preserve text without inventing graph edits',()=>{
 const output=compileLocalActionPlan({snapshot:snapshot(),requestRef:'answer',
  requestText:'Hello',plan:{contract:'action-plan.v2',message:'Hi'}});
 assert.equal(output.message,'Hi');
 assert.equal(output.actions,undefined);
 assert.equal(output._meta.providerCalls,0);
});
test('new v2 link endpoints are scoped skill selectors, not legacy nodes',()=>{
 const translated=toLegacySkillActionPlan({contract:'action-plan.v2',actions:[{
  action:'link.add',kind:'data',
  from:{skill:{kind:'existing',skillId:'s1'},port:'result'},
  to:{skill:{kind:'created',alias:'writer'},port:'in'}
 }]});
 assert.equal(translated.actions[0].from.node.nodeId,'s1');
 assert.equal(translated.actions[0].to.node.alias,'writer');
 assert.equal('skill' in translated.actions[0].from,false);
});
test('mixing old identifiers in new action fails closed',()=>{
 assert.throws(()=>toLegacySkillActionPlan({contract:'action-plan.v2',actions:[
  {action:'skill.delete',target:{kind:'existing',nodeId:'n_old',skillId:'s'}}
 ]}),e=>e.code==='MIXED_SKILL_ACTION');
});
test('v2 produces canonical execution targets, retaining stable original IDs',()=>{
 const result=toSkillCompiledTurn({actions:[{
  localKey:'run',kind:'run.start',args:{targets:[{nodeId:'n_old'}],damMode:'closed'}
 }]});
 assert.deepEqual(result.actions[0].args.targets,[{skillId:'n_old'}]);
});
