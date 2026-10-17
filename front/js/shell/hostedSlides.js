const BLOCKED = 'input,textarea,select,button,a,[contenteditable=""],[contenteditable="true"],[data-swipe-block]';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Normalise page declarations; absent flags never acquire global gestures. */
export function normalizePresentation({ layout='immersive', pill={}, slides=[], stationary=[] }={}) {
  if (!['immersive','stacked'].includes(layout)) throw new TypeError('Unknown hosted layout');
  if (!Array.isArray(slides) || !Array.isArray(stationary)) throw new TypeError('Slide and stationary lists must be arrays');
  const ids=new Set();
  const validated=slides.map(slide=>{
    if(!slide?.id || typeof slide.id!=='string' || !slide.element || ids.has(slide.id)) throw new TypeError('Invalid or repeated slide id/element');
    ids.add(slide.id);
    return { id:slide.id,label:slide.label||slide.id, element:slide.element, allowContentSwipe:slide.allowContentSwipe===true };
  });
  const stationaryIds=new Set();
  const fixed=stationary.map(item=>{
    if(!item?.id || !item.element || stationaryIds.has(item.id) || !['top','bottom','overlay'].includes(item.slot??'bottom')) throw new TypeError('Invalid stationary declaration');
    stationaryIds.add(item.id);
    return {id:item.id,element:item.element,slot:item.slot??'bottom',reserveSpace:item.reserveSpace===true};
  });
  const requested=pill?.requested===true || (pill?.requested===undefined && pill?.visible===true);
  return {layout,pill:{visible:requested && validated.length>=2,requested},slides:validated,stationary:fixed};
}

