/** Canvas coordinates are CSS pixels before the camera transform. */
export const MIN_ZOOM = .12;
export const MAX_ZOOM = 3;
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
export function normalizeViewport(value={}) {
  return {x:finite(value.x,0),y:finite(value.y,0),zoom:clamp(finite(value.zoom,1),MIN_ZOOM,MAX_ZOOM)};
}
export function screenToWorld(point,camera) {
  return {x:(point.x-camera.x)/camera.zoom,y:(point.y-camera.y)/camera.zoom};
}
export function worldToScreen(point,camera) {
  return {x:point.x*camera.zoom+camera.x,y:point.y*camera.zoom+camera.y};
}
export function zoomAt(camera,point,zoom) {
  const anchor=screenToWorld(point,camera), next=normalizeViewport({...camera,zoom});
  return {...next,x:point.x-anchor.x*next.zoom,y:point.y-anchor.y*next.zoom};
}
const midpoint=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function pinchViewport(camera,initial,current) {
  const anchor=screenToWorld(midpoint(...initial),camera), center=midpoint(...current);
  const zoom=clamp(camera.zoom*distance(...current)/Math.max(1,distance(...initial)),MIN_ZOOM,MAX_ZOOM);
  return {x:center.x-anchor.x*zoom,y:center.y-anchor.y*zoom,zoom};
}
export function fitViewport(bounds,size,{padding=40,top=0,bottom=0}={}) {
  const width=Math.max(1,size.width-padding*2),height=Math.max(1,size.height-top-bottom-padding*2);
  const zoom=clamp(Math.min(width/Math.max(1,bounds.width),height/Math.max(1,bounds.height),1),MIN_ZOOM,MAX_ZOOM);
  return {x:size.width/2-(bounds.x+bounds.width/2)*zoom,y:top+padding+height/2-(bounds.y+bounds.height/2)*zoom,zoom};
}
export function connectionPath(a,b) {
  const bend=clamp(Math.abs(b.x-a.x)*.22+Math.abs(b.y-a.y)*.05,28,85);
  return `M ${a.x} ${a.y} C ${a.x+bend} ${a.y}, ${b.x-bend} ${b.y}, ${b.x} ${b.y}`;
}

/** Owns pointer geometry only; callers own graph changes and capture lifetimes. */
export function createGestureTracker() {
  const pointers=new Map();
  let base=null, mode=null, origin=null, pinch=null, moved=false, last=null;
  function begin(point,camera,nextMode={kind:'pan'}) {
    if(pointers.has(point.id)||pointers.size>=2) return null;
    pointers.set(point.id,{...point});
    if(pointers.size===1) {
      base={...camera};mode={...nextMode};origin={...point};moved=false;
      last={...mode,point:{...point},moved:false,delta:{x:0,y:0}};
    } else {
      base={...camera};mode={kind:'pinch'};pinch=[...pointers.values()].map(p=>({...p}));moved=true;
      last={kind:'pinch',moved:true,viewport:{...camera}};
    }
    return {...last};
  }
  function move(point) {
    if(!pointers.has(point.id)) return null;
    pointers.set(point.id,{...point});
    if(mode.kind==='pinch') {
      last={kind:'pinch',moved:true,viewport:pinchViewport(base,pinch,[...pointers.values()])};
    } else {
      const delta={x:(point.x-origin.x)/base.zoom,y:(point.y-origin.y)/base.zoom};
      moved ||= distance(point,origin)>=4;
      last={...mode,point:{...point},delta,moved};
      if(mode.kind==='pan')last.viewport={...base,x:base.x+point.x-origin.x,y:base.y+point.y-origin.y};
    }
    return {...last};
  }
  function end(id,camera) {
    if(!pointers.has(id))return null;
    const result={...last};pointers.delete(id);
    if(pointers.size) {
      origin={...[...pointers.values()][0]};base={...camera};mode={kind:'pan'};pinch=null;moved=false;
      last={kind:'pan',point:{...origin},delta:{x:0,y:0},moved:false};
    }else {base=mode=origin=pinch=last=null;moved=false;}
    return result;
  }
  return {begin,move,end,cancel(){pointers.clear();base=mode=origin=pinch=last=null;moved=false},get size(){return pointers.size}};
}

/** Find a nearby slot using actual occupied sizes, including expanded blocks. */
export function findOpenPosition(center,size,occupied,{gap=28}={}) {
  const origin={x:center.x-size.width/2,y:center.y-size.height/2};
  const available=point=>occupied.every(box=>point.x+size.width+gap<=box.x||point.x>=box.x+box.width+gap||point.y+size.height+gap<=box.y||point.y>=box.y+box.height+gap);
  if(available(origin))return origin;
  const stepX=size.width+gap,stepY=size.height+gap;
  for(let ring=1;ring<=occupied.length+1;ring++){
    const candidates=[[0,ring],[0,-ring],[-ring,0],[ring,0]];
    for(let i=1;i<=ring;i++)candidates.push([i,ring],[-i,ring],[i,-ring],[-i,-ring],[-ring,i],[-ring,-i],[ring,i],[ring,-i]);
    for(const [dx,dy]of candidates){const point={x:origin.x+dx*stepX,y:origin.y+dy*stepY};if(available(point))return point}
  }
  return {x:Math.max(origin.x,...occupied.map(box=>box.x+box.width+gap)),y:origin.y};
}
