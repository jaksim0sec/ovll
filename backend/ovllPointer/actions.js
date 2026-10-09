import { KernelError, computeScope } from './graph.js';
const issue = (code, status = 422) => { throw new KernelError(code, code, status); };
const keyFor = (s, k) => JSON.stringify([s.actorRef, s.workspaceRef, s.requestRef, k]);
function orderActions(actions) {
  if (!Array.isArray(actions) || actions.length > 32) issue('ACTION_LIMIT');
  const byKey = new Map();
  for (const a of actions) {
    if (!a || typeof a.localKey !== 'string' || byKey.has(a.localKey)) issue('DUPLICATE_ACTION_KEY');
    byKey.set(a.localKey, a);
  }
  const ordered = [], active = new Set(), done = new Set();
  function visit(k) {
    if (!byKey.has(k)) issue('MISSING_ACTION_DEPENDENCY');
    if (active.has(k)) issue('ACTION_DEPENDENCY_CYCLE');
    if (done.has(k)) return;
    active.add(k);
    for (const dep of byKey.get(k).dependsOn || []) visit(dep);
    active.delete(k); done.add(k); ordered.push(byKey.get(k));
  }
  for (const action of actions) visit(action.localKey);
  return ordered;
}
export class ProposalKernel {
  #store; #authorize; #validate; #schedule; #publish; #seen = new Map();
  constructor({ graphStore, authorize, validateProposal, scheduleRun, publish } = {}) {
    if (!graphStore || typeof authorize !== 'function' || typeof validateProposal !== 'function') issue('GUARDS_REQUIRED', 500);
    this.#store = graphStore; this.#authorize = authorize; this.#validate = validateProposal;
    this.#schedule = scheduleRun; this.#publish = publish || (() => {});
  }
  async submit(turn, scope) {
    if (!scope || !['actorRef', 'workspaceRef', 'requestRef'].every(k => typeof scope[k] === 'string' && scope[k])) issue('TRUSTED_SCOPE_REQUIRED', 401);
    if (!this.#validate(turn)) issue('INVALID_MODEL_TURN');
    if (turn.needs?.length && (turn.actions?.length || turn.outputs)) issue('NEEDS_ACTION_BARRIER');
    if (!turn.actions?.length) return { message: turn.message, needs: turn.needs || [], results: [] };
    const sorted = orderActions(turn.actions);
    const results = new Map();
    for (const action of sorted) {
      const actionId = scope.requestRef + ':' + action.localKey;
      const dependencies = (action.dependsOn || []).map(dep => results.get(dep));
      if (dependencies.some(r => !r || !['applied', 'scheduled', 'duplicate'].includes(r.status))) {
        results.set(action.localKey, { actionId, status: 'rejected', error: { code: 'DEPENDENCY_NOT_APPLIED', retryable: false } });
        continue;
      }
      const idem = keyFor(scope, action.localKey), signature = JSON.stringify([action.kind, action.args, action.dependsOn || []]);
      if (this.#seen.has(idem)) {
        const previous = this.#seen.get(idem);
        if (previous.signature !== signature) {
          results.set(action.localKey, { actionId, status: 'rejected', error: { code: 'IDEMPOTENCY_CONFLICT', retryable: false } });
        } else {
          results.set(action.localKey, { ...previous.result, status: 'duplicate', originalActionId: previous.result.actionId });
        }
        continue;
      }
      let result;
      try {
        if (!await this.#authorize({ actorRef: scope.actorRef, workspaceRef: scope.workspaceRef, taskRef: scope.taskRef, actionKind: action.kind, graphId: scope.graphId })) issue('FORBIDDEN', 403);
        const a = action.args || {};
        if (action.kind === 'ir.applyPatch') {
          if (scope.graphId && a.patch?.graphId !== scope.graphId) issue('GRAPH_SCOPE_MISMATCH', 403);
          const applied = this.#store.apply(scope.workspaceRef, a.patch);
          result = { actionId, status: 'applied', newRevision: applied.graphRef.revision, createdRefs: applied.createdRefs };
        } else if (action.kind === 'run.start') {
          if (!scope.graphId) issue('GRAPH_CONTEXT_REQUIRED');
          if (typeof this.#schedule !== 'function') issue('DURABLE_QUEUE_REQUIRED', 503);
          const graph = this.#store.get(scope.workspaceRef, scope.graphId).graph;
          const targets = (a.targets || []).map(target => {
            if (target.nodeId) return target.nodeId;
            const dep = results.get(target.fromAction);
            if (!action.dependsOn?.includes(target.fromAction) || !dep || !['applied','duplicate'].includes(dep.status)) issue('UNKNOWN_TARGET_PRODUCER');
            return dep.createdRefs?.['node:' + target.localNodeKey] || issue('UNKNOWN_LOCAL_TARGET');
          });
          const damMode = a.damMode || 'closed';
          const selected = computeScope(graph, targets, damMode);
          // scheduleRun must atomically record Run+pending work before acknowledging a queued job.
          const committed = await this.#schedule({ actorRef: scope.actorRef, workspaceRef: scope.workspaceRef, taskRef: scope.taskRef, requestRef: scope.requestRef, graphRef: { graphId: scope.graphId, revision: graph.revision }, targets, selected, damMode, idempotencyKey: idem });
          if (!committed?.durable || !committed?.runRef) issue('QUEUE_NOT_DURABLE', 503);
          result = { actionId, status: 'scheduled', runRef: committed.runRef };
        } else {
          issue('ACTION_NOT_IMPLEMENTED', 501);
        }
      } catch (err) {
        result = { actionId, status: 'rejected', error: { code: err.code || 'INTERNAL_ERROR', retryable: err.status === 503 || err.status === 409 } };
      }
      if (['applied', 'scheduled'].includes(result.status)) {
        this.#seen.set(idem, { signature, result });
        this.#publish({ workspaceRef: scope.workspaceRef, actorRef: scope.actorRef, actionId, kind: action.kind, status: result.status, newRevision: result.newRevision, runRef: result.runRef });
      }
      results.set(action.localKey, result);
    }
    return { message: turn.message, needs: [], results: [...results.values()] };
  }
}
