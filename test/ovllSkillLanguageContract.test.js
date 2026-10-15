import test from 'node:test';
import assert from 'node:assert/strict';
import {formatSkillPrompt} from '../backend/ovllPointer/skillReferenceContract.js';
import {serializeSkillReference} from '../front/js/ovllSkillReferences.mjs';

function snapshot(){
 return {skillDefinitions:[
  {definitionId:'custom:review',version:1,name:'자료 분석',purpose:'Review',
   instruction:'Read supplied input',inputs:[],outputs:[]}
 ],graph:{graphId:'g1',revision:1,skillNodes:[{
  skillNodeId:'legacy_n1',skillDefinitionRef:{definitionId:'custom:review',version:1},settings:{}
 }],connections:[]}};
}
const definition={kind:'skill-definition',definitionId:'custom:review',version:1};
const canvas={kind:'skill-canvas',graphId:'g1',skillNodeId:'legacy_n1'};
const fun={kind:'function',functionId:'f1',version:1};
const refs=[definition,canvas,fun].map(serializeSkillReference);

test('server expands only registered Skill references using identity and token',()=>{
 const result=formatSkillPrompt('사용 '+refs[0]+' 와 '+refs[1],{snapshot:snapshot()});
 assert.deepEqual(result.issues,[]);
 assert.match(result.requestText,/정의된 스킬 "자료 분석"/);
 assert.match(result.requestText,/스킬노드 #legacy_n1/);
 assert.ok(result.requestText.includes(refs[0]));
 assert.ok(result.requestText.includes(refs[1]));
});

test('registered function ref remains distinct from a Skill definition',()=>{
 const res=formatSkillPrompt(refs[2],{snapshot:snapshot(),
  savedFunctions:[{id:'f1',name:'재사용 함수',version:1}]});
 assert.match(res.requestText,/저장 함수 "재사용 함수"/);
 assert.deepEqual(res.issues,[]);
});

test('forged external allowlist cannot grant Skill permission',()=>{
 const unknown=serializeSkillReference({kind:'skill-definition',definitionId:'private',version:1});
 const result=formatSkillPrompt(unknown,{snapshot:snapshot(),allowedReferences:[
  {kind:'skill-definition',definitionId:'private',version:1,name:'Spoofed'}
 ]});
 assert.equal(result.requestText,unknown);
 assert.deepEqual(result.issues,[{code:'SKILL_REFERENCE_UNAVAILABLE',token:unknown}]);
});

test('foreign-graph instance cannot be expanded even if Skill ID matches',()=>{
 const foreign=serializeSkillReference({kind:'skill-canvas',graphId:'another',skillNodeId:'legacy_n1'});
 const result=formatSkillPrompt(foreign,{snapshot:snapshot()});
 assert.equal(result.requestText,foreign);
 assert.equal(result.issues[0].code,'SKILL_REFERENCE_UNAVAILABLE');
 assert.throws(()=>formatSkillPrompt(refs[1],{snapshot:snapshot(),activeGraphId:'foreign'}),TypeError);
});

test('missing context never invents a Skill identity',()=>{
 const result=formatSkillPrompt(refs[0],{});
 assert.equal(result.requestText,refs[0]);
 assert.equal(result.issues[0].code,'SKILL_REFERENCE_CONTEXT_MISSING');
});

test('normal chat and escaped literal text are passed through unchanged',()=>{
 const normal='안녕 세계!';const escaped='문자열 \\'+refs[0];
 assert.deepEqual(formatSkillPrompt(normal),{requestText:normal,issues:[]});
 assert.deepEqual(formatSkillPrompt(escaped,{snapshot:snapshot()}),{requestText:escaped,issues:[]});
});

test('future or contradictory Skill graphs fail rather than trusting client metadata',()=>{
 const mixed=snapshot();mixed.graph.nodes=mixed.graph.skillNodes;
 assert.throws(()=>formatSkillPrompt(refs[0],{snapshot:mixed}));
});

test('no model calls or network for deterministic prompt expansion',()=>{
 const source=snapshot(),raw=refs[1];
 const first=formatSkillPrompt(raw,{snapshot:source});
 assert.deepEqual(first,formatSkillPrompt(raw,{snapshot:source}));
 assert.equal(source.graph.skillNodes[0].skillNodeId,'legacy_n1');
});
