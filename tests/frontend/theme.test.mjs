import test from 'node:test';
import assert from 'node:assert/strict';
import { createThemeSettings } from '../../front/js/settings/theme.js';
function fixture(stored=null){const root={dataset:{}};let value=stored;return {root,storage:{getItem:()=>value,setItem:(k,v)=>{value=v}},get stored(){return value}};}
test('theme defaults to OS and switches across dark light system',()=>{
  const f=fixture();const theme=createThemeSettings({root:f.root,storage:f.storage});
  assert.equal(theme.getTheme(),'system');assert.equal(f.root.dataset.theme,'system');
  theme.setTheme('light');assert.equal(f.root.dataset.theme,'light');assert.equal(f.stored,'light');
  theme.setTheme('dark');assert.equal(f.root.dataset.theme,'dark');
  theme.setTheme('system');assert.equal(f.root.dataset.theme,'system');theme.destroy();
});
test('theme keeps user preference and tolerates blocked storage',()=>{
  const f=fixture('dark');const theme=createThemeSettings({root:f.root,storage:f.storage});
  assert.equal(theme.getTheme(),'dark');theme.destroy();
  const root={dataset:{}};const blocked={getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')}};
  const next=createThemeSettings({root,storage:blocked});next.setTheme('light');assert.equal(root.dataset.theme,'light');next.destroy();
});
