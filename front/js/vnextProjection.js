(function(global){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const validRef=v=>typeof v==='string'&&v.length>0&&v.length<=160;
  const key=ref=>'vnext:'+ref.definitionId+':'+ref.version;
  function projectGraph(snapshot,previous){
    if(!isObject(snapshot)||!isObject(snapshot.graph)||!Array.isArray(snapshot.graph.nodes)||
      !Array.isArray(snapshot.graph.connections)||!Array.isArray(snapshot.definitions)||
      !Number.isInteger(snapshot.graph.revision))throw new Error('INVALID_GRAPH_SNAPSHOT');
    const defs=new Map(),definitions={},prior=new Map((previous?.nodes||[]).map(n=>[n.id,n]));
    for(const def of snapshot.definitions){
      if(!validRef(def.definitionId)||!Number.isInteger(def.version)||def.version<1||
        !Array.isArray(def.inputs)||!Array.isArray(def.outputs))throw new Error('INVALID_NODE_DEFINITION');
      defs.set(key(def),def);
    }
    const nodes=snapshot.graph.nodes.map(node=>{
      if(!validRef(node.nodeId)||!isObject(node.definitionRef))throw new Error('INVALID_GRAPH_NODE');
      const type=key(node.definitionRef),def=defs.get(type);
      if(!def)throw new Error('UNRESOLVED_NODE_DEFINITION');
      if(!definitions[type]){
        const port=p=>({id:p.name,name:p.role||p.name,type:'any',accepts:['any'],
          required:p.required===true,multiple:true});
        definitions[type]={name:def.purpose.slice(0,100),desc:def.purpose,
          color:'#888888',iconKey:'',tag:'AI',
          inputs:[...def.inputs.map(port),...(!def.inputs.some(p=>p.name==='in')?
            [{id:'in',name:'진입',type:'any',accepts:['any'],multiple:true}]:[])],
          outputs:[...def.outputs.map(port),...(!def.outputs.some(p=>p.name==='next')?
            [{id:'next',name:'다음',type:'any',accepts:['any'],multiple:true}]:[])],
          params:[{id:'request',name:'요청',type:'textarea',default:def.instruction}]};
      }
      const earlier=prior.get(node.nodeId);
      const incoming={id:node.nodeId,type,params:{request:def.instruction},
        data:{vnext:{definitionRef:clone(node.definitionRef),inputBindings:clone(node.inputBindings||{})}},
        expanded:earlier?.expanded??false};
      if(Number.isFinite(earlier?.x)&&Number.isFinite(earlier?.y)){
        incoming.x=earlier.x;incoming.y=earlier.y;
      }
      return incoming;
    });
    const nodeIds=new Set(nodes.map(n=>n.id)),links=[],data=[];
    for(const link of snapshot.graph.connections){
      if(!validRef(link?.from?.nodeId)||!validRef(link?.to?.nodeId)||
        !nodeIds.has(link.from.nodeId)||!nodeIds.has(link.to.nodeId)||
        !validRef(link.from.port)||!validRef(link.to.port))throw new Error('INVALID_GRAPH_CONNECTION');
      if(!['flow','data'].includes(link.kind))throw new Error('UNSUPPORTED_CONNECTION_KIND');
      (link.kind==='data'?data:links).push([
        link.from.nodeId+'.'+link.from.port,link.to.nodeId+'.'+link.to.port
      ]);
    }
    return {graphId:snapshot.graph.graphId,revision:snapshot.graph.revision,
      definitions,workflow:{nodes,links,data}};
  }
  function applyGraph(canvas,snapshot,restoredView){
    if(!canvas?.getWorkflow||!canvas?.getBaseNodeDefinitions||
      !canvas?.setNodeDefinitions||!canvas?.applyWorkflowIR)throw new Error('VNEXT_CANVAS_UNAVAILABLE');
    const projected=projectGraph(snapshot,Array.isArray(restoredView?.nodes)?restoredView:canvas.getWorkflow());
    const legacy=Object.fromEntries(Object.entries(canvas.getBaseNodeDefinitions())
      .filter(([type])=>!type.startsWith('vnext:')));
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
  global.OvllVNextProjection=Object.freeze({projectGraph,applyGraph,statusNode,applyRunState,artifactPreview});
})(window);
