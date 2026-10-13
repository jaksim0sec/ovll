import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const dockMedia = '(min-width: 43.76rem) and (hover: hover) and (pointer: fine), (min-width: 60.01rem)';

test('wide desktop keeps its dock even when the primary pointer is touch-capable',()=>{
  const menu=read('front/js/shellMenu.js');
  const style=read('front/css/shellMenu.css');
  assert.ok(menu.includes('"'+dockMedia+'"'), 'desktop JS media query matches responsive CSS');
  assert.ok(style.includes('@media '+dockMedia+' {'), 'same desktop media query used in CSS');
  assert.match(menu,/function usesDockedSidebar\(\)\s*\{\s*return desktopSidebarMedia\s*\?\.matches === true/);
  assert.match(menu,/if\(usesDockedSidebar\(\)\)\{\s*setOpen\(true\);\s*\}/);
});

test('desktop sidebar and workspace content can remain side by side',()=>{
  const css=read('front/css/shellMenu.css');
  const desktop=css.slice(css.indexOf('@media '+dockMedia+' {'));
  assert.match(desktop,/#ovll-shell-menu-backdrop\s*\{\s*display:\s*none/);
  assert.match(desktop,/:root\.shell-menu-open\s*#workspace-shell,\s*:root\.shell-menu-open\s*#library-page\s*\{\s*left:\s*var\(--sidebar-width\)/);
  assert.match(desktop,/#workspace-shell[^}]*right:\s*0/);
  assert.match(desktop,/#workspace-shell[^}]*width:\s*auto/);
  assert.match(css,/#ovll-shell-menu\.is-open\s*#ovll-shell-menu-panel/);
});

test('small-screen overlay and closing gesture remain available',()=>{
  const css=read('front/css/shellMenu.css');
  const js=read('front/js/shellMenu.js');
  assert.match(css,/#ovll-shell-menu\.is-open\s*#ovll-shell-menu-backdrop\s*\{/);
  assert.match(js,/if\(!usesDockedSidebar\(\)\)\{\s*close\(\);/);
  assert.match(js,/function closeOnSmallScreen\(\)\{\s*if\(usesDockedSidebar\(\)\)\{/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)\s*\{\s*#ovll-shell-menu-panel\s*\{/);
});