/** One active Hosted Page at a time; overlays may outlive swipe transitions, not page lifetime. */
export function createHostedSlides({ pillHost, stationaryHost, input, onLayout=()=>{}, isBlocked=()=>false }) {
  let active=null;
  let destroyed=false;
  function cancel(reason='external') {active?.cancel(reason);}
  function deactivate() {if(active){const old=active;active=null;old.destroy();}}

  function activateForPage({root,slides=[],pill={},showPill,stationary=[],layout='immersive',signal}={}) {
    if(destroyed) throw new Error('Hosted slides is destroyed');
    if(!root) throw new TypeError('Hosted root is required');
    deactivate();
    let config=normalizePresentation({layout,pill:showPill===undefined?pill:{visible:showPill},slides,stationary});
    let current=0;
    let progress=0;
    let frame=null;
    let interaction=null;
    let closed=false;
    let animationId=0;
    let suppressedClick=false;
    const lifetime=new AbortController();
    const abort=()=>deactivate();
    const viewport=document.createElement('div');
    viewport.className='hosted-viewport';
    const track=document.createElement('div');
    track.className='hosted-track';
    viewport.append(track);
    root.replaceChildren(viewport);
    root.classList.add('hosted-root');
    const pillNode=document.createElement('div');
    pillNode.className='hosted-pill';
    pillNode.setAttribute('role','tablist');
    pillNode.setAttribute('aria-label','내부 화면');
    const thumb=document.createElement('span');
    thumb.className='hosted-pill-thumb';
    thumb.setAttribute('aria-hidden','true');
    pillNode.append(thumb);
    pillHost.replaceChildren(pillNode);
    const stationaryLayers=new Map();

    function width() {return Math.max(1,viewport.getBoundingClientRect().width||viewport.clientWidth||1);}
    function paint() {
      if(closed) return;
      const n=config.slides.length;
      viewport.style.setProperty('--hosted-progress',String(progress));
      track.style.transform=`translate3d(${-progress*width()}px,0,0)`;
      pillNode.style.setProperty('--pill-progress',String(progress));
      pillNode.style.setProperty('--pill-count',String(Math.max(1,n)));
      pillNode.hidden=!config.pill.visible;
      pillHost.hidden=!config.pill.visible;
      for(let i=0;i<n;i++) {
        const slide=config.slides[i];
        slide.element.style.opacity=String(1-.08*clamp(Math.abs(i-progress),0,1));
        slide.element.inert=i!==current;
        slide.element.setAttribute('aria-hidden',String(i!==current));
      }
      [...pillNode.querySelectorAll('button')].forEach((btn,i)=>{
        const selected=i===current;
        btn.setAttribute('aria-selected',String(selected));
        btn.tabIndex=selected?0:-1;
      });
      root.dataset.activeSlide=config.slides[current]?.id||'';
    }
    function stop() {
      animationId++;
      if(frame!==null) {cancelAnimationFrame(frame);frame=null;}
      viewport.classList.remove('is-dragging');
      pillNode.classList.remove('is-dragging');
    }
    function goTo(id,{immediate=false}={}) {
      if(closed) return;
      const index=config.slides.findIndex(s=>s.id===id);
      if(index<0) throw new Error(`Unknown slide: ${id}`);
      stop();
      current=index;
      const initial=progress;
      if(immediate || matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(initial-index)<.001) {
        progress=index;paint();return;
      }
      const token=animationId;
      const start=performance.now();
      const duration=280+55*Math.abs(index-initial);
      viewport.classList.add('is-dragging');
      pillNode.classList.add('is-dragging');
      const tick=now=>{
        if(closed || token!==animationId) return;
        const t=clamp((now-start)/duration,0,1);
        progress=initial+(index-initial)*(1-Math.pow(1-t,4));
        paint();
        if(t<1) frame=requestAnimationFrame(tick);
        else {frame=null;progress=index;viewport.classList.remove('is-dragging');pillNode.classList.remove('is-dragging');paint();}
      };
      frame=requestAnimationFrame(tick);
    }
    function createPillButtons() {
      pillNode.replaceChildren(thumb);
      for(const [i,slide] of config.slides.entries()) {
        const button=document.createElement('button');
        button.type='button';
        button.role='tab';
        button.textContent=slide.label;
        button.dataset.slide=slide.id;
        button.addEventListener('click',()=>{
          if(suppressedClick){suppressedClick=false;return;}
          goTo(slide.id);
        },{signal:lifetime.signal});
        button.addEventListener('keydown',event=>{
          let target=i;
          if(event.key==='ArrowRight')target=Math.min(config.slides.length-1,i+1);
          else if(event.key==='ArrowLeft')target=Math.max(0,i-1);
          else if(event.key==='Home')target=0;
          else if(event.key==='End')target=config.slides.length-1;
          else return;
          event.preventDefault();
          goTo(config.slides[target].id);
          pillNode.querySelectorAll('button')[target]?.focus();
        },{signal:lifetime.signal});
        pillNode.append(button);
      }
    }
    function rebuildSlides() {
      track.replaceChildren();
      config.slides.forEach((item,i)=>{
        item.element.classList.add('hosted-slide');
        item.element.style.setProperty('--slide-index',String(i));
        track.append(item.element);
      });
      createPillButtons();
      paint();
    }
    function rebuildStationary() {
      const nextIds=new Set(config.stationary.map(item=>item.id));
      for(const [id,layer] of stationaryLayers)if(!nextIds.has(id)){layer.remove();stationaryLayers.delete(id);}
      for(const item of config.stationary){
        let layer=stationaryLayers.get(item.id);
        if(!layer){layer=document.createElement('div');layer.className='stationary-slot';stationaryLayers.set(item.id,layer);}
        layer.dataset.slot=item.slot;
        layer.dataset.reserve=String(item.reserveSpace);
        if(layer.firstElementChild!==item.element)layer.replaceChildren(item.element);
        stationaryHost.append(layer);
      }
      // Reserve-space values are owned by the slot host, never by the Composer.
      if(typeof ResizeObserver!=='undefined') requestAnimationFrame(syncStationaryHeight);
      else syncStationaryHeight();
    }
    function syncStationaryHeight(){
      if(closed)return;
      for(const side of ['top','bottom']){
        let total=0;
        for(const layer of stationaryLayers.values()) if(layer.dataset.slot===side&&layer.dataset.reserve==='true') total+=layer.getBoundingClientRect().height;
        root.style.setProperty(`--stationary-reserve-${side}`,`${total}px`);
      }
    }
    const resizeObserver=typeof ResizeObserver!=='undefined' ? new ResizeObserver(()=>{syncStationaryHeight();paint();}) : null;
    function watchSlots(){if(!resizeObserver)return;resizeObserver.disconnect();resizeObserver.observe(viewport);for(const layer of stationaryLayers.values())resizeObserver.observe(layer);}
    function blockedTarget(target) {
      if(!(target instanceof Element) || target.closest(BLOCKED)) return true;
      for(let node=target;node && node!==viewport;node=node.parentElement){
        if(!(node instanceof HTMLElement)) continue;
        const style=getComputedStyle(node);
        if(node.scrollWidth>node.clientWidth+2 && /auto|scroll/.test(style.overflowX))return true;
      }
      return false;
    }
    const owner=()=>config.slides[current];
    const bodyOwner=input.registerOwner({
      element:viewport,signal:lifetime.signal,
      onStart(event){
        if(isBlocked()||!owner()?.allowContentSwipe || event.pointerType==='mouse' || blockedTarget(event.target))return false;
        stop();
        interaction={kind:'body',id:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastTime:performance.now(),speed:0,base:progress,drag:false,denied:false};
        return true;
      },
      onMove(event){ updateSwipe(event); },
      onEnd(){ finishSwipe(); },
      onCancel(){ cancelSwipe(); }
    });
    const pillOwner=input.registerOwner({
      element:pillNode,signal:lifetime.signal,
      onStart(event){
        if(!config.pill.visible||isBlocked()|| (event.button!==0 && event.pointerType==='mouse'))return false;
        stop();
        interaction={kind:'pill',id:event.pointerId,startX:event.clientX,startY:event.clientY,lastX:event.clientX,lastTime:performance.now(),speed:0,base:progress,drag:false,denied:false};
        return true;
      },
      onMove(event){updateSwipe(event);},
      onEnd(){finishSwipe();},
      onCancel(){cancelSwipe();}
    });
    function updateSwipe(event){
      const gesture=interaction;
      if(!gesture || gesture.id!==event.pointerId)return;
      const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
      if(!gesture.drag){
        if(Math.abs(dx)<(gesture.kind==='pill'?5:8) && Math.abs(dy)<8)return;
        if(gesture.kind==='body' && (Math.abs(dy)>=Math.abs(dx)||Math.abs(dx)<8)) {gesture.denied=true;return;}
        if(gesture.denied)return;
        gesture.drag=true;
        viewport.classList.add('is-dragging');pillNode.classList.add('is-dragging');
      }
      if(event.cancelable)event.preventDefault();
      const now=performance.now();
      const vx=(event.clientX-gesture.lastX)/Math.max(1,now-gesture.lastTime);
      gesture.speed=gesture.speed*.72+vx*.28;
      gesture.lastX=event.clientX;gesture.lastTime=now;
      progress=clamp(gesture.base+(gesture.kind==='pill'?dx/Math.max(1,pillNode.getBoundingClientRect().width/Math.max(1,config.slides.length)): -dx/width()),0,config.slides.length-1);
      paint();
    }
    function finishSwipe(){
      const gesture=interaction;
      interaction=null;
      if(!gesture)return;
      if(!gesture.drag){stop();progress=current;paint();return;}
      const distance=progress-gesture.base;
      let target=Math.round(progress);
      if(Math.abs(gesture.speed)>.34){
        const dir=gesture.kind==='pill'?Math.sign(gesture.speed):-Math.sign(gesture.speed);
        target=clamp(Math.round(gesture.base)+dir,0,config.slides.length-1);
      }else if(gesture.kind==='body' && Math.abs(distance)<.42)target=current;
      if(gesture.kind==='pill'){
        suppressedClick=true;
        // A pointer click dispatched after pointerup is suppressed only once.
        requestAnimationFrame(()=>{requestAnimationFrame(()=>{suppressedClick=false;});});
      }
      goTo(config.slides[target].id);
    }
    function cancelSwipe(){if(!interaction)return;interaction=null;goTo(config.slides[current].id);}
    const publicHandle={
      goTo,
      getCurrentSlide:()=>config.slides[current]?.id??null,
      update(patch={}){
        if(closed)return;
        const next=normalizePresentation({
          layout:patch.layout??config.layout,pill:patch.pill??config.pill,
          slides:patch.slides??config.slides,stationary:patch.stationary??config.stationary
        });
        const selected=config.slides[current]?.id;
        const previousIndex=current;
        stop();interaction=null;
        const structureChanged=patch.slides!==undefined;
        const stationaryChanged=patch.stationary!==undefined;
        config=next;
        const nextSelected=config.slides.findIndex(s=>s.id===selected);
        current=nextSelected>=0?nextSelected:Math.max(0,Math.min(previousIndex,config.slides.length-1));
        if(structureChanged){
          // Preserve surviving DOM elements and avoid any reparenting for flag/label-only changes.
          rebuildSlides();
        }else if(patch.pill!==undefined)createPillButtons();
        if(stationaryChanged)rebuildStationary();
        progress=current;
        onLayout(config.layout);
        if(structureChanged || stationaryChanged || previousIndex!==current)watchSlots();
        paint();
      },
      cancel(reason){
        if(interaction){interaction=null;input.cancel(reason);}
        if(frame!==null)goTo(config.slides[current]?.id,{immediate:true});
      },
      destroy(){
        if(closed)return;
        closed=true;stop();lifetime.abort();
        bodyOwner.unregister();pillOwner.unregister();
        resizeObserver?.disconnect();
        pillHost.replaceChildren();pillHost.hidden=true;
        stationaryHost.replaceChildren();
        root.style.removeProperty('--stationary-reserve-top');root.style.removeProperty('--stationary-reserve-bottom');
        root.classList.remove('hosted-root');
        if(signal)signal.removeEventListener('abort',abort);
        if(active===publicHandle)active=null;
      }
    };
    active=publicHandle;
    onLayout(config.layout);
    rebuildSlides();
    rebuildStationary();
    watchSlots();
    if(signal){signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();}
    return publicHandle;
  }
  return {activateForPage,cancel,destroy(){if(destroyed)return;destroyed=true;deactivate();}};
}
