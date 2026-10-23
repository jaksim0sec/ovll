import { createWorkspaceModel } from './model.js';
import { createCanvas } from '../canvas/controller.js';
import { createComposer } from '../composer/controller.js';
import { isRestorableDraft } from '../composer/draft.js';
import { skills, getSkill } from '../skill/catalog.js';
import { createWorkspaceDataAccess } from './dataAccess.js';
import { createChat } from './chat.js';
import { createMascot } from '../mascot/actor.js';
import { createCanvasMascotScene } from '../mascot/canvasScene.js';

/** Allow the UI to finish booting if an IndexedDB operation never settles.
 * Rejected restore slots retain existing overwrite-protection rules.
 */
export async function settleInitialWorkspaceReads(reads,{timeoutMs=8000}={}){
  if(!Array.isArray(reads)||!Number.isInteger(timeoutMs)||timeoutMs<1)throw new TypeError('Invalid workspace restoration');
  let timer;
  try{
    return await Promise.race([
      Promise.allSettled(reads),
      new Promise(resolve=>{
        timer=setTimeout(()=>resolve(reads.map(()=>({status:'rejected',reason:new Error('Workspace storage restore timed out')}))),timeoutMs);
      })
    ]);
  }finally{clearTimeout(timer);}
}


const DEFAULT_ROOM = 'beta-local-workspace';

/** A single local Workspace. Owns graph/draft persistence and component composition.
 * SERVER INTEGRATION: room selection and validated remote snapshots enter here.
 * No main store, request protocol, offline queue or inferred AI result is used.
 */
