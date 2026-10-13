import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('shared Skill module is loaded before classic composer and included in offline assets',()=>{
 const boot=read('front/js/boot.js'),manifest=read('front/asset-manifest.js');
 assert.match(boot,/global\.OvllSkillReferences=Object\.freeze/);
 assert.match(boot,/await Promise\.all\(\[\s*"\.\/js\/ovllSkillReferences\.mjs"/);
 assert.match(manifest,/\.\/js\/skillReferenceUI\.js/);
 assert.match(manifest,/\.\/js\/ovllSkillReferenceView\.mjs/);
 assert.match(manifest,/\.\/css\/skillReferences\.css/);
 assert.match(read('front/index.html'),/href="\.\/css\/skillReferences\.css"/);
});

test('user message parts persist and restore as separate identity from text',()=>{
 const app=read('front/js/app.js');
 assert.match(app,/parts:role==="user"&&Array\.isArray\(options\.parts\)/);
 assert.match(app,/parts:\s*item\.parts/);
 assert.match(app,/addUserMessage\(value,\{parts:options\.parts\}\)/);
 assert.match(app,/runPrompt\(text,\{parts\}\)/);
});

test('assistant and workspace renderer share verified Skill reference view',()=>{
 const app=read('front/js/app.js');
 const space=read('front/js/ovllWorkspace.js');
 const ui=read('front/js/skillReferenceUI.js');
 assert.match(app,/OvllSkillReferenceUI\?\.decorateAssistant/);
 assert.match(space,/decorateAssistant\?\./);
 assert.match(ui,/createSkillReferenceResolver/);
 assert.match(ui,/if\(!snapshot\?\.graph\)return \(\)=>null/);
 assert.match(ui,/serializeSkillReference\(found\.reference\)===part\.token/);
});

test('existing composer size/keyboard behavior is not changed by shared renderer wiring',()=>{
 const composer=read('front/js/ovllComposer.js');
 assert.match(composer,/function resize\(\)/);
 assert.match(composer,/if \(mobile\(\)\)/);
 assert.doesNotMatch(read('front/js/skillReferenceUI.js'),/\.focus\(|\.blur\(|getBoundingClientRect\(/);
});
