import test from 'node:test';
import assert from 'node:assert/strict';
import {
 serializeSkillReference,parseSkillReference,segmentSkillReferences,
 escapeSkillReferenceLiteral,SkillReferenceSyntaxError
} from '../front/js/ovllSkillReferences.mjs';

const e=code=>err=>err instanceof SkillReferenceSyntaxError&&err.code===code;
const def=(definitionId,version)=>({kind:'skill-definition',definitionId,...(version===undefined?{}:{version})});
const canvas=(graphId,skillNodeId)=>({kind:'skill-canvas',graphId,skillNodeId});

test('canonical ref tokens have distinct definition and graph-scoped instance identities',()=>{
 assert.equal(serializeSkillReference(def('builtin:review',1)),
   '⟦ovll:ref:v1:skill-def:builtin%3Areview:1⟧');
 assert.equal(serializeSkillReference(canvas('graph:1','s_17')),
   '⟦ovll:ref:v1:skill-canvas:graph%3A1:s_17⟧');
 assert.equal(serializeSkillReference({kind:'function',functionId:'fn_4'}),
   '⟦ovll:ref:v1:function:fn_4⟧');
 assert.deepEqual(parseSkillReference('⟦ovll:ref:v1:skill-def:builtin%3Areview:1⟧'),
   def('builtin:review',1));
 assert.deepEqual(parseSkillReference('⟦ovll:ref:v1:skill-canvas:graph%3A1:s_17⟧'),
   canvas('graph:1','s_17'));
});

test('roundtrip Unicode names and reserved percent-encoding safely',()=>{
 const all=[def('한글:!()* %/[]',2),canvas('g:📎','skillNode:☃'),{kind:'function',functionId:"fn<'\">",version:3}];
 for(const ref of all) {
   const token=serializeSkillReference(ref);
   assert.deepEqual(parseSkillReference(token),ref);
   assert.equal(serializeSkillReference(parseSkillReference(token)),token);
 }
});

test('non-canonical encoded IDs, malformed versions and ambiguous delimiters reject',()=>{
 for(const token of [
   '⟦ovll:ref:v1:skill-def:%41⟧',
   '⟦ovll:ref:v1:skill-def:a%3ab⟧',
   '⟦ovll:ref:v1:skill-def:abc:00⟧',
   '⟦ovll:ref:v1:skill-def:abc:0⟧',
   '⟦ovll:ref:v1:skill-def:abc:1.1⟧',
   '⟦ovll:ref:v1:skill-def:abc:9999999999999999999⟧',
   '⟦ovll:ref:v1:skill-def:⟧',
   '⟦ovll:ref:v1:skill-canvas:g:⟧',
   '⟦ovll:ref:v1:skill-canvas:g:s:extra⟧',
   '⟦ovll:ref:v1:skill-def:%ZZ⟧',
   '⟦ovll:ref:v1:unknown:key⟧'
 ]) assert.equal(parseSkillReference(token),null,token);
});

test('serializer refuses invalid IDs and unknown kind without inventing references',()=>{
 assert.throws(()=>serializeSkillReference(def('',1)),e('INVALID_SKILL_REFERENCE_ID'));
 assert.throws(()=>serializeSkillReference(canvas('g','\n')),e('INVALID_SKILL_REFERENCE_ID'));
 assert.throws(()=>serializeSkillReference({kind:'unknown',skillNodeId:'s'}),e('INVALID_SKILL_REFERENCE_KIND'));
 assert.throws(()=>serializeSkillReference(def('x',0)),e('INVALID_SKILL_REFERENCE_VERSION'));
 assert.throws(()=>serializeSkillReference(def('x',1.5)),e('INVALID_SKILL_REFERENCE_VERSION'));
 assert.throws(()=>serializeSkillReference(def('x'.repeat(161),1)),e('INVALID_SKILL_REFERENCE_ID'));
});

test('segmenter preserves original characters and leaves malformed token inert',()=>{
 const a=serializeSkillReference(def('sample',1));
 const b=serializeSkillReference(canvas('g1','s1'));
 const input='시작 '+a+' 그리고 '+b+'! ⟦ovll:ref:v1:unknown:fake⟧';
 const segments=segmentSkillReferences(input);
 assert.equal(segments.map(x=>x.text??x.token).join(''),input);
 assert.deepEqual(segments.filter(x=>x.type==='candidate').map(x=>x.reference.kind),
   ['skill-definition','skill-canvas']);
 assert.ok(segments.some(x=>x.type==='text'&&x.text.includes('unknown:fake')));
});

test('literal user text can be escaped without gaining reference authority',()=>{
 const tok=serializeSkillReference(def('quoted',1));
 const escaped=escapeSkillReferenceLiteral('text '+tok+' end');
 assert.equal(escaped,'text \\'+tok+' end');
 assert.equal(segmentSkillReferences(escaped).filter(x=>x.type==='candidate').length,0);
 assert.equal(segmentSkillReferences('before '+tok).filter(x=>x.type==='candidate').length,1);
});

test('truncated and overly long tokens cannot turn into partial chips',()=>{
 assert.equal(parseSkillReference('⟦ovll:ref:v1:skill-def:x'),null);
 assert.equal(parseSkillReference('⟦ovll:ref:v1:skill-def:x⟧oops'),null);
 assert.equal(parseSkillReference('⟦ovll:ref:v1:skill-def:'+('a'.repeat(515))+'⟧'),null);
 const value='prefix ⟦ovll:ref:v1:skill-def:missing';
 assert.deepEqual(segmentSkillReferences(value),[{type:'text',text:value}]);
});

test('token scanning does not change arbitrary source text',()=>{
 const sample='a ⟦b⟧ ☃ foo\\⟦ovll:ref:v1:skill-def:x⟧ a@b lorem\nbar';
 const result=segmentSkillReferences(sample);
 assert.equal(result.map(x=>x.text??x.token).join(''),sample);
 assert.ok(result.every(x=>x.type==='text'));
});

test('serializer rejects injected presentation and execution metadata on references',()=>{
 assert.throws(()=>serializeSkillReference({kind:'skill-canvas',graphId:'g',skillNodeId:'s',label:'spoof'}),e('INVALID_SKILL_REFERENCE_FIELDS'));
 assert.throws(()=>serializeSkillReference({kind:'skill-definition',definitionId:'custom:a',version:1,admin:true}),e('INVALID_SKILL_REFERENCE_FIELDS'));
 assert.throws(()=>serializeSkillReference({kind:'function',functionId:'f',iconKey:'unknown'}),e('INVALID_SKILL_REFERENCE_FIELDS'));
 assert.equal(serializeSkillReference({kind:'skill-canvas',graphId:'g',skillNodeId:'s'}),'⟦ovll:ref:v1:skill-canvas:g:s⟧');
});
