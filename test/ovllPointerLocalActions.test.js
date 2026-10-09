import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8');
const window={};vm.runInNewContext(src,{window});
const order=window.OvllPointerLocalActions.order;
test('model proposal actions execute dependencies before use of temporary node refs',()=>{
  const actions=[{localKey:'run',kind:'run.start',dependsOn:['create']},
    {localKey:'create',kind:'ir.applyPatch'}];
  assert.deepEqual(Array.from(order(actions),x=>x.localKey),['create','run']);
});
test('local action sorter rejects missing dependencies and cycles',()=>{
  assert.throws(()=>order([{localKey:'a',dependsOn:['missing']}]),/MISSING/);
  assert.throws(()=>order([{localKey:'a',dependsOn:['b']},{localKey:'b',dependsOn:['a']}]),/CYCLE/);
  assert.throws(()=>order([{localKey:'a'},{localKey:'a'}]),/DUPLICATE/);
});
