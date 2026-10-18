import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputManager} from '../../front/js/input/inputManager.js';
function harness(){
 const target=new EventTarget();target.document=new EventTarget();const input=createInputManager({target});
 const a={},b={};
 const fire=(type,id,element)=>{const event=new Event(type);Object.defineProperties(event,{pointerId:{value:id},composedPath:{value:()=>[element]},target:{value:element}});target.dispatchEvent(event);};
 return {target,input,a,b,fire};
}
test('an opted-in owner receives two pointers, other owners cannot steal either',()=>{
 const {input,a,b,fire}=harness(),events=[];
 input.registerOwner({element:a,multiPointer:true,onStart:e=>{events.push(['start',e.pointerId]);return true;},onMove:e=>events.push(['move',e.pointerId]),onEnd:e=>events.push(['end',e.pointerId]),onCancel:()=>events.push(['cancel'])});
 input.registerOwner({element:b,onStart:()=>{events.push(['stolen']);return true;}});
 fire('pointerdown',1,a);fire('pointerdown',2,a);fire('pointerdown',3,b);fire('pointerup',1,a);fire('pointermove',2,a);fire('pointerup',2,a);
 assert.deepEqual(events,[['start',1],['start',2],['end',1],['move',2],['end',2]]);input.destroy();
});
test('default owner stays single pointer, cancel or lifetime abort releases the whole group once',()=>{
 const {input,a,b,fire}=harness();let starts=0,cancels=0;
 input.registerOwner({element:a,onStart:()=>{starts++;return true;}});fire('pointerdown',1,a);fire('pointerdown',2,a);assert.equal(starts,1);input.cancel();
 const life=new AbortController();input.registerOwner({element:b,signal:life.signal,multiPointer:true,onStart:()=>true,onCancel:()=>cancels++});
 fire('pointerdown',3,b);fire('pointerdown',4,b);life.abort();fire('pointercancel',4,b);assert.equal(cancels,1);input.destroy();
});
