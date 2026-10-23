import test from 'node:test';
import assert from 'node:assert/strict';
import {getActionDescriptor} from '../../back/js/engine/actionDescriptors.js';
import {createPromptComposer} from '../../back/js/engine/promptComposer.js';

const skill={name:'식물 조사',description:'식물 조사 스킬',instruction:'사용자가 요청한 식물의 특징을 조사하도록 정의한다.',
  icon:'globe',color:'#4F8EF7',inputs:[{id:'in',label:'입력',type:'any',multiple:true}],
  outputs:[{id:'result',label:'결과',type:'research',multiple:true}],
  fields:[{id:'request',label:'조사할 식물',placeholder:'은행나무',default:'',maxLength:1800}]};
test('registered actions are exactly one dedicated tool and unknown names are absent',async()=>{
 const define=getActionDescriptor('skillDefine.defineDirect');
 const add=getActionDescriptor('canvasEdit.addBlock');
 assert.equal(define.tool.name,'define_direct');
 assert.equal(add.tool.name,'add_block');
 assert.equal(getActionDescriptor('skillDefine.defineFromIR'),null);
 assert.equal(getActionDescriptor('canvasEdit.deleteBlock'),null);
 const composer=createPromptComposer();
 const prompt=await composer.compose(define.promptLayer,{});
 assert.ok(prompt.includes('defineDirect'));
 assert.equal(prompt.includes('addBlock'),false);
});
test('complete Skill definition is validated and rejects unavailable icons or duplicate fields',()=>{
 const define=getActionDescriptor('skillDefine.defineDirect');
 assert.deepEqual(define.validateArgs(skill,{}),skill);
 assert.throws(()=>define.validateArgs({...skill,icon:'nonexistent-icon'},{}),e=>e.code==='ACTION_ARGS_INVALID');
 assert.throws(()=>define.validateArgs({...skill,fields:[skill.fields[0],skill.fields[0]]},{}),e=>e.code==='ACTION_ARGS_INVALID');
 assert.throws(()=>define.validateArgs({...skill,outputs:[{id:'result',label:'x',type:'unexpected',multiple:true}]},{}),e=>e.code==='ACTION_ARGS_INVALID');
 assert.throws(()=>define.validateArgs({...skill,extra:true},{}),e=>e.code==='ACTION_ARGS_INVALID');
});
test('Block arguments reference an existing server Skill, not a fabricated ID',()=>{
 const d=getActionDescriptor('canvasEdit.addBlock');
 const state={skills:[{...skill,id:'skill-real'}],blocks:[],links:[],revision:1};
 const input={skillId:'skill-real',x:100,y:120,expanded:true,values:{request:'은행나무'}};
 assert.deepEqual(d.validateArgs(input,state),input);
 assert.throws(()=>d.validateArgs({...input,skillId:'skill-fake'},state),e=>e.code==='ACTION_ARGS_INVALID');
 assert.throws(()=>d.validateArgs({...input,values:{undefined:'hi'}},state),e=>e.code==='ACTION_ARGS_INVALID');
 assert.throws(()=>d.validateArgs({...input,x:Infinity},state),e=>e.code==='ACTION_ARGS_INVALID');
});

test('engine action descriptors use provider-neutral JSON Schema for both actions',()=>{
 const define=getActionDescriptor('skillDefine.defineDirect').tool;
 const add=getActionDescriptor('canvasEdit.addBlock').tool;
 for(const tool of [define,add]){
  assert.ok(tool.inputSchema?.type==='object');
  assert.equal('parameters' in tool,false);
  assert.equal('parametersJsonSchema' in tool,false);
 }
 assert.deepEqual(add.inputSchema.properties.values.additionalProperties,{type:'string'});
});
