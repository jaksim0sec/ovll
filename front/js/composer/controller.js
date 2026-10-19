import { skills, getSkill } from '../skill/catalog.js';
import { icon } from '../workspace/icons.js';
import { normalizeDraft, hasDraftContent } from './draft.js';

let instanceNumber = 0;

/** Owns editor DOM, selection, menus and its active-page event lifetime. */
export function createComposer({model,onSubmit,onHeightChange,onAttach,resolveSkill=getSkill,listSkills=()=>skills} = {}) {
  const doc = document;
  const view = doc.defaultView;
  const prefix = `composer-${++instanceNumber}`;
  const element = doc.createElement('section');
  element.className = 'ovll-composer';
  element.setAttribute('aria-label','작업 입력기');
  const form = doc.createElement('form');
  form.className = 'ovll-composer-form';
  const editor = doc.createElement('div');
  editor.className = 'ovll-rich-editor';
  editor.contentEditable = 'true';
  editor.spellcheck = true;
  editor.dataset.placeholder = '무엇을 할까요?';
  editor.setAttribute('role','textbox');
  editor.setAttribute('aria-label','작업 입력');
  editor.setAttribute('aria-multiline','true');
  editor.setAttribute('aria-autocomplete','list');
  editor.setAttribute('aria-controls',`${prefix}-picker`);
  editor.setAttribute('autocapitalize','sentences');
  const toolbar = doc.createElement('div');
  toolbar.className = 'ovll-rich-toolbar';
  function button(glyph,label,className='') {
    const node=doc.createElement('button');
    node.type='button';node.className=`ovll-rich-tool ${className}`.trim();
    node.innerHTML=icon(glyph);node.setAttribute('aria-label',label);node.title=label;
    return node;
  }
  const add = button('plus','추가 메뉴','ovll-rich-add');
  const mention = button('mention','스킬 및 스킬블럭 참조','ovll-rich-mention');
  const canvas = button('canvas','스킬블럭 참조','ovll-rich-canvas');
  const commands = button('slash','빠른 명령','ovll-rich-slash');
  for(const node of [add,mention,canvas,commands]) {
    node.setAttribute('aria-haspopup','listbox');node.setAttribute('aria-expanded','false');
  }
  toolbar.append(add,mention,canvas,commands);
  const send=button('up','요청 보내기','ovll-rich-send');send.type='submit';
  const measure=doc.createElement('div');
  measure.className='ovll-rich-editor ovll-rich-measure';measure.setAttribute('aria-hidden','true');
  const attachmentsView=doc.createElement('div');attachmentsView.className='ovll-rich-attachments';attachmentsView.hidden=true;
  const fileInput=doc.createElement('input');fileInput.type='file';fileInput.multiple=true;fileInput.hidden=true;
  const pickerHost=doc.createElement('div');pickerHost.className='ovll-rich-picker-host';
  const picker=doc.createElement('div');picker.className='ovll-rich-picker';picker.id=`${prefix}-picker`;picker.hidden=true;
  picker.setAttribute('role','listbox');picker.setAttribute('aria-label','스킬 및 명령 검색');pickerHost.append(picker);
  const status=doc.createElement('p');status.className='ovll-composer-status';status.setAttribute('role','status');status.hidden=true;
  form.append(attachmentsView,editor,toolbar,send,measure,fileInput);
  // A sibling popup keeps its backdrop outside the form's blur context.
  element.append(form,pickerHost,status);

  let attachments=[];
  let lifetime=null;
  let externalSignal=null;
  let externalAbort=null;
  let observer=null;
  let unsubscribe=null;
  let resizeFrame=0;
  let destroyed=false;
  let composing=false;
  let busy=false;
  let pendingAttachments=0;
  let savedRange=null;
  let triggerRange=null;
  let selectedTag=null;
  let menuType='';
  let menuQuery='';
  let entries=[];
  let selectedIndex=0;
  let lastHeight=-1;
  let revision=0;
  let tokenNumber=0;
  let openingToolbarMenu=false;
  let layoutAnimations=[];
  const coarse=()=>view.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

  function notify(message='') {status.textContent=message;status.hidden=!message;scheduleResize();}
  function appendText(parts,text) {
    if(!text)return;
    const last=parts.at(-1);
    if(last?.type==='text')last.text+=text;else parts.push({type:'text',text});
  }
  function readParts() {
    const parts=[];
    const visit=node=>{
      if(node.nodeType===3){appendText(parts,node.data);return;}
      if(node.nodeType!==1)return;
      if(node.dataset.refKind){parts.push({type:node.dataset.refKind,id:node.dataset.refId,label:node.dataset.refLabel});return;}
      if(node.tagName==='BR'){
        // The final BR in an otherwise empty paragraph is the browser's caret
        // placeholder. Its paragraph boundary already represents the new line.
        if(!node.nextSibling && (!node.previousSibling || node.previousSibling.nodeName==='BR'))return;
        appendText(parts,'\n');return;
      }
      const block=/^(DIV|P|LI)$/.test(node.tagName);
      const previous=node.previousSibling;
      const followsExplicitBreak=previous?.nodeName==='BR' || (previous?.nodeType===3 && previous.data.endsWith('\n'));
      if(block && previous && !followsExplicitBreak)appendText(parts,'\n');
      for(const child of node.childNodes)visit(child);
    };
    for(const node of editor.childNodes)visit(node);
    return parts;
  }
  function getDraft(){return normalizeDraft({parts:readParts(),attachments});}
  function createTag(part) {
    const tag=doc.createElement('span');tag.className='ovll-rich-ref';tag.contentEditable='false';
    tag.id=`${prefix}-token-${++tokenNumber}`;
    tag.dataset.refKind=part.type;tag.dataset.refId=part.id;tag.dataset.refLabel=part.label;
    tag.tabIndex=0;tag.setAttribute('role','button');tag.setAttribute('aria-label',`${part.label}, ${part.type==='skill'?'스킬':'스킬블럭'} 참조 메뉴`);
    const definition=part.type==='skill'?resolveSkill(part.id):resolveSkill(model?.getBlock?.(part.id)?.skillId);
    const glyph=doc.createElement('span');glyph.className='ovll-rich-ref-icon';glyph.innerHTML=icon(definition?.icon || (part.type==='block'?'canvas':'workflow'));
    const label=doc.createElement('span');label.textContent=part.label;
    tag.append(glyph,label);return tag;
  }
  function renderAttachments() {
    attachmentsView.replaceChildren();attachmentsView.hidden=!attachments.length;form.classList.toggle('has-attachments',attachments.length>0);
    attachments.forEach((attachment,index)=>{
      const item=doc.createElement('div');item.className='ovll-rich-attachment';
      const file=button('folder',`${attachment.name} 내려받기`,'ovll-rich-file');
      const name=doc.createElement('span');name.textContent=attachment.name;file.append(name);
      file.dataset.attachmentAction='download';file.dataset.attachmentIndex=String(index);
      file.title=attachment.file ? `${attachment.name} · 이 기기에 첨부됨` : `${attachment.name} · 파일 정보`;
      file.disabled=!attachment.file;
      const remove=button('close',`${attachment.name} 첨부 제거`,'ovll-rich-file-remove');
      remove.dataset.attachmentAction='remove';remove.dataset.attachmentIndex=String(index);
      item.append(file,remove);attachmentsView.append(item);
    });
  }
  function setDraft(draft) {
    const normalized=normalizeDraft(draft);attachments=normalized.attachments;
    editor.replaceChildren(...normalized.parts.map(part=>part.type==='text'?doc.createTextNode(part.text):createTag(part)));
    savedRange=null;revision++;closeMenu();renderAttachments();update();
  }
  function update(){const draft=getDraft();send.disabled=busy||pendingAttachments>0||!hasDraftContent(draft);editor.classList.toggle('is-empty',draft.parts.length===0);scheduleResize();}
  function changed({detect=true,emit=false}={}) {
    revision++;notify();update();remember();if(detect)detectTrigger();
    if(emit)element.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function resize() {
    resizeFrame=0;if(destroyed)return;
    const style=view.getComputedStyle(editor);const rem=parseFloat(view.getComputedStyle(doc.documentElement).fontSize)||16;
    const formStyle=view.getComputedStyle(form);
    const compactPadding=parseFloat(formStyle.getPropertyValue('--ovll-rich-compact-padding-rem'))||.44;
    const compactGap=parseFloat(formStyle.getPropertyValue('--ovll-rich-compact-gap-rem'))||.25;
    const compactWidth=Math.max(1,form.clientWidth-2*compactPadding*rem-2.25*rem-2.5*rem-2*compactGap*rem);
    measure.style.width=`${compactWidth}px`;measure.textContent=editor.textContent||'';
    const parts=readParts();
    const expanded=doc.activeElement===editor || openingToolbarMenu || !picker.hidden || attachments.length>0 || parts.some(p=>p.type!=='text'||p.text.trim()||p.text.includes('\n')) || measure.scrollHeight>(parseFloat(style.lineHeight)||24)+.5*rem+2;
    const layoutChanged=form.classList.contains('is-expanded')!==expanded;
    const nodes=[editor,toolbar,send];
    const beforeForm=layoutChanged?form.getBoundingClientRect():null;
    const previous=layoutChanged?nodes.map(node=>node.getBoundingClientRect()):null;
    if(layoutChanged){for(const animation of layoutAnimations)animation.cancel();layoutAnimations=[];}
    form.classList.toggle('is-expanded',expanded);
    if(layoutChanged && !view.matchMedia?.('(prefers-reduced-motion: reduce)').matches){
      // Read every destination before starting the height animation. Positions
      // are relative to the form: its anchored top moves with its live height.
      const afterForm=form.getBoundingClientRect();
      const next=nodes.map(node=>node.getBoundingClientRect());
      const motion={duration:300,easing:'cubic-bezier(.22,1,.36,1)'};
      if(Math.abs(beforeForm.height-afterForm.height)>1)layoutAnimations.push(form.animate([{height:`${beforeForm.height}px`},{height:`${afterForm.height}px`}],motion));
      nodes.forEach((node,index)=>{
        const dx=(previous[index].left-beforeForm.left)-(next[index].left-afterForm.left);
        const dy=(previous[index].top-beforeForm.top)-(next[index].top-afterForm.top);
        if(Math.abs(dx)+Math.abs(dy)>1)layoutAnimations.push(node.animate([{transform:`translate3d(${dx}px,${dy}px,0)`},{transform:'translate3d(0,0,0)'}],motion));
      });
    }
    pickerHost.style.left=`${form.offsetLeft}px`;pickerHost.style.width=`${form.offsetWidth}px`;pickerHost.style.right='auto';
    const height=element.getBoundingClientRect().height;
    if(height!==lastHeight){lastHeight=height;onHeightChange?.(height);}
  }
  function scheduleResize(){if(!resizeFrame && !destroyed)resizeFrame=view.requestAnimationFrame(resize);}
  function currentRange() {
    const selection=view.getSelection();
    if(!selection?.rangeCount)return null;
    const range=selection.getRangeAt(0);
    return editor.contains(range.commonAncestorContainer)?range:null;
  }
  function remember(){const range=currentRange();if(range)savedRange=range.cloneRange();}
  function endRange(){const range=doc.createRange();range.selectNodeContents(editor);range.collapse(false);return range;}
  function usableRange(){return savedRange && editor.contains(savedRange.commonAncestorContainer)?savedRange.cloneRange():endRange();}
  function setCaret(range,{focus=true}={}) {
    if(focus && !coarse())editor.focus({preventScroll:true});
    // Selection.addRange itself focuses a blurred contenteditable in Chromium.
    if(!coarse() || doc.activeElement===editor){
      const selection=view.getSelection();selection.removeAllRanges();selection.addRange(range);
    }
    savedRange=range.cloneRange();
  }
  function edit(command,value,range=usableRange()) {
    // Chromium focuses the editable target even when only Selection.addRange
    // or execCommand is used. A toolbar transaction suppresses its virtual
    // keyboard before either call, then returns to a blurred editor. Keep the
    // native editing transaction so existing undo history remains consistent.
    const manual=coarse() && doc.activeElement!==editor;
    const inputMode=editor.getAttribute('inputmode');
    const keyboardPolicy=editor.getAttribute('virtualkeyboardpolicy');
    if(manual){editor.setAttribute('inputmode','none');editor.setAttribute('virtualkeyboardpolicy','manual');}
    const previousRevision=revision;
    const previousHTML=editor.innerHTML;
    // Browser editing commands participate in the native contenteditable undo
    // stack. Direct Range DOM mutations leave older native history out of sync.
    let applied;
    try{
      if(manual){
        const selection=view.getSelection();selection.removeAllRanges();selection.addRange(range);
        savedRange=range.cloneRange();
      }else setCaret(range);
      applied=doc.execCommand(command,false,value);remember();
    }
    finally{
      if(manual){
        editor.blur();
        if(inputMode===null)editor.removeAttribute('inputmode');else editor.setAttribute('inputmode',inputMode);
        if(keyboardPolicy===null)editor.removeAttribute('virtualkeyboardpolicy');else editor.setAttribute('virtualkeyboardpolicy',keyboardPolicy);
      }
    }

    if(!applied && revision===previousRevision && editor.innerHTML===previousHTML){
      notify('이 브라우저에서 편집 작업을 적용하지 못했습니다.');return false;
    }
    remember();
    // Most browsers emit input synchronously for editing commands; preserve the
    // same public change event in browsers that do not emit that event.
    if(revision===previousRevision)changed({detect:false,emit:true});
    return true;
  }
  function insertText(text,range=usableRange()) {return edit('insertText',text,range);}
  function removeTag(tag) {
    if(!tag?.isConnected)return;
    const range=doc.createRange();range.selectNode(tag);closeMenu();edit('delete',undefined,range);
  }
  function closeMenu() {
    picker.hidden=true;picker.replaceChildren();menuType='';entries=[];triggerRange=null;selectedTag=null;
    editor.removeAttribute('aria-activedescendant');editor.setAttribute('aria-expanded','false');
    for(const node of [add,mention,canvas,commands])node.setAttribute('aria-expanded','false');
    scheduleResize();
  }
  function references(type) {
    const definitions=listSkills().filter(skill=>skill.id!=='start').map(skill=>({type:'skill',id:skill.id,label:skill.name,detail:skill.description,icon:skill.icon,color:skill.color,group:'기본 스킬'}));
    const blocks=(model?.getBlocks?.()||[]).map((block,index)=>{
      const skill=resolveSkill(block.skillId);
      return {type:'block',id:block.id,label:block.values?.name || `${skill?.name||'스킬블럭'} ${index+1}`,detail:'캔버스에 배치된 스킬블럭',icon:skill?.icon||'canvas',color:skill?.color,group:'스킬블럭'};
    });
    return type==='blocks'?blocks:[...definitions,...blocks];
  }
  function menuItems(type) {
    if(type==='tag')return [{action:'remove',label:'참조 삭제',detail:'선택한 참조만 제거합니다.',icon:'close'}];
    if(type==='add')return [
      {action:'file',label:'파일 추가',detail:'이 기기의 파일을 첨부합니다.',icon:'folder'},
      {action:'skills',label:'스킬 참조',detail:'사용할 스킬을 지정합니다.',icon:'mention'},
      {action:'blocks',label:'스킬블럭 참조',detail:'캔버스의 스킬블럭을 지정합니다.',icon:'canvas'}
    ];
    if(type==='commands')return [
      {action:'skills',label:'스킬 참조',detail:'사용할 스킬을 지정합니다.',icon:'mention',keywords:'skill @'},
      {action:'blocks',label:'스킬블럭 참조',detail:'캔버스의 스킬블럭을 지정합니다.',icon:'canvas',keywords:'canvas block'},
      {action:'file',label:'파일 추가',detail:'이 기기의 파일을 첨부합니다.',icon:'folder',keywords:'file attach'},
      {action:'newline',label:'줄바꿈',detail:'커서 위치에서 새 줄을 시작합니다.',icon:'enter',keywords:'newline'}
    ];
    return references(type);
  }
  function renderMenu() {
    picker.replaceChildren();
    if(!entries.length){const empty=doc.createElement('p');empty.className='ovll-rich-empty';empty.textContent=menuType==='blocks'?'캔버스에 스킬블럭을 추가해 주세요.':'검색 결과가 없습니다.';picker.append(empty);editor.removeAttribute('aria-activedescendant');return;}
    let group='';
    entries.forEach((entry,index)=>{
      if(menuType==='skills' && entry.group && entry.group!==group){group=entry.group;const heading=doc.createElement('div');heading.className='ovll-rich-group-title';heading.setAttribute('role','presentation');heading.textContent=group;picker.append(heading);}
      const option=doc.createElement('button');option.type='button';option.className=`ovll-rich-option${index===selectedIndex?' is-selected':''}`;
      option.id=`${prefix}-option-${index}`;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===selectedIndex));option.dataset.optionIndex=String(index);option.tabIndex=-1;
      const glyph=doc.createElement('span');glyph.className='ovll-rich-option-icon';glyph.innerHTML=icon(entry.icon);if(entry.color)glyph.style.color=entry.color;
      const label=doc.createElement('span');label.className='ovll-rich-option-label';
      const title=doc.createElement('strong');title.textContent=entry.label;const detail=doc.createElement('small');detail.textContent=entry.detail||'';
      label.append(title,detail);option.append(glyph,label);
      if(entry.group && menuType!=='skills'){const kind=doc.createElement('small');kind.className='ovll-rich-option-kind';kind.textContent=entry.group;option.append(kind);}
      picker.append(option);
    });
    editor.setAttribute('aria-activedescendant',`${prefix}-option-${selectedIndex}`);
    picker.querySelector('.is-selected')?.scrollIntoView({block:'nearest'});
  }
  function openMenu(type,query='',range=null) {
    if(!lifetime || lifetime.signal.aborted)return;
    remember();menuType=type;menuQuery=query;triggerRange=range?.cloneRange()||null;selectedIndex=0;
    const search=query.trim().toLocaleLowerCase();
    entries=menuItems(type).filter(entry=>!search||[entry.label,entry.detail,entry.id,entry.keywords].some(value=>String(value||'').toLocaleLowerCase().includes(search)));
    picker.hidden=false;editor.setAttribute('aria-expanded','true');
    for(const [node,kind] of [[add,'add'],[mention,'skills'],[canvas,'blocks'],[commands,'commands']])node.setAttribute('aria-expanded',String(type===kind));
    renderMenu();scheduleResize();
  }
  function detectTrigger() {
    if(composing)return;
    const range=currentRange();
    if(!range?.collapsed || range.startContainer.nodeType!==3){if(triggerRange)closeMenu();return;}
    const before=range.startContainer.data.slice(0,range.startOffset);
    const match=before.match(/(?:^|\s)([@/])([^\s@/]*)$/u);
    if(!match){if(triggerRange)closeMenu();return;}
    const trigger=range.cloneRange();trigger.setStart(range.startContainer,range.startOffset-match[2].length-1);
    openMenu(match[1]==='@'?'skills':'commands',match[2],trigger);
  }
  function choose(entry) {
    if(!entry)return;
    let range=(triggerRange||usableRange()).cloneRange();
    if(entry.action==='remove'){
      removeTag(selectedTag);return;
    }
    if(entry.action){
      if(triggerRange){edit('delete',undefined,range);range=usableRange();}
      closeMenu();
      if(['skills','blocks'].includes(entry.action)){changed({detect:false,emit:true});openMenu(entry.action);}
      else if(entry.action==='file'){changed({detect:false,emit:true});fileInput.click();}
      else if(entry.action==='newline')insertText('\n',range);
      return;
    }
    const tag=createTag(entry);closeMenu();
    // This HTML is serialized from our own DOM: labels/ids were assigned with
    // textContent/dataset and icons come only from trusted static SVG assets.
    if(edit('insertHTML',tag.outerHTML+' ',range)){
      const inserted=doc.getElementById(tag.id);
      if(inserted && editor.contains(inserted)){
        const caret=doc.createRange();
        const following=inserted.nextSibling;
        if(following?.nodeType===3 && following.data.startsWith(' '))caret.setStart(following,1);
        else caret.setStartAfter(inserted);
        caret.collapse(true);setCaret(caret);
      }
    }
  }
  function deleteAdjacent(event) {
    if(!['Backspace','Delete'].includes(event.key))return false;
    const range=currentRange();if(!range?.collapsed)return false;
    const backwards=event.key==='Backspace';let node=range.startContainer;const offset=range.startOffset;let candidate=null;
    if(node.nodeType===3){
      const text=backwards?node.data.slice(0,offset):node.data.slice(offset);
      if(text && text!==' ')return false;
      candidate=backwards?node.previousSibling:node.nextSibling;
    }else if(node===editor)candidate=editor.childNodes[backwards?offset-1:offset];
    while(candidate?.nodeType===3 && (!candidate.data || candidate.data===' '))candidate=backwards?candidate.previousSibling:candidate.nextSibling;
    if(!candidate?.dataset?.refKind)return false;
    event.preventDefault();
    const deletion=range.cloneRange();
    if(backwards)deletion.setStartBefore(candidate);else deletion.setEndAfter(candidate);
    closeMenu();edit('delete',undefined,deletion);return true;
  }
  async function submit(event) {
    event.preventDefault();if(composing||busy||pendingAttachments>0||!hasDraftContent(getDraft()))return;
    const draft=getDraft();const submittedRevision=revision;busy=true;update();closeMenu();
    try{
      const result=await onSubmit?.(draft);
      if(destroyed)return;
      if(result?.accepted===true){if(submittedRevision===revision){setDraft({});element.dispatchEvent(new Event('input',{bubbles:true}));}}
      else notify(result?.message||'서버에 연결되지 않아 요청을 보낼 수 없습니다. 입력한 내용은 보관됩니다.');
    }catch(error){if(!destroyed)notify(error?.message||'요청을 보내지 못했습니다. 입력한 내용은 보관됩니다.');}
    finally{busy=false;if(!destroyed)update();}
  }
  function onKeydown(event) {
    if(event.currentTarget===editor && event.target.closest('[data-ref-kind]'))return;
    if(event.isComposing||composing||event.keyCode===229)return;
    if(!picker.hidden){
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu();return;}
      if(['ArrowDown','ArrowUp'].includes(event.key)){
        event.preventDefault();event.stopPropagation();selectedIndex=(selectedIndex+(event.key==='ArrowDown'?1:-1)+entries.length)%Math.max(entries.length,1);renderMenu();return;
      }
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.stopPropagation();choose(entries[selectedIndex]);return;}
    }
    if(deleteAdjacent(event))return;
    if(event.key==='Enter'&&!event.shiftKey&&!coarse()){event.preventDefault();form.requestSubmit();}
    else if(event.key==='Enter'&&event.shiftKey){event.preventDefault();remember();insertText('\n');}
  }
  function onEditorClick(event) {
    const tag=event.target.closest('[data-ref-kind]');if(!tag)return;
    remember();openMenu('tag');selectedTag=tag;
  }
  function onElementKeydown(event) {
    const tag=event.target.closest('[data-ref-kind]');
    if(tag && !picker.hidden){onKeydown(event);return;}
    if(tag && ['Backspace','Delete'].includes(event.key)){event.preventDefault();removeTag(tag);return;}
    if(tag && ['Enter',' '].includes(event.key)){event.preventDefault();openMenu('tag');selectedTag=tag;return;}
    if(!picker.hidden && event.target!==editor && !editor.contains(event.target))onKeydown(event);
  }
  async function attachFiles(files) {
    if(!files.length || destroyed)return;
    let failure='';
    if(onAttach){
      pendingAttachments++;update();
      try{
        const result=await onAttach([...files]);
        if(destroyed || result?.handled===true)return;
      }catch(error){failure=error?.message||'파일 정보를 처리하지 못했습니다.';}
      finally{pendingAttachments--;if(!destroyed)update();}
    }
    if(destroyed)return;
    for(const file of files)attachments.push({id:view.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`,name:file.name,type:file.type,size:file.size,lastModified:file.lastModified,file});
    renderAttachments();changed({detect:false,emit:true});
    if(failure)notify(failure);
  }
  function activate({signal}={}) {
    if(destroyed)throw new Error('해제된 입력기를 활성화할 수 없습니다.');
    deactivate();if(signal?.aborted)return;
    lifetime=new AbortController();const options={signal:lifetime.signal};
    const listen=(target,type,handler)=>target.addEventListener(type,handler,options);
    listen(editor,'input',()=>changed());listen(editor,'compositionstart',()=>{composing=true;closeMenu();});
    listen(editor,'compositionend',()=>{composing=false;changed();});listen(editor,'keydown',onKeydown);
    listen(editor,'pointerdown',event=>{if(coarse() && event.target.closest('[data-ref-kind]')){remember();event.preventDefault();editor.blur();}});
    listen(editor,'keyup',remember);listen(editor,'mouseup',remember);listen(editor,'focus',scheduleResize);listen(editor,'blur',scheduleResize);listen(editor,'click',onEditorClick);
    listen(editor,'paste',event=>{const text=event.clipboardData?.getData('text/plain');if(typeof text!=='string')return;event.preventDefault();remember();closeMenu();insertText(text);});
    listen(editor,'dragover',event=>event.preventDefault());
    listen(editor,'drop',event=>{
      event.preventDefault();remember();closeMenu();
      const files=Array.from(event.dataTransfer?.files||[]);
      if(files.length){attachFiles(files);return;}
      const text=event.dataTransfer?.getData('text/plain');if(text)insertText(text);
    });
    listen(editor,'beforeinput',event=>{if(event.inputType?.startsWith('format'))event.preventDefault();});
    listen(element,'keydown',onElementKeydown);listen(form,'submit',submit);
    for(const [node,type] of [[add,'add'],[mention,'skills'],[canvas,'blocks'],[commands,'commands']]){
      listen(node,'pointerdown',event=>{openingToolbarMenu=true;remember();if(!coarse())event.preventDefault();});
      listen(node,'pointercancel',()=>{openingToolbarMenu=false;scheduleResize();});
      listen(node,'click',()=>{openingToolbarMenu=false;if(menuType===type){closeMenu();return;}if(coarse())editor.blur();else editor.focus({preventScroll:true});openMenu(type);});
    }
    listen(picker,'pointerdown',event=>event.preventDefault());
    listen(picker,'click',event=>{const option=event.target.closest('[data-option-index]');if(option)choose(entries[Number(option.dataset.optionIndex)]);});
    listen(doc,'pointerdown',event=>{if(!element.contains(event.target))closeMenu();});
    listen(doc,'keydown',event=>{if(event.key==='Escape'&&!event.isComposing&&!picker.hidden){event.preventDefault();closeMenu();}});
    listen(fileInput,'input',event=>event.stopPropagation());
    listen(fileInput,'change',()=>{attachFiles(Array.from(fileInput.files||[]));fileInput.value='';});
    listen(attachmentsView,'click',event=>{
      const control=event.target.closest('[data-attachment-action]');if(!control)return;
      const index=Number(control.dataset.attachmentIndex);
      if(control.dataset.attachmentAction==='remove'){attachments.splice(index,1);renderAttachments();changed({detect:false,emit:true});}
      else if(attachments[index]?.file){const url=URL.createObjectURL(attachments[index].file);const link=doc.createElement('a');link.href=url;link.download=attachments[index].name;link.click();view.setTimeout(()=>URL.revokeObjectURL(url),0);}
    });
    listen(view,'resize',scheduleResize);if(view.visualViewport){listen(view.visualViewport,'resize',scheduleResize);listen(view.visualViewport,'scroll',scheduleResize);}
    if(view.ResizeObserver){observer=new view.ResizeObserver(scheduleResize);observer.observe(form);}
    unsubscribe=model?.subscribe?.(()=>{if(['skills','blocks'].includes(menuType))openMenu(menuType,menuQuery,triggerRange);});
    if(signal){externalSignal=signal;externalAbort=()=>deactivate();signal.addEventListener('abort',externalAbort,{once:true});}
    scheduleResize();
  }
  function deactivate() {
    lifetime?.abort();lifetime=null;observer?.disconnect();observer=null;unsubscribe?.();unsubscribe=null;
    externalSignal?.removeEventListener('abort',externalAbort);externalSignal=null;externalAbort=null;
    if(resizeFrame)view.cancelAnimationFrame(resizeFrame);resizeFrame=0;
    composing=false;openingToolbarMenu=false;savedRange=null;closeMenu();
    for(const animation of layoutAnimations)animation.cancel();layoutAnimations=[];
    if(resizeFrame)view.cancelAnimationFrame(resizeFrame);resizeFrame=0;
  }
  function destroy(){if(destroyed)return;deactivate();destroyed=true;element.remove();attachments=[];}
  function refreshCatalog(){if(['skills','blocks'].includes(menuType))openMenu(menuType,menuQuery,triggerRange);}
  update();
  return {element,editor,getDraft,setDraft,refreshCatalog,focus(){if(!destroyed)editor.focus({preventScroll:true});},closeMenu,activate,deactivate,destroy};
}
