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
export function createCanvas({model,input,onRun,onNotice,onAttach}={}) {
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
  let fileBlock=null,attachmentGeneration=0;
  const notice=message=>{const text=String(message?.message||message||'작업을 완료하지 못했습니다.');status.textContent=text;onNotice?.(text);clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>{status.textContent=''},4500)};
  const safe=action=>{try{return action()}catch(error){notice(error.message);return null}};
  const localPoint=event=>{const bounds=surface.getBoundingClientRect();return {id:event.pointerId,x:event.clientX-bounds.left,y:event.clientY-bounds.top}};
  const bottomSpace=()=>{const value=parseFloat(getComputedStyle(element).getPropertyValue('--workspace-composer-height'));return (Number.isFinite(value)?value:76)+90};
  function setViewport(next) {
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
  function closePalette(focus=false) {palette.hidden=true;add.setAttribute('aria-expanded','false');if(focus)add.focus()}
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
    safe(()=>existing?model.disconnect(existing.id):model.connect({blockId:from.blockId,portId:from.portId},{blockId:to.blockId,portId:to.portId}));
  }
  function selectBlock(id) {selected=id;selectedLink=null;linkDelete.hidden=true;renderSelection()}
  function renderSelection() {
    const connected=new Set();for(const link of model.getSnapshot().links){connected.add(`output/${link.from.blockId}/${link.from.portId}`);connected.add(`input/${link.to.blockId}/${link.to.portId}`)}
    for(const [id,record]of blockViews){record.element.classList.toggle('is-selected',id===selected);for(const p of record.element.querySelectorAll('.canvas-port')){
      p.classList.toggle('is-connected',connected.has(`${p.dataset.direction}/${p.dataset.blockId}/${p.dataset.portId}`));
      p.classList.toggle('is-picked',!!pendingPort&&p.dataset.blockId===pendingPort.blockId&&p.dataset.portId===pendingPort.portId&&p.dataset.direction===pendingPort.direction);
      p.setAttribute('aria-pressed',String(p.classList.contains('is-picked')));
    }}
  }
  function blockPosition(block) {return preview?.id===block.id?{x:preview.x,y:preview.y}:block}
  function portPoint(endpoint,direction) {
    const record=blockViews.get(endpoint.blockId),block=model.getBlock(endpoint.blockId);if(!record||!block)return null;
    const ports=direction==='input'?getSkill(block.skillId).inputs:getSkill(block.skillId).outputs;
    const index=ports.findIndex(port=>port.id===endpoint.portId);if(index<0)return null;
    const position=blockPosition(block),box=record.element;
    return {x:position.x+(direction==='output'?box.offsetWidth:0),y:position.y+box.offsetHeight*(index+1)/(ports.length+1)};
  }
  function renderLinks() {
    if(destroyed)return;connections.replaceChildren();
    for(const link of model.getSnapshot().links){const from=portPoint(link.from,'output'),to=portPoint(link.to,'input');if(!from||!to)continue;
      const d=connectionPath(from,to),hit=svgPath('canvas-link-hit',d),path=svgPath('canvas-link',d);hit.dataset.linkId=link.id;hit.setAttribute('role','button');hit.setAttribute('aria-label','연결 선택');hit.setAttribute('tabindex','0');path.classList.toggle('is-selected',link.id===selectedLink);connections.append(hit,path);
    }
    const pending=dragLink;
    if(pending){const anchor=portPoint(pending.port,pending.port.direction),point=screenToWorld(pending.point,camera);if(anchor)connections.append(svgPath('canvas-link-preview',pending.port.direction==='output'?connectionPath(anchor,point):connectionPath(point,anchor)))}
  }
  function createBlock(block,skill) {
    const node=el('article','canvas-block');node.dataset.blockId=block.id;node.setAttribute('aria-label',`${skill.name} 스킬블럭`);node.style.setProperty('--block-color',skill.color);
    node.classList.toggle('is-expanded',block.expanded);
    const head=el('div','canvas-block-head');head.append(glyph(skill.icon),el('span','canvas-block-title',block.file?.name||skill.name));
    const toggle=button('chevron',`상세 내용 ${block.expanded?'닫기':'열기'}`,'canvas-block-toggle');toggle.dataset.action='toggle';toggle.setAttribute('aria-expanded',String(block.expanded));head.append(toggle);node.append(head);
    const body=el('div','canvas-block-body');body.hidden=!block.expanded;
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
      p.append(el('span','canvas-port-dot'),el('span','canvas-port-label',port.label));node.append(p);
    });return node;
  }
  function resizeField(control) {
    const style=getComputedStyle(control),min=parseFloat(style.minHeight)||27,max=parseFloat(style.maxHeight)||144;
    control.style.height='0px';control.style.height=`${Math.min(max,Math.max(min,control.scrollHeight))}px`;
  }
  function render() {
    if(destroyed)return;const blocks=model.getBlocks();fileResources.sync(blocks);const ids=new Set(blocks.map(b=>b.id));
    for(const [id,view]of blockViews)if(!ids.has(id)){resize?.unobserve(view.element);view.element.remove();blockViews.delete(id)}
    if(selected&&!ids.has(selected))selected=null;
    if(pendingPort&&!ids.has(pendingPort.blockId))pendingPort=null;
    for(const block of blocks){const skill=getSkill(block.skillId);if(!skill)continue;
      const signature=JSON.stringify([block.skillId,block.expanded,block.file?.localId,block.file?.name,block.file?.type,block.file?.size]);let view=blockViews.get(block.id);
      if(!view||view.signature!==signature){const node=createBlock(block,skill);if(view){resize?.unobserve(view.element);view.element.replaceWith(node)}else nodes.append(node);view={element:node,signature};blockViews.set(block.id,view);resize?.observe(node)}
      const position=blockPosition(block);view.element.style.left=`${position.x}px`;view.element.style.top=`${position.y}px`;
      for(const control of view.element.querySelectorAll('[data-field-id]')){if(control!==document.activeElement)control.value=block.values[control.dataset.fieldId]??'';if(control.matches('textarea'))resizeField(control)}
    }
    undo.disabled=!model.canUndo();redo.disabled=!model.canRedo();arrange.disabled=!blocks.length;reset.disabled=!blocks.length;hint.hidden=blocks.length>1;
    if(selectedLink&&!model.getSnapshot().links.some(link=>link.id===selectedLink)){selectedLink=null;linkDelete.hidden=true}
    renderSelection();renderLinks();
  }
  function fit() {
    const blocks=model.getBlocks();if(!blocks.length){setViewport({x:surface.clientWidth/2-100,y:surface.clientHeight*.4,zoom:1});return}
    const left=Math.min(...blocks.map(b=>b.x)),top=Math.min(...blocks.map(b=>b.y)),right=Math.max(...blocks.map(b=>b.x+(blockViews.get(b.id)?.element.offsetWidth||205))),bottom=Math.max(...blocks.map(b=>b.y+(blockViews.get(b.id)?.element.offsetHeight||60)));
    setViewport(fitViewport({x:left,y:top,width:right-left,height:bottom-top},{width:surface.clientWidth,height:surface.clientHeight},{padding:45,top:72,bottom:bottomSpace()}));
  }
  function focusBlock(id) {
    const block=model.getBlock(id),node=blockViews.get(id)?.element;if(!block||!node)return;
    selectBlock(id);const zoom=Math.max(.65,Math.min(camera.zoom,1.2));setViewport({zoom,x:surface.clientWidth/2-(block.x+node.offsetWidth/2)*zoom,y:72+Math.max(100,(surface.clientHeight-bottomSpace()-72)/2)-(block.y+node.offsetHeight/2)*zoom});
  }
  function clearPreview(){if(preview){const record=blockViews.get(preview.id),block=model.getBlock(preview.id);if(record&&block){record.element.style.left=`${block.x}px`;record.element.style.top=`${block.y}px`;record.element.classList.remove('is-dragging')}}preview=null;dragLink=null;surface.classList.remove('is-panning');renderLinks()}
  function start(event) {
    if(event.button!==0&&event.button!==1)return false;
    const port=portInfo(event.target);
    if(!port&&event.target.closest?.(`${editable},button,a,.canvas-link-hit`))return false;
    const point=localPoint(event),block=event.target.closest?.('.canvas-block');
    const mode=port?{kind:'link',port}:block&&event.button!==1?{kind:'block',blockId:block.dataset.blockId,origin:model.getBlock(block.dataset.blockId)}:{kind:'pan'};
    if(mode.kind==='block')selectBlock(mode.blockId);
    if(!gestures.size&&mode.kind==='pan'){selected=null;selectedLink=null;pendingPort=null;linkDelete.hidden=true;renderSelection();renderLinks();closePalette()}
    const begun=gestures.begin(point,camera,mode);if(!begun)return false;
    if(begun.kind==='pinch'){clearPreview();pendingPort=null;renderSelection()}
    if(mode.kind==='pan')surface.classList.add('is-panning');
    event.preventDefault();surface.focus({preventScroll:true});return true;
  }
  function move(event) {
    const result=gestures.move(localPoint(event));if(!result)return;event.preventDefault();
    if(result.viewport)setViewport(result.viewport);
    if(result.kind==='block'&&result.moved){const block=result.origin;preview={id:block.id,x:block.x+result.delta.x,y:block.y+result.delta.y};const record=blockViews.get(block.id);if(record){record.element.style.left=`${preview.x}px`;record.element.style.top=`${preview.y}px`;record.element.classList.add('is-dragging')}renderLinks()}
    if(result.kind==='link'&&result.moved){dragLink={port:result.port,point:result.point};renderLinks()}
  }
  function end(event) {
    // Include the final release position; browsers need not send a last move.
    gestures.move(localPoint(event));const result=gestures.end(event.pointerId,camera);if(!result)return;
    clearPreview();
    if(result.kind==='block'&&result.moved)safe(()=>model.updateBlock(result.blockId,{x:result.origin.x+result.delta.x,y:result.origin.y+result.delta.y}));
    if(result.kind==='link'){
      if(result.moved){const target=portInfo(document.elementFromPoint(event.clientX,event.clientY));if(target)connectPorts(result.port,target);pendingPort=null;renderSelection()}
      else choosePort(result.port);
    }
    if(!gestures.size)surface.classList.remove('is-panning');
  }
  function cancel(){gestures.cancel();clearPreview();pendingPort=null;renderSelection()}
  function placement(skillId,{expanded=true,file}={}) {
    const skill=getSkill(skillId),center=screenToWorld({x:surface.clientWidth/2,y:Math.max(130,(surface.clientHeight-bottomSpace())/2)},camera);
    const sample=createBlock({id:'',skillId,values:{},expanded,file},skill);sample.style.visibility='hidden';nodes.append(sample);
    const rem=parseFloat(getComputedStyle(element).fontSize)||16;
    const size={width:sample.offsetWidth||12.25*rem,height:sample.offsetHeight||3.35*rem};sample.remove();
    const occupied=model.getBlocks().map(block=>({x:block.x,y:block.y,width:blockViews.get(block.id)?.element.offsetWidth||size.width,height:blockViews.get(block.id)?.element.offsetHeight||60}));
    return {position:findOpenPosition(center,size,occupied),size};
  }
  function placeBlock(skillId,options={}) {
    const {position,size}=placement(skillId,options),block=model.addBlock(skillId,{...position,...options});
    render();selectBlock(block.id);
    const left=position.x*camera.zoom+camera.x,top=position.y*camera.zoom+camera.y;
    if(left<30||left+size.width*camera.zoom>surface.clientWidth-30||top<85||top+size.height*camera.zoom>surface.clientHeight-bottomSpace())focusBlock(block.id);
    return block;
  }
  async function addFile(file) {
    if(destroyed)throw new Error('종료된 캔버스에는 파일을 추가할 수 없습니다.');
    const generation=lifecycleGeneration,metadata=await readLocalFile(file);
    if(destroyed||generation!==lifecycleGeneration)return null;
    const block=placeBlock('file',{expanded:false,file:metadata});focusBlock(block.id);return block;
  }
  async function attachFile() {
    const file=fileInput.files?.[0],id=fileBlock,generation=++attachmentGeneration;fileInput.value='';if(!file||!model.getBlock(id))return;
    try{
      const metadata=await readLocalFile(file),enriched=await onAttach?.(file,{blockId:id,metadata});
      if(destroyed||generation!==attachmentGeneration||!model.getBlock(id))return;
      model.updateBlock(id,{file:enriched||metadata});
    }catch(error){notice(error.message||'파일을 읽지 못했습니다.')}
  }
  for(const skill of skills){if(skill.id==='start')continue;const option=el('button','canvas-palette-option');option.type='button';option.dataset.skillId=skill.id;option.style.setProperty('--block-color',skill.color);option.append(glyph(skill.icon));const info=el('span','canvas-palette-copy');info.append(el('strong','',skill.name),el('small','',skill.description));option.append(info);paletteList.append(option)}
  function activate({signal}={}) {
    if(destroyed||signal?.aborted)return;deactivate();active=new AbortController();const life=active;
    signal?.addEventListener('abort',deactivate,{once:true});life.signal.addEventListener('abort',()=>signal?.removeEventListener('abort',deactivate),{once:true});
    const listen=(target,type,handler,options={})=>target.addEventListener(type,handler,{...options,signal:life.signal});
    owner=input.registerOwner({element:surface,signal:life.signal,multiPointer:true,onStart:start,onMove:move,onEnd:end,onCancel:cancel});
    unsubscribe=model.subscribe(render);resize=new ResizeObserver(()=>renderLinks());for(const record of blockViews.values())resize.observe(record.element);
    listen(add,'click',()=>{const open=palette.hidden;palette.hidden=!open;add.setAttribute('aria-expanded',String(open));disarmReset();if(open)paletteList.querySelector('button')?.focus()});
    listen(paletteList,'click',event=>{const option=event.target.closest('[data-skill-id]');if(!option)return;
      const block=safe(()=>placeBlock(option.dataset.skillId,{expanded:true}));closePalette(true);
      if(block?.skillId==='file'){fileBlock=block.id;fileInput.click()}
    });
    listen(palette,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();closePalette(true)}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const items=[...paletteList.querySelectorAll('button')],index=items.indexOf(document.activeElement);let next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus()}});
    listen(reset,'click',()=>{if(resetTimer){disarmReset();cancel();safe(()=>model.clear());notice('캔버스를 초기화했습니다. 실행 취소로 복원할 수 있습니다.')}else{reset.classList.add('is-confirming');resetText.textContent='한 번 더';reset.setAttribute('aria-label','캔버스 초기화 확인');resetTimer=setTimeout(disarmReset,3500);notice('한 번 더 누르면 모든 스킬블럭과 연결을 삭제합니다.')}});
    listen(arrange,'click',()=>{cancel();safe(()=>model.arrange());fit()});listen(undo,'click',()=>{cancel();safe(()=>model.undo())});listen(redo,'click',()=>{cancel();safe(()=>model.redo())});
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
    listen(surface,'wheel',event=>{if(event.target.closest(`${editable},.canvas-palette`))return;event.preventDefault();if(gestures.size)return;setViewport(zoomAt(camera,localPoint(event),camera.zoom*Math.exp(-Math.max(-100,Math.min(100,event.deltaY))*.002)))},{passive:false});
    listen(fileInput,'change',attachFile);
    listen(document,'pointerdown',event=>{if(!palette.hidden&&!primary.contains(event.target))closePalette()},{capture:true});
    render();setViewport(camera);
  }
  function deactivate() {
    flushFields();active?.abort();active=null;owner?.unregister();owner=null;unsubscribe?.();unsubscribe=null;resize?.disconnect();resize=null;cancel();closePalette();disarmReset();attachmentGeneration++;lifecycleGeneration++;clearTimeout(noticeTimer);status.textContent='';
  }
  function closeMenu(){owner?.cancel('menu-open');cancel();closePalette();disarmReset();flushFields()}
  function destroy(){if(destroyed)return;deactivate();destroyed=true;unsubscribeResources();fileResources.destroy();blockViews.clear();element.remove()}
  // Resource lifetime outlives input activation so offscreen replacements/deletions revoke URLs.
  const unsubscribeResources=model.subscribe(({snapshot})=>fileResources.sync(snapshot.blocks));
  render();setViewport(camera);
  return {element,activate,deactivate,destroy,closeMenu,addFile,getViewport:()=>({...camera}),setViewport,focusBlock};
}
function formatBytes(size){return size<1024?`${size} B`:size<1024*1024?`${Math.round(size/1024)} KB`:`${(size/(1024*1024)).toFixed(1)} MB`}
