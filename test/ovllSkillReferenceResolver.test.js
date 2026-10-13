import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillReferenceResolver} from '../front/js/ovllSkillReferenceResolver.mjs';

const refs=[
  {definitionId:'builtin:review',version:1,name:'요약',iconKey:'review',color:'#aabbcc'},
  {definitionId:'builtin:review',version:2,name:'요약',iconKey:'review-v2'},
  {definitionId:'custom:my',version:1,name:'요약',iconKey:'custom'}
];
function setup(graphId='g1'){
  return createSkillReferenceResolver({
    getSkillDefinitions:()=>refs,
    getCanvasGraph:()=>({graphId:'g1',skills:[
      {skillId:'s1',skillDefinitionRef:{definitionId:'custom:my',version:1},name:'커스텀 작업'},
      {skillId:'s2',skillDefinitionRef:{definitionId:'builtin:review',version:2}}
    ]}),
    getFunctions:()=>[{id:'f1',name:'재사용 함수',version:1}],
    getCurrentScope:()=>({graphId})
  });
}

test('definition identity is ID+version and never a display-name lookup',()=>{
  const resolver=setup();
  const a=resolver.resolve({kind:'skill-definition',definitionId:'builtin:review',version:2});
  assert.equal(a.label,'요약');assert.equal(a.iconKey,'review-v2');
  const b=resolver.resolve({kind:'skill-definition',definitionId:'custom:my',version:1});
  assert.equal(b.label,'요약');assert.equal(b.iconKey,'custom');
  assert.equal(resolver.resolve({kind:'skill-definition',definitionId:'builtin:review'}),null);
  assert.equal(resolver.resolve({kind:'skill-definition',definitionId:'missing',version:1}),null);
});

test('canvas Skill ID is only valid in the matching active graph scope',()=>{
  const ref={kind:'skill-canvas',graphId:'g1',skillId:'s1'};
  const a=setup('g1').resolve(ref);
  assert.equal(a.label,'커스텀 작업');
  assert.equal(a.kind,'skill-canvas');
  assert.equal(a.iconKey,'custom');
  assert.equal(setup('another-graph').resolve(ref),null);
  assert.equal(setup('g1').resolve({...ref,skillId:'unknown'}),null);
});

test('saved function identity stays separate from Skill definition IDs',()=>{
  const resolve=setup().resolve;
  assert.equal(resolve({kind:'function',functionId:'f1',version:1}).label,'재사용 함수');
  assert.equal(resolve({kind:'function',functionId:'f1',version:3}),null);
  assert.equal(resolve({kind:'skill-definition',definitionId:'f1',version:1}),null);
});

test('authorized reference catalog never generates out-of-scope canvas references',()=>{
  const a=setup('g1').allowedReferences();
  assert.ok(a.some(r=>r.kind==='skill-canvas'&&r.skillId==='s1'));
  assert.ok(a.some(r=>r.kind==='skill-definition'&&r.definitionId==='custom:my'));
  assert.ok(a.some(r=>r.kind==='function'&&r.functionId==='f1'));
  const other=setup('g2').allowedReferences();
  assert.equal(other.some(r=>r.kind==='skill-canvas'),false);
});

test('duplicate names never change which definition or instance is returned',()=>{
  const r=setup().resolve({kind:'skill-canvas',graphId:'g1',skillId:'s2'});
  assert.equal(r.label,'요약');
  assert.equal(r.reference.skillId,'s2');
  assert.equal(r.iconKey,'review-v2');
});

test('untrusted reference objects cannot smuggle extra fields into the resolved identity',()=>{
  const resolver=setup();
  assert.equal(resolver.resolve({
    kind:'skill-canvas',graphId:'g1',skillId:'s1',label:'forged name'
  }),null);
  assert.equal(resolver.resolve({
    kind:'skill-definition',definitionId:'custom:my',version:1,admin:true
  }),null);
  assert.equal(resolver.resolve({
    kind:'skill-definition',definitionId:'custom:my',version:0
  }),null);
  const good=resolver.resolve({kind:'skill-canvas',graphId:'g1',skillId:'s1'});
  assert.equal(good.reference.kind,'skill-canvas');
  assert.deepEqual(Object.keys(good.reference).sort(),['graphId','kind','skillId']);
});

test('canvas references require a currently registered definition version',()=>{
 const r=createSkillReferenceResolver({
  getSkillDefinitions:()=>[],
  getCanvasGraph:()=>({graphId:'g',skills:[{skillId:'x',name:'Looks real',skillDefinitionRef:{definitionId:'missing',version:1}}]}),
  getCurrentScope:()=>({graphId:'g'})
 });
 assert.equal(r.resolve({kind:'skill-canvas',graphId:'g',skillId:'x'}),null);
 assert.equal(r.allowedReferences().some(x=>x.kind==='skill-canvas'),false);
});
