import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLocalActionPlan} from '../backend/ovllPointer/localHost.js';
const snapshot=()=>({graph:{graphId:'g',revision:0,skillNodes:[],connections:[]},skillDefinitions:[]});
const compile=actions=>compileLocalActionPlan({snapshot:snapshot(),requestRef:'r',requestText:'Edit the canvas',plan:{contract:'action-plan.v3',actions}});
test('native plan compiles directly into the existing kernel contract without provider calls',()=>{
 const result=compile([{action:'skillNode.add',alias:'writer',definition:{kind:'builtin',type:'write'}}]);
 const patch=result.actions[0].args.patch,op=patch.operations[0];
 assert.equal(op.op,'skillNode.add');assert.equal(op.localSkillNodeKey,'n1');
 assert.equal('localNodeKey' in op,false);assert.equal('definitions' in patch,false);
 assert.equal(patch.graphId,'g');assert.equal(result._meta.providerCalls,0);
});
test('definition actions and instance actions have distinct native namespaces',()=>{
 const result=compile([{action:'skill.define',alias:'words',purpose:'Words',instruction:'Review words'},
 {action:'skillNode.add',alias:'one',definition:{kind:'created',alias:'words'}},
 {action:'skillNode.add',alias:'two',definition:{kind:'created',alias:'words'}}]);
 const patch=result.actions[0].args.patch;assert.equal(patch.skillDefinitions.length,1);assert.equal(patch.operations.length,2);
 assert.deepEqual(patch.operations[0].skillDefinitionRef,patch.operations[1].skillDefinitionRef);
});
test('old action names and instance selectors are rejected without a translation fallback',()=>{
 assert.throws(()=>compile([{action:'node.add',alias:'old',definition:{kind:'builtin',type:'write'}}]));
 assert.throws(()=>compile([{action:'skillNode.delete',target:{kind:'existing',nodeId:'old'}}]));
});
test('native direct answer preserves text without inventing edits',()=>{
 const result=compileLocalActionPlan({snapshot:snapshot(),requestRef:'a',requestText:'Hi',plan:{contract:'action-plan.v3',message:'Hello'}});
 assert.equal(result.message,'Hello');assert.equal(result.actions,undefined);assert.equal(result._meta.providerCalls,0);
});
