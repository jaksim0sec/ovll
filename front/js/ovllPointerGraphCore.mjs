export class KernelError extends Error {
  constructor(code, message = code, status = 422) {
    super(message); this.code = code; this.status = status;
  }
}
const reject = (code, msg, status) => { throw new KernelError(code, msg, status); };
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const clone = x => JSON.parse(JSON.stringify(x));
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_:.\-]{1,160}$/.test(x);
const requireId = (x, name) => { if (!validId(x)) reject('BAD_ID', name); };
const isArray = x => { if (!Array.isArray(x)) reject('BAD_ARRAY'); return x; };
const graphKey = (w, g) => JSON.stringify([w, g]);
const endpoint = (node, pending) => node?.nodeId || (node?.localNodeKey && pending.get(node.localNodeKey)) || reject('UNKNOWN_ENDPOINT');
function validate(graph, definitions) {
  const map = new Map();
  for (const node of graph.nodes) {
    if (map.has(node.nodeId)) reject('DUPLICATE_NODE');
    const def = definitions.find(d => d.definitionId === node.definitionRef?.definitionId && d.version === node.definitionRef?.version);
    if (!def) reject('UNKNOWN_DEFINITION');
    map.set(node.nodeId, def);
  }
  const seen = new Set(), edges = new Map([...map.keys()].map(n => [n, []]));
  for (const link of graph.connections) {
    if (seen.has(link.id)) reject('DUPLICATE_LINK');
    seen.add(link.id);
    const a = map.get(link.from?.nodeId), b = map.get(link.to?.nodeId);
    if (!a || !b) reject('UNKNOWN_ENDPOINT');
    if (link.kind !== 'flow' && link.kind !== 'data') reject('BAD_LINK_KIND');
    if (link.kind === 'data') {
      const out = a.outputs.find(x => x.name === link.from.port);
      const input = b.inputs.find(x => x.name === link.to.port);
      if (!out || !input || out.representation !== input.representation) reject('PORT_MISMATCH');
    }
    edges.get(link.from.nodeId).push(link.to.nodeId);
  }
  const active = new Set(), done = new Set();
  function visit(n) {
    if (active.has(n)) reject('GRAPH_CYCLE');
    if (done.has(n)) return;
    active.add(n);
    for (const m of edges.get(n)) visit(m);
    active.delete(n); done.add(n);
  }
  for (const node of map.keys()) visit(node);
}
export function computeScope(graph, targets, mode = 'closed') {
  if (!['closed', 'open'].includes(mode)) reject('BAD_DAM_MODE');
  const nodes = new Set(graph.nodes.map(n => n.nodeId));
  for (const n of targets) if (!nodes.has(n)) reject('UNKNOWN_TARGET', n);
  const selected = new Set(targets);
  if (mode === 'open') {
    const queue = [...targets];
    while (queue.length) {
      const x = queue.shift();
      for (const l of graph.connections) {
        if (l.kind === 'flow' && l.from.nodeId === x && !selected.has(l.to.nodeId)) {
          selected.add(l.to.nodeId); queue.push(l.to.nodeId);
        }
      }
    }
  }
  const queue = [...selected];
  while (queue.length) {
    const x = queue.shift();
    for (const l of graph.connections) {
      if (l.to.nodeId === x && !selected.has(l.from.nodeId)) {
        selected.add(l.from.nodeId); queue.push(l.from.nodeId);
      }
    }
  }
  return [...selected];
}
export class MemoryGraphRepository {
  #items = new Map();
  #revisions = new Map();
  create(workspaceId, graphId) {
    requireId(workspaceId, 'workspaceId'); requireId(graphId, 'graphId');
    const key = graphKey(workspaceId, graphId);
    if (this.#items.has(key)) reject('GRAPH_EXISTS', graphId, 409);
    const item = { graph: { graphId, revision: 0, nodes: [], connections: [] }, definitions: [] };
    this.#items.set(key, item);
    this.#revisions.set(key, new Map([[0, clone(item)]]));
    return this.get(workspaceId, graphId);
  }
  get(workspaceId, graphId) {
    const item = this.#items.get(graphKey(workspaceId, graphId));
    if (!item) reject('GRAPH_NOT_FOUND', graphId, 404);
    return clone(item);
  }
  // Database adapter only: reconstruct an immutable snapshot inside a disposable, isolated repository.
  restore(workspaceId, graphId, snapshot) {
    requireId(workspaceId, 'workspaceId'); requireId(graphId, 'graphId');
    if (snapshot?.graph?.graphId !== graphId || !Number.isInteger(snapshot.graph.revision) ||
        !Array.isArray(snapshot.graph.nodes) || !Array.isArray(snapshot.graph.connections) ||
        !Array.isArray(snapshot.definitions)) reject('INVALID_PERSISTED_GRAPH');
    validate(snapshot.graph, snapshot.definitions);
    const k = graphKey(workspaceId, graphId), item = clone(snapshot);
    this.#items.set(k, item);
    this.#revisions.set(k, new Map([[item.graph.revision, clone(item)]]));
  }
  getRevision(workspaceId, graphId, revision) {
    const value = this.#revisions.get(graphKey(workspaceId, graphId))?.get(revision);
    if (!value) reject('REVISION_NOT_FOUND', String(revision), 404);
    return clone(value);
  }
  apply(workspaceId, patch, ids = () => crypto.randomUUID()) {
    if (!patch || !validId(patch.graphId) || !Number.isInteger(patch.expectedGraphRevision)) reject('BAD_PATCH');
    if (patch.adoption === 'active_run') reject('ACTIVE_RUN_ADOPTION_PENDING');
    const key = graphKey(workspaceId, patch.graphId), item = this.#items.get(key);
    if (!item) reject('GRAPH_NOT_FOUND', patch.graphId, 404);
    if (item.graph.revision !== patch.expectedGraphRevision) reject('STALE_REVISION', patch.graphId, 409);
    const next = clone(item), tempNodes = new Map(), tempDefs = new Map(), createdRefs = {};
    const defs = isArray(patch.definitions), ops = isArray(patch.operations);
    if (!defs.length && !ops.length) reject('EMPTY_PATCH');
    if (defs.length > 64 || ops.length > 256) reject('PATCH_TOO_LARGE');
    for (const d of defs) {
      requireId(d.localKey, 'definition.localKey');
      if (tempDefs.has(d.localKey)) reject('DUPLICATE_LOCAL_DEFINITION');
      if (!['model_task', 'tool_task', 'subgraph'].includes(d.executorKind)) reject('BAD_EXECUTOR');
      if (!d.purpose?.trim() || !d.instruction?.trim()) reject('BAD_DEFINITION');
      if (d.executorKind === 'tool_task' && !d.requiredCapabilities?.length) reject('CAPABILITY_REQUIRED');
      if (d.executorKind === 'subgraph' && !d.procedureRef) reject('PROCEDURE_REQUIRED');
      isArray(d.inputs); isArray(d.outputs);
      if (!d.outputs.length) reject('OUTPUT_REQUIRED');
      for (const ports of [d.inputs, d.outputs]) {
        const names = new Set();
        for (const p of ports) {
          requireId(p.name, 'port');
          if (!p.representation || names.has(p.name)) reject('BAD_PORT');
          names.add(p.name);
        }
      }
      const base = d.supersedes && next.definitions.find(x => x.definitionId === d.supersedes.definitionId && x.version === d.supersedes.version);
      if (d.supersedes && !base) reject('UNKNOWN_BASE_DEFINITION');
      const value = { ...d, definitionId: base ? base.definitionId : 'd_' + ids(), version: base ? base.version + 1 : 1 };
      if (next.definitions.some(x => x.definitionId === value.definitionId && x.version === value.version)) reject('DEFINITION_VERSION_CONFLICT');
      delete value.supersedes;
      delete value.localKey;
      next.definitions.push(value);
      tempDefs.set(d.localKey, value);
      createdRefs['definition:' + d.localKey] = value.definitionId;
    }
    for (const op of ops) {
      if (op.op === 'node.add') {
        requireId(op.localNodeKey, 'localNodeKey');
        if (tempNodes.has(op.localNodeKey)) reject('DUPLICATE_LOCAL_NODE');
        const ref = op.definitionRef || {};
        const d = ref.localDefinitionKey ? tempDefs.get(ref.localDefinitionKey) : next.definitions.find(x => x.definitionId === ref.definitionId && x.version === ref.version);
        if (!d) reject('UNKNOWN_DEFINITION');
        const nodeId = 'n_' + ids();
        next.graph.nodes.push({ nodeId, definitionRef: { definitionId: d.definitionId, version: d.version }, inputBindings: op.inputBindings || {}, settings: op.settings || {} });
        tempNodes.set(op.localNodeKey, nodeId);
        createdRefs['node:' + op.localNodeKey] = nodeId;
      } else if (op.op === 'node.update') {
        const node = next.graph.nodes.find(n => n.nodeId === op.nodeId);
        if (!node) reject('UNKNOWN_NODE');
        if (op.definitionRef) {
          const ref = op.definitionRef;
          const d = ref.localDefinitionKey ? tempDefs.get(ref.localDefinitionKey) : next.definitions.find(x => x.definitionId === ref.definitionId && x.version === ref.version);
          if (!d) reject('UNKNOWN_DEFINITION');
          node.definitionRef = { definitionId: d.definitionId, version: d.version };
        }
        if (own(op, 'settings')) node.settings = clone(op.settings);
        if (own(op, 'inputBindings')) node.inputBindings = clone(op.inputBindings);
      } else if (op.op === 'node.delete') {
        const n = next.graph.nodes.findIndex(x => x.nodeId === op.nodeId);
        if (n < 0) reject('UNKNOWN_NODE');
        if (next.graph.connections.some(x => x.from.nodeId === op.nodeId || x.to.nodeId === op.nodeId)) reject('NODE_HAS_LINKS');
        next.graph.nodes.splice(n, 1);
      } else if (op.op === 'link.add') {
        requireId(op.localLinkKey, 'localLinkKey');
        if (own(createdRefs, 'link:' + op.localLinkKey)) reject('DUPLICATE_LOCAL_LINK');
        const linkId = 'l_' + ids();
        next.graph.connections.push({ id: linkId, kind: op.kind, from: { nodeId: endpoint(op.from?.node, tempNodes), port: op.from?.port }, to: { nodeId: endpoint(op.to?.node, tempNodes), port: op.to?.port } });
        createdRefs['link:' + op.localLinkKey] = linkId;
      } else if (op.op === 'link.remove') {
        const n = next.graph.connections.findIndex(x => x.id === op.linkId);
        if (n < 0) reject('UNKNOWN_LINK');
        next.graph.connections.splice(n, 1);
      } else reject('UNKNOWN_PATCH_OPERATION');
    }
    validate(next.graph, next.definitions);
    next.graph.parentRevision = next.graph.revision; next.graph.revision += 1;
    this.#items.set(key, next);
    this.#revisions.get(key).set(next.graph.revision, clone(next));
    return { graphRef: { graphId: patch.graphId, revision: next.graph.revision }, createdRefs };
  }
}
