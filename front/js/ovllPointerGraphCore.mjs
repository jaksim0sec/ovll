import {compatibleDataRepresentation,isFlowPort} from './ovllPointerPortTypes.mjs';
export class KernelError extends Error {
  constructor(code, message = code, status = 422) {
    super(message); this.code = code; this.status = status;
  }
}
const reject = (code, msg, status) => { throw new KernelError(code, msg, status); };
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const clone = x => JSON.parse(JSON.stringify(x));
const historicalKeys=['nodeId','skillId','nodeRef','skillRef','localNodeKey','localSkillKey','definitionRef'];
const rejectHistorical=(value,keys=historicalKeys)=>{if(value&&keys.some(key=>own(value,key)))reject('UNEXPECTED_LEGACY_SCHEMA');};
const validId = x => typeof x === 'string' && /^[a-zA-Z0-9_:.\-]{1,160}$/.test(x);
const requireId = (x, name) => { if (!validId(x)) reject('BAD_ID', name); };
const isArray = x => { if (!Array.isArray(x)) reject('BAD_ARRAY'); return x; };
const graphKey = (w, g) => JSON.stringify([w, g]);
const endpoint = (skillNode, pending) => skillNode?.skillNodeId || (skillNode?.localSkillNodeKey && pending.get(skillNode.localSkillNodeKey)) || reject('UNKNOWN_ENDPOINT');
function validate(graph, skillDefinitions) {
  const map = new Map();
  for (const skillNode of graph.skillNodes) {
    rejectHistorical(skillNode);
    if (map.has(skillNode.skillNodeId)) reject('DUPLICATE_SKILL_NODE');
    const def = skillDefinitions.find(d => d.definitionId === skillNode.skillDefinitionRef?.definitionId && d.version === skillNode.skillDefinitionRef?.version);
    if (!def) reject('UNKNOWN_DEFINITION');
    map.set(skillNode.skillNodeId, def);
  }
  const producers = new Set(),sources = new Set();
  const skillNodeMap = new Map(graph.skillNodes.map(n=>[n.skillNodeId,n]));
  const seen = new Set(), edges = new Map([...map.keys()].map(n => [n, []]));
  for (const link of graph.connections) {
    if (seen.has(link.id)) reject('DUPLICATE_LINK');
    seen.add(link.id);
    const a = map.get(link.from?.skillNodeId), b = map.get(link.to?.skillNodeId);
    if (!a || !b) reject('UNKNOWN_ENDPOINT');
    if (link.kind !== 'flow' && link.kind !== 'data') reject('BAD_LINK_KIND');
    if (link.kind === 'data') {
      const out = a.outputs.find(x => x.name === link.from.port);
      const input = b.inputs.find(x => x.name === link.to.port);
      if (!out || !input || !compatibleDataRepresentation(out.representation,input.representation)) reject('PORT_MISMATCH');
      const inputKey=JSON.stringify([link.to.skillNodeId,link.to.port]);
      const sourceKey=JSON.stringify([link.from.skillNodeId,link.from.port,link.to.skillNodeId,link.to.port]);
      if(sources.has(sourceKey))reject('DUPLICATE_INPUT_SOURCE');
      sources.add(sourceKey);
      if(own(skillNodeMap.get(link.to.skillNodeId).inputBindings||{},link.to.port)||
        producers.has(inputKey)&&input.multiple===false)reject('AMBIGUOUS_INPUT_PRODUCERS');
      producers.add(inputKey);
    } else if(!isFlowPort(a,link.from.port,'outputs')||!isFlowPort(b,link.to.port,'inputs')) {
      reject('PORT_MISMATCH');
    }
    edges.get(link.from.skillNodeId).push(link.to.skillNodeId);
  }
  const active = new Set(), done = new Set();
  function visit(n) {
    if (active.has(n)) reject('GRAPH_CYCLE');
    if (done.has(n)) return;
    active.add(n);
    for (const m of edges.get(n)) visit(m);
    active.delete(n); done.add(n);
  }
  for (const skillNode of map.keys()) visit(skillNode);
}
export function computeScope(graph, targets, mode = 'closed') {
  if (!['closed', 'open'].includes(mode)) reject('BAD_DAM_MODE');
  const skillNodes = new Set(graph.skillNodes.map(n => n.skillNodeId));
  for (const n of targets) if (!skillNodes.has(n)) reject('UNKNOWN_TARGET', n);
  const selected = new Set(targets);
  if (mode === 'open') {
    const queue = [...targets];
    while (queue.length) {
      const x = queue.shift();
      for (const l of graph.connections) {
        if (l.kind === 'flow' && l.from.skillNodeId === x && !selected.has(l.to.skillNodeId)) {
          selected.add(l.to.skillNodeId); queue.push(l.to.skillNodeId);
        }
      }
    }
  }
  const queue = [...selected];
  while (queue.length) {
    const x = queue.shift();
    for (const l of graph.connections) {
      if (l.to.skillNodeId === x && !selected.has(l.from.skillNodeId)) {
        selected.add(l.from.skillNodeId); queue.push(l.from.skillNodeId);
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
    const item = { graph: { graphId, revision: 0, skillNodes: [], connections: [] }, skillDefinitions: [] };
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
        !Array.isArray(snapshot.graph.skillNodes) || !Array.isArray(snapshot.graph.connections) ||
        !Array.isArray(snapshot.skillDefinitions)) reject('INVALID_PERSISTED_GRAPH');
    rejectHistorical(snapshot,['definitions']);rejectHistorical(snapshot.graph,['nodes','skills']);
    for(const link of snapshot.graph.connections){rejectHistorical(link.from);rejectHistorical(link.to);}
    validate(snapshot.graph, snapshot.skillDefinitions);
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
    rejectHistorical(patch,['definitions']);
    for(const op of patch.operations||[]){
      rejectHistorical(op);
      for(const end of [op.from,op.to]){rejectHistorical(end,['node','skill']);rejectHistorical(end?.skillNode);}
    }
    const next = clone(item), tempSkillNodes = new Map(), tempDefs = new Map(), createdRefs = {};
    const defs = isArray(patch.skillDefinitions), ops = isArray(patch.operations);
    const explicitLinkRemovals = new Set(ops.filter(op => op?.op === 'link.remove').map(op => op.linkId));
    if (!defs.length && !ops.length) reject('EMPTY_PATCH');
    if (defs.length > 64 || ops.length > 256) reject('PATCH_TOO_LARGE');
    for (const d of defs) {
      requireId(d.localKey, 'definition.localKey');
      if (tempDefs.has(d.localKey)) reject('DUPLICATE_LOCAL_DEFINITION');
      const executorKind=d.executorKind??'model_task';
      if (!['model_task', 'tool_task', 'subgraph'].includes(executorKind)) reject('BAD_EXECUTOR');
      if (!d.purpose?.trim() || !d.instruction?.trim()) reject('BAD_DEFINITION');
      if (d.supersedes?.definitionId?.startsWith('builtin:')) reject('BUILTIN_DEFINITION_IMMUTABLE');
      if (d.supersedes && (d.executorKind===undefined||d.inputs===undefined||d.outputs===undefined))
        reject('REVISION_REQUIRES_FULL_DEFINITION');
      if (executorKind === 'tool_task' && !d.requiredCapabilities?.length) reject('CAPABILITY_REQUIRED');
      if (executorKind === 'subgraph' && !d.procedureRef) reject('PROCEDURE_REQUIRED');
      const inputs=d.inputs??(executorKind==='model_task'?
        [{name:'in',role:'입력',representation:'json',required:false}]:[]);
      const outputs=d.outputs??(executorKind==='model_task'?
        [{name:'result',role:'결과',representation:'json',required:false}]:[]);
      isArray(inputs);isArray(outputs);
      if (!outputs.length) reject('OUTPUT_REQUIRED');
      for (const ports of [inputs, outputs]) {
        const names = new Set();
        for (const p of ports) {
          requireId(p.name, 'port');
          if (!p.representation || names.has(p.name)) reject('BAD_PORT');
          names.add(p.name);
        }
      }
      const base = d.supersedes && next.skillDefinitions.find(x => x.definitionId === d.supersedes.definitionId && x.version === d.supersedes.version);
      if (d.supersedes && !base) reject('UNKNOWN_BASE_DEFINITION');
      const value = { ...(base?.presentation?{presentation:base.presentation}:{}), ...d,
        executorKind,inputs,outputs,definitionId:base?base.definitionId:'d_'+ids(),
        version:base?base.version+1:1 };
      if (next.skillDefinitions.some(x => x.definitionId === value.definitionId && x.version === value.version)) reject('DEFINITION_VERSION_CONFLICT');
      delete value.supersedes;
      delete value.localKey;
      next.skillDefinitions.push(value);
      tempDefs.set(d.localKey, value);
      createdRefs['definition:' + d.localKey] = value.definitionId;
    }
    for (const op of ops) {
      if (op.op === 'skillNode.add') {
        requireId(op.localSkillNodeKey, 'localSkillNodeKey');
        if (tempSkillNodes.has(op.localSkillNodeKey)) reject('DUPLICATE_LOCAL_SKILL_NODE');
        const ref = op.skillDefinitionRef || {};
        const d = ref.localDefinitionKey ? tempDefs.get(ref.localDefinitionKey) : next.skillDefinitions.find(x => x.definitionId === ref.definitionId && x.version === ref.version);
        if (!d) reject('UNKNOWN_DEFINITION');
        const skillNodeId = 'n_' + ids();
        next.graph.skillNodes.push({ skillNodeId, skillDefinitionRef: { definitionId: d.definitionId, version: d.version }, inputBindings: op.inputBindings || {}, settings: op.settings || {} });
        tempSkillNodes.set(op.localSkillNodeKey, skillNodeId);
        createdRefs['skillNode:' + op.localSkillNodeKey] = skillNodeId;
      } else if (op.op === 'skillNode.update') {
        const skillNode = next.graph.skillNodes.find(n => n.skillNodeId === op.skillNodeId);
        if (!skillNode) reject('UNKNOWN_SKILL_NODE');
        if (op.skillDefinitionRef) {
          const ref = op.skillDefinitionRef;
          const d = ref.localDefinitionKey ? tempDefs.get(ref.localDefinitionKey) : next.skillDefinitions.find(x => x.definitionId === ref.definitionId && x.version === ref.version);
          if (!d) reject('UNKNOWN_DEFINITION');
          skillNode.skillDefinitionRef = { definitionId: d.definitionId, version: d.version };
        }
        if (own(op, 'settings')) skillNode.settings = clone(op.settings);
        if (own(op, 'inputBindings')) skillNode.inputBindings = clone(op.inputBindings);
      } else if (op.op === 'skillNode.delete') {
        const n = next.graph.skillNodes.findIndex(x => x.skillNodeId === op.skillNodeId);
        if (n < 0) reject('UNKNOWN_SKILL_NODE');
        if (next.graph.connections.some(x => (x.from.skillNodeId === op.skillNodeId || x.to.skillNodeId === op.skillNodeId) &&
            !explicitLinkRemovals.has(x.id))) reject('SKILL_NODE_HAS_LINKS');
        next.graph.skillNodes.splice(n, 1);
      } else if (op.op === 'skill.appearance') {
        const ref=op.skillDefinitionRef;
        if (!validId(ref?.definitionId) || !Number.isInteger(ref.version) || ref.version<1)
          reject('BAD_DEFINITION_REF');
        if (ref.definitionId.startsWith('builtin:')) reject('BUILTIN_DEFINITION_IMMUTABLE');
        const base=next.skillDefinitions.find(d=>d.definitionId===ref.definitionId&&d.version===ref.version);
        if (!base) reject('UNKNOWN_DEFINITION');
        if (next.skillDefinitions.some(d=>d.definitionId===ref.definitionId&&d.version>ref.version))
          reject('STALE_DEFINITION_VERSION');
        const visual=op.presentation;
        if (!visual || typeof visual!=='object' || Array.isArray(visual) ||
          !Object.keys(visual).length || Object.keys(visual).some(k=>!['name','iconKey','color'].includes(k)) ||
          visual.name!==undefined&&(typeof visual.name!=='string'||!visual.name.trim()||visual.name.length>100) ||
          visual.iconKey!==undefined&&(typeof visual.iconKey!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/i.test(visual.iconKey)) ||
          visual.color!==undefined&&(typeof visual.color!=='string'||!/^#[0-9a-f]{6}$/i.test(visual.color)))
          reject('BAD_PRESENTATION');
        // Appearance is editable metadata, not a new executable definition version.
        // Graph revisions remain immutable; instance refs and fingerprints stay unchanged.
        next.skillDefinitions[next.skillDefinitions.indexOf(base)]={
          ...base,presentation:{...(base.presentation||{}),...visual}
        };
      } else if (op.op === 'skill.delete') {
        const ref = op.skillDefinitionRef;
        if (!ref || !validId(ref.definitionId) || !Number.isInteger(ref.version) || ref.version < 1)
          reject('BAD_DEFINITION_REF');
        if (ref.definitionId.startsWith('builtin:')) reject('BUILTIN_DEFINITION_IMMUTABLE');
        const index = next.skillDefinitions.findIndex(d =>
          d.definitionId === ref.definitionId && d.version === ref.version);
        if (index < 0) reject('UNKNOWN_DEFINITION');
        if (next.graph.skillNodes.some(skillNode => skillNode.skillDefinitionRef.definitionId === ref.definitionId &&
          skillNode.skillDefinitionRef.version === ref.version)) reject('DEFINITION_IN_USE');
        next.skillDefinitions.splice(index, 1);
      } else if (op.op === 'link.add') {
        requireId(op.localLinkKey, 'localLinkKey');
        if (own(createdRefs, 'link:' + op.localLinkKey)) reject('DUPLICATE_LOCAL_LINK');
        const linkId = 'l_' + ids();
        next.graph.connections.push({ id: linkId, kind: op.kind, from: { skillNodeId: endpoint(op.from?.skillNode, tempSkillNodes), port: op.from?.port }, to: { skillNodeId: endpoint(op.to?.skillNode, tempSkillNodes), port: op.to?.port } });
        createdRefs['link:' + op.localLinkKey] = linkId;
      } else if (op.op === 'link.remove') {
        const n = next.graph.connections.findIndex(x => x.id === op.linkId);
        if (n < 0) reject('UNKNOWN_LINK');
        next.graph.connections.splice(n, 1);
      } else reject('UNKNOWN_PATCH_OPERATION');
    }
    validate(next.graph, next.skillDefinitions);
    next.graph.parentRevision = next.graph.revision; next.graph.revision += 1;
    this.#items.set(key, next);
    this.#revisions.get(key).set(next.graph.revision, clone(next));
    return { graphRef: { graphId: patch.graphId, revision: next.graph.revision }, createdRefs };
  }
}