export async function createWorkspace({ root, data, input, roomId = DEFAULT_ROOM, skillCatalog, onSubmitRequest, onRunBlock, onAnswerRequest, onRetryOutput } = {}) {
  if (typeof roomId !== 'string' || !roomId.trim()) throw new TypeError('Workspace roomId is required');
  if (!root || !input || !data?.cache?.read || !data?.cache?.write || !data?.local?.read || !data?.local?.write)
    throw new TypeError('Workspace requires root, input and a local data store');
  if (skillCatalog !== undefined && (!skillCatalog || typeof skillCatalog.get !== 'function' || typeof skillCatalog.list !== 'function'))
    throw new TypeError('Skill catalog must provide get(id) and list()');
  // Keep the provider as method receiver; providers may use their own state.
  const serverSkills=new Map();
  const resolveSkill = id => serverSkills.get(id)||(skillCatalog?.get ? skillCatalog.get(id) : getSkill(id));
  const listSkills = () => {const local=skillCatalog?.list ? skillCatalog.list() : skills;return [...local.filter(s=>!serverSkills.has(s.id)),...serverSkills.values()];};
  if(typeof resolveSkill!=='function'||typeof listSkills!=='function')throw new TypeError('Invalid Skill catalog provider');
  if((onSubmitRequest !== undefined && typeof onSubmitRequest !== 'function') ||
     (onRunBlock !== undefined && typeof onRunBlock !== 'function')) throw new TypeError('Invalid Workspace request callbacks');
  const lifetime = new AbortController();
  const feedback = document.createElement('div');
  feedback.className = 'workspace-feedback';
  const notice = document.createElement('p');
  notice.className = 'workspace-notice'; notice.role = 'status'; notice.hidden = true;
  feedback.append(notice);
  let noticeTimer = null;
  function announce(message, { persistent = false } = {}) {
    clearTimeout(noticeTimer); notice.textContent = message; notice.hidden = !message;
    if (!persistent) noticeTimer = setTimeout(() => { notice.hidden = true; }, 6000);
  }

  let presentation = null;
  const chatView = createChat({onOpenCanvas:()=>presentation?.goTo('canvas'),onAnswer:({requestId,waitingId,text})=>onAnswerRequest?.({roomId,requestId,waitingId,text}),onRetryOutput:({requestId})=>onRetryOutput?.({roomId,requestId})});
  const chat = chatView.element;
  const saveState = chatView.saveState;
  let queued = Promise.resolve(), pending = 0, destroyed = false;
  const failedDomains = new Set();
  function ensureAlive() { if (destroyed) throw new Error('Workspace has been destroyed'); }
  function save(domain, operation) {
    if (destroyed) return;
    pending++; saveState.textContent = '저장 중';
    queued = queued.then(operation).then(result => {
      if(result?.written === false) throw new Error(`Workspace ${domain} save skipped: ${result.reason}`);
      failedDomains.delete(domain);
    }).catch(error => {
      failedDomains.add(domain);
      console.error('Workspace local save failed', error);
      announce('이 기기에 저장하지 못했습니다. 새로고침 전에 내용을 보관해 주세요.', { persistent: true });
    }).finally(() => {
      pending--;
      saveState.textContent = pending ? '저장 중' : failedDomains.size ? '저장되지 않음' : '이 기기에 임시 저장됨';
    });
  }
  let storedGraph = null, storedDraft = null, storedViewport = null;
  const restored = await settleInitialWorkspaceReads([
    data.cache.read('canvasState', roomId, 'state'),
    data.cache.read('chatDraft', roomId, 'state'),
    data.local.read('canvasViewport', roomId)
  ]);
  if (restored[0].status === 'fulfilled') storedGraph = restored[0].value?.value;
  if (restored[1].status === 'fulfilled') storedDraft = restored[1].value?.value;
  if (restored[2].status === 'fulfilled') storedViewport = restored[2].value;
  const loadFailed = restored.some(r => r.status === 'rejected');
  if (loadFailed) {
    restored.forEach((result, index) => { if (result.status === 'rejected') failedDomains.add(['canvas', 'draft', 'viewport'][index]); });
    announce('이 기기의 저장 내용을 불러오지 못했습니다. 새로 입력한 내용도 저장 여부를 확인해 주세요.', { persistent: true });
  }
  let model;
  // A corrupt stored graph is left intact. Do not silently overwrite user work.
  // A cache record with a missing/null payload is damaged, not a new empty room.
  let preserveStoredGraph = restored[0].status === 'rejected' ||
    (restored[0].status === 'fulfilled' && restored[0].value != null && !storedGraph);
  if(preserveStoredGraph){
    failedDomains.add('canvas');
    announce('저장된 캔버스를 안전하게 확인할 수 없어 기존 내용을 보존합니다.', {persistent:true});
  }
  try { model = createWorkspaceModel({ snapshot: storedGraph || undefined, resolveSkill }); }
  catch (error) {
    model = createWorkspaceModel({ resolveSkill }); preserveStoredGraph = true; failedDomains.add('canvas');
    announce('저장된 캔버스를 복원하지 못했습니다. 새로고침 후 다시 확인해 주세요.', { persistent: true });
    console.error('Workspace graph restore failed', error);
  }
  if (!storedGraph && !loadFailed && !preserveStoredGraph) {
    save('canvas', () => data.cache.write('canvasState', roomId, 'state', model.getSnapshot(), { source: 'provisional' }));
  }
  const runUnavailable = () => {
    // SERVER INTEGRATION: connect a validated request/execution adapter here.
    // A request acceptance must never be fabricated from a local button click.
    return { accepted: false, message: '아직 서버에 연결되지 않았습니다. 입력과 캔버스는 유지됩니다.' };
  };
  const canvas = createCanvas({
    model, input, resolveSkill, listSkills,
    onRun: onRunBlock ?? runUnavailable,
    onAttach: async (file, { blockId, metadata }) => {
      // Preserve the actual local file for future reads; metadata alone is not a file.
      return { ...metadata, blob: file };
    }
  });
  // Each scene actor has its own feature flags, motion and lifecycle.
  // Both live under the world DOM so normal Canvas gestures transform them.
  const mascotScene=createCanvasMascotScene(canvas);
  const mascots=[
    createMascot({host:mascotScene.host,scene:mascotScene,id:'ovll-guide',
      position:{x:26,y:26},size:36,
      capabilities:{mouseReaction:true,movement:true,nodeInteraction:true,drag:true}}),
    createMascot({host:mascotScene.host,scene:mascotScene,id:'ovll-companion',
      position:{x:276,y:80},size:29,color:'#303137',
      capabilities:{mouseReaction:true,movement:true,nodeInteraction:false,drag:true}})
  ];
  function composerHeight(height) {
    const value = `calc(${height}px + var(--workspace-composer-clearance))`;
    chat.style.setProperty('--workspace-composer-height', value);
    canvas.element.style.setProperty('--workspace-composer-height', value);
  }
  const composer = createComposer({
    model, resolveSkill, listSkills, onSubmit: onSubmitRequest ?? runUnavailable, onHeightChange: composerHeight,
    onAttach: async files => {
      for (const file of files) {
        const block = await canvas.addFile(file);
        if (!block) throw new Error('파일을 캔버스에 추가하지 못했습니다.');
      }
      presentation?.goTo('canvas');
      return { handled: true };
    }
  });
  const dataAccess = createWorkspaceDataAccess({roomId,model,canvas,composer,data,listSkills,isAlive:()=>!destroyed});
  // Validated local graph operations for callers outside Canvas. Not a server
  // action-plan format, execution IR, authorization check or sync protocol.
  let lastServerProjection=null;
  const canvasCommands = Object.freeze({
    addBlock(skillId, options) {
      ensureAlive();
      canvas.flushPendingEdits();
      return model.addBlock(skillId, options);
    },
    updateBlock(blockId, patch) {
      ensureAlive();
      canvas.flushPendingEdits();
      return model.updateBlock(blockId, patch);
    },
    deleteBlock(blockId) {
      ensureAlive();
      canvas.flushPendingEdits();
      return model.deleteBlock(blockId);
    },
    connect(from, to) {
      ensureAlive();
      canvas.flushPendingEdits();
      return model.connect(from, to);
    },
    disconnect(linkId) {
      ensureAlive();
      canvas.flushPendingEdits();
      return model.disconnect(linkId);
    }
  });
  composer.element.classList.add('workspace-composer');
  // A malformed stored draft must not be quietly normalized to an empty draft
  // and overwritten by the next keystroke.
  let preserveStoredDraft = restored[1].status === 'rejected';
  if(restored[1].status === 'fulfilled' && restored[1].value != null){
    if(!isRestorableDraft(storedDraft)){
      preserveStoredDraft = true;
      failedDomains.add('draft');
      announce('저장된 입력 초안을 복원하지 못해 원본을 보호합니다.', {persistent:true});
    }else{
      try{composer.setDraft(storedDraft);}
      catch(error){
        preserveStoredDraft = true;
        failedDomains.add('draft');
        announce('저장된 입력 초안을 복원하지 못해 원본을 보호합니다.', {persistent:true});
        console.error('Workspace draft restore failed',error);
      }
    }
  }
  if (storedViewport) canvas.setViewport(storedViewport);
  let hasViewport = Boolean(storedViewport);
  const unsubscribe = model.subscribe(({ snapshot }) => {
    if (!preserveStoredGraph) save('canvas', () => data.cache.write('canvasState', roomId, 'state', snapshot, { source: 'provisional' }));
    else announce('저장된 캔버스 보호를 위해 현재 변경은 저장하지 않습니다. 새로고침 후 다시 확인해 주세요.', { persistent: true });
  });
  composer.element.addEventListener('input', () => {
    if(preserveStoredDraft){
      announce('저장된 초안을 보호하기 위해 현재 입력은 저장하지 않습니다.', {persistent:true});
      return;
    }
    const draft = composer.getDraft();
    save('draft', () => data.cache.write('chatDraft', roomId, 'state', draft, { source: 'provisional' }));
  }, { signal: lifetime.signal });
  canvas.element.addEventListener('canvasviewportchange', event => {
    hasViewport = true;
    const viewport = { ...event.detail };
    save('viewport', () => data.local.write('canvasViewport', roomId, viewport));
  }, { signal: lifetime.signal });
  saveState.textContent = pending ? '저장 중' : failedDomains.size ? '저장 내용을 확인해 주세요' : '이 기기에 임시 저장됨';
  const resize = new ResizeObserver(() => {
    composerHeight(composer.element.getBoundingClientRect().height);
  });
  resize.observe(composer.element);
  return {
    getRoomId(){ensureAlive();return roomId;},
    getDataAccess(){ensureAlive();return dataAccess;},
    getCanvasCommands(){ensureAlive();return canvasCommands;},
    setConfirmedChatRecords(value){ensureAlive();chatView.setConfirmedRecords(value);},
    setRequestActivities(value){ensureAlive();chatView.setRequestActivities(value);},
    applyServerAssets(snapshot){
      ensureAlive();
      if(!snapshot||!Array.isArray(snapshot.skills)||!Array.isArray(snapshot.blocks)||!Array.isArray(snapshot.links)||!Number.isSafeInteger(snapshot.revision))throw new TypeError('Invalid confirmed assets');
      serverSkills.clear();
      for(const skill of snapshot.skills)if(typeof skill?.id==='string'&&Array.isArray(skill.fields))serverSkills.set(skill.id,structuredClone(skill));
      canvas.refreshCatalog();composer.refreshCatalog();
      const local=model.getSnapshot();
      const updated={version:1,blocks:snapshot.blocks,links:snapshot.links};
      if(JSON.stringify(local)===JSON.stringify(updated)){lastServerProjection=structuredClone(updated);return;}
      const empty=local.blocks.length===0&&local.links.length===0;
      const last=lastServerProjection;
      if(!empty&&JSON.stringify(local)!==JSON.stringify(last)){
        if(snapshot.blocks.length)announce('서버에 확정된 캔버스가 있지만 이 기기의 로컬 작업과 충돌해 덮어쓰지 않았습니다.',{persistent:true});
        return;
      }
      try{model.replaceConfirmedSnapshot(updated);lastServerProjection=structuredClone(updated);}
      catch(error){announce('서버 변경을 캔버스에 표시하지 못했습니다. 로컬 작업은 보존합니다.',{persistent:true});console.warn('Server projection conflict',error);}
    },
    refreshSkillCatalog(){ensureAlive();model.validateCurrent();canvas.refreshCatalog();composer.refreshCatalog();},
    getPresentation() {ensureAlive();return {
      root, layout: 'immersive', pill: { visible: true },
      slides: [{ id: 'chat', label: '채팅', element: chat, allowContentSwipe: true }, { id: 'canvas', label: '캔버스', element: canvas.element, allowContentSwipe: false }],
      stationary: [{ id: 'composer', slot: 'bottom', element: composer.element }, { id: 'workspace-feedback', slot: 'overlay', element: feedback }]
    };},
    activate({ signal, controller }) {
      ensureAlive();
      presentation = controller;
      // A graph restored without a local camera can be framed without rewriting its blocks.
      if (!hasViewport && model.getBlocks().length) {
        const frame = root.getBoundingClientRect();
        canvas.setViewport({ x: Math.max(60, frame.width / 2 - 100), y: Math.max(115, frame.height / 2 - 70), zoom: 1 });
      }
      canvas.activate({ signal }); mascots.forEach(actor=>actor.activate()); composer.activate({ signal });
    },
    closeTransientUI() { if(destroyed)return; composer.closeMenu(); canvas.closeMenu?.(); },
    deactivate() { if(destroyed)return; mascots.forEach(actor=>actor.deactivate()); composer.deactivate(); canvas.deactivate(); presentation = null; },
    flush: () => queued,
    destroy() {
      if (destroyed) return;
      mascots.forEach(actor=>actor.destroy()); composer.deactivate(); canvas.deactivate();
      destroyed = true; clearTimeout(noticeTimer); lifetime.abort(); resize.disconnect(); unsubscribe();
      composer.destroy(); canvas.destroy(); chatView.destroy(); presentation = null;
    }
  };
}
