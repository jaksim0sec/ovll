import test from 'node:test';
import assert from 'node:assert/strict';
import { screenToWorld, worldToScreen, zoomAt, pinchViewport, fitViewport, connectionPath, createGestureTracker } from '../../front/js/canvas/geometry.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} ≈ ${b}`);
test('screen coordinates round trip through translated and scaled camera',()=>{
  const camera={x:120,y:-80,zoom:.4}, point={x:-350,y:240};
  assert.deepEqual(screenToWorld(worldToScreen(point,camera),camera),point);
});
test('zoom keeps the world position beneath cursor fixed, including scale limits',()=>{
  const camera={x:-300,y:100,zoom:.5}, cursor={x:600,y:250};
  const anchor=screenToWorld(cursor,camera);
  for(const zoom of [1.7,80,.001]){
    const next=zoomAt(camera,cursor,zoom);
    const actual=screenToWorld(cursor,next);near(actual.x,anchor.x);near(actual.y,anchor.y);
    assert.ok(next.zoom>=.12 && next.zoom<=3);
  }
});
test('pinch combines midpoint translation with zoom around original anchor',()=>{
  const camera={x:100,y:50,zoom:1};
  const next=pinchViewport(camera,[{x:200,y:100},{x:400,y:100}],[{x:220,y:160},{x:620,y:160}]);
  assert.deepEqual(next,{x:20,y:60,zoom:2});
  assert.deepEqual(screenToWorld({x:420,y:160},next),screenToWorld({x:300,y:100},camera));
});
test('fit respects occupied bounds, top inset and bottom toolbar space',()=>{
  const bounds={x:-300,y:-250,width:800,height:450};
  const camera=fitViewport(bounds,{width:640,height:700},{padding:40,top:70,bottom:150});
  const a=worldToScreen(bounds,camera),b=worldToScreen({x:500,y:200},camera);
  assert.ok(a.x>=40 && a.y>=110);assert.ok(b.x<=600 && b.y<=510);
  assert.ok(camera.zoom<=1);
});
test('connection curve reaches both anchors and bends outwards for reverse links',()=>{
  assert.equal(connectionPath({x:200,y:50},{x:0,y:100}),'M 200 50 C 246.5 50, -46.5 100, 0 100');
});
test('block gesture returns world delta and commits once after pointer lift',()=>{
  const tracker=createGestureTracker();
  tracker.begin({id:1,x:10,y:20},{x:0,y:0,zoom:.5},{kind:'block',blockId:'one'});
  const move=tracker.move({id:1,x:30,y:40});
  assert.deepEqual(move.delta,{x:40,y:40});assert.equal(move.kind,'block');
  const end=tracker.end(1,{x:0,y:0,zoom:.5});
  assert.equal(end.blockId,'one');assert.equal(end.moved,true);assert.equal(tracker.size,0);
});
test('second finger switches block drag to pinch and remaining finger pans without jump',()=>{
  const tracker=createGestureTracker(), camera={x:0,y:0,zoom:1};
  tracker.begin({id:1,x:100,y:100},camera,{kind:'block',blockId:'one'});
  assert.equal(tracker.begin({id:2,x:300,y:100},camera).kind,'pinch');
  const moved=tracker.move({id:2,x:500,y:100});
  assert.deepEqual(moved.viewport,{x:-100,y:-100,zoom:2});
  assert.equal(tracker.end(2,moved.viewport).kind,'pinch');
  const pan=tracker.move({id:1,x:110,y:110});
  assert.equal(pan.kind,'pan');assert.deepEqual(pan.viewport,{x:-90,y:-90,zoom:2});
  tracker.cancel();assert.equal(tracker.size,0);assert.equal(tracker.move({id:1,x:130,y:130}),null);
});
test('tap threshold ignores hand jitter and pointer tracking ignores unknown IDs',()=>{
  const tracker=createGestureTracker();tracker.begin({id:7,x:100,y:100},{x:0,y:0,zoom:1},{kind:'link'});
  assert.equal(tracker.move({id:9,x:200,y:200}),null);
  tracker.move({id:7,x:101,y:101});assert.equal(tracker.end(7,{x:0,y:0,zoom:1}).moved,false);
});
test('new block placement searches beyond occupied expanded bounds without overlap',async()=>{
  const geometry=await import('../../front/js/canvas/geometry.js');assert.equal(typeof geometry.findOpenPosition,'function');
  const occupied=[{x:-100,y:-100,width:210,height:400}];
  for(let i=0;i<12;i++){
    const point=geometry.findOpenPosition({x:0,y:0},{width:210,height:240},occupied,{gap:28});
    const next={...point,width:210,height:240};
    for(const box of occupied)assert.ok(next.x+next.width+28<=box.x||next.x>=box.x+box.width+28||next.y+next.height+28<=box.y||next.y>=box.y+box.height+28);
    occupied.push(next);
  }
});
