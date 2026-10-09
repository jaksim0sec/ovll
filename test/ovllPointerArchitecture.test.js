import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {iconSvg,nodeDefinitionsPublic,GENERATABLE_NODE_TYPES,getNodeDefinition,getPortDefinition} from '../backend/ovllPointer/nodeCatalog.js';
import {cloneWorkflow,normalizeMemory,normalizeConversationHistory,planWorkflow,geminiHttpFailure} from '../backend/ovllPointer/legacyCompatibility.js';
import {localModelReady} from '../backend/ovllPointer/localHttp.js';

test('OvllPointer owns the canonical node catalog and legacy builder contracts',()=>{
  assert.equal(typeof iconSvg.globe,'string');
  assert.equal(nodeDefinitionsPublic.research.iconKey,'globe');
  assert.ok(GENERATABLE_NODE_TYPES.includes('write'));
  assert.equal(getNodeDefinition('write').iconKey,'pen');
  assert.ok(getPortDefinition('write','output','result'));
  assert.deepEqual(cloneWorkflow(null),{nodes:[],links:[],data:[]});
  assert.equal(typeof normalizeMemory,'function');
  assert.equal(typeof normalizeConversationHistory,'function');
  assert.equal(typeof planWorkflow,'function');
  assert.equal(typeof geminiHttpFailure,'function');
});
test('server entry serves only the canonical Pointer model runtime',()=>{
  const server=readFileSync(new URL('../server.js',import.meta.url),'utf8');
  const config=readFileSync(new URL('../front/runtime-config.js',import.meta.url),'utf8');
  assert.match(server,/backend\/ovllPointer\/nodeCatalog\.js/);
  assert.doesNotMatch(server,/backend\/ovllPointer\/legacyCompatibility\.js/);
  assert.doesNotMatch(server,/\/api\/(chat|workflow|execute-group|finalize-run)/);
  assert.match(server,/mountLocalPointerRoutes\(app\)/);
  assert.doesNotMatch(server,/const\s+SYSTEM_PROMPT\s*=/);
  assert.doesNotMatch(server,/const\s+PLANNER_SCHEMA\s*=/);
  assert.doesNotMatch(server,/async function requestPlanner\(/);
  assert.match(config,/pointerStorageMode:"local"/);
  assert.match(config,/pointerEnabled:true/);
  assert.equal(localModelReady({}),false);
});
