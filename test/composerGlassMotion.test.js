import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const compact=text=>text.replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\s+/g,' ');

test('send and attach SVGs share rounded composer stroke without resizing hit targets',()=>{
  const style=read('front/css/style.css');
  const composer=compact(read('front/css/composer.css'));
  const html=read('front/index.html');
  const workspace=read('front/js/ovllWorkspace.js');
  const library=read('front/js/svgLibrary.js');
  assert.match(style,/svg\.svg-icon\s*\{[^}]*stroke-linecap:\s*round;[^}]*stroke-linejoin:\s*round;/);
  assert.match(html,/id="composer-attach"[\s\S]*?<svg class="svg-icon"/);
  assert.match(workspace,/data-ovll-composer-attach[\s\S]*?<svg class="svg-icon"/);
  assert.match(library,/composerSend:[\s\S]*?<svg class="svg-icon"[\s\S]*?<path d="M10 15\.7V4\.6"/);
  assert.match(composer,/\.ovll-rich-toolbar > :is\(#composer-attach,\[data-ovll-composer-attach\]\) svg\.svg-icon\s*\{[^}]*stroke-width:\s*2\.1/);
  assert.match(composer,/ovll-composer-rich > :is\(#composer-submit,\[data-ovll-composer-submit\]\) svg\.svg-icon\s*\{[^}]*stroke-width:\s*2\.1/);
  assert.match(composer,/\.ovll-rich-toolbar > :is\(#composer-attach,\[data-ovll-composer-attach\]\)\s*\{[^}]*width:\s*2\.25rem/);
  assert.match(composer,/ovll-composer-rich > :is\(#composer-submit,\[data-ovll-composer-submit\]\)\s*\{[^}]*width:\s*2\.5rem/);
});

test('composer expansion animates measured heights only when state flips and respects reduced motion',()=>{
  const js=read('front/js/ovllComposer.js');
  const css=compact(read('front/css/composer.css'));
  assert.match(js,/let sizeAnimation = null/);
  assert.match(js,/const wasExpanded = form\.classList\.contains\("is-expanded"\)/);
  assert.match(js,/const changedLayout = wasExpanded !== expanded/);
  assert.match(js,/if \(changedLayout\)/);
  assert.match(js,/sizeAnimation\?\.cancel\(\)/);
  assert.match(js,/form\.animate\(/);
  assert.match(js,/prefers-reduced-motion: reduce/);
  assert.match(css,/\.ovll-composer-rich\.is-expanded/);
  assert.match(css,/transition:[^}]*background-color/);
  assert.doesNotMatch(css,/transition:[^}]*padding/);
  assert.match(js,/const motion = \{ duration: 145/);
  assert.match(js,/submit\.disabled = busy \|\| !input\.value\.trim\(\);\s*scheduleResize\(\)/);
  assert.match(js,/let resizeScheduled = false/);
  assert.match(js,/if \(resizeScheduled\) return/);
  assert.match(js,/function setBusy\(value\) \{[\s\S]*?submit\.disabled = busy \|\| !input\.value\.trim\(\)/);
  // Keep existing keyboard and picker focus behavior; motion must not force focus.
  assert.match(js,/editor\.addEventListener\("blur", event =>/);
  assert.doesNotMatch(js,/sizeAnimation[\s\S]{0,300}editor\.focus\(/);
});

test('composer and nearby glass pills share readable translucency without global button changes',()=>{
  const theme=read('front/css/style.css');
  const composer=compact(read('front/css/composer.css'));
  const ui=compact(read('front/css/ui.css'));
  const chat=compact(read('front/css/chat.css'));
  assert.match(theme,/--ui-glass:\s*rgba\(255,\s*255,\s*255,\s*\.72\)/);
  assert.match(theme,/--ui-backdrop:\s*blur\(\.85rem\)\s*saturate\(1\.07\)/);
  assert.match(theme,/:root\.dark\s*\{[^}]*--ui-glass:\s*rgba\(28,\s*29,\s*32,\s*\.70\)/);
  assert.match(composer,/\.ovll-composer-rich\s*\{[^}]*background:\s*var\(--ui-glass\);[^}]*backdrop-filter:\s*var\(--ui-backdrop\)/);
  assert.match(composer,/\.ovll-composer-rich:focus-within\s*\{[^}]*background:\s*var\(--ui-glass-strong\)/);
  assert.match(composer,/\.ovll-composer-rich \.ovll-rich-picker\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--panel\) 64%, transparent\)/);
  assert.match(ui,/mode-switch[\s\S]*?canvas-node-builder-layout[\s\S]*?background:\s*var\(--ui-glass\)/);
  assert.match(ui,/canvas-node-builder-panel[\s\S]*?background:\s*var\(--ui-glass-strong\)/);
  assert.match(chat,/\.astra-message-actions\s*\{[^}]*background:\s*var\(--ui-glass\);[^}]*backdrop-filter:\s*var\(--ui-backdrop\)/);
  assert.doesNotMatch(theme,/--ui-control-shadow:[^;]*inset/);
  assert.doesNotMatch(theme,/button\s*\{\s*backdrop-filter:/);
});
