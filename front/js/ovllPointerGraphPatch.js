(function(global){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const safe=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(s);
  const fail=code=>{const e=new Error(code);e.code=code;throw e;};
  const refKey=d=>'pointer:'+d.definitionId+':'+d.version;
  const typeFor=d=>d.version===1&&/^builtin:(research|organize|judge|write|file|createFile)$/.test(d.definitionId)?d.definitionId.slice(8):refKey(d);
  function settingsFor(node,prior={}){
    const settings={...prior};
    const request=node.data?.params?.request??node.params?.request;
    if(typeof request==='string'){
      if(request.length>2400)fail('INVALID_NODE_INSTRUCTION');
      if(request.length||Object.hasOwn(prior,'request'))settings.request=request;
    }
    if(node.type==='file'){
      const file={};for(const k of ['localFileId','name','mime','size','downloadUrl','previewUrl','textPreview','textTruncated'])
        if(node.data?.[k]!==undefined)file[k]=node.data[k];
      settings.file=file;
    }
    return settings;
  }
  function build(snapshot,workflow){
    const graph=snapshot?.graph;
    if(!graph||!safe(graph.graphId)||!Number.isInteger(graph.revision)||
      !Array.isArray(graph.nodes)||!Array.isArray(graph.connections)||
      !Array.isArray(snapshot.definitions)||!Array.isArray(workflow?.nodes)||
      !Array.isArray(workflow?.connections))fail('INVALID_GRAPH_EDIT');
    const before=new Map(graph.nodes.map(n=>[n.nodeId,n]));
    const after=new Map(),defs=new Map(snapshot.definitions.flatMap(d=>[[typeFor(d),d],[refKey(d),d]]));
    const operations=[],definitions=[],added=new Map(),moved=new Map();
    // Confirmed result files are projected UI entries until a user connects one.
    const connected=new Set(workflow.connections.flatMap(link=>[link?.from?.node,link?.to?.node]));
    const editableNodes=workflow.nodes.filter(node=>node?.type!=='file'||
      node.data?.generated!==true||before.has(node.id)||connected.has(node.id));
    for(const [i,node] of editableNodes.entries()){
      if(!safe(node?.id)||after.has(node.id))fail('INVALID_CANVAS_NODE');
      after.set(node.id,node);
      if(!before.has(node.id)){
        const def=defs.get(node.type);
        if(!def)fail('UNSUPPORTED_UI_NODE_TYPE');
        const localNodeKey='new'+i;
        added.set(node.id,localNodeKey);
      }else if(!defs.has(node.type))fail('UNSUPPORTED_UI_NODE_TYPE');
    }
    // New instances inherit the type's control sockets, but no instance metadata.
    const typePortMaps=new Map();
    if(global.OvllPointerProjection?.projectGraph){
      for(const node of global.OvllPointerProjection.projectGraph(snapshot).workflow.nodes)
        typePortMaps.set(node.type,node.data.pointer.portMap);
    }
    for(const node of after.values())if(!typePortMaps.has(node.type)&&node.data?.pointer?.portMap)
      typePortMaps.set(node.type,node.data.pointer.portMap);
    const key=(kind,from,fromPort,to,toPort)=>JSON.stringify([kind,from,fromPort,to,toPort]);
    const original=new Map();
    for(const link of graph.connections){
      const k=key(link.kind,link.from.nodeId,link.from.port,link.to.nodeId,link.to.port);
      if(original.has(k))fail('DUPLICATE_GRAPH_CONNECTION');
      original.set(k,link);
    }
    const desired=new Map();
    for(const link of workflow.connections){
      const source=defs.get(after.get(link?.from?.node)?.type),destination=defs.get(after.get(link?.to?.node)?.type);
      const declared=link?.data?.kind;
      if(declared!==undefined&&!['links','flow','data'].includes(declared))fail('INVALID_CANVAS_CONNECTION_KIND');
      const kind=declared==='links'?'flow':declared||
        (source?.outputs.some(p=>p.name===link?.from?.port)&&destination?.inputs.some(p=>p.name===link?.to?.port)?'data':'flow');
      const f=link?.from,t=link?.to;
      if(!safe(f?.node)||!safe(t?.node)||!safe(f.port)||!safe(t.port)||
        !after.has(f.node)||!after.has(t.node))fail('INVALID_CANVAS_CONNECTION');
      const logical=(endpoint,direction)=>({...endpoint,port:kind==='flow'?
        typePortMaps.get(after.get(endpoint.node)?.type)?.[direction]?.[endpoint.port]||endpoint.port:endpoint.port});
      const from=logical(f,'outputs'),to=logical(t,'inputs');
      const k=key(kind,from.node,from.port,to.node,to.port);
      if(desired.has(k))fail('DUPLICATE_CANVAS_CONNECTION');
      desired.set(k,{kind,from,to});
    }
    // A new data wire chooses this input's producer instead of its literal binding.
    const rebound=new Map();
    for(const [k,link] of desired)if(link.kind==='data'&&!original.has(k)){
      const id=link.to.node;
      const bindings=rebound.get(id)||{...(after.get(id).data?.pointer?.inputBindings??before.get(id)?.inputBindings??{})};
      delete bindings[link.to.port];
      rebound.set(id,bindings);
    }
    for(const [k,link] of original)if(!desired.has(k))
      operations.push({op:'link.remove',linkId:link.id});
    for(const id of before.keys())if(!after.has(id))operations.push({op:'node.delete',nodeId:id});
    for(const [id,localNodeKey] of added){
      const node=after.get(id),def=defs.get(node.type);
      operations.push({op:'node.add',localNodeKey,
        definitionRef:{definitionId:def.definitionId,version:def.version},
        inputBindings:rebound.get(id)||node.data?.pointer?.inputBindings||{},settings:settingsFor(node)});
      moved.set(id,localNodeKey);
    }
    for(const [id,prior] of before){
      const node=after.get(id);
      if(!node)continue;
      const prevDef=defs.get(typeFor(prior.definitionRef));
      if(!prevDef)fail('MISSING_GRAPH_DEFINITION');
      const selected=defs.get(node.type);
      const currentRef=prior.definitionRef;
      const changes={};
      if(node.type!==typeFor(currentRef))
        changes.definitionRef={definitionId:selected.definitionId,version:selected.version};
      const uiBindings=rebound.get(id)??node.data?.pointer?.inputBindings;
      if(uiBindings!==undefined&&!same(uiBindings,prior.inputBindings||{}))
        changes.inputBindings=uiBindings;
      const settings=settingsFor(node,prior.settings||{});
      if(!same(settings,prior.settings||{}))changes.settings=settings;
      if(Object.keys(changes).length)operations.push({op:'node.update',nodeId:id,...changes});
    }
    for(const [k,link] of desired)if(!original.has(k)){
      const endpoint=ref=>({node:added.has(ref.node)?{localNodeKey:added.get(ref.node)}:{nodeId:ref.node},port:ref.port});
      operations.push({op:'link.add',localLinkKey:'newlink'+operations.length,
        kind:link.kind,from:endpoint(link.from),to:endpoint(link.to)});
    }
    if(!operations.length&&!definitions.length)return null;
    return {patch:{graphId:graph.graphId,expectedGraphRevision:graph.revision,definitions,operations},
      newNodeKeys:Object.fromEntries(moved)};
  }
  function resolvedView(workflow,createdRefs,newNodeKeys){
    return {nodes:(workflow?.nodes||[]).map(node=>({
      id:createdRefs?.['node:'+newNodeKeys?.[node.id]]||node.id,
      x:node.x,y:node.y,expanded:node.expanded
    }))};
  }
  global.OvllPointerGraphPatch=Object.freeze({build,resolvedView});
})(window);
