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
        definitions[type].inputs=(definitions[type].inputs||[]).map(p=>({...p,multiple:false,channel:'data'}));
        definitions[type].outputs=(definitions[type].outputs||[]).map(p=>({...p,channel:'data'}));
        continue;
      }
      const port=(p,input=false)=>({id:p.name,name:p.role||p.name,type:p.representation,
        accepts:[p.representation],required:p.required===true,
        channel:'data',multiple:!input});
      definitions[type]={name:def.presentation?.name||def.purpose.slice(0,100),desc:def.purpose,
        color:/^#[0-9a-f]{6}$/i.test(def.presentation?.color||'')?def.presentation.color:'#7C6CF2',
        iconKey:def.presentation?.iconKey||'sparkle',tag:type.startsWith('pointer:')?'AI':type.toUpperCase(),
        inputs:def.inputs.map(p=>port(p,true)),outputs:type==='createFile'?[]:def.outputs.map(p=>port(p)),
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
    const nodeIds=new Set(nodes.map(n=>n.id)),links=[],data=[],connections=[];
    const types=new Map(nodes.map(n=>[n.id,n.type]));
    const flowMaps=new Map(nodes.map(node=>[node.type,{inputs:{},outputs:{}}]));
    const visiblePort=(nodeId,name,direction,kind)=>{
      const ui=definitions[types.get(nodeId)],ports=ui?.[direction]||[];
      const def=defs.get(key(snapshot.graph.nodes.find(n=>n.nodeId===nodeId).definitionRef));
      const logical=(def[direction]||[]).find(p=>p.name===name);
      if(kind==='data'){
        if(logical&&ports.some(p=>p.id===name&&p.channel!=='flow'))return name;
        throw new Error('UNREPRESENTABLE_GRAPH_PORT');
      }
      const reserved=(direction==='outputs'?/^(next|flow_next_*)$/:/^(in|flow_in_*)$/).test(name);
      if(!logical&&!reserved)throw new Error('UNREPRESENTABLE_GRAPH_PORT');
      const mapped=flowMaps.get(types.get(nodeId))[direction];
      if(mapped[name])return mapped[name];
      let id=name;
      if(logical){
        const base='__flow_'+(direction==='outputs'?'out_':'in_')+name.slice(0,130);
        id=base;let suffix=0;
        while(ports.some(p=>p.id===id))id=base+'_'+(++suffix);
      }
      if(!ports.some(p=>p.id===id&&p.channel==='flow'))ports.push({id,
        name:direction==='outputs'?(def.requiredCapabilities?.includes('branch.exclusive')?logical?.role||name:'다음'):'진행',
        type:'control_flow',accepts:['control_flow'],channel:'flow',multiple:true,required:false});
      ui[direction]=ports;mapped[name]=id;
      return id;
    };
    for(const link of snapshot.graph.connections){
      if(!validRef(link?.from?.nodeId)||!validRef(link?.to?.nodeId)||
        !nodeIds.has(link.from.nodeId)||!nodeIds.has(link.to.nodeId)||
        !validRef(link.from.port)||!validRef(link.to.port))throw new Error('INVALID_GRAPH_CONNECTION');
      if(!['flow','data'].includes(link.kind))throw new Error('UNSUPPORTED_CONNECTION_KIND');
      const fromPort=visiblePort(link.from.nodeId,link.from.port,'outputs',link.kind);
      const toPort=visiblePort(link.to.nodeId,link.to.port,'inputs',link.kind);
      connections.push({id:link.id,from:{node:link.from.nodeId,port:fromPort},
        to:{node:link.to.nodeId,port:toPort},data:{kind:link.kind,
          pointer:{linkId:link.id,kind:link.kind,from:clone(link.from),to:clone(link.to)}}});
      (link.kind==='data'?data:links).push([
        link.from.nodeId+'.'+fromPort,link.to.nodeId+'.'+toPort
      ]);
    }
    for(const node of nodes){
      const mapped=flowMaps.get(node.type);
      node.data.pointer.portMap={inputs:Object.fromEntries(Object.entries(mapped.inputs).map(([logical,visible])=>[visible,logical])),
        outputs:Object.fromEntries(Object.entries(mapped.outputs).map(([logical,visible])=>[visible,logical]))};
    }
    return {graphId:snapshot.graph.graphId,revision:snapshot.graph.revision,
      definitions,workflow:{nodes,links,data,connections}};
  }
  function resultFileNodes(snapshot,verified=[],previous=[]){
    const graph=snapshot?.graph;
    if(!Array.isArray(graph?.nodes))return [];
    const nodeIds=new Set(graph.nodes.map(n=>n.nodeId));
    const canonicalFiles=new Set(graph.nodes.filter(n=>n.definitionRef?.definitionId==='builtin:file')
      .map(n=>n.settings?.file?.localFileId).filter(Boolean));
    const positions=new Map((previous||[]).map(n=>[n.id,n]));
    const previousFiles=new Map((previous||[]).filter(n=>n.type==='file'&&n.data?.generated===true)
      .map(n=>[n.data.artifactId,n]));
    const latest=new Map();
    for(const row of verified)if(nodeIds.has(row?.nodeId))latest.set(row.nodeId,row);
    const seen=new Set(),files=[];
    for(const [sourceId,row] of latest){
      if(row.status!=='success'||row.resultCurrent===false||
        row.toolEffectStarted!==true||row.effectConfirmed!==true)continue;
      for(const output of Object.values(row.outputs?.values||{})){
        const artifact=output?.inline;
        if(!isObject(artifact))continue;
        const artifactId=String(artifact.id||''),url=String(artifact.downloadUrl||'');
        if(!/^[A-Za-z0-9_.:-]{1,135}$/.test(artifactId)||
          !/^(https?:\/\/|\/(?!\/)|blob:)/.test(url)||/[\s()<>\"']/.test(url)||
          seen.has(artifactId)||(artifact.localFileId&&canonicalFiles.has(artifact.localFileId)))continue;
        seen.add(artifactId);
        const prior=previousFiles.get(artifactId),source=positions.get(sourceId);
        files.push({id:'result:'+artifactId,type:'file',expanded:prior?.expanded??false,
          x:Number.isFinite(prior?.x)?prior.x:(Number(source?.x)||0)+220,
          y:Number.isFinite(prior?.y)?prior.y:(Number(source?.y)||0)+(files.length%3)*54,
          data:{generated:true,artifactId,sourceNodeId:sourceId,
            localFileId:artifact.localFileId||'',name:artifact.name||'결과물',
            mime:artifact.mime||'application/octet-stream',size:Number(artifact.size)||0,
            format:artifact.format||'',renderer:artifact.renderer||'',
            targetPages:artifact.targetPages??null,previewKind:artifact.previewKind||'',
            previewText:artifact.previewText||'',downloadUrl:url,
            previewUrl:artifact.previewUrl||url}});
      }
    }
    return files;
  }
  function applyGraph(canvas,snapshot,restoredView,extraNodes=[]){
    if(!canvas?.getWorkflow||!canvas?.getBaseNodeDefinitions||
      !canvas?.setNodeDefinitions||!canvas?.applyWorkflowIR)throw new Error('POINTER_CANVAS_UNAVAILABLE');
    const base=canvas.getBaseNodeDefinitions();
    const projected=projectGraph(snapshot,Array.isArray(restoredView?.nodes)?restoredView:canvas.getWorkflow(),base);
    const known=new Set(projected.workflow.nodes.map(n=>n.id));
    for(const node of extraNodes){
      if(node?.type!=='file'||node.data?.generated!==true||known.has(node.id))continue;
      projected.workflow.nodes.push(clone(node));known.add(node.id);
    }
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
  global.OvllPointerProjection=Object.freeze({projectGraph,applyGraph,resultFileNodes,statusNode,applyRunState,artifactPreview});
})(window);
