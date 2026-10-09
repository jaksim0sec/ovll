import {KernelError,computeScope} from './pointerGraphCore.mjs';
const reject=(code,status=422)=>{throw new KernelError(code,code,status);};
export function buildExecutionPlan(snapshot, run) {
  if (!snapshot?.graph || !Array.isArray(snapshot.definitions) || !run?.graphRef) reject('INVALID_EXECUTION_CONTEXT');
  const graph=snapshot.graph;
  if (graph.graphId!==run.graphRef.graphId || graph.revision!==run.graphRef.revision) reject('PINNED_GRAPH_MISMATCH',409);
  if (!Array.isArray(run.targets) || !run.targets.length) reject('RUN_TARGETS_REQUIRED');
  const selected=new Set(computeScope(graph,run.targets,run.damMode));
  const nodes=new Map(graph.nodes.map(n=>[n.nodeId,n]));
  const defs=new Map(snapshot.definitions.map(d=>[d.definitionId+':'+d.version,d]));
  const parents=new Map([...selected].map(n=>[n,new Set()]));
  const outgoing=new Map([...selected].map(n=>[n,new Set()]));
  for(const link of graph.connections){
    if(!selected.has(link.from.nodeId)||!selected.has(link.to.nodeId))continue;
    if(link.kind==='flow' && link.from.port!=='result' && link.from.port!=='next') reject('CONDITIONAL_ROUTING_NOT_IMPLEMENTED',501);
    if(!['flow','data'].includes(link.kind)) reject('UNKNOWN_EDGE_KIND');
    parents.get(link.to.nodeId).add(link.from.nodeId);
    outgoing.get(link.from.nodeId).add(link.to.nodeId);
  }
  for(const nodeId of selected){
    const node=nodes.get(nodeId),definition=defs.get(node?.definitionRef.definitionId+':'+node?.definitionRef.version);
    if(!definition)reject('PLAN_DEFINITION_NOT_FOUND');
    if(definition.executorKind==='subgraph')reject('SUBGRAPH_EXECUTOR_NOT_IMPLEMENTED',501);
    const inputs=new Map((definition.inputs||[]).map(p=>[p.name,p])),bound=node.inputBindings||{};
    const incoming=graph.connections.filter(l=>l.kind==='data'&&l.to.nodeId===nodeId),ports=new Set();
    for(const link of incoming){
      if(ports.has(link.to.port)||Object.hasOwn(bound,link.to.port))reject('AMBIGUOUS_INPUT_PRODUCERS');
      ports.add(link.to.port);
      const parent=nodes.get(link.from.nodeId),parentDef=defs.get(parent?.definitionRef.definitionId+':'+parent?.definitionRef.version);
      const out=parentDef?.outputs.find(p=>p.name===link.from.port),input=inputs.get(link.to.port);
      if(!out||!input||out.representation!==input.representation)reject('PORT_MISMATCH');
    }
    for(const name of Object.keys(bound))if(!inputs.has(name))reject('UNKNOWN_INPUT_PORT');
    for(const port of inputs.values())if(port.required===true&&!ports.has(port.name)&&!Object.hasOwn(bound,port.name))reject('REQUIRED_INPUT_MISSING');
  }
  const remaining=new Map([...parents].map(([n,p])=>[n,p.size]));
  const ready=[...selected].filter(n=>remaining.get(n)===0).sort();
  const order=[];
  while(ready.length){
    const nodeId=ready.shift();const node=nodes.get(nodeId);
    if(!node)reject('PLAN_NODE_NOT_FOUND');
    const definition=defs.get(node.definitionRef.definitionId+':'+node.definitionRef.version);
    if(!definition)reject('PLAN_DEFINITION_NOT_FOUND');
    if(!['model_task','tool_task','subgraph'].includes(definition.executorKind))reject('UNSUPPORTED_EXECUTOR_KIND');
    order.push({nodeId,node,definition,predecessors:[...parents.get(nodeId)].sort()});
    for(const next of outgoing.get(nodeId)){remaining.set(next,remaining.get(next)-1);if(!remaining.get(next)){ready.push(next);ready.sort();}}
  }
  if(order.length!==selected.size) reject('PLAN_DEPENDENCY_CYCLE');
  return {graphRef:{...run.graphRef},planEpoch:run.planEpoch,targets:[...run.targets],order};
}
