import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('composer emits canonical Skill references only after live scope resolution',()=>{
 const src=read('front/js/ovllComposer.js');
 assert.match(src,/function referenceFor\(item\)/);
 assert.match(src,/getSkillSnapshot\?\.\(\)/);
 assert.match(src,/const verified=resolve\?\.\(reference\)/);
 assert.match(src,/tag\.dataset\.ovllRefToken=api\.serializeSkillReference\(reference\)/);
 assert.match(src,/parseSkillReference\(node\.dataset\.ovllRefToken\)/);
 assert.match(src,/getWireText:plainValue/);
});
test('literal user typed token is escaped without losing editor draft identity',()=>{
 const src=read('front/js/ovllComposer.js');
 assert.match(src,/escapeSkillReferenceLiteral\?\.\(p\.text\)/);
 assert.match(src,/p\.type==="reference"/);
 assert.match(src,/labelSnapshot:node\.dataset\.ovllRefLabel/);
 assert.match(src,/editor\.append\(createTag\(\{reference:p\.reference/);
});
test('old saved drafts remain loadable and mobile input behavior unchanged',()=>{
 const src=read('front/js/ovllComposer.js');
 assert.match(src,/\["node_type", "node_instance", "function"\]/);
 assert.match(src,/if \(mobile\(\)\)/);
 assert.match(src,/function resize\(\)/);
 assert.match(src,/const hasReference = contentParts/);
});
test('composer and chat use same scope snapshot and shared chip class',()=>{
 assert.match(read('front/js/app.js'),/getSkillSnapshot:\(\)=>state\.pointerGraphSnapshot/);
 assert.match(read('front/js/ovllWorkspace.js'),/getSkillSnapshot:\(\)=>options\.getSkillSnapshot/);
 assert.match(read('front/js/ovllComposer.js'),/createSkillReferenceChip/);
 assert.match(read('front/js/ovllComposer.js'),/classList\.add\("ovll-rich-ref"\)/);
});

test('trusted drafts rehydrate after scoped graph is ready with pill metrics',()=>{
 const src=read('front/js/ovllComposer.js'),app=read('front/js/app.js');
 assert.match(src,/let pendingDraftParts = null/);
 assert.match(src,/function reconcileDraft\(\)/);
 assert.match(src,/editor\.textContent !== pendingDraftText/);
 assert.match(src,/pendingDraftParts\.every\(p => p\.type !== "reference" \|\| resolver\(p\.reference\)\)/);
 assert.match(src,/getDraftParts: draftParts/);
 assert.match(app,/composerEditor\?\.reconcileDraft\?\.\(\)/);
 assert.match(app,/composerEditor\.getDraftParts\(\)/);
 for(const path of ['front/css/skillReferences.css','front/css/composer.css']){
  const css=read(path);
  assert.match(css,/border-radius:\s*999px/);
  assert.match(css,/min-height:\s*1\.7em/);
 }
});
