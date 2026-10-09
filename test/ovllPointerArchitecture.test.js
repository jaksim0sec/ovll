import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {iconSvg,nodeDefinitionsPublic,GENERATABLE_NODE_TYPES,getNodeDefinition,getPortDefinition} from '../backend/ovllPointer/nodeCatalog.js';
import {localModelReady} from '../backend/ovllPointer/localHttp.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('canonical Pointer node catalog remains the source of UI definitions',()=>{
  assert.equal(typeof iconSvg.globe,'string');
  assert.equal(nodeDefinitionsPublic.research.iconKey,'globe');
  assert.ok(GENERATABLE_NODE_TYPES.includes('write'));
  assert.equal(getNodeDefinition('write').iconKey,'pen');
  assert.ok(getPortDefinition('write','output','result'));
});
test('active entrypoint and UI use only Pointer model and run routes',()=>{
  const server=read('server.js'),app=read('front/js/app.js'),boot=read('front/js/boot.js');
  assert.match(server,/mountLocalPointerRoutes\(app\)/);
  assert.doesNotMatch(server,/\/api\/(chat|workflow|execute-group|finalize-run)/);
  assert.doesNotMatch(server,/legacyCompatibility|geminiExecution/);
  assert.match(app,/PointerAPI\.localTurn/);
  assert.doesNotMatch(app,/API\.(?:planWorkflow|finalizeRun)/);
  assert.doesNotMatch(boot,/runtimeEngine\.js|runtimeFinalization\.js/);
  assert.match(read('front/runtime-config.js'),/pointerStorageMode:"local"/);
  assert.equal(localModelReady({}),false);
});
test('retired execution modules are absent and saved workflow migration remains',()=>{
  for(const p of ['backend/ai/geminiExecution.js','backend/ovllPointer/legacyCompatibility.js',
    'front/js/runtimeEngine.js','front/js/runtimeFinalization.js'])
    assert.equal(existsSync(new URL('../'+p,import.meta.url)),false,p);
  const migration=read('front/js/ovllPointerLocal.js');
  assert.match(migration,/migrateConversation/);
  assert.match(migration,/LEGACY_GRAPH_REQUIRES_REVIEW/);
});
