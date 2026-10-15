(function(global){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const safe=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(s);
  const fail=code=>{const e=new Error(code);e.code=code;throw e;};
  const refKey=d=>'pointer:'+d.definitionId+':'+d.version;
  const typeFor=d=>d.version===1&&/^builtin:(research|organize|judge|write|file|createFile)$/.test(d.definitionId)?d.definitionId.slice(8):refKey(d);
  const supportedTypes=snapshot=>new Set((snapshot?.skillDefinitions||[]).map(typeFor));
  function settingsFor(skillNode,prior={}){
    const settings={...prior};
    const request=skillNode.data?.params?.request??skillNode.params?.request;
    if(typeof request==='string'){
      if(request.length>2400)fail('INVALID_SKILL_NODE_INSTRUCTION');
      if(request.length||Object.hasOwn(prior,'request'))settings.request=request;
    }
    if(skillNode.type==='file'){
      const file={};for(const k of ['localFileId','name','mime','size','downloadUrl','previewUrl','textPreview','textTruncated'])
        if(skillNode.data?.[k]!==undefined)file[k]=skillNode.data[k];
      settings.file=file;
    }
    return settings;
  }
  function build(snapshot,workflow){
    const graph=snapshot?.graph;
    if(!graph||!safe(graph.graphId)||!Number.isInteger(graph.revision)||
      !Array.isArray(graph.skillNodes)||!Array.isArray(graph.connections)||
      !Array.isArray(snapshot.skillDefinitions)||!Array.isArray(workflow?.skillNodes)||
      !Array.isArray(workflow?.connections))fail('INVALID_GRAPH_EDIT');
    const before=new Map(graph.skillNodes.map(n=>[n.skillNodeId,n]));
    const after=new Map(),defs=new Map(snapshot.skillDefinitions.flatMap(d=>[[typeFor(d),d],[refKey(d),d]]));
    const operations=[],skillDefinitions=[],added=new Map(),moved=new Map();
    // Confirmed result files are projected UI entries until a user connects one.
    const connected=new Set(workflow.connections.flatMap(link=>[link?.from?.skillNode,link?.to?.skillNode]));
    const editableSkillNodes=workflow.skillNodes.filter(skillNode=>skillNode?.type!=='file'||
      skillNode.data?.generated!==true||before.has(skillNode.id)||connected.has(skillNode.id));
    for(const [i,skillNode] of editableSkillNodes.entries()){
      if(!safe(skillNode?.id)||after.has(skillNode.id))fail('INVALID_CANVAS_SKILL_NODE');
      after.set(skillNode.id,skillNode);
      if(!before.has(skillNode.id)){
        const def=defs.get(skillNode.type);
        if(!def)fail('UNSUPPORTED_UI_SKILL_NODE_TYPE');
        const localSkillNodeKey='new'+i;
        added.set(skillNode.id,localSkillNodeKey);
      }else if(!defs.has(skillNode.type))fail('UNSUPPORTED_UI_SKILL_NODE_TYPE');
    }
    // Compare visible links to their exact saved identities before converting ports.
    const typePortMaps=new Map(),projectedLinks=new Map();
    if(global.OvllPointerProjection?.projectGraph){
      const projected=global.OvllPointerProjection.projectGraph(snapshot);
      for(const skillNode of projected.workflow.skillNodes)
        typePortMaps.set(skillNode.type,skillNode.data.pointer.portMap);
      for(const link of projected.workflow.connections)
        if(link.id)projectedLinks.set(link.id,link);
    }
    for(const skillNode of after.values())if(!typePortMaps.has(skillNode.type)&&skillNode.data?.pointer?.portMap)
      typePortMaps.set(skillNode.type,skillNode.data.pointer.portMap);
    const key=(kind,from,fromPort,to,toPort)=>JSON.stringify([kind,from,fromPort,to,toPort]);
    const original=new Map(),originalById=new Map();
    for(const link of graph.connections){
      if(link.id)originalById.set(link.id,link);
      const k=key(link.kind,link.from.skillNodeId,link.from.port,link.to.skillNodeId,link.to.port);
      if(original.has(k))fail('DUPLICATE_GRAPH_CONNECTION');
      original.set(k,link);
    }
    const desired=new Map();
    for(const link of workflow.connections){
      const source=defs.get(after.get(link?.from?.skillNode)?.type),destination=defs.get(after.get(link?.to?.skillNode)?.type);
      const declared=link?.data?.kind;
      if(declared!==undefined&&!['links','flow','data'].includes(declared))fail('INVALID_CANVAS_CONNECTION_KIND');
      const kind=declared==='links'?'flow':declared||
        (source?.outputs.some(p=>p.name===link?.from?.port)&&destination?.inputs.some(p=>p.name===link?.to?.port)?'data':'flow');
      const f=link?.from,t=link?.to;
      if(!safe(f?.skillNode)||!safe(t?.skillNode)||!safe(f.port)||!safe(t.port)||
        !after.has(f.skillNode)||!after.has(t.skillNode))fail('INVALID_CANVAS_CONNECTION');
      const previous=originalById.get(link.id),visible=projectedLinks.get(link.id);
      const unchanged=previous&&visible&&previous.kind===kind&&
        visible.from.skillNode===f.skillNode&&visible.from.port===f.port&&
        visible.to.skillNode===t.skillNode&&visible.to.port===t.port;
      const logical=(endpoint,direction)=>{
        const type=after.get(endpoint.skillNode)?.type;
        const declared=defs.get(type)?.[direction]||[];
        const mapped=kind==='flow'&&!declared.some(p=>p.name===endpoint.port)?
          typePortMaps.get(type)?.[direction]?.[endpoint.port]:null;
        return {...endpoint,port:mapped||endpoint.port};
      };
      const from=unchanged?{skillNode:f.skillNode,port:previous.from.port}:logical(f,'outputs');
      const to=unchanged?{skillNode:t.skillNode,port:previous.to.port}:logical(t,'inputs');
      const k=key(kind,from.skillNode,from.port,to.skillNode,to.port);
      if(desired.has(k))fail('DUPLICATE_CANVAS_CONNECTION');
      desired.set(k,{kind,from,to});
    }
    // A new data wire chooses this input's producer instead of its literal binding.
    const rebound=new Map();
    for(const [k,link] of desired)if(link.kind==='data'&&!original.has(k)){
      const id=link.to.skillNode;
      const bindings=rebound.get(id)||{...(after.get(id).data?.pointer?.inputBindings??before.get(id)?.inputBindings??{})};
      delete bindings[link.to.port];
      rebound.set(id,bindings);
    }
    for(const [k,link] of original)if(!desired.has(k))
      operations.push({op:'link.remove',linkId:link.id});
    for(const id of before.keys())if(!after.has(id))operations.push({op:'skillNode.delete',skillNodeId:id});
    for(const [id,localSkillNodeKey] of added){
      const skillNode=after.get(id),def=defs.get(skillNode.type);
      operations.push({op:'skillNode.add',localSkillNodeKey,
        skillDefinitionRef:{definitionId:def.definitionId,version:def.version},
        inputBindings:rebound.get(id)||skillNode.data?.pointer?.inputBindings||{},settings:settingsFor(skillNode)});
      moved.set(id,localSkillNodeKey);
    }
    for(const [id,prior] of before){
      const skillNode=after.get(id);
      if(!skillNode)continue;
      const prevDef=defs.get(typeFor(prior.skillDefinitionRef));
      if(!prevDef)fail('MISSING_GRAPH_DEFINITION');
      const selected=defs.get(skillNode.type);
      const currentRef=prior.skillDefinitionRef;
      const changes={};
      if(skillNode.type!==typeFor(currentRef))
        changes.skillDefinitionRef={definitionId:selected.definitionId,version:selected.version};
      const uiBindings=rebound.get(id)??skillNode.data?.pointer?.inputBindings;
      if(uiBindings!==undefined&&!same(uiBindings,prior.inputBindings||{}))
        changes.inputBindings=uiBindings;
      const settings=settingsFor(skillNode,prior.settings||{});
      if(!same(settings,prior.settings||{}))changes.settings=settings;
      if(Object.keys(changes).length)operations.push({op:'skillNode.update',skillNodeId:id,...changes});
    }
    for(const [k,link] of desired)if(!original.has(k)){
      const endpoint=ref=>({skillNode:added.has(ref.skillNode)?{localSkillNodeKey:added.get(ref.skillNode)}:{skillNodeId:ref.skillNode},port:ref.port});
      operations.push({op:'link.add',localLinkKey:'newlink'+operations.length,
        kind:link.kind,from:endpoint(link.from),to:endpoint(link.to)});
    }
    if(!operations.length&&!skillDefinitions.length)return null;
    return {patch:{graphId:graph.graphId,expectedGraphRevision:graph.revision,skillDefinitions,operations},
      newSkillNodeKeys:Object.fromEntries(moved)};
  }
  function resolvedView(workflow,createdRefs,newSkillNodeKeys){
    return {skillNodes:(workflow?.skillNodes||[]).map(skillNode=>({
      id:createdRefs?.['skillNode:'+newSkillNodeKeys?.[skillNode.id]]||skillNode.id,
      x:skillNode.x,y:skillNode.y,expanded:skillNode.expanded
    }))};
  }
  global.OvllPointerGraphPatch=Object.freeze({build,resolvedView,supportedTypes});
})(window);
