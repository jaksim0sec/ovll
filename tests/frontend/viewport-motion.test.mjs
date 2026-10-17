import test from 'node:test';
import assert from 'node:assert/strict';
import { createViewportMotion } from '../../front/js/shell/viewportMotion.js';
function simulation() {
  let clock=0, queue=new Map(), index=0;
  const events=[];
  const driver=createViewportMotion({
    now:()=>clock,
    requestFrame:(cb)=>{queue.set(++index,cb);return index},
    cancelFrame:(id)=>queue.delete(id),
    onFrame:(data)=>events.push(data)
  });
  return {driver,events,advance(ms=16){clock+=ms;const runs=[...queue.values()];queue.clear();runs.forEach(cb=>cb(clock));}, get pending(){return queue.size}};
}
test('first sample applies visual frame and stage immediately',()=>{
  const s=simulation();s.driver.update({height:800,top:0});
  assert.equal(s.events.at(-1).frameHeight,800);assert.equal(s.events.at(-1).stageHeight,800);assert.equal(s.pending,0);
});
test('viewport shrinks safely while JS stage height interpolates instead of snapping',()=>{
  const s=simulation();s.driver.update({height:800,top:0});
  s.driver.update({height:500,top:0});
  const now=s.events.at(-1);
  assert.equal(now.frameHeight,500,'visible frame must not extend behind keyboard');
  assert.equal(now.stageHeight,800,'interior starts at current display height');
  s.advance(30);
  assert.ok(s.events.at(-1).stageHeight<800);
  assert.ok(s.events.at(-1).stageHeight>500);
  assert.ok(s.events.at(-1).frameHeight<=500);
  s.advance(160);assert.equal(s.events.at(-1).stageHeight,500);
});
test('growing viewport animates outer frame and stage with JS',()=>{
  const s=simulation();s.driver.update({height:480,top:8});
  s.driver.update({height:760,top:0});
  assert.equal(s.events.at(-1).frameHeight,480);
  s.advance(40);const data=s.events.at(-1);
  assert.ok(data.frameHeight>480 && data.frameHeight<760);
  assert.ok(data.stageHeight>480 && data.stageHeight<760);
  s.advance(160);assert.equal(s.events.at(-1).frameHeight,760);assert.equal(s.events.at(-1).stageHeight,760);
});
test('new measurement retargets from displayed values and never exceeds safe region',()=>{
  const s=simulation();s.driver.update({height:800,top:0});
  s.driver.update({height:450,top:10});s.advance(40);
  const prior=s.events.at(-1).stageHeight;
  s.driver.update({height:520,top:0});
  assert.ok(Math.abs(s.events.at(-1).stageHeight-prior)<1);
  s.advance(20);assert.ok(s.events.at(-1).frameTop>=0);
  assert.ok(s.events.at(-1).frameTop+s.events.at(-1).frameHeight<=520+1);
});
test('orientation cancels animation and destroy leaves no pending callbacks',()=>{
  const s=simulation();s.driver.update({height:800,top:0});s.driver.update({height:500,top:0});
  assert.ok(s.pending>0);s.driver.update({height:400,top:0,orientation:true});
  assert.equal(s.events.at(-1).stageHeight,400);assert.equal(s.pending,0);
  s.driver.update({height:480,top:0});s.driver.destroy();assert.equal(s.pending,0);
});
