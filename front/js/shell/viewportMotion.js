/** UI interpolation policy: browser-visible bounds themselves are never delayed. */
export function decideViewportMotion({ previousHeight, height, elapsed, orientation = false }) {
  if (orientation) return 'immediate';
  const change = height - previousHeight;
  if (!Number.isFinite(change) || Math.abs(change) < 1.25) return 'stable';
  if (elapsed < 95) return 'tracking';
  return change < 0 ? 'shrinking' : 'growing';
}


/**
 * One JS clock interpolates the physical viewport frame and the interior stage.
 * The frame is always intersected with the *latest* visible rectangle; on
 * shrink this safety clamp wins over appearance, on expansion it eases in.
 */
export function createViewportMotion({onFrame,now=()=>performance.now(),requestFrame=cb=>requestAnimationFrame(cb),cancelFrame=id=>cancelAnimationFrame(id),reducedMotion=()=>false}) {
  let measured=null, drawn=null, from=null, goal=null, started=0, duration=0, raf=null, disposed=false, updatedAt=-Infinity;
  const ease=x=>1-(1-x)**4;
  function emit(top,height,stageHeight,mode) {
    const lower=top+height;
    const safeTop=Math.max(top,measured.top);
    const safeBottom=Math.min(lower,measured.top+measured.height);
    const data={frameTop:safeTop,frameHeight:Math.max(1,safeBottom-safeTop),stageHeight,mode};
    drawn={top,height,stageHeight};
    onFrame(data);
  }
  function advance(time) {
    if(disposed||!from||!goal)return;
    const portion=duration===0?1:Math.min(1,Math.max(0,(time-started)/duration));
    const amount=ease(portion);
    const lerp=(a,b)=>a+(b-a)*amount;
    emit(lerp(from.top,goal.top),lerp(from.height,goal.height),lerp(from.stageHeight,goal.stageHeight),goal.mode);
    if(portion>=1){from=null;goal=null;raf=null;return;}
    raf=requestFrame(advance);
  }
  function update({top=0,height,orientation=false}={}){
    if(disposed || !Number.isFinite(top) || !Number.isFinite(height) || height<=0)return;
    const next={top,height};const prev=measured;
    if(prev && Math.abs(prev.top-top)<.5 && Math.abs(prev.height-height)<1.25 && !orientation)return;
    const moment=now();
    const mode=!prev||orientation||reducedMotion()?'immediate':decideViewportMotion({previousHeight:prev.height,height,elapsed:moment-updatedAt});
    measured=next;updatedAt=moment;
    if(raf!==null){cancelFrame(raf);raf=null;}
    if(!drawn || mode==='immediate') {
      from=null;goal=null;emit(top,height,height,mode);
      return;
    }
    from={...drawn};goal={top,height,stageHeight:height,mode};started=moment;
    duration=mode==='tracking'?65:mode==='shrinking'?120:mode==='growing'?140:75;
    // Apply safety bounds before the next animation frame to avoid a flash under keyboard.
    emit(from.top,from.height,from.stageHeight,mode);
    raf=requestFrame(advance);
  }
  return {update,destroy(){disposed=true;if(raf!==null)cancelFrame(raf);raf=null;from=null;goal=null;}};
}
