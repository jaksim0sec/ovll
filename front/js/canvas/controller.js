import { readLocalFile, createFileResources } from './files.js';
import { skills, getSkill } from '../skill/catalog.js';
import { icon } from '../workspace/icons.js';
import { normalizeViewport, screenToWorld, zoomAt, fitViewport, connectionPath, createGestureTracker, findOpenPosition } from './geometry.js';

const SVG='http://www.w3.org/2000/svg';
const editable='input,textarea,select,[contenteditable="true"],.canvas-file-preview';
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node};
const glyph=name=>{const node=el('span','canvas-icon');node.innerHTML=icon(name);node.setAttribute('aria-hidden','true');return node};
const button=(name,label,className='')=>{const node=el('button',`canvas-button ${className}`);node.type='button';node.setAttribute('aria-label',label);node.title=label;node.append(glyph(name));return node};
const svgPath=(className,d)=>{const path=document.createElementNS(SVG,'path');path.setAttribute('class',className);path.setAttribute('d',d);path.setAttribute('vector-effect','non-scaling-stroke');return path};

/** Local editable canvas. The workspace model is the only graph owner. */
export function createCanvas({model,input,onRun,onNotice,onAttach,resolveSkill=getSkill,listSkills=()=>skills}={}) {
  if(!model||!input)throw new TypeError('Canvas needs a workspace model and Input Manager');
  const element=el('section','workspace-canvas');element.setAttribute('aria-label','작업 캔버스');
  const surface=el('div','canvas-surface');surface.tabIndex=0;surface.setAttribute('aria-label','스킬블럭 캔버스. 빈 공간을 끌어 이동하고 휠로 확대합니다.');
  const world=el('div','canvas-world'), nodes=el('div','canvas-blocks');
  const connections=document.createElementNS(SVG,'svg');connections.classList.add('canvas-connections');connections.setAttribute('aria-label','스킬블럭 연결');
  world.append(connections,nodes);surface.append(world);element.append(surface);
  const hint=el('p','canvas-hint','스킬블럭을 추가하고 포트를 연결해 작업을 구성하세요.');element.append(hint);
  const tools=el('div','canvas-tools');tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','캔버스 도구');
  const primary=el('div','canvas-primary-tools'), view=el('div','canvas-view-tools');
  const add=button('plus','스킬블럭 추가','canvas-tool-pill');add.append(el('span','canvas-tool-label','스킬블럭'));
  add.setAttribute('aria-expanded','false');
  const reset=button('reset','캔버스 초기화','canvas-tool-pill');const resetText=el('span','canvas-tool-label','초기화');reset.append(resetText);
  const arrange=button('layout','스킬블럭 정리하기','canvas-tool-pill');arrange.append(el('span','canvas-tool-label','정리하기'));
  const undo=button('undo','실행 취소'),redo=button('redo','다시 실행'),out=button('zoomOut','축소'),zoom=button('fit','전체 보기','canvas-zoom-label'),inside=button('zoomIn','확대');
  zoom.replaceChildren(el('span','','100%'));
  primary.append(add,reset,arrange);view.append(undo,redo,out,zoom,inside);tools.append(primary,view);element.append(tools);
  const palette=el('div','canvas-palette');palette.hidden=true;palette.setAttribute('role','dialog');palette.setAttribute('aria-label','스킬블럭 추가');
  palette.append(el('div','canvas-palette-heading','스킬블럭 추가'));
  const paletteList=el('div','canvas-palette-list');palette.append(paletteList);primary.append(palette);
  const linkDelete=button('trash','선택한 연결 삭제','canvas-link-delete');linkDelete.append(el('span','','연결 삭제'));linkDelete.hidden=true;element.append(linkDelete);
  const status=el('span','canvas-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');element.append(status);
  const fileInput=el('input','canvas-file-input');fileInput.type='file';fileInput.hidden=true;element.append(fileInput);

  let camera={x:80,y:140,zoom:1},selected=null,selectedLink=null,pendingPort=null,dragLink=null,preview=null;
  let active=null,owner=null,destroyed=false,resetTimer=null,noticeTimer=null,unsubscribe=null,resize=null;
  const blockViews=new Map(),gestures=createGestureTracker(),pendingFields=new Map();
  const fileResources=createFileResources();
  let fieldTimer=null,lifecycleGeneration=0;
  let fileBlock=null,attachmentGeneration=0,paletteOpen=false,paletteAnimations=[];
  let panSample=null,portStartedAt=0,motionFrame=0,pickupTimer=null,pickupCandidate=null,portTap=null;
  const removalTimers=new Map(),linkViews=new Map(),layoutPositions=new Map();
  const reducedMotion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const samePort=(a,b)=>!!a&&!!b&&a.blockId===b.blockId&&a.portId===b.portId&&a.direction===b.direction;
  function stopMotion(){
    cancelAnimationFrame(motionFrame);motionFrame=0;surface.classList.remove('is-panning');
    if(layoutPositions.size){layoutPositions.clear();render()}
  }
  function coast(sample){
    stopMotion();if(!sample||reducedMotion()||performance.now()-sample.time>100)return;
    let {vx,vy}=sample;const speed=Math.hypot(vx,vy);if(speed<.08)return;
    if(speed>1.6){vx*=1.6/speed;vy*=1.6/speed}
    let previous=performance.now();surface.classList.add('is-panning');
    const tick=now=>{const dt=Math.min(32,Math.max(1,now-previous));previous=now;
      setViewport({...camera,x:camera.x+vx*dt,y:camera.y+vy*dt},{motion:true});
      const damping=Math.pow(.86,dt/16.67);vx*=damping;vy*=damping;
      if(Math.hypot(vx,vy)<.035){stopMotion();return}motionFrame=requestAnimationFrame(tick);
    };motionFrame=requestAnimationFrame(tick);
  }
  function clearPickup(){clearTimeout(pickupTimer);pickupTimer=null;pickupCandidate=null}
  function portAt(point,direction){
    const worldPoint=screenToWorld(point,camera);
    for(const block of model.getBlocks())for(const port of resolveSkill(block.skillId)[direction==='input'?'inputs':'outputs']){
      const endpoint={blockId:block.id,portId:port.id,direction},center=portPoint(endpoint,direction);
      if(center&&Math.abs(center.x-worldPoint.x)<=20&&Math.abs(center.y-worldPoint.y)<=20)return endpoint;
    }return null;
  }
  function collectOutput(point){
    const candidate=portAt(point,'output');
    if(!candidate||dragLink.anchors.some(anchor=>samePort(anchor,candidate))){clearPickup();renderSelection();return}
    if(samePort(candidate,pickupCandidate))return;
    clearPickup();pickupCandidate=candidate;renderSelection();const drag=dragLink;
    pickupTimer=setTimeout(()=>{
      if(dragLink!==drag||!samePort(portAt(drag.point,'output'),candidate))return;
      drag.anchors.push(candidate);clearPickup();renderSelection();renderLinks();
    },200);
  }
  function tapPort(port){
    const now=performance.now();
    if(samePort(portTap?.port,port)&&now-portTap.at<=340){
      portTap=null;pendingPort=null;
      const links=model.getSnapshot().links.filter(link=>{const end=port.direction==='input'?link.to:link.from;return end.blockId===port.blockId&&end.portId===port.portId});
      if(links.length){
        const key=JSON.stringify(port);clearTimeout(removalTimers.get(key));
        links.forEach(link=>linkViews.get(link.id)?.path.classList.add('is-removing'));
        const ids=new Set(links.map(link=>link.id));
        const timer=setTimeout(()=>{removalTimers.delete(key);safe(()=>model.toggleConnections(model.getSnapshot().links.filter(link=>ids.has(link.id)).map(({from,to})=>({from,to}))));},reducedMotion()?0:140);
        removalTimers.set(key,timer);renderSelection();return;
      }
    }else portTap={port,at:now};
    choosePort(port);
  }
  const notice=message=>{const text=String(message?.message||message||'작업을 완료하지 못했습니다.');status.textContent=text;onNotice?.(text);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{status.textContent=''},4500)};
  const safe=action=>{try{return action()}catch(error){notice(error.message);return null}};
  const localPoint=event=>{const bounds=surface.getBoundingClientRect();return {id:event.pointerId,x:event.clientX-bounds.left,y:event.clientY-bounds.top}};
  const bottomSpace=()=>{const value=parseFloat(getComputedStyle(element).getPropertyValue('--workspace-composer-height'));return (Number.isFinite(value)?value:76)+90};
  function setViewport(next,{motion=false}={}) {
    if(!motion)stopMotion();
    camera=normalizeViewport(next);world.style.transform=`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    surface.style.setProperty('--canvas-grid-size',`${24*camera.zoom}px`);surface.style.setProperty('--canvas-grid-x',`${camera.x}px`);surface.style.setProperty('--canvas-grid-y',`${camera.y}px`);
    zoom.firstChild.textContent=`${Math.round(camera.zoom*100)}%`;
    element.dispatchEvent(new CustomEvent('canvasviewportchange',{detail:{...camera}}));
  }
  function queueField(control) {
    const blockId=control.closest('.canvas-block').dataset.blockId;
    pendingFields.set(`${blockId}/${control.dataset.fieldId}`,{blockId,fieldId:control.dataset.fieldId,value:control.value});
    clearTimeout(fieldTimer);fieldTimer=setTimeout(flushFields,250);
  }
  function flushFields() {
    clearTimeout(fieldTimer);fieldTimer=null;const values=new Map();
    for(const entry of pendingFields.values()){if(!model.getBlock(entry.blockId))continue;if(!values.has(entry.blockId))values.set(entry.blockId,{});values.get(entry.blockId)[entry.fieldId]=entry.value}
    pendingFields.clear();for(const [id,fields]of values)safe(()=>model.updateBlock(id,{values:fields}));
  }
  function setPalette(open,{immediate=false}={}){
    if(paletteOpen===open&&!immediate)return;
    const style=palette.hidden?{opacity:'0',transform:'translateY(.5rem) scale(.98)'}:getComputedStyle(palette);
    const from={opacity:style.opacity,transform:style.transform};
    paletteAnimations.forEach(animation=>animation.cancel());paletteAnimations=[];paletteOpen=open;
    palette.hidden=false;palette.inert=!open;palette.setAttribute('aria-hidden',String(!open));add.setAttribute('aria-expanded',String(open));
    const to={opacity:open?'1':'0',transform:open?'translateY(0) scale(1)':'translateY(.5rem) scale(.98)'};
    palette.style.opacity=to.opacity;palette.style.transform=to.transform;
    if(immediate||reducedMotion()){palette.hidden=!open;return}
    const fade=palette.animate([{opacity:from.opacity},{opacity:to.opacity}],{duration:180,easing:'ease'});
    const slide=palette.animate([{transform:from.transform},{transform:to.transform}],{duration:220,easing:'cubic-bezier(.2,.82,.2,1)'});
    paletteAnimations=[fade,slide];slide.onfinish=()=>{if(paletteAnimations.includes(slide)){paletteAnimations=[];palette.hidden=!open}};
  }
  function closePalette(focus=false) {setPalette(false,{immediate:!active});if(focus)add.focus()}
  function stopExpansion(view){view.animation?.cancel();view.fade?.cancel();view.reveal?.cancel();view.animation=view.fade=view.reveal=null}
  function stopEntry(view){if(!view)return;view.entry?.forEach(animation=>animation.cancel());view.entry=null}
  function enterBlock(view){
    if(!view||reducedMotion())return;stopEntry(view);
    const fade=view.element.animate([{opacity:0},{opacity:1}],{duration:240,easing:'ease'});
    const rise=view.element.animate([{transform:'translateY(.28rem) scale(.965)'},{transform:'translateY(0) scale(1)'}],{duration:340,easing:'cubic-bezier(.2,.82,.2,1)'});
    view.entry=[fade,rise];rise.onfinish=()=>{if(view.entry?.includes(rise))view.entry=null};
  }
  function disarmReset() {clearTimeout(resetTimer);resetTimer=null;reset.classList.remove('is-confirming');resetText.textContent='초기화';reset.setAttribute('aria-label','캔버스 초기화')}
  function portInfo(target) {
    const port=target?.closest?.('.canvas-port');if(!port||!element.contains(port))return null;
    return {blockId:port.dataset.blockId,portId:port.dataset.portId,direction:port.dataset.direction};
  }
  function choosePort(port) {
    if(!pendingPort){pendingPort=port;notice('연결할 반대쪽 포트를 선택하세요.');renderSelection();return}
    if(pendingPort.blockId===port.blockId&&pendingPort.portId===port.portId&&pendingPort.direction===port.direction){pendingPort=null;renderSelection();return}
    if(pendingPort.direction===port.direction){pendingPort=port;notice('출력 포트와 입력 포트를 연결해 주세요.');renderSelection();return}
    connectPorts(pendingPort,port);pendingPort=null;renderSelection();renderLinks();
  }
  function connectPorts(a,b) {
    if(a.direction===b.direction){notice('출력 포트와 입력 포트를 연결해 주세요.');return}
    const from=a.direction==='output'?a:b,to=a.direction==='input'?a:b;
    const existing=model.getSnapshot().links.find(link=>link.from.blockId===from.blockId&&link.from.portId===from.portId&&link.to.blockId===to.blockId&&link.to.portId===to.portId);
    clearTimeout(noticeTimer);status.textContent='';
    safe(()=>existing?model.disconnect(existing.id):model.connect({blockId:from.blockId,portId:from.portId},{blockId:to.blockId,portId:to.portId}));
  }
  function selectBlock(id) {selected=id;selectedLink=null;linkDelete.hidden=true;renderSelection();
    element.dispatchEvent(new CustomEvent('canvasblockfocus',{detail:{blockId:id}}));
  }
  function renderSelection() {
    const connected=new Set();for(const link of model.getSnapshot().links){connected.add(`output/${link.from.blockId}/${link.from.portId}`);connected.add(`input/${link.to.blockId}/${link.to.portId}`)}
    for(const [id,record]of blockViews){record.element.classList.toggle('is-selected',id===selected);for(const p of record.element.querySelectorAll('.canvas-port')){
      p.classList.toggle('is-connected',connected.has(`${p.dataset.direction}/${p.dataset.blockId}/${p.dataset.portId}`));
      const endpoint=portInfo(p);
      p.classList.toggle('is-picked',samePort(endpoint,pendingPort)||!!dragLink?.anchors?.some(anchor=>samePort(anchor,endpoint)));
      p.classList.toggle('is-pickup-hover',samePort(endpoint,pickupCandidate));
      p.setAttribute('aria-pressed',String(p.classList.contains('is-picked')));
    }}
  }
  function blockPosition(block) {return layoutPositions.get(block.id)||(preview?.id===block.id?{x:preview.x,y:preview.y}:block)}
  function portPoint(endpoint,direction) {
    const record=blockViews.get(endpoint.blockId),block=model.getBlock(endpoint.blockId);if(!record||!block)return null;
    const ports=direction==='input'?resolveSkill(block.skillId).inputs:resolveSkill(block.skillId).outputs;
    const index=ports.findIndex(port=>port.id===endpoint.portId);if(index<0)return null;
    const position=blockPosition(block),box=record.element,port=box.querySelectorAll(`.canvas-port.is-${direction}`)[index];
    if(!port||!box.isConnected)return null;
    // Read untransformed fractional layout metrics. offsetHeight rounds animated
    // heights and the block border is inside each port's containing rectangle.
    const style=getComputedStyle(port);
    return {x:position.x+box.clientLeft+parseFloat(style.left)+parseFloat(style.width)/2,y:position.y+box.clientTop+parseFloat(style.top)};
  }
  function renderLinks() {
    if(destroyed)return;const ids=new Set();
    for(const link of model.getSnapshot().links){const from=portPoint(link.from,'output'),to=portPoint(link.to,'input');if(!from||!to)continue;
      ids.add(link.id);let record=linkViews.get(link.id);
      if(!record){const hit=svgPath('canvas-link-hit',''),path=svgPath('canvas-link','');hit.dataset.linkId=link.id;hit.setAttribute('role','button');hit.setAttribute('aria-label','연결 선택');hit.setAttribute('tabindex','0');connections.append(hit,path);record={hit,path};linkViews.set(link.id,record)}
      const d=connectionPath(from,to);record.hit.setAttribute('d',d);record.path.setAttribute('d',d);
      record.path.classList.toggle('is-selected',link.id===selectedLink||selected===link.from.blockId||selected===link.to.blockId);
    }
    for(const [id,record]of linkViews)if(!ids.has(id)){record.hit.remove();record.path.remove();linkViews.delete(id)}
    connections.querySelectorAll('.canvas-link-preview,.canvas-link-source').forEach(node=>node.remove());
    const pending=dragLink;
    if(pending){const point=screenToWorld(pending.point,camera);
      for(const port of pending.anchors){const anchor=portPoint(port,port.direction);if(!anchor)continue;
        connections.append(svgPath('canvas-link-preview',port.direction==='output'?connectionPath(anchor,point):connectionPath(point,anchor)));
        const dot=document.createElementNS(SVG,'circle');dot.setAttribute('class','canvas-link-source');dot.setAttribute('cx',anchor.x);dot.setAttribute('cy',anchor.y);dot.setAttribute('r','4');connections.append(dot);
      }
    }
  }
  function setExpanded(view,expanded,{immediate=false}={}){
    const node=view.element,body=node.querySelector('.canvas-block-body'),toggle=node.querySelector('.canvas-block-toggle');
    const style=getComputedStyle(body);
    const from=body.hidden?{height:0,opacity:'0',transform:'translateY(-.16rem)'}:{height:parseFloat(style.height)||0,opacity:style.opacity,transform:style.transform};
    stopExpansion(view);view.expanded=expanded;
    node.classList.toggle('is-expanded',expanded);toggle.setAttribute('aria-expanded',String(expanded));toggle.setAttribute('aria-label',`상세 내용 ${expanded?'닫기':'열기'}`);
    body.hidden=false;body.inert=!expanded;body.setAttribute('aria-hidden',String(!expanded));body.style.height='auto';
    for(const field of body.querySelectorAll('textarea'))resizeField(field);
    const target=expanded?body.scrollHeight:0;
    body.style.opacity=expanded?'1':'0';body.style.transform=expanded?'translateY(0)':'translateY(-.16rem)';
    const settle=()=>{body.style.height=expanded?'auto':'0px';body.hidden=!expanded;view.animation=view.fade=view.reveal=null;renderLinks()};
    if(immediate||reducedMotion()||Math.abs(from.height-target)<.5){settle();return}
    body.style.height=`${target}px`;
    const animation=body.animate([{height:`${from.height}px`},{height:`${target}px`}],{duration:380,easing:'cubic-bezier(.16,1,.3,1)'});
    view.fade=body.animate([{opacity:from.opacity},{opacity:body.style.opacity}],{duration:240,easing:'ease'});
    view.reveal=body.animate([{transform:from.transform},{transform:body.style.transform}],{duration:240,easing:'cubic-bezier(.16,1,.3,1)'});
    view.animation=animation;animation.onfinish=()=>{if(view.animation===animation)settle()};
  }
  function createBlock(block,skill) {
    const node=el('article','canvas-block');node.dataset.blockId=block.id;node.setAttribute('aria-label',`${skill.name} 스킬블럭`);node.style.setProperty('--block-color',skill.color);
    node.classList.toggle('is-expanded',block.expanded);
    const head=el('div','canvas-block-head');head.append(glyph(skill.icon),el('span','canvas-block-title',block.file?.name||skill.name));
    const toggle=button('chevron',`상세 내용 ${block.expanded?'닫기':'열기'}`,'canvas-block-toggle');toggle.dataset.action='toggle';toggle.setAttribute('aria-expanded',String(block.expanded));head.append(toggle);node.append(head);
    const body=el('div','canvas-block-body');body.hidden=!block.expanded;body.inert=!block.expanded;body.setAttribute('aria-hidden',String(!block.expanded));
    if(skill.id==='start')body.append(el('p','canvas-block-description','출력 포트를 다른 스킬블럭에 연결해 작업을 시작하세요.'));
    for(const field of skill.fields){
      const label=el('label',`canvas-field${field.id==='request'?' canvas-request-field':''}`);label.append(el('span','canvas-field-label',field.label));
      let control;
      if(field.options){control=el('select');for(const option of field.options){const item=el('option','',typeof option==='string'?option:option.label);item.value=typeof option==='string'?option:option.value;control.append(item)}}
      else{control=el('textarea');control.rows=1;control.placeholder=field.placeholder||'';if(field.maxLength)control.maxLength=field.maxLength}
      control.dataset.fieldId=field.id;control.value=block.values[field.id]??field.default??'';control.setAttribute('aria-label',field.label);label.append(control);body.append(label);
    }
    if(skill.id==='file'){
      const file=block.file;body.append(el('p','canvas-file-summary',file?`${file.name} · ${formatBytes(file.size)}`:'작업에 사용할 파일을 기기에서 선택하세요.'));
      const attach=button('folder',file?'다른 파일 선택':'파일 선택','canvas-file-select');attach.dataset.action='file';attach.append(el('span','',file?'다른 파일 선택':'파일 선택'));body.append(attach);
      if(file){
        const url=fileResources.getUrl(block.id);
        if(url&&file.type.startsWith('image/')){const frame=el('div','canvas-file-image-preview'),image=el('img');image.src=url;image.alt=file.name;image.draggable=false;frame.append(image);body.append(frame)}
        else if(file.text){const text=el('pre','canvas-file-preview',file.text.slice(0,900));body.append(text)}
        if(url){const download=el('a','canvas-file-download','다운로드');download.href=url;download.download=file.name;download.setAttribute('aria-label','파일 다운로드');download.append(glyph('up'));body.append(download)}
        const remove=button('close','첨부 파일 제거','canvas-file-remove');remove.dataset.action='remove-file';remove.append(el('span','','파일 제거'));body.append(remove)}
    }else if(skill.description&&skill.id!=='start'&&!skill.fields.some(field=>field.id==='request'))body.append(el('p','canvas-block-description',skill.description));
    const footer=el('div','canvas-block-footer');
    const run=button('play','이 스킬블럭부터 실행','canvas-block-run');run.dataset.action='run';run.append(el('span','','실행하기'));
    const remove=button('trash','스킬블럭 삭제','canvas-block-delete');remove.dataset.action='delete';remove.append(el('span','','삭제하기'));footer.append(run,remove);body.append(footer);node.append(body);
    for(const [direction,ports]of [['input',skill.inputs],['output',skill.outputs]])ports.forEach((port,index)=>{
      const p=el('button',`canvas-port is-${direction}`);p.type='button';p.dataset.blockId=block.id;p.dataset.portId=port.id;p.dataset.direction=direction;p.dataset.portType=port.type;
      p.title=`${port.label} · ${port.type} · ${direction==='input'?'입력':'출력'}`;p.setAttribute('aria-label',`${skill.name} ${port.label} ${direction==='input'?'입력':'출력'} 포트 (${port.type})`);p.style.top=`${(index+1)/(ports.length+1)*100}%`;
      const anchor=el('span','canvas-port-anchor');anchor.append(el('span','canvas-port-dot'));p.append(anchor,el('span','canvas-port-label',port.label));node.append(p);
    });return node;
  }
  function resizeField(control) {
    const style=getComputedStyle(control),min=parseFloat(style.minHeight)||27,max=parseFloat(style.maxHeight)||144;
    control.style.height='0px';control.style.height=`${Math.min(max,Math.max(min,control.scrollHeight))}px`;
  }
  function render() {
    if(destroyed)return;const blocks=model.getBlocks();fileResources.sync(blocks);const ids=new Set(blocks.map(b=>b.id));
    for(const [id,view]of blockViews)if(!ids.has(id)){stopExpansion(view);stopEntry(view);resize?.unobserve(view.element);view.element.remove();blockViews.delete(id)}
    if(selected&&!ids.has(selected))selected=null;
    if(pendingPort&&!ids.has(pendingPort.blockId))pendingPort=null;
    for(const block of blocks){const skill=resolveSkill(block.skillId);if(!skill)continue;
      const signature=JSON.stringify([skill,block.file?.localId,block.file?.name,block.file?.type,block.file?.size]);let view=blockViews.get(block.id);
      if(!view||view.signature!==signature){const node=createBlock(block,skill);if(view){stopExpansion(view);stopEntry(view);resize?.unobserve(view.element);view.element.replaceWith(node)}else nodes.append(node);view={element:node,signature,expanded:block.expanded};blockViews.set(block.id,view);resize?.observe(node)}
      const expanded=preview?.id===block.id&&preview.collapsed?false:block.expanded;
      if(view.expanded!==expanded)setExpanded(view,expanded);
      const position=blockPosition(block);view.element.style.left=`${position.x}px`;view.element.style.top=`${position.y}px`;
      for(const control of view.element.querySelectorAll('[data-field-id]')){if(control!==document.activeElement)control.value=block.values[control.dataset.fieldId]??'';if(control.matches('textarea'))resizeField(control)}
    }
    undo.disabled=!model.canUndo();redo.disabled=!model.canRedo();arrange.disabled=!blocks.length;reset.disabled=!blocks.length;hint.hidden=blocks.length>1;
    if(selectedLink&&!model.getSnapshot().links.some(link=>link.id===selectedLink)){selectedLink=null;linkDelete.hidden=true}
    renderSelection();renderLinks();
  }
  function fittedViewport() {
    const blocks=model.getBlocks();if(!blocks.length)return {x:surface.clientWidth/2-100,y:surface.clientHeight*.4,zoom:1};
    const left=Math.min(...blocks.map(b=>b.x)),top=Math.min(...blocks.map(b=>b.y)),right=Math.max(...blocks.map(b=>b.x+(blockViews.get(b.id)?.element.offsetWidth||205))),bottom=Math.max(...blocks.map(b=>b.y+(blockViews.get(b.id)?.element.offsetHeight||60)));
    return fitViewport({x:left,y:top,width:right-left,height:bottom-top},{width:surface.clientWidth,height:surface.clientHeight},{padding:45,top:72,bottom:bottomSpace()});
  }
  function fit(){setViewport(fittedViewport())}
  function arrangeBlocks(){
    cancel();const fromCamera={...camera},from=new Map(model.getBlocks().map(block=>[block.id,{x:block.x,y:block.y}]));
    safe(()=>model.arrange());const targetCamera=fittedViewport(),targets=model.getBlocks();
    if(reducedMotion()){setViewport(targetCamera);return}
    const started=performance.now(),duration=520,normalizer=1-7*Math.exp(-6);
    function frame(now){
      const progress=Math.min(1,(now-started)/duration),spring=(1-(1+6*progress)*Math.exp(-6*progress))/normalizer;
      for(const block of targets){const start=from.get(block.id)||block;layoutPositions.set(block.id,{x:start.x+(block.x-start.x)*spring,y:start.y+(block.y-start.y)*spring})}
      setViewport({x:fromCamera.x+(targetCamera.x-fromCamera.x)*spring,y:fromCamera.y+(targetCamera.y-fromCamera.y)*spring,zoom:fromCamera.zoom+(targetCamera.zoom-fromCamera.zoom)*spring},{motion:true});
      for(const block of targets){const node=blockViews.get(block.id)?.element,position=layoutPositions.get(block.id);if(node&&position){node.style.left=`${position.x}px`;node.style.top=`${position.y}px`}}
      renderLinks();if(progress<1)motionFrame=requestAnimationFrame(frame);else{motionFrame=0;layoutPositions.clear();render()}
    }
    frame(started);
  }
  function focusBlock(id) {
    const block=model.getBlock(id),node=blockViews.get(id)?.element;if(!block||!node)return;
    selectBlock(id);const zoom=Math.max(.65,Math.min(camera.zoom,1.2));setViewport({zoom,x:surface.clientWidth/2-(block.x+node.offsetWidth/2)*zoom,y:72+Math.max(100,(surface.clientHeight-bottomSpace()-72)/2)-(block.y+node.offsetHeight/2)*zoom});
  }
  function clearPreview(){clearPickup();if(preview){const record=blockViews.get(preview.id),block=model.getBlock(preview.id);if(record&&block){record.element.style.left=`${block.x}px`;record.element.style.top=`${block.y}px`;record.element.classList.remove('is-dragging');if(record.expanded!==block.expanded)setExpanded(record,block.expanded,{immediate:!active})}}preview=null;dragLink=null;surface.classList.remove('is-panning');renderLinks()}
  function start(event) {
    if(event.button!==0&&event.button!==1)return false;
    const port=portInfo(event.target);
    if(!port&&event.target.closest?.(`${editable},button,a,.canvas-link-hit`))return false;
    stopMotion();panSample={point:localPoint(event),time:performance.now(),vx:0,vy:0};
    const point=localPoint(event),block=event.target.closest?.('.canvas-block');
    const mode=port?{kind:'link',port}:block&&event.button!==1?{kind:'block',blockId:block.dataset.blockId,origin:model.getBlock(block.dataset.blockId),collapseOnDrag:!!event.target.closest('.canvas-block-head')}:{kind:'pan'};
    if(mode.kind==='block'){stopEntry(blockViews.get(mode.blockId));selectBlock(mode.blockId);}
    if(mode.kind==='link')portStartedAt=performance.now();
    if(!gestures.size&&mode.kind==='pan'){selected=null;selectedLink=null;pendingPort=null;linkDelete.hidden=true;renderSelection();renderLinks();closePalette()}
    const begun=gestures.begin(point,camera,mode);if(!begun)return false;
    if(begun.kind==='pinch'){clearPreview();panSample=null;pendingPort=null;renderSelection()}
    if(mode.kind==='pan')surface.classList.add('is-panning');
    event.preventDefault();surface.focus({preventScroll:true});return true;
  }
  function move(event) {
    const result=gestures.move(localPoint(event));if(!result)return;event.preventDefault();
    if(result.viewport){
      if(result.kind==='pan'&&panSample){const now=performance.now(),dt=Math.max(1,now-panSample.time),point=localPoint(event);panSample={point,time:now,vx:panSample.vx*.68+(point.x-panSample.point.x)/dt*.32,vy:panSample.vy*.68+(point.y-panSample.point.y)/dt*.32};}
      setViewport(result.viewport,{motion:true});
    }
    if(result.kind==='block'&&result.moved){const block=result.origin;preview={id:block.id,x:block.x+result.delta.x,y:block.y+result.delta.y,collapsed:result.collapseOnDrag&&block.expanded};const record=blockViews.get(block.id);if(record){if(preview.collapsed&&record.expanded)setExpanded(record,false,{immediate:true});record.element.style.left=`${preview.x}px`;record.element.style.top=`${preview.y}px`;record.element.classList.add('is-dragging')}renderLinks()}
    if(result.kind==='link'&&result.moved){
      portTap=null;
      if(!dragLink)dragLink={port:result.port,point:result.point,anchors:[result.port]};else dragLink.point=result.point;
      if(result.port.direction==='output')collectOutput(result.point);renderSelection();renderLinks();
    }
  }
  function end(event) {
    // Include the final release position; browsers need not send a last move.
    gestures.move(localPoint(event));const result=gestures.end(event.pointerId,camera);if(!result)return;
    const completedLink=dragLink;clearPreview();
    if(result.kind==='block'&&result.moved)safe(()=>model.updateBlock(result.blockId,{x:result.origin.x+result.delta.x,y:result.origin.y+result.delta.y}));
    if(result.kind==='link'){
      if(result.moved){
        const target=portAt(localPoint(event),result.port.direction==='output'?'input':'output');
        if(target){const anchors=completedLink?.anchors||[result.port];const results=safe(()=>model.toggleConnections(anchors.map(anchor=>({from:anchor.direction==='output'?{blockId:anchor.blockId,portId:anchor.portId}:{blockId:target.blockId,portId:target.portId},to:anchor.direction==='input'?{blockId:anchor.blockId,portId:anchor.portId}:{blockId:target.blockId,portId:target.portId}}))));for(const result of results||[])if(result.error)notice(result.error)}
        pendingPort=null;renderSelection();
      }else if(performance.now()-portStartedAt<320)tapPort(result.port);else portTap=null;
    }
    if(!gestures.size){surface.classList.remove('is-panning');if(result.kind==='pan'&&result.moved)coast(panSample);panSample=null;}
  }
  function cancel(){
    stopMotion();panSample=null;portTap=null;gestures.cancel();clearPreview();pendingPort=null;
    for(const timer of removalTimers.values())clearTimeout(timer);removalTimers.clear();
    for(const record of linkViews.values())record.path.classList.remove('is-removing');renderSelection();
  }
  function placement(skillId,{expanded=true,file}={}) {
    const skill=resolveSkill(skillId),center=screenToWorld({x:surface.clientWidth/2,y:Math.max(130,(surface.clientHeight-bottomSpace())/2)},camera);
    const sample=createBlock({id:'',skillId,values:{},expanded,file},skill);sample.style.visibility='hidden';nodes.append(sample);
    const rem=parseFloat(getComputedStyle(element).fontSize)||16;
    const size={width:sample.offsetWidth||12.25*rem,height:sample.offsetHeight||3.35*rem};sample.remove();
    const occupied=model.getBlocks().map(block=>({x:block.x,y:block.y,width:blockViews.get(block.id)?.element.offsetWidth||size.width,height:blockViews.get(block.id)?.element.offsetHeight||60}));
    return {position:findOpenPosition(center,size,occupied),size};
  }
  function placeBlock(skillId,options={}) {
    const {position}=placement(skillId,options),block=model.addBlock(skillId,{...position,...options});
    render();selectBlock(block.id);enterBlock(blockViews.get(block.id));
    // Insertion changes the graph only. An explicit focus/fit may move the camera.
    return block;
  }
  async function addFile(file) {
    if(destroyed)throw new Error('종료된 캔버스에는 파일을 추가할 수 없습니다.');
    const generation=lifecycleGeneration,metadata=await readLocalFile(file);
    if(destroyed||generation!==lifecycleGeneration)return null;
    return placeBlock('file',{expanded:false,file:metadata});
  }
  async function attachFile() {
    const file=fileInput.files?.[0],id=fileBlock,generation=++attachmentGeneration;fileInput.value='';if(!file||!model.getBlock(id))return;
    try{
      const metadata=await readLocalFile(file),enriched=await onAttach?.(file,{blockId:id,metadata});
      if(destroyed||generation!==attachmentGeneration||!model.getBlock(id))return;
      model.updateBlock(id,{file:enriched||metadata});
    }catch(error){notice(error.message||'파일을 읽지 못했습니다.')}
  }
  function renderPalette(){
    paletteList.replaceChildren();
    for(const skill of listSkills()){if(skill.id==='start')continue;const option=el('button','canvas-palette-option');option.type='button';option.dataset.skillId=skill.id;option.style.setProperty('--block-color',skill.color);option.append(glyph(skill.icon));const info=el('span','canvas-palette-copy');info.append(el('strong','',skill.name),el('small','',skill.description));option.append(info);paletteList.append(option)}
  }
  renderPalette();
  function refreshCatalog(){flushFields();model.validateCurrent();renderPalette();render();}
  function activate({signal}={}) {
    if(destroyed||signal?.aborted)return;deactivate();active=new AbortController();const life=active;
    signal?.addEventListener('abort',deactivate,{once:true});life.signal.addEventListener('abort',()=>signal?.removeEventListener('abort',deactivate),{once:true});
    const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...options,signal:life.signal});
    listen(element,'pointerdown',()=>{if(motionFrame)stopMotion()},{capture:true});
    listen(window,'blur',cancel);listen(document,'visibilitychange',()=>{if(document.hidden)cancel()});
    owner=input.registerOwner({element:surface,signal:life.signal,multiPointer:true,onStart:start,onMove:move,onEnd:end,onCancel:cancel});
    unsubscribe=model.subscribe(render);resize=new ResizeObserver(()=>renderLinks());for(const record of blockViews.values())resize.observe(record.element);
    listen(add,'click',()=>{setPalette(!paletteOpen);disarmReset();if(paletteOpen)paletteList.querySelector('button')?.focus()});
    listen(paletteList,'click',event=>{const option=event.target.closest('[data-skill-id]');if(!option)return;
      const block=safe(()=>placeBlock(option.dataset.skillId,{expanded:true}));closePalette(true);
      if(block?.skillId==='file'){fileBlock=block.id;fileInput.click()}
    });
    listen(palette,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePalette(true)}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...paletteList.querySelectorAll('button')],index=items.indexOf(document.activeElement);let next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus()}});
    listen(reset,'click',()=>{if(resetTimer){disarmReset();cancel();safe(()=>model.clear());notice('캔버스를 초기화했습니다. 실행 취소로 복원할 수 있습니다.')}else{reset.classList.add('is-confirming');resetText.textContent='한 번 더';reset.setAttribute('aria-label','캔버스 초기화 확인');resetTimer=setTimeout(disarmReset,3500);notice('한 번 더 누르면 모든 스킬블럭과 연결을 삭제합니다.')}});
    listen(arrange,'click',arrangeBlocks);listen(undo,'click',()=>{cancel();safe(()=>model.undo())});listen(redo,'click',()=>{cancel();safe(()=>model.redo())});
    const zoomBy=factor=>setViewport(zoomAt(camera,{x:surface.clientWidth/2,y:(surface.clientHeight-bottomSpace())/2},camera.zoom*factor));
    listen(out,'click',()=>zoomBy(1/1.2));listen(inside,'click',()=>zoomBy(1.2));listen(zoom,'click',fit);
    listen(linkDelete,'click',()=>{safe(()=>model.disconnect(selectedLink));selectedLink=null;linkDelete.hidden=true;surface.focus()});
    listen(surface,'click',event=>{
      const port=portInfo(event.target);if(port){if(event.detail===0)choosePort(port);return}
      const link=event.target.closest?.('[data-link-id]');if(link){selectedLink=link.dataset.linkId;selected=null;linkDelete.hidden=false;renderSelection();renderLinks();return}
      const action=event.target.closest?.('[data-action]');if(!action)return;const block=model.getBlock(action.closest('.canvas-block').dataset.blockId);if(!block)return;
      selectBlock(block.id);
      if(action.dataset.action==='toggle')safe(()=>model.updateBlock(block.id,{expanded:!block.expanded}));
      if(action.dataset.action==='delete')safe(()=>model.deleteBlock(block.id));
      if(action.dataset.action==='remove-file')safe(()=>model.updateBlock(block.id,{file:null}));
      if(action.dataset.action==='file'){fileBlock=block.id;fileInput.click()}
      if(action.dataset.action==='run')Promise.resolve(onRun?.(block.id)).then(result=>{if(!destroyed&&!result?.accepted)notice(result?.message||'실행 연결을 준비 중입니다.')},error=>notice(error.message));
    });
    listen(surface,'keydown',event=>{
      if(event.target.matches(editable)||event.isComposing)return;
      if(event.key==='Escape'){cancel();closePalette();disarmReset();selectedLink=null;linkDelete.hidden=true;renderLinks()}
      const mod=event.ctrlKey||event.metaKey;
      if(mod&&event.key.toLowerCase()==='z'){event.preventDefault();cancel();event.shiftKey?model.redo():model.undo()}
      else if(mod&&event.key.toLowerCase()==='y'){event.preventDefault();cancel();model.redo()}
      else if(event.key==='Delete'||event.key==='Backspace'){if(selectedLink){event.preventDefault();safe(()=>model.disconnect(selectedLink))}else if(selected){event.preventDefault();safe(()=>model.deleteBlock(selected))}}
      else if((event.key==='Enter'||event.key===' ')&&event.target.classList.contains('canvas-link-hit')){event.preventDefault();selectedLink=event.target.dataset.linkId;selected=null;linkDelete.hidden=false;renderSelection();renderLinks()}
    });
    listen(surface,'change',event=>{if(!event.target.matches('[data-field-id]'))return;queueField(event.target);flushFields()});
    listen(surface,'input',event=>{if(event.target.matches('[data-field-id]'))queueField(event.target);if(event.target.matches('textarea')){resizeField(event.target);renderLinks()}});
    listen(surface,'focusin',event=>{if(event.target.matches('textarea')){resizeField(event.target);renderLinks()}});
    listen(surface,'focusout',event=>{if(event.target.matches('textarea')){resizeField(event.target);renderLinks()}});
    listen(surface,'wheel',event=>{if(event.target.closest(`${editable},.canvas-palette`))return;event.preventDefault();if(gestures.size)return;setViewport(zoomAt(camera,localPoint(event),camera.zoom*Math.exp(-event.deltaY*.0015)))},{passive:false});
    listen(fileInput,'change',attachFile);
    listen(document,'pointerdown',event=>{if(paletteOpen&&!primary.contains(event.target))closePalette()},{capture:true});
    render();setViewport(camera);
  }
  function deactivate() {
    for(const timer of removalTimers.values())clearTimeout(timer);removalTimers.clear();
    for(const view of blockViews.values()){stopEntry(view);if(view.animation){stopExpansion(view);setExpanded(view,view.expanded,{immediate:true})}}
    flushFields();active?.abort();active=null;owner?.unregister();owner=null;unsubscribe?.();unsubscribe=null;resize?.disconnect();resize=null;cancel();closePalette();disarmReset();attachmentGeneration++;lifecycleGeneration++;clearTimeout(noticeTimer);status.textContent='';
  }
  function closeMenu(){owner?.cancel('menu-open');cancel();closePalette();disarmReset();flushFields()}
  function destroy(){if(destroyed)return;deactivate();destroyed=true;unsubscribeResources();fileResources.destroy();blockViews.clear();element.remove()}
  // Resource lifetime outlives input activation so offscreen replacements/deletions revoke URLs.
  const unsubscribeResources=model.subscribe(({snapshot})=>fileResources.sync(snapshot.blocks));
  render();setViewport(camera);
  // Canvas owns untransformed geometry and provides the coordinate host.
  // Its world DOM transform automatically moves scene actors on pan/zoom.
  function getBlockBounds(id) {
    if(destroyed)return null;
    const block=model.getBlock(id),view=blockViews.get(id)?.element;
    if(!block||!view)return null;
    const at=blockPosition(block);
    return {x:at.x,y:at.y,width:view.offsetWidth,height:view.offsetHeight};
  }
  const actorHost=Object.freeze({
    element:world,pointerElement:surface,
    clientToLocal(event) {
      const rect=surface.getBoundingClientRect();
      return screenToWorld({x:event.clientX-rect.left,y:event.clientY-rect.top},camera);
    }
  });
  return {element,activate,deactivate,destroy,closeMenu,addFile,flushPendingEdits:flushFields,refreshCatalog,
    getViewport:()=>({...camera}),setViewport,focusBlock,getBlockBounds,
    getSelectedBlockId:()=>selected,getActorHost:()=>actorHost};
}
function formatBytes(size){return size<1024?`${size} B`:size<1024*1024?`${Math.round(size/1024)} KB`:`${(size/(1024*1024)).toFixed(1)} MB`}
