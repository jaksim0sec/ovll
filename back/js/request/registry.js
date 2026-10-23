/** Volatile request lifecycle; storage and transport are deliberately separate. */
export function createRequestRegistry({createId = () => crypto.randomUUID()} = {}) {
  if (typeof createId !== 'function') throw new TypeError('createId is required');
  const records = new Map();
  const clone = value => structuredClone(value);
  const key = (roomId, requestId) => JSON.stringify([roomId, requestId]);
  const states = {queued: new Set(['running','stopped']), running: new Set(['completed', 'awaiting_input', 'unsupported_workshop', 'failed','stopping']), stopping: new Set(['stopped']), awaiting_input: new Set(['running']), failed: new Set(['running'])};
  function register({roomId, request, contextData, initialResources=[]} = {}) {
    if (typeof roomId !== 'string' || !roomId || !request || !Array.isArray(request.parts) || !Array.isArray(request.attachments) || !Array.isArray(initialResources))
      throw new TypeError('Invalid request registration');
    const requestId = createId();
    if (typeof requestId !== 'string' || !requestId || records.has(key(roomId, requestId))) throw new Error('duplicate or invalid request ID');
    const record = clone({roomId, requestId, request, contextData, initialResources,
      status:'queued', currentLayer:'gate', contextBlock:{intent:'',progress:''},revision:0});
    records.set(key(roomId, requestId), record);
    return clone(record);
  }
  function get(roomId, requestId) { const record=records.get(key(roomId,requestId)); return record ? clone(record) : null; }
  function transition(roomId, requestId, changes, {expectedRevision} = {}) {
    const k=key(roomId,requestId), current=records.get(k);
    if (!current) throw new Error('Unknown request');
    if(expectedRevision!==undefined&&current.revision!==expectedRevision)throw Object.assign(new Error('Stale request revision'),{code:'CHECKPOINT_CONFLICT'});
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new TypeError('Invalid transition');
    const allowed=new Set(['status','currentLayer','contextBlock','contextData','result','plan','planCursor','activeCallId','pendingOperation','error','waiting','verifiedResults','handoff']);
    if (Object.keys(changes).some(name=>!allowed.has(name))) throw new TypeError('Unknown request field');
    if ('status' in changes && !states[current.status]?.has(changes.status)) throw new Error('Invalid request status transition');
    const next=clone({...current,...changes,revision:current.revision+1});
    records.set(k,next);
    return clone(next);
  }
  return Object.freeze({register,get,transition});
}
