(function(global){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const validRef=v=>typeof v==='string'&&v.length>0&&v.length<=160;
  const key=ref=>'pointer:'+ref.definitionId+':'+ref.version;
  const builtin=/^builtin:(research|organize|judge|write|file|createFile)$/;
  function projectGraph(snapshot,previous,baseDefinitions={}){
    if(!isObject(snapshot)||!isObject(snapshot.graph)||!Array.isArray(snapshot.graph.nodes)||
      !Array.isArray(snapshot.graph.connections)||!Array.isArray(snapshot.definitions)||
      !Number.isInteger(snapshot.graph.revision))throw new Error('INVALID_GRAPH_SNAPSHOT');
    const defs=new Map(),definitions={},prior=new Map((previous?.nodes||[]).map(n=>[n.id,n]));
    const typeFor=ref=>ref.version===1&&builtin.test(ref.definitionId)?
      ref.definitionId.slice(8):key(ref);
    for(const def of snapshot.definitions){
      if(!validRef(def.definitionId)||!Number.isInteger(def.version)||def.version<1||
        !Array.isArray(def.inputs)||!Array.isArray(def.outputs))throw new Error('INVALID_NODE_DEFINITION');
      defs.set(key(def),def);
      const type=typeFor(def);
      if(definitions[type])continue;
      if(type===def.definitionId.slice(8)&&baseDefinitions[type]){
        // Builtins retain the existing server-owned visual contract.
        definitions[type]=clone(baseDefinitions[type]);
        continue;
      }
      const port=p=>({id:p.name,name:p.role||p.name,type:p.representation,
        accepts:[p.representation],required:p.required===true,multiple:true});
      definitions[type]={name:def.presentation?.name||def.purpose.slice(0,100),desc:def.purpose,
        color:/^#[0-9a-f]{6}$/i.test(def.presentation?.color||'')?def.presentation.color:'#7C6CF2',
        iconKey:def.presentation?.iconKey||'sparkle',tag:type.startsWith('pointer:')?'AI':type.toUpperCase(),
        inputs:def.inputs.map(port),outputs:type==='createFile'?[]:def.outputs.map(port),
        params:[{id:'request',name:'요청사항',kind:'request',maxLength:2400,default:''}],
        ...(type.startsWith('pointer:')?{catalog:{group:'custom',groupLabel:'내 노드'}}:{})};
    }
    const nodes=snapshot.graph.nodes.map(node=>{
      if(!validRef(node.nodeId)||!isObject(node.definitionRef))throw new Error('INVALID_GRAPH_NODE');
      const def=defs.get(key(node.definitionRef)),type=typeFor(node.definitionRef);
      if(!def)throw new Error('UNRESOLVED_NODE_DEFINITION');
      const earlier=prior.get(node.nodeId);
      const incoming={id:node.nodeId,type,params:{request:node.settings?.request??''},
        data:{...(node.settings?.file||{}),pointer:{definitionRef:clone(node.definitionRef),
          inputBindings:clone(node.inputBindings||{})}},
        expanded:earlier?.expanded??false};
      if(Number.isFinite(earlier?.x)&&Number.isFinite(earlier?.y)){
        incoming.x=earlier.x;incoming.y=earlier.y;
      }
      return incoming;
    });
    const nodeIds=new Set(nodes.map(n=>n.id)),links=[],data=[];
    const types=new Map(nodes.map(n=>[n.id,n.type]));
    const visiblePort=(nodeId,name,direction,kind)=>{
      const ports=definitions[types.get(nodeId)]?.[direction]||[];
      if(ports.some(p=>p.id===name))return name;
      if(kind==='flow'&&((direction==='outputs'&&/^flow_next_*$|^next$/.test(name))||
        (direction==='inputs'&&/^flow_in_*$|^in$/.test(name)))&&ports.length)
        return ports[0].id;
      throw new Error('UNREPRESENTABLE_GRAPH_PORT');
    };
    for(const link of snapshot.graph.connections){
      if(!validRef(link?.from?.nodeId)||!validRef(link?.to?.nodeId)||
        !nodeIds.has(link.from.nodeId)||!nodeIds.has(link.to.nodeId)||
        !validRef(link.from.port)||!validRef(link.to.port))throw new Error('INVALID_GRAPH_CONNECTION');
      if(!['flow','data'].includes(link.kind))throw new Error('UNSUPPORTED_CONNECTION_KIND');
      const fromPort=visiblePort(link.from.nodeId,link.from.port,'outputs',link.kind);
      const toPort=visiblePort(link.to.nodeId,link.to.port,'inputs',link.kind);
      (link.kind==='data'?data:links).push([
        link.from.nodeId+'.'+fromPort,link.to.nodeId+'.'+toPort
      ]);
    }
    return {graphId:snapshot.graph.graphId,revision:snapshot.graph.revision,
      definitions,workflow:{nodes,links,data}};
  }
  function applyGraph(canvas,snapshot,restoredView){
    if(!canvas?.getWorkflow||!canvas?.getBaseNodeDefinitions||
      !canvas?.setNodeDefinitions||!canvas?.applyWorkflowIR)throw new Error('POINTER_CANVAS_UNAVAILABLE');
    const base=canvas.getBaseNodeDefinitions();
    const projected=projectGraph(snapshot,Array.isArray(restoredView?.nodes)?restoredView:canvas.getWorkflow(),base);
    const legacy=Object.fromEntries(Object.entries(base)
      .filter(([type])=>!type.startsWith('pointer:')));
    canvas.setNodeDefinitions({...legacy,...projected.definitions});
    canvas.applyWorkflowIR(projected.workflow,{center:false});
    return projected;
  }
  function statusNode(node){
    if(!node||!validRef(node.nodeId))throw new Error('INVALID_RUN_NODE');
    const mapping={running:'RUNNING',success:'SUCCESS',failed:'FAILED',cancelled:'SKIPPED',
      outcome_unknown:'FAILED'};
    const status=mapping[node.status];
    if(!status)return null;
    return {nodeId:node.nodeId,status,state:{status,
      report:status==='SUCCESS'?'결과 저장 완료':node.reason||node.code||'',
      ...(status==='SUCCESS'?{result:{outputRefs:clone(node.outputRefs||[])}}:
        status==='FAILED'?{error:{code:node.code||'NODE_EXECUTION_FAILED'}}:{})}};
  }
  function applyRunState(canvas,result){
    if(!isObject(result?.run)||!Array.isArray(result.nodes))throw new Error('INVALID_RUN_STATE');
    for(const node of result.nodes){
      const event=statusNode(node);
      if(event)canvas?.setRuntimeNodeState?.(event.nodeId,event.state);
    }
    return result.run.status;
  }
  function artifactPreview(contents){
    if(!Array.isArray(contents))throw new Error('INVALID_ARTIFACT_LIST');
    return contents.slice(0,3).map(entry=>{
      if(!isObject(entry?.artifact)||!isObject(entry?.content))return '';
      const value=entry.content.value;
      const raw=typeof value==='string'?value:JSON.stringify(value);
      if(!raw)return '';
      const role=entry.artifact.semanticRole||'결과';
      return String(role).slice(0,35)+': '+raw.replace(/\s+/g,' ').slice(0,140);
    }).filter(Boolean).join(' · ').slice(0,220);
  }
  global.OvllPointerProjection=Object.freeze({projectGraph,applyGraph,statusNode,applyRunState,artifactPreview});
})(window);
