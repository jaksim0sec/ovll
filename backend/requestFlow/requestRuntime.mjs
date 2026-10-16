// 1014 request-flow core. Provider, persistence, execution and transport are injected.
// The model plans WORKROOM OBJECTIVES, never their internal actions.
const WORKROOMS = new Set(['skillDefine', 'skillEdit', 'canvasEdit', 'textGenerate']);
const ENDED = new Set(['completed', 'stopped', 'failed']);
const has = (v, key) => Object.prototype.hasOwnProperty.call(v, key);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = v => structuredClone(v);

function exactShape(value, fields, name) {
  if (!object(value) || Object.keys(value).sort().join('|') !== fields.slice().sort().join('|') ||
      fields.some(field => typeof value[field] !== 'string')) throw new Error(`Invalid ${name}`);
  return copy(value);
}
const contextBlock = v => exactShape(v, ['intent', 'progress'], 'contextBlock');
const contextData = v => exactShape(v, ['overallFlow', 'currentTopic', 'details'], 'contextData');

function validateNeed(need) {
  if (!Array.isArray(need)) throw new Error('Invalid need');
  for (const entry of need) {
    if (!Array.isArray(entry) || !entry.length) throw new Error('Invalid need entry');
    const [type, arg] = entry;
    if (type === 'skillList' && entry.length === 1) continue;
    if ((type === 'originalReq' || type === 'chatContext') && entry.length === 2 && Number.isSafeInteger(arg) && arg >= 0) continue;
    if ((type === 'skillDef' || type === 'canvasSkill') && entry.length === 2 && Array.isArray(arg) && arg.every(s => typeof s === 'string' && s.length)) continue;
    throw new Error(`Unsupported need: ${type}`);
  }
  return copy(need);
}

function validatePlan(plan) {
  if (!Array.isArray(plan) || !plan.length) throw new Error('Invalid or empty plan');
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (!object(step) || Object.keys(step).length !== 1) throw new Error('Plan step must have one workroom');
    const type = Object.keys(step)[0], spec = step[type];
    if (!WORKROOMS.has(type) && type !== 'terminate') throw new Error(`Unknown plan step: ${type}`);
    if (!object(spec) || Object.keys(spec).sort().join('|') !== 'need|objective' || typeof spec.objective !== 'string' || !spec.objective.trim()) throw new Error(`Invalid ${type} objective`);
    validateNeed(spec.need);
    if (type === 'terminate' && i !== plan.length - 1) throw new Error('terminate must be final');
  }
  return copy(plan);
}
function validateReply(layer, reply) {
  if (typeof reply === 'string') reply = JSON.parse(reply);
  if (!object(reply)) throw new Error(`Invalid ${layer} JSON`);
  const fields = Object.keys(reply).sort().join('|');
  if (layer === 'gate') {
    if (fields !== 'need') throw new Error('Gate returns only need');
    return { need: validateNeed(reply.need) };
  }
  if (layer === 'corridorInitial' && fields === 'contextBlock|contextData|languageBlock') {
    if (typeof reply.languageBlock !== 'string') throw new Error('Invalid direct languageBlock');
    return { languageBlock: reply.languageBlock, contextBlock: contextBlock(reply.contextBlock), contextData: contextData(reply.contextData) };
  }
  if ((layer === 'corridorInitial' || layer === 'corridorReturn') && fields === 'contextBlock|plan') {
    return { plan: validatePlan(reply.plan), contextBlock: contextBlock(reply.contextBlock) };
  }
  if (layer === 'output' && fields === 'contextBlock|contextData|languageBlock') {
    if (typeof reply.languageBlock !== 'string') throw new Error('Invalid output languageBlock');
    return { languageBlock: reply.languageBlock, contextBlock: contextBlock(reply.contextBlock), contextData: contextData(reply.contextData) };
  }
  throw new Error(`Unexpected ${layer} response contract: ${fields}`);
}

