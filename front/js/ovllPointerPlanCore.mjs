import {compatibleDataRepresentation,isFlowPort} from './ovllPointerPortTypes.mjs';
export {matchesInputRepresentation} from './ovllPointerPortTypes.mjs';
import {matchesInputRepresentation} from './ovllPointerPortTypes.mjs';
import {KernelError,computeScope} from './ovllPointerGraphCore.mjs';
const reject=(code,status=422)=>{throw new KernelError(code,code,status);};
// Local adapters must validate actual bound and produced values, just as the
// server executor does. A JSON serialization must never silently discard them.
export function matchesRuntimeRepresentation(representation,value){
  const supported=['text','structured_text','document','boolean','number','object','array','json'];
  const json=(item,depth=0)=>{
    if(depth>12)return false;
    if(item===null||typeof item==='string'||typeof item==='boolean')return true;
    if(typeof item==='number')return Number.isFinite(item);
    if(!item||typeof item!=='object')return false;
    if(!Array.isArray(item)&&Object.getPrototypeOf(item)?.constructor?.name!=='Object')return false;
    return Object.values(item).every(child=>json(child,depth+1));
  };
  return supported.includes(representation)&&json(value)&&matchesInputRepresentation(representation,value);
}
export function isVerifiedProducedOutput(definition,output){
  const values=output?.values,declared=definition?.outputs||[];
  if(output?.status!=='produced'||!values||typeof values!=='object'||Array.isArray(values))return false;
  const names=Object.keys(values);
  if(!names.length||names.length>64||definition.requiredCapabilities?.includes('branch.exclusive')&&names.length!==1)return false;
  if(names.some(name=>!declared.some(port=>port.name===name))||declared.some(port=>port.required&&!Object.hasOwn(values,port.name)))return false;
  return names.every(name=>{
    const wrapper=values[name],port=declared.find(port=>port.name===name);
    return wrapper&&typeof wrapper==='object'&&!Array.isArray(wrapper)&&Object.keys(wrapper).length===1&&
      Object.hasOwn(wrapper,'inline')&&matchesRuntimeRepresentation(port.representation,wrapper.inline);
  });
}
export function buildExecutionPlan(snapshot, run) {
  if (!snapshot?.graph || !Array.isArray(snapshot.skillDefinitions) || !run?.graphRef) reject('INVALID_EXECUTION_CONTEXT');
  const graph=snapshot.graph;
  if (graph.graphId!==run.graphRef.graphId || graph.revision!==run.graphRef.revision) reject('PINNED_GRAPH_MISMATCH',409);
  if (!Array.isArray(run.targets) || !run.targets.length) reject('RUN_TARGETS_REQUIRED');
  const selected=new Set(computeScope(graph,run.targets,run.damMode));
  const skillNodes=new Map(graph.skillNodes.map(n=>[n.skillNodeId,n]));
  const defs=new Map(snapshot.skillDefinitions.map(d=>[d.definitionId+':'+d.version,d]));
  const parents=new Map([...selected].map(n=>[n,new Set()]));
  const outgoing=new Map([...selected].map(n=>[n,new Set()]));
  for(const link of graph.connections){
    if(!selected.has(link.from.skillNodeId)||!selected.has(link.to.skillNodeId))continue;
    if(link.kind==='flow'){
      const from=skillNodes.get(link.from.skillNodeId),to=skillNodes.get(link.to.skillNodeId);
      const source=defs.get(from?.skillDefinitionRef.definitionId+':'+from?.skillDefinitionRef.version);
      const destination=defs.get(to?.skillDefinitionRef.definitionId+':'+to?.skillDefinitionRef.version);
      if(!isFlowPort(source,link.from.port,'outputs')||!isFlowPort(destination,link.to.port,'inputs'))reject('PORT_MISMATCH');
    }
    if(!['flow','data'].includes(link.kind)) reject('UNKNOWN_EDGE_KIND');
    parents.get(link.to.skillNodeId).add(link.from.skillNodeId);
    outgoing.get(link.from.skillNodeId).add(link.to.skillNodeId);
  }
  for(const skillNodeId of selected){
    const skillNode=skillNodes.get(skillNodeId),definition=defs.get(skillNode?.skillDefinitionRef.definitionId+':'+skillNode?.skillDefinitionRef.version);
    if(!definition)reject('PLAN_DEFINITION_NOT_FOUND');
    if(definition.executorKind==='subgraph')reject('SUBGRAPH_EXECUTOR_NOT_IMPLEMENTED',501);
    const inputs=new Map((definition.inputs||[]).map(p=>[p.name,p])),bound=skillNode.inputBindings||{};
    const incoming=graph.connections.filter(l=>l.kind==='data'&&l.to.skillNodeId===skillNodeId),ports=new Set(),sources=new Set();
    for(const link of incoming){
      const sourceKey=JSON.stringify([link.from.skillNodeId,link.from.port,link.to.port]);
      if(sources.has(sourceKey))reject('DUPLICATE_INPUT_SOURCE');
      sources.add(sourceKey);
      const input=inputs.get(link.to.port);
      if(Object.hasOwn(bound,link.to.port)||ports.has(link.to.port)&&input?.multiple===false)
        reject('AMBIGUOUS_INPUT_PRODUCERS');
      ports.add(link.to.port);
      const parent=skillNodes.get(link.from.skillNodeId),parentDef=defs.get(parent?.skillDefinitionRef.definitionId+':'+parent?.skillDefinitionRef.version);
      const out=parentDef?.outputs.find(p=>p.name===link.from.port);
      if(!out||!input||!compatibleDataRepresentation(out.representation,input.representation))reject('PORT_MISMATCH');
    }
    for(const name of Object.keys(bound))if(!inputs.has(name))reject('UNKNOWN_INPUT_PORT');
    for(const port of inputs.values())if(port.required===true&&!ports.has(port.name)&&!Object.hasOwn(bound,port.name))reject('REQUIRED_INPUT_MISSING');
  }
  const remaining=new Map([...parents].map(([n,p])=>[n,p.size]));
  const ready=[...selected].filter(n=>remaining.get(n)===0).sort();
  const order=[];
  while(ready.length){
    const skillNodeId=ready.shift();const skillNode=skillNodes.get(skillNodeId);
    if(!skillNode)reject('PLAN_SKILL_NODE_NOT_FOUND');
    const definition=defs.get(skillNode.skillDefinitionRef.definitionId+':'+skillNode.skillDefinitionRef.version);
    if(!definition)reject('PLAN_DEFINITION_NOT_FOUND');
    if(!['model_task','tool_task','subgraph'].includes(definition.executorKind))reject('UNSUPPORTED_EXECUTOR_KIND');
    order.push({skillNodeId,skillNode,definition,predecessors:[...parents.get(skillNodeId)].sort()});
    for(const next of outgoing.get(skillNodeId)){remaining.set(next,remaining.get(next)-1);if(!remaining.get(next)){ready.push(next);ready.sort();}}
  }
  if(order.length!==selected.size) reject('PLAN_DEPENDENCY_CYCLE');
  return {graphRef:{...run.graphRef},planEpoch:run.planEpoch,targets:[...run.targets],order};
}
