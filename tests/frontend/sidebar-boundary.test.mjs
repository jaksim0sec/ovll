import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOpenStartDrawer } from '../../front/js/shell/hostedSlides.js';

const gesture = (changes = {}) => ({ slideIndex:0, kind:'body', allowContentSwipe:true,
  dx:110, width:390, speed:0.12, drag:true, denied:false, ...changes });

test('only leftmost swipe-enabled body may open sidebar by dragging toward the left boundary',()=>{
  assert.equal(shouldOpenStartDrawer(gesture()), true);
  assert.equal(shouldOpenStartDrawer(gesture({slideIndex:1})), false);
  assert.equal(shouldOpenStartDrawer(gesture({allowContentSwipe:false})), false);
  assert.equal(shouldOpenStartDrawer(gesture({kind:'pill'})), false);
});

test('sidebar does not open for wrong direction, vertical rejection, short moves',()=>{
  for (const changes of [{dx:-110},{denied:true},{drag:false},{dx:20,speed:0},{dx:15,speed:1}])
    assert.equal(shouldOpenStartDrawer(gesture(changes)), false);
});

test('a committed short fast rightward flick can open sidebar',()=>{
  assert.equal(shouldOpenStartDrawer(gesture({dx:30,speed:.6})), true);
  assert.equal(shouldOpenStartDrawer(gesture({dx:30,speed:-.6})), false);
});
