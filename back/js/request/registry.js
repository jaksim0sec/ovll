/** Volatile request lifecycle; storage and transport are deliberately separate. */
export function createRequestRegistry({createId = () => crypto.randomUUID()} = {}) {
  if (typeof createId !== 'function') throw new TypeError('createId is required');
  const records = new Map();
  const clone = value => structuredClone(value);
  const key = (roomId, requestId) => JSON.stringify([roomId, requestId]);
  const states = {queued: new Set(['running']), running: new Set(['completed', 'awaiting_input', 'unsupported_workshop', 'failed']), awaiting_input: new Set(['running'])};
  function register({roomId, request, contextData, initialResources=[]} = {}) {
    if (typeof roomId !== 'string' || !roomId || !request || !Array.isArray(request.parts) || !Array.isArray(request.attachments) || !Array.isArray(initialResources))
      throw new TypeError('Invalid request registration');
    const requestId = createId();
    if (typeof requestId !== 'string' || !requestId || records.has(key(roomId, requestId))) throw new Error('duplicate or invalid request ID');
    const record = clone({roomId, requestId, request, contextData, initialResources,
      status:'queued', currentLayer:'gate', contextBlock:{intent:'',progress:''}});
    records.set(key(roomId, requestId), record);
    return clone(record);
  }
  function get(roomId, requestId) { const record=records.get(key(roomId,requestId)); return record ? clone(record) : null; }
  function transition(roomId, requestId, changes) {
    const k=key(roomId,requestId), current=records.get(k);
    if (!current) throw new Error('Unknown request');
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Invalid transition');
    const allowed=new Set(['status','currentLayer','contextBlock','contextData','result','plan','error','waiting','verifiedResults']);
    if (Object.keys(changes).some(name=>!allowed.has(name))) throw new TypeError('Unknown request field');
    if ('status' in changes && !states[current.status]?.has(changes.status)) throw new Error('Invalid request status transition');
    const next=clone({...current,...changes});
    records.set(k,next);
    return clone(next);
  }
  return Object.freeze({register,get,transition});
}
