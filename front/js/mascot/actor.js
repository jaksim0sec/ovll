/** Reusable Ovll character. Parent DOM determines its coordinate space. */
const FEATURES=Object.freeze({mouseReaction:false,movement:false,nodeInteraction:false,drag:false});
let serial=0;
function point(value){
  if(!Number.isFinite(value?.x)||!Number.isFinite(value?.y))throw new TypeError('Mascot coordinates must be finite');
  return {x:value.x,y:value.y};
}
export function createMascot({host,scene=null,id,position={x:0,y:0},size=34,color='#202120',capabilities={}}={}){
  if(!host?.element?.append||!host?.pointerElement?.addEventListener||typeof host.clientToLocal!=='function')
    throw new TypeError('Mascot host requires element, pointerElement and clientToLocal');
  if(!Number.isFinite(size)||size<20||size>96)throw new RangeError('Mascot size must be 20..96');
  let features={...FEATURES,...capabilities};
  for(const [key,value] of Object.entries(capabilities))
    if(!(key in FEATURES)||typeof value!=='boolean')throw new TypeError('Invalid mascot capability: '+key);
  function checkScene(next){
    if(next.nodeInteraction&&(!scene||typeof scene.subscribeSelection!=='function'||
      typeof scene.getTargetBounds!=='function'||typeof scene.getSelection!=='function'))
      throw new TypeError('Node interaction requires an explicit scene adapter');
  }
  checkScene(features);
  const identity=String(id??('ovll-'+(++serial))),root=document.createElement('div');
  root.className='ovll-actor';root.dataset.actorId=identity;
  root.style.setProperty('--ovll-actor-size',size+'px');
  root.style.setProperty('--ovll-body-color',color);
  const body=document.createElement('button');body.type='button';body.className='ovll-actor-body';
  body.setAttribute('aria-label','오블 마스코트 '+identity);
  body.innerHTML='<span class="ovll-actor-eyes" aria-hidden="true"><i></i><i></i></span>';
  root.append(body);host.element.append(root);
  let location=point(position),goal=null,focusId=null,frame=0,previous=0,phase=0;
  let active=false,destroyed=false,life=null,unsubscribe=null,drag=null,pressMoved=false,pulseTimer=0,mouseUntil=0;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ensureAlive=()=>{if(destroyed)throw new Error('Mascot has been destroyed')};
  function paint(){root.style.transform='translate3d('+location.x+'px,'+location.y+'px,0)'}
  function lookAt(target){
    const dx=target.x-location.x-size/2,dy=target.y-location.y-size/2;
    const theta=Math.atan2(dy,dx),amount=Math.min(1,Math.hypot(dx,dy)/90);
    body.style.setProperty('--ovll-eye-x',(Math.cos(theta)*amount*2.6).toFixed(2)+'px');
    body.style.setProperty('--ovll-eye-y',(Math.sin(theta)*amount*2.6).toFixed(2)+'px');
    body.style.setProperty('--ovll-lean',(Math.cos(theta)*3.5).toFixed(2)+'deg');
  }
  function relax(){
    body.style.setProperty('--ovll-eye-x','0px');body.style.setProperty('--ovll-eye-y','0px');
    body.style.setProperty('--ovll-lean','0deg');
  }
  function stopFrame(){if(frame)cancelAnimationFrame(frame);frame=0;previous=0}
  function schedule(){if(active&&!destroyed&&!document.hidden&&!frame)frame=requestAnimationFrame(tick)}
  function tick(now){
    frame=0;if(!active||destroyed||document.hidden)return;
    const dt=Math.min(50,Math.max(1,now-(previous||now-16)));previous=now;
    if(focusId&&features.nodeInteraction){
      const bounds=scene.getTargetBounds(focusId);
      if(!bounds){focusId=null;goal=null;relax()}
      else{
        if(features.movement){
          phase+=reduced()?0:dt*.00065;
          goal={x:bounds.x+bounds.width+18+Math.cos(phase)*12,
                y:bounds.y-size*.35+Math.sin(phase)*14};
        }
        if(!features.mouseReaction||now>mouseUntil)
          lookAt({x:bounds.x+bounds.width/2,y:bounds.y+bounds.height/2});
      }
    }
    if(goal&&features.movement){
      const dx=goal.x-location.x,dy=goal.y-location.y;
      const ratio=reduced()?1:1-Math.exp(-dt/190);
      location={x:location.x+dx*ratio,y:location.y+dy*ratio};paint();
      if(!focusId&&Math.hypot(dx,dy)<.4){location=goal;goal=null;paint()}
    }
    if((focusId&&features.nodeInteraction)||goal)schedule();
  }
  function select(id){
    if(!features.nodeInteraction)return;
    focusId=id==null?null:String(id);goal=null;phase=0;
    if(!focusId)relax();else schedule();
  }
  function subscribe(){
    unsubscribe?.();unsubscribe=null;
    if(active&&features.nodeInteraction){
      unsubscribe=scene.subscribeSelection(select);select(scene.getSelection());
    }
  }
  function moveTo(target){
    ensureAlive();if(!features.movement)return false;
    focusId=null;goal=point(target);
    if(reduced()||!active){location=goal;goal=null;paint()}else schedule();
    return true;
  }
  function setPosition(next){
    ensureAlive();location=point(next);goal=null;focusId=null;paint();relax();
  }
  function setCapabilities(next){
    ensureAlive();
    for(const [key,value] of Object.entries(next||{}))
      if(!(key in FEATURES)||typeof value!=='boolean')throw new TypeError('Invalid mascot capability: '+key);
    const updated={...features,...next};checkScene(updated);features=updated;
    if(!features.movement){goal=null;stopFrame()}
    if(!features.nodeInteraction){focusId=null;relax()}
    if(!features.mouseReaction&&!features.nodeInteraction)relax();
    subscribe();if(focusId||goal)schedule();
    return {...features};
  }
  function onPointerMove(event){
    if(!features.mouseReaction||drag||event.pointerType==='touch')return;
    const p=host.clientToLocal(event);
    if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
    mouseUntil=performance.now()+850;lookAt(p);
  }
  function onPointerLeave(){mouseUntil=0;if(!focusId)relax()}
  function onDown(event){
    if(!features.drag||!active||event.button!==0)return;
    const at=host.clientToLocal(event);if(!at)return;
    drag={id:event.pointerId,start:at,origin:{...location}};pressMoved=false;
    goal=null;focusId=null;stopFrame();
    event.preventDefault();event.stopPropagation();body.setPointerCapture?.(event.pointerId);
  }
  function onDrag(event){
    if(!drag||drag.id!==event.pointerId)return;
    const p=host.clientToLocal(event);if(!p)return;
    if(Math.hypot(p.x-drag.start.x,p.y-drag.start.y)>3)pressMoved=true;
    location={x:drag.origin.x+p.x-drag.start.x,y:drag.origin.y+p.y-drag.start.y};
    paint();event.preventDefault();event.stopPropagation();
  }
  function onUp(event){
    if(drag?.id!==event.pointerId)return;
    drag=null;event.stopPropagation();
    if(body.hasPointerCapture?.(event.pointerId))body.releasePointerCapture(event.pointerId);
  }
  function onClick(event){
    event.stopPropagation();
    if(pressMoved){pressMoved=false;return}
    body.classList.remove('is-poked');void body.offsetWidth;body.classList.add('is-poked');
    clearTimeout(pulseTimer);pulseTimer=setTimeout(()=>body.classList.remove('is-poked'),380);
    if(features.nodeInteraction&&focusId&&typeof scene.focusTarget==='function')scene.focusTarget(focusId);
  }
  function activate(){
    ensureAlive();if(active)return;
    active=true;life=new AbortController();const signal=life.signal;
    host.pointerElement.addEventListener('pointermove',onPointerMove,{signal,passive:true});
    host.pointerElement.addEventListener('pointerleave',onPointerLeave,{signal,passive:true});
    body.addEventListener('pointerdown',onDown,{signal});
    body.addEventListener('pointermove',onDrag,{signal});
    body.addEventListener('pointerup',onUp,{signal});
    body.addEventListener('pointercancel',onUp,{signal});
    body.addEventListener('lostpointercapture',onUp,{signal});
    body.addEventListener('click',onClick,{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFrame();else if(goal||focusId)schedule()},{signal});
    subscribe();if(goal||focusId)schedule();
  }
  function deactivate(){
    if(!active)return;active=false;drag=null;stopFrame();
    unsubscribe?.();unsubscribe=null;life?.abort();life=null;relax();
  }
  function destroy(){
    if(destroyed)return;deactivate();destroyed=true;clearTimeout(pulseTimer);root.remove();
  }
  paint();
  return Object.freeze({element:root,activate,deactivate,destroy,moveTo,setPosition,setCapabilities,
    getPosition:()=>({...location}),getCapabilities:()=>({...features}),getFocusedTarget:()=>focusId});
}
