(function(global){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const safe=s=>typeof s==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(s);
  const fail=code=>{const e=new Error(code);e.code=code;throw e;};
  const typeFor=d=>'vnext:'+d.definitionId+':'+d.version;
  function build(snapshot,workflow){
    const graph=snapshot?.graph;
    if(!graph||!safe(graph.graphId)||!Number.isInteger(graph.revision)||
      !Array.isArray(graph.nodes)||!Array.isArray(graph.connections)||
      !Array.isArray(snapshot.definitions)||!Array.isArray(workflow?.nodes)||
      !Array.isArray(workflow?.connections))fail('INVALID_GRAPH_EDIT');
    const before=new Map(graph.nodes.map(n=>[n.nodeId,n]));
    const after=new Map(),defs=new Map(snapshot.definitions.map(d=>[typeFor(d),d]));
    const operations=[],definitions=[],added=new Map(),moved=new Map(),revisions=new Set();
    for(const [i,node] of workflow.nodes.entries()){
      if(!safe(node?.id)||after.has(node.id))fail('INVALID_CANVAS_NODE');
      after.set(node.id,node);
      if(!before.has(node.id)){
        const def=defs.get(node.type);
        if(!def)fail('UNSUPPORTED_UI_NODE_TYPE');
        const localNodeKey='new'+i;
        added.set(node.id,localNodeKey);
      }else if(!defs.has(node.type))fail('UNSUPPORTED_UI_NODE_TYPE');
    }
    const key=(kind,from,fromPort,to,toPort)=>JSON.stringify([kind,from,fromPort,to,toPort]);
    const original=new Map();
    for(const link of graph.connections){
      const k=key(link.kind,link.from.nodeId,link.from.port,link.to.nodeId,link.to.port);
      if(original.has(k))fail('DUPLICATE_GRAPH_CONNECTION');
      original.set(k,link);
    }
    const desired=new Map();
    for(const link of workflow.connections){
      const kind=link?.data?.kind==='data'?'data':'flow';
      const f=link?.from,t=link?.to;
      if(!safe(f?.node)||!safe(t?.node)||!safe(f.port)||!safe(t.port)||
        !after.has(f.node)||!after.has(t.node))fail('INVALID_CANVAS_CONNECTION');
      const k=key(kind,f.node,f.port,t.node,t.port);
      if(desired.has(k))fail('DUPLICATE_CANVAS_CONNECTION');
      desired.set(k,{kind,from:f,to:t});
    }
    for(const [k,link] of original)if(!desired.has(k))
      operations.push({op:'link.remove',linkId:link.id});
    for(const id of before.keys())if(!after.has(id))operations.push({op:'node.delete',nodeId:id});
    for(const [id,localNodeKey] of added){
      const node=after.get(id),def=defs.get(node.type);
      operations.push({op:'node.add',localNodeKey,
        definitionRef:{definitionId:def.definitionId,version:def.version},
        inputBindings:node.data?.vnext?.inputBindings||{}});
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
      const uiBindings=node.data?.vnext?.inputBindings;
      if(uiBindings!==undefined&&!same(uiBindings,prior.inputBindings||{}))
        changes.inputBindings=uiBindings;
      const request=node.data?.params?.request;
      if(typeof request==='string'&&request!==prevDef.instruction){
        const versionKey=typeFor(prior.definitionRef);
        if(revisions.has(versionKey)||changes.definitionRef)fail('SHARED_DEFINITION_REVISION_UNSUPPORTED');
        revisions.add(versionKey);
        if(!request.trim()||request.length>2400)fail('INVALID_NODE_INSTRUCTION');
        const localKey='edit'+definitions.length;
        const {definitionId,version,localKey:unused,supersedes, ...draft}=prevDef;
        definitions.push({...draft,localKey,supersedes:{definitionId:currentRef.definitionId,version:currentRef.version},
          instruction:request});
        changes.definitionRef={localDefinitionKey:localKey};
      }
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
  global.OvllVNextGraphPatch=Object.freeze({build,resolvedView});
})(window);
