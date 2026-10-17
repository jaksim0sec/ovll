import test from 'node:test';
import assert from 'node:assert/strict';
import { decideViewportMotion } from '../../front/js/shell/viewportMotion.js';
import { normalizePresentation } from '../../front/js/shell/hostedSlides.js';
test('isolated resize settles; animated viewport tracks; rotation uses no easing',()=>{
 assert.equal(decideViewportMotion({previousHeight:780,height:480,elapsed:300}), 'shrinking');
 assert.equal(decideViewportMotion({previousHeight:480,height:520,elapsed:22}), 'tracking');
 assert.equal(decideViewportMotion({previousHeight:520,height:519.4,elapsed:250}), 'stable');
 assert.equal(decideViewportMotion({previousHeight:520,height:780,elapsed:200,orientation:true}), 'immediate');
});
test('slide IDs and layout validated; content swipe defaults false',()=>{
 const element={};const config=normalizePresentation({layout:'immersive',pill:{visible:true},slides:[{id:'chat',element},{id:'canvas',element:{}}],stationary:[{id:'composer',element:{},slot:'bottom'}]});
 assert.equal(config.pill.visible,true);assert.equal(config.slides[1].allowContentSwipe,false);assert.equal(config.stationary[0].slot,'bottom');
 assert.throws(()=>normalizePresentation({layout:'bad'}));
 assert.throws(()=>normalizePresentation({slides:[{id:'x',element},{id:'x',element:{}}]}));
});
test('requested pill appears when dynamic slide count grows from one to two',()=>{
 const first=normalizePresentation({pill:{visible:true},slides:[{id:'a',element:{}}]});
 assert.equal(first.pill.visible,false);
 const second=normalizePresentation({pill:first.pill,slides:[{id:'a',element:{}},{id:'b',element:{}}]});
 assert.equal(second.pill.visible,true);
});