export function createRequestRuntime({ buildPrompt, callAI, lookupNeed, runWorkroom, loadRoom, saveRoomContext, persist, publish = () => {}, maxModelCalls = 40, maxCorridorReturns = 8 }) {
  if (![buildPrompt, callAI, lookupNeed, runWorkroom, loadRoom, saveRoomContext, persist, publish].every(f => typeof f === 'function')) throw new Error('Missing runtime integration');
  const requests = new Map(), calls = new Map(), controllers = new Map(), queues = new Map();
  const key = (roomId, requestId) => JSON.stringify([roomId, requestId]);
  const aborted = (r, signal) => {
    if (r.status !== 'running' || signal.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
  };
  const snapshot = r => copy({
    roomId: r.roomId, requestId: r.requestId, revision: r.revision ?? 0,
    status: r.status, currentLayer: r.currentLayer, planIndex: r.planIndex ?? null,
    contextBlock: r.contextBlock, plan: r.plan ?? null,
    verifiedResults: r.verifiedResults ?? [], languageBlock: r.languageBlock ?? null,
    error: r.error ?? null
  });
  // Serialized persistence prevents a concurrent stop notification overtaking finalization.
  function record(r, type, payload = {}) {
    const id = key(r.roomId, r.requestId);
    const prev = queues.get(id) ?? Promise.resolve();
    const done = prev.catch(() => {}).then(async () => {
      r.revision = (r.revision ?? 0) + 1;
      const state = snapshot(r);
      const event = { roomId: r.roomId, requestId: r.requestId, revision: state.revision, type, payload: copy(payload), snapshot: state };
      await persist({ state, event }); // durable first; publish failures cannot undo a successful commit
      try { await publish(event); } catch { /* SSE can be reconciled by status GET */ }
      return state;
    });
    queues.set(id, done);
    return done;
  }
  async function finish(r, status, error = null) {
    if (ENDED.has(r.status)) return snapshot(r);
    r.status = status;
    if (error !== null) r.error = String(error);
    await record(r, 'final');
    return snapshot(r);
  }
  function routePlan(r) {
    const step = r.plan?.[r.planIndex];
    if (!step) return 'corridorReturn';
    return has(step, 'terminate') ? 'output' : 'workroom';
  }

  async function runModel(r, layer, data, signal, options = {}) {
    aborted(r, signal);
    const id = key(r.roomId, r.requestId);
    r.modelCalls = (r.modelCalls ?? 0) + 1;
    if (r.modelCalls > maxModelCalls) throw new Error('Model call limit reached');
    const prompt = await buildPrompt(layer, data, options);
    aborted(r, signal);
    const call = { index: r.modelCalls, layer, prompt, startedAt: Date.now() };
    calls.set(id, call);
    await record(r, 'model_call', { layer, index: call.index });
    try {
      const raw = await callAI({ layer, mode: 'json', prompt, signal });
      aborted(r, signal);
      call.raw = raw;
      call.parsed = validateReply(layer, raw);
      return call.parsed;
    } finally {
      if (calls.get(id) === call) calls.delete(id);
    }
  }
  async function begin({ roomId, requestId = crypto.randomUUID(), userRequest, languageSettings = '', interfaceSyntax = '' }) {
    if (!roomId || typeof userRequest !== 'string' || !userRequest.trim()) throw new Error('Invalid new request');
    const id = key(roomId, requestId);
    if (requests.has(id)) throw new Error('Duplicate requestId');
    const session = await loadRoom(roomId); // authoritative snapshot, not client-supplied context
    if (!session || !Number.isSafeInteger(session.revision)) throw new Error('Invalid room version');
    const r = { roomId, requestId, userRequest, contextData: contextData(session.contextData), contextBlock: { intent: '', progress: '' }, currentLayer: 'gate', status: 'running' };
    const signalController = new AbortController();
    requests.set(id, r); controllers.set(id, signalController);
    const signal = signalController.signal;
    let roomRevision = session.revision;
    const opts = { languageSettings, interfaceSyntax };
    const syncContext = async value => {
      // compare-and-swap: never silently overwrite another request's session context
      aborted(r, signal);
      const updated = await saveRoomContext({ roomId, expectedRevision: roomRevision, contextData: value });
      if (!updated || !Number.isSafeInteger(updated.revision)) throw new Error('Room context revision conflict or failed commit');
      roomRevision = updated.revision;
      r.contextData = value;
    };
    async function closeWithReply(reply) {
      // No unverified language is sent as success; context commit precedes publication.
      await syncContext(reply.contextData);
      r.contextBlock = reply.contextBlock;
      r.languageBlock = reply.languageBlock;
      await record(r, 'language', { text: reply.languageBlock });
      return finish(r, 'completed');
    }
    const workerCall = async ({ prompt, mode = 'tools', tools, ...other } = {}) => {
      aborted(r, signal);
      r.modelCalls = (r.modelCalls ?? 0) + 1;
      if (r.modelCalls > maxModelCalls) throw new Error('Model call limit reached');
      const call = { index: r.modelCalls, layer: 'workroom', prompt, mode, startedAt: Date.now() };
      calls.set(id, call);
      await record(r, 'model_call', { layer: 'workroom', index: call.index });
      try {
        const raw = await callAI({ prompt, mode, tools, signal, ...other });
        aborted(r, signal);
        call.raw = raw;
        return raw; // Function Calling payload is verified by the workroom adapter, NOT as a plan.
      } finally { if (calls.get(id) === call) calls.delete(id); }
    };
    const run = async () => {
      let returns = 0, lastResult = null;
      try {
        await record(r, 'started');
        while (r.status === 'running') {
          aborted(r, signal);
          const layer = r.currentLayer;
          const focus = { currentLayer: layer, planIndex: r.planIndex ?? null, previousVerifiedResult: lastResult };
          if (layer === 'gate') {
            const gate = await runModel(r, layer, { userRequest: r.userRequest, contextData: r.contextData, focus }, signal, opts);
            const result = await lookupNeed({ roomId, requestId, need: gate.need, signal });
            aborted(r, signal);
            r.gateData = result;
            r.currentLayer = 'corridorInitial';
          } else if (layer === 'corridorInitial' || layer === 'corridorReturn') {
            if (layer === 'corridorReturn' && ++returns > maxCorridorReturns) throw new Error('Corridor return limit reached');
            const data = layer === 'corridorInitial'
              ? { userRequest: r.userRequest, gateData: r.gateData, contextData: r.contextData, focus }
              : { contextBlock: r.contextBlock, verifiedResults: r.verifiedResults ?? [], focus };
            const result = await runModel(r, layer, data, signal, opts);
            if (has(result, 'languageBlock')) { await closeWithReply(result); break; }
            r.contextBlock = result.contextBlock;
            r.plan = result.plan;
            r.planIndex = 0;
            r.currentLayer = routePlan(r);
            await record(r, 'plan', { plan: r.plan });
          } else if (layer === 'workroom') {
            const step = r.plan?.[r.planIndex];
            const name = step && Object.keys(step)[0];
            if (!WORKROOMS.has(name)) throw new Error('Invalid active workroom');
            const spec = step[name];
            const needData = await lookupNeed({ roomId, requestId, need: validateNeed(spec.need), signal });
            aborted(r, signal);
            await record(r, 'workroom_started', { workroom: name, objective: spec.objective });
            const result = await runWorkroom({
              workroom: name, objective: spec.objective, needData, contextBlock: copy(r.contextBlock),
              focus, roomId, requestId, callModel: workerCall, signal
            });
            // The workroom owns action choice and MUST report effects that were actually committed,
            // even if cancellation arrived while an uninterruptible action was finishing.
            if (!object(result) || typeof result.ok !== 'boolean' || typeof result.summary !== 'string') throw new Error('Invalid verified workroom outcome');
            const verified = { workroom: name, ok: result.ok, summary: result.summary, refs: result.refs ?? [] };
            r.verifiedResults ??= [];
            r.verifiedResults.push(verified);
            lastResult = verified;
            await record(r, 'workroom_result', { result: verified });
            if (typeof result.languageBlock === 'string') {
              r.languageBlock = result.languageBlock;
              await record(r, 'language', { text: result.languageBlock });
            }
            if (r.status !== 'running') break;
            if (!result.ok || result.replan === true) r.currentLayer = 'corridorReturn';
            else { r.planIndex++; r.currentLayer = routePlan(r); }
          } else if (layer === 'output') {
            const reply = await runModel(r, 'output', {
              contextBlock: r.contextBlock, contextData: r.contextData,
              verifiedResults: r.verifiedResults ?? [], focus
            }, signal, opts);
            await closeWithReply(reply);
            break;
          } else throw new Error(`Unknown layer: ${layer}`);
          if (r.status === 'running') await record(r, 'progress', { currentLayer: r.currentLayer, planIndex: r.planIndex ?? null });
        }
        if (r.status === 'stopping') await finish(r, 'stopped');
      } catch (error) {
        if (r.status === 'stopping' || error?.name === 'AbortError') await finish(r, 'stopped');
        else await finish(r, 'failed', error?.message ?? String(error));
      } finally {
        controllers.delete(id);
        calls.delete(id);
      }
      return snapshot(r);
    };
    // No SSE connection dependency: work continues even if the client disconnects.
    return { requestId, finished: run() };
  }
  async function stop(roomId, requestId) {
    const id = key(roomId, requestId), r = requests.get(id);
    if (!r) return null;
    if (r.status === 'running') {
      r.status = 'stopping';
      controllers.get(id)?.abort();
      await record(r, 'stopping');
    }
    return snapshot(r);
  }
  const status = (roomId, requestId) => {
    const r = requests.get(key(roomId, requestId));
    return r ? snapshot(r) : null;
  };
  return { begin, stop, status, getCurrentCall: (roomId, requestId) => calls.get(key(roomId, requestId)) ?? null };
}