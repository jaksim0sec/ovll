import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const local=readFileSync(new URL('../front/js/ovllPointerLocal.js',import.meta.url),'utf8');
const api=readFileSync(new URL('../front/js/ovllPointerApi.js',import.meta.url),'utf8');
const host=readFileSync(new URL('../backend/ovllPointer/localHost.js',import.meta.url),'utf8');
const route=readFileSync(new URL('../backend/ovllPointer/localHttp.js',import.meta.url),'utf8');
test('active browser model tasks send canonical Skill ingress with stable IDs',()=>{
 assert.match(local,/async function executeModelSkill\(\{snapshot,nodeId,\.\.\.args\}\)/);
 assert.match(local,/normalizeSkillSnapshot\(snapshot,\{source:'legacy'\}\)/);
 assert.match(local,/skillAPI\(\{snapshot:canonical,skillId:nodeId,\.\.\.args\}\)/);
 assert.match(local,/if\(result\?\.skillId!==nodeId\)throw/);
 assert.match(local,/executeNode=executeModelSkill/);
 assert.match(api,/request\('local\/skill'/);
 assert.match(route,/const allowed=new Set\(\['turn','node','skill','response'\]\)/);
 assert.match(host,/async function skill\(\{snapshot,skillId,\.\.\.args\}/);
});
test('old node route remains narrow compatibility and no extra model call is injected',()=>{
 assert.match(local,/return global\.OvllPointerApi\.localNode\(\{snapshot,nodeId,\.\.\.args\}\)/);
 assert.doesNotMatch(local,/executeModelSkill[\s\S]{0,900}gateway\.complete/);
});
