import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('wide desktop always docks sidebar beside content including touch-enabled laptops', () => {
  const script = read('front/js/shellMenu.js');
  const stylesheet = read('front/css/shellMenu.css');
  const wideQuery = '(min-width: 60rem)';
  assert.ok(script.includes(wideQuery),
    'desktop JS must dock wide layouts even if primary pointer is coarse');
  assert.match(stylesheet, /,\s*\(min-width:\s*60rem\)\s*\{/,
    'matching wide-layout CSS must provide the dock layout');
  assert.match(stylesheet,
    /:root\.shell-menu-open\s*#workspace-shell,\s*:root\.shell-menu-open\s*#library-page\s*\{\s*left:\s*var\(--sidebar-width\)/,
    'main content and library must shift to the right while dock is open');
  assert.match(script, /\.classList\.toggle\(\s*"shell-menu-open",\s*next\s*\)/);
  assert.match(script, /setOpen\(event\.matches\)/);
});

test('existing mouse desktop dock and mobile overlay behavior are preserved', () => {
  const script = read('front/js/shellMenu.js');
  const stylesheet = read('front/css/shellMenu.css');
  const desktopQuery = '(min-width: 43.76rem) and (hover: hover) and (pointer: fine)';
  assert.ok(script.includes(desktopQuery),
    'existing mouse desktop minimum width must still work');
  assert.match(stylesheet, /@media\s*\(min-width:\s*43\.76rem\)[^{}]*hover:\s*hover/);
  assert.match(stylesheet, /@media\s*\(max-width:\s*43\.75rem\)/);
  assert.match(script, /if\(!usesDockedSidebar\(\)\)\s*\{\s*close\(\)/,
    'small-screen overlay must still close on backdrop');
  assert.match(stylesheet, /#ovll-shell-menu\.is-open\s*#ovll-shell-menu-backdrop/);
  assert.match(script, /if\(usesDockedSidebar\(\)\)\s*\{\s*setOpen\(true\)/,
    'desktop dock initially opens beside content');
});

test('desktop sidebar fix does not depend on composer or Skill runtime changes', () => {
  const stylesheet = read('front/css/shellMenu.css');
  const script = read('front/js/shellMenu.js');
  assert.doesNotMatch(stylesheet, /#composer-form|\.ovll-composer-rich/);
  assert.doesNotMatch(script, /skillId|nodeId\s*=/);
});