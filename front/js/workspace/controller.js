import { createWorkspaceModel } from './model.js';
import { createCanvas } from '../canvas/controller.js';
import { createComposer } from '../composer/controller.js';
import { skills, getSkill } from '../skill/catalog.js';
import { createWorkspaceDataAccess } from './dataAccess.js';
import { createChat } from './chat.js';

const ROOM = 'beta-local-workspace';

/** A single local Workspace. Owns graph/draft persistence and component composition.
 * SERVER INTEGRATION: room selection and validated remote snapshots enter here.
 * No main store, request protocol, offline queue or inferred AI result is used.
 */
export async function createWorkspace({ root, data, input, skillCatalog, onSubmitRequest, onRunBlock } = {}) {
  const resolveSkill = skillCatalog?.get ?? getSkill;
  const listSkills = skillCatalog?.list ?? (() => skills);
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
  const chatView = createChat({onOpenCanvas:()=>presentation?.goTo('canvas')});
  const chat = chatView.element;
  const saveState = chatView.saveState;
  let queued = Promise.resolve(), pending = 0, destroyed = false;
  const failedDomains = new Set();
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
  const restored = await Promise.allSettled([
    data.cache.read('canvasState', ROOM, 'state'),
    data.cache.read('chatDraft', ROOM, 'state'),
    data.local.read('canvasViewport', ROOM)
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
  let preserveStoredGraph = restored[0].status === 'rejected';
  try { model = createWorkspaceModel({ snapshot: storedGraph || undefined, resolveSkill }); }
  catch (error) {
    model = createWorkspaceModel({ resolveSkill }); preserveStoredGraph = true; failedDomains.add('canvas');
    announce('저장된 캔버스를 복원하지 못했습니다. 새로고침 후 다시 확인해 주세요.', { persistent: true });
    console.error('Workspace graph restore failed', error);
  }
  if (!storedGraph && !loadFailed) {
    save('canvas', () => data.cache.write('canvasState', ROOM, 'state', model.getSnapshot(), { source: 'provisional' }));
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
  const dataAccess = createWorkspaceDataAccess({roomId:ROOM,model,canvas,composer,data,listSkills});
  // Validated local graph operations for callers outside Canvas. Not a server
  // action-plan format, execution IR, authorization check or sync protocol.
  const canvasCommands = Object.freeze({
    addBlock(skillId, options) {
      canvas.flushPendingEdits();
      return model.addBlock(skillId, options);
    },
    updateBlock(blockId, patch) {
      canvas.flushPendingEdits();
      return model.updateBlock(blockId, patch);
    },
    deleteBlock(blockId) {
      canvas.flushPendingEdits();
      return model.deleteBlock(blockId);
    },
    connect(from, to) {
      canvas.flushPendingEdits();
      return model.connect(from, to);
    },
    disconnect(linkId) {
      canvas.flushPendingEdits();
      return model.disconnect(linkId);
    }
  });
  composer.element.classList.add('workspace-composer');
  if (storedDraft) composer.setDraft(storedDraft);
  if (storedViewport) canvas.setViewport(storedViewport);
  let hasViewport = Boolean(storedViewport);
  const unsubscribe = model.subscribe(({ snapshot }) => {
    if (!preserveStoredGraph) save('canvas', () => data.cache.write('canvasState', ROOM, 'state', snapshot, { source: 'provisional' }));
    else announce('저장된 캔버스 보호를 위해 현재 변경은 저장하지 않습니다. 새로고침 후 다시 확인해 주세요.', { persistent: true });
  });
  composer.element.addEventListener('input', () => {
    const draft = composer.getDraft();
    save('draft', () => data.cache.write('chatDraft', ROOM, 'state', draft, { source: 'provisional' }));
  }, { signal: lifetime.signal });
  canvas.element.addEventListener('canvasviewportchange', event => {
    hasViewport = true;
    const viewport = { ...event.detail };
    save('viewport', () => data.local.write('canvasViewport', ROOM, viewport));
  }, { signal: lifetime.signal });
  saveState.textContent = pending ? '저장 중' : failedDomains.size ? '저장 내용을 확인해 주세요' : '이 기기에 임시 저장됨';
  const resize = new ResizeObserver(() => {
    composerHeight(composer.element.getBoundingClientRect().height);
  });
  resize.observe(composer.element);
  return {
    getDataAccess: () => dataAccess,
    getCanvasCommands: () => canvasCommands,
    setConfirmedChatRecords(value){chatView.setConfirmedRecords(value);},
    setRequestActivities(value){chatView.setRequestActivities(value);},
    refreshSkillCatalog(){model.validateCurrent();canvas.refreshCatalog();composer.refreshCatalog();},
    getPresentation: () => ({
      root, layout: 'immersive', pill: { visible: true },
      slides: [{ id: 'chat', label: '채팅', element: chat, allowContentSwipe: true }, { id: 'canvas', label: '캔버스', element: canvas.element, allowContentSwipe: false }],
      stationary: [{ id: 'composer', slot: 'bottom', element: composer.element }, { id: 'workspace-feedback', slot: 'overlay', element: feedback }]
    }),
    activate({ signal, controller }) {
      presentation = controller;
      // A graph restored without a local camera can be framed without rewriting its blocks.
      if (!hasViewport && model.getBlocks().length) {
        const frame = root.getBoundingClientRect();
        canvas.setViewport({ x: Math.max(60, frame.width / 2 - 100), y: Math.max(115, frame.height / 2 - 70), zoom: 1 });
      }
      canvas.activate({ signal }); composer.activate({ signal });
    },
    closeTransientUI() { composer.closeMenu(); canvas.closeMenu?.(); },
    deactivate() { composer.deactivate(); canvas.deactivate(); presentation = null; },
    flush: () => queued,
    destroy() {
      if (destroyed) return;
      composer.deactivate(); canvas.deactivate();
      destroyed = true; clearTimeout(noticeTimer); lifetime.abort(); resize.disconnect(); unsubscribe();
      composer.destroy(); canvas.destroy(); chatView.destroy(); presentation = null;
    }
  };
}
