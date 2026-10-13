import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptComposer} from '../backend/ovllPointer/promptComposer.js';
const context={requestRef:'r1',objective:'Summarize notes',constraints:[],
 capabilities:[],outputContract:'NodeOutput',requestText:'Summarize this',
 materials:[{ref:'source1',kind:'text',source:'user_input',
  content:'Read supplied notes',truncated:false,provenanceRefs:['user:r1']}]};
test('ENTRY, chat and EXIT share exactly one versioned Skill reference grammar',()=>{
 const composer=createPromptComposer();
 for(const moduleIds of [['layer.entry'],['layer.chat'],['layer.response','response.present']]){
   const built=composer.assemble({moduleIds,context});
   assert.equal(built.moduleIds.filter(x=>x==='shared.skill-references').length,1);
   const developer=built.messages.find(m=>m.role==='developer')?.content||'';
   assert.match(developer,/ovll:ref:v1:skill-def/);
   assert.match(developer,/ovll:ref:v1:skill-canvas/);
   assert.match(developer,/ovll:ref:v1:function/);
   assert.equal(developer.split('# SKILL REFERENCES — SHARED CONTRACT V1').length-1,1);
 }
});
test('Skill reference grammar does not alter run-only prompts or add calls',()=>{
 const composer=createPromptComposer();
 const run=composer.assemble({moduleIds:['run.perform'],context});
 assert.deepEqual(run.moduleIds,['core','layer.run','run.perform']);
 assert.equal(run.messages.length,3);
 assert.ok(!run.moduleIds.includes('shared.skill-references'));
 assert.ok(!composer.index().some(x=>x.moduleId==='shared.skill-references'));
});
