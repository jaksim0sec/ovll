import { getSkill } from '../skill/catalog.js';

/** Editable local graph only. A future server adapter must explicitly validate its own contract. */
export function createWorkspaceModel({ snapshot } = {}) {
  const clone = value => structuredClone(value);
  const listeners = new Set();
  let state = { version: 1, blocks: [], links: [] };
  const past = [], future = [];
  const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
  const requireBlock = (source, key) => {
    const block = source.blocks.find(b => b.id === key);
    if (!block) throw new Error('스킬블럭을 찾을 수 없습니다');
    return block;
  };
  function checkBlock(block) {
    if (!block || typeof block.id !== 'string' || !block.id || !getSkill(block.skillId)) throw new Error('스킬블럭의 스킬 또는 ID가 올바르지 않습니다');
    if (!Number.isFinite(block.x) || !Number.isFinite(block.y)) throw new Error('스킬블럭 좌표가 올바르지 않습니다');
    if (typeof block.expanded !== 'boolean' || !block.values || typeof block.values !== 'object' || Array.isArray(block.values)) throw new Error('스킬블럭 설정이 올바르지 않습니다');
    const fields = getSkill(block.skillId).fields;
    for (const [key, value] of Object.entries(block.values)) {
      const field = fields.find(f => f.id === key);
      if (!field || typeof value !== 'string' || value.length > field.maxLength) throw new Error('스킬블럭 입력값이 올바르지 않습니다');
    }
    if (block.file && (typeof block.file.name !== 'string' || typeof block.file.type !== 'string' || !Number.isFinite(block.file.size) || block.file.size < 0 || (block.file.text !== undefined && typeof block.file.text !== 'string'))) throw new Error('파일 정보가 올바르지 않습니다');
  }
  function checkLink(source, from, to) {
    if (!from || !to) throw new Error('연결 포트가 필요합니다');
    const a = requireBlock(source, from.blockId), b = requireBlock(source, to.blockId);
    const output = getSkill(a.skillId).outputs.find(p => p.id === from.portId);
    const input = getSkill(b.skillId).inputs.find(p => p.id === to.portId);
    if (!output || !input) throw new Error('출력 포트와 입력 포트를 연결해 주세요');
    if (a.id === b.id) throw new Error('같은 스킬블럭으로 연결할 수 없습니다');
    if (source.links.some(l => l.from.blockId === a.id && l.from.portId === from.portId && l.to.blockId === b.id && l.to.portId === to.portId)) throw new Error('이미 연결된 포트입니다');
    if (!input.multiple && source.links.some(l => l.to.blockId === b.id && l.to.portId === to.portId)) throw new Error('이미 사용 중인 입력 포트입니다');
    if (input.type !== 'any' && output.type !== 'any' && input.type !== output.type) throw new Error('호환되지 않는 포트입니다');
    const seen = new Set(), pending = [b.id];
    while (pending.length) {
      const current = pending.pop();
      if (current === a.id) throw new Error('순환 연결은 지원하지 않습니다');
      if (seen.has(current)) continue;
      seen.add(current);
      for (const link of source.links) if (link.from.blockId === current) pending.push(link.to.blockId);
    }
  }
  function validate(value) {
    if (value?.version !== 1 || !Array.isArray(value.blocks) || !Array.isArray(value.links)) throw new Error('캔버스 저장 형식이 올바르지 않습니다');
    const next = clone(value), ids = new Set();
    for (const block of next.blocks) { checkBlock(block); if (ids.has(block.id)) throw new Error('중복된 스킬블럭 ID입니다'); ids.add(block.id); }
    const accumulated = { blocks: next.blocks, links: [] }, linkIds = new Set();
    for (const link of next.links) {
      if (typeof link.id !== 'string' || !link.id || linkIds.has(link.id)) throw new Error('연결 ID가 올바르지 않습니다');
      checkLink(accumulated, link.from, link.to); accumulated.links.push(link); linkIds.add(link.id);
    }
    return { version: 1, blocks: next.blocks, links: next.links };
  }
  function emit(type) { for (const listener of listeners) listener({ type, snapshot: clone(state) }); }
  function commit(type, action, { force = false } = {}) {
    const next = clone(state), result = action(next);
    if (!force && JSON.stringify(next) === JSON.stringify(state)) return clone(result);
    past.push(state); if (past.length > 80) past.shift(); future.length = 0;
    state = next; emit(type); return clone(result);
  }
  const api = {
    getSnapshot: () => clone(state),
    getBlocks: () => clone(state.blocks),
    getBlock: key => clone(state.blocks.find(b => b.id === key) || null),
    addBlock(skillId, { x = 0, y = 0, values = {}, expanded = false, file } = {}) {
      const skill = getSkill(skillId); if (!skill) throw new Error('정의된 스킬을 찾을 수 없습니다');
      const block = { id: id('block'), skillId, x, y, expanded, values: { ...Object.fromEntries(skill.fields.map(f => [f.id, f.default || ''])), ...values } };
      if (file !== undefined) block.file = clone(file);
      checkBlock(block); return commit('add-block', next => { next.blocks.push(block); return block; });
    },
    updateBlock(key, patch) {
      return commit('update-block', next => {
        const block = requireBlock(next, key);
        for (const k of ['x', 'y', 'expanded', 'file']) if (Object.hasOwn(patch, k)) { if (k === 'file' && patch[k] == null) delete block.file; else block[k] = clone(patch[k]); }
        if (patch.values) block.values = { ...block.values, ...clone(patch.values) };
        checkBlock(block); return block;
      }, { force: Object.hasOwn(patch, 'file') });
    },
    deleteBlock(key) { return commit('delete-block', next => { requireBlock(next, key); next.blocks = next.blocks.filter(b => b.id !== key); next.links = next.links.filter(l => l.from.blockId !== key && l.to.blockId !== key); }); },
    connect(from, to) { checkLink(state, from, to); return commit('connect', next => { const link = { id: id('link'), from: clone(from), to: clone(to) }; next.links.push(link); return link; }); },
    disconnect(key) { return commit('disconnect', next => { next.links = next.links.filter(l => l.id !== key); }); },
    clear() { return commit('clear', next => { next.blocks = []; next.links = []; }); },
    arrange() {
      return commit('arrange', next => {
        const ranks = new Map(next.blocks.map(b => [b.id, 0]));
        // Validated graphs are acyclic; relaxation terminates within block count.
        for (let i = 0; i < next.blocks.length; i++) for (const l of next.links) ranks.set(l.to.blockId, Math.max(ranks.get(l.to.blockId), ranks.get(l.from.blockId) + 1));
        const rows = new Map();
        for (const b of next.blocks) { const rank = ranks.get(b.id), row = rows.get(rank) || 0; b.x = rank * 340; b.y = row * 330; rows.set(rank, row + 1); }
      });
    },
    replace(value) { const next = validate(value); state = next; past.length = 0; future.length = 0; emit('replace'); },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    undo() { if (!past.length) return false; future.push(state); state = past.pop(); emit('undo'); return true; },
    redo() { if (!future.length) return false; past.push(state); state = future.pop(); emit('redo'); return true; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
  if (snapshot) state = validate(snapshot);
  return api;
}
