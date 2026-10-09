// vNext event replay contract. In-memory only; production requires durable ordered events.
export class WorkspaceEventLog {
  #groups = new Map(); #listeners = new Map();
  constructor({ capacity = 128 } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('INVALID_CAPACITY');
    this.capacity = capacity;
  }
  append(workspaceRef, payload) {
    if (!workspaceRef || typeof workspaceRef !== 'string') throw new Error('WORKSPACE_REQUIRED');
    const state = this.#groups.get(workspaceRef) || { next: 1, records: [] };
    const item = Object.freeze({ id: state.next++, workspaceRef, type: payload.type || 'action', time: new Date().toISOString(), data: { ...payload } });
    state.records.push(item);
    if (state.records.length > this.capacity) state.records.shift();
    this.#groups.set(workspaceRef, state);
    for (const fn of this.#listeners.get(workspaceRef) || []) fn(item);
    return item;
  }
  read(workspaceRef, after = 0) {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error('INVALID_CURSOR');
    const state = this.#groups.get(workspaceRef);
    if (!state) return { events: [], resetRequired: after > 0, latestId: 0 };
    const oldest = state.records[0]?.id || state.next;
    return { events: state.records.filter(event => event.id > after), resetRequired: after > 0 && after < oldest - 1, latestId: state.next - 1 };
  }
  subscribe(workspaceRef, listener) {
    if (typeof listener !== 'function') throw new Error('INVALID_LISTENER');
    const listeners = this.#listeners.get(workspaceRef) || new Set();
    listeners.add(listener); this.#listeners.set(workspaceRef, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.#listeners.delete(workspaceRef); };
  }
}
export function sseFrame(event) {
  return 'id: ' + event.id + '\nevent: ' + (event.type || 'state') + '\ndata: ' + JSON.stringify(event) + '\n\n';
}
