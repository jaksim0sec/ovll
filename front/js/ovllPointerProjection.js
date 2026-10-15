(function(global){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const isObject=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const validRef=v=>typeof v==='string'&&v.length>0&&v.length<=160;
  const key=ref=>'pointer:'+ref.definitionId+':'+ref.version;
  const builtin=/^builtin:(research|organize|judge|write|file|createFile)$/;
  function projectGraph(snapshot,previous,baseDefinitions={}){
    if(!isObject(snapshot)||!isObject(snapshot.graph)||!Array.isArray(snapshot.graph.skillNodes)||
      !Array.isArray(snapshot.graph.connections)||!Array.isArray(snapshot.skillDefinitions)||
      !Number.isInteger(snapshot.graph.revision))throw new Error('INVALID_GRAPH_SNAPSHOT');
    const defs=new Map(),skillDefinitions={},prior=new Map((previous?.skillNodes||[]).map(n=>[n.id,n]));
    const typeFor=ref=>ref.version===1&&builtin.test(ref.definitionId)?
      ref.definitionId.slice(8):key(ref);
    for(const def of snapshot.skillDefinitions){
      if(!validRef(def.definitionId)||!Number.isInteger(def.version)||def.version<1||
        !Array.isArray(def.inputs)||!Array.isArray(def.outputs))throw new Error('INVALID_SKILL_NODE_DEFINITION');
      defs.set(key(def),def);
      const type=typeFor(def);
      if(skillDefinitions[type])continue;
      if(type===def.definitionId.slice(8)&&baseDefinitions[type]){
        // Builtins retain the existing server-owned visual contract.
        skillDefinitions[type]=clone(baseDefinitions[type]);
        const port=(p,direction)=>{
          const semantic=def[direction].find(entry=>entry.name===p.id);
          const representation=semantic?.representation||p.type;
          return {...p,type:representation,accepts:[representation],
            multiple:semantic?.multiple!==false,channel:'data'};
        };
        skillDefinitions[type].inputs=(skillDefinitions[type].inputs||[]).map(p=>port(p,'inputs'));
        skillDefinitions[type].outputs=(skillDefinitions[type].outputs||[]).map(p=>port(p,'outputs'));
        continue;
      }
      const port=(p,input=false)=>({id:p.name,name:p.role||p.name,type:p.representation,
        accepts:[p.representation],required:p.required===true,
        channel:'data',multiple:input?p.multiple!==false:true});
      const requestedIcon=def.presentation?.iconKey||'sparkle';
      const iconKey=global.OvllSvgLibrary?.has&&!global.OvllSvgLibrary.has(requestedIcon)?
        'custom':requestedIcon;
      skillDefinitions[type]={name:def.presentation?.name||def.purpose.slice(0,100),desc:def.purpose,
        color:/^#[0-9a-f]{6}$/i.test(def.presentation?.color||'')?def.presentation.color:'#7C6CF2',
        iconKey,tag:type.startsWith('pointer:')?'AI':type.toUpperCase(),
        inputs:def.inputs.map(p=>port(p,true)),outputs:type==='createFile'?[]:def.outputs.map(p=>port(p)),
        params:[{id:'request',name:'요청사항',kind:'request',maxLength:2400,default:''}],
        ...(type.startsWith('pointer:')?{catalog:{group:'custom',groupLabel:'내 노드'}}:{})};
    }
    const skillNodes=snapshot.graph.skillNodes.map(skillNode=>{
      if(!validRef(skillNode.skillNodeId)||!isObject(skillNode.skillDefinitionRef))throw new Error('INVALID_GRAPH_SKILL_NODE');
      const def=defs.get(key(skillNode.skillDefinitionRef)),type=typeFor(skillNode.skillDefinitionRef);
      if(!def)throw new Error('UNRESOLVED_SKILL_NODE_DEFINITION');
      const earlier=prior.get(skillNode.skillNodeId);
      const incoming={id:skillNode.skillNodeId,type,params:{request:skillNode.settings?.request??''},
        data:{...(skillNode.settings?.file||{}),pointer:{skillDefinitionRef:clone(skillNode.skillDefinitionRef),
          inputBindings:clone(skillNode.inputBindings||{})}},
        expanded:earlier?.expanded??false};
      if(Number.isFinite(earlier?.x)&&Number.isFinite(earlier?.y)){
        incoming.x=earlier.x;incoming.y=earlier.y;
      }
      return incoming;
    });
    const skillNodeIds=new Set(skillNodes.map(n=>n.id)),links=[],data=[],connections=[];
    const types=new Map(skillNodes.map(n=>[n.id,n.type]));
    const flowMaps=new Map(skillNodes.map(skillNode=>[skillNode.type,{inputs:{},outputs:{}}]));
    const visiblePort=(skillNodeId,name,direction,kind)=>{
      const ui=skillDefinitions[types.get(skillNodeId)],ports=ui?.[direction]||[];
      const def=defs.get(key(snapshot.graph.skillNodes.find(n=>n.skillNodeId===skillNodeId).skillDefinitionRef));
      const logical=(def[direction]||[]).find(p=>p.name===name);
      if(kind==='data'){
        if(logical&&ports.some(p=>p.id===name&&p.channel!=='flow'))return name;
        throw new Error('UNREPRESENTABLE_GRAPH_PORT');
      }
      const reserved=(direction==='outputs'?/^(next|flow_next_*)$/:/^(in|flow_in_*)$/).test(name);
      if(!logical&&!reserved)throw new Error('UNREPRESENTABLE_GRAPH_PORT');
      if(logical&&ports.some(p=>p.id===name))return name;
      const mapped=flowMaps.get(types.get(skillNodeId))[direction];
      if(mapped[name])return mapped[name];
      // Share a visible data socket for control when it already expresses this endpoint.
      const semantic=def[direction]||[];
      const shared=!logical&&reserved&&semantic.length===1&&ports.some(p=>p.id===semantic[0].name);
      const id=shared?semantic[0].name:name;
      if(!ports.some(p=>p.id===id))ports.push({id,
        name:direction==='outputs'?(def.requiredCapabilities?.includes('branch.exclusive')?logical?.role||name:'다음'):'진행',
        type:'control_flow',accepts:['control_flow'],channel:'flow',multiple:true,required:false});
      ui[direction]=ports;mapped[name]=id;
      return id;
    };
    for(const link of snapshot.graph.connections){
      if(!validRef(link?.from?.skillNodeId)||!validRef(link?.to?.skillNodeId)||
        !skillNodeIds.has(link.from.skillNodeId)||!skillNodeIds.has(link.to.skillNodeId)||
        !validRef(link.from.port)||!validRef(link.to.port))throw new Error('INVALID_GRAPH_CONNECTION');
      if(!['flow','data'].includes(link.kind))throw new Error('UNSUPPORTED_CONNECTION_KIND');
      const fromPort=visiblePort(link.from.skillNodeId,link.from.port,'outputs',link.kind);
      const toPort=visiblePort(link.to.skillNodeId,link.to.port,'inputs',link.kind);
      connections.push({id:link.id,from:{skillNode:link.from.skillNodeId,port:fromPort},
        to:{skillNode:link.to.skillNodeId,port:toPort},data:{kind:link.kind,
          pointer:{linkId:link.id,kind:link.kind,from:clone(link.from),to:clone(link.to)}}});
      (link.kind==='data'?data:links).push([
        link.from.skillNodeId+'.'+fromPort,link.to.skillNodeId+'.'+toPort
      ]);
    }
    for(const skillNode of skillNodes){
      const mapped=flowMaps.get(skillNode.type);
      skillNode.data.pointer.portMap={inputs:Object.fromEntries(Object.entries(mapped.inputs).map(([logical,visible])=>[visible,logical])),
        outputs:Object.fromEntries(Object.entries(mapped.outputs).map(([logical,visible])=>[visible,logical]))};
    }
    return {graphId:snapshot.graph.graphId,revision:snapshot.graph.revision,
      skillDefinitions,workflow:{skillNodes,links,data,connections}};
  }
  function resultFileSkillNodes(snapshot,verified=[],previous=[]){
    const graph=snapshot?.graph;
    if(!Array.isArray(graph?.skillNodes))return [];
    const skillNodeIds=new Set(graph.skillNodes.map(n=>n.skillNodeId));
    const canonicalFiles=new Set(graph.skillNodes.filter(n=>n.skillDefinitionRef?.definitionId==='builtin:file')
      .map(n=>n.settings?.file?.localFileId).filter(Boolean));
    const positions=new Map((previous||[]).map(n=>[n.id,n]));
    const previousFiles=new Map((previous||[]).filter(n=>n.type==='file'&&n.data?.generated===true)
      .map(n=>[n.data.artifactId,n]));
    const latest=new Map();
    for(const row of verified)if(skillNodeIds.has(row?.skillNodeId))latest.set(row.skillNodeId,row);
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
          data:{generated:true,artifactId,sourceSkillNodeId:sourceId,
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
  function applyGraph(canvas,snapshot,restoredView,extraSkillNodes=[]){
    if(!canvas?.getWorkflow||!canvas?.getBaseSkillDefinitions||
      !canvas?.setSkillDefinitions||!canvas?.applyWorkflowIR)throw new Error('POINTER_CANVAS_UNAVAILABLE');
    const base=canvas.getBaseSkillDefinitions();
    const projected=projectGraph(snapshot,Array.isArray(restoredView?.skillNodes)?restoredView:canvas.getWorkflow(),base);
    const known=new Set(projected.workflow.skillNodes.map(n=>n.id));
    for(const skillNode of extraSkillNodes){
      if(skillNode?.type!=='file'||skillNode.data?.generated!==true||known.has(skillNode.id))continue;
      projected.workflow.skillNodes.push(clone(skillNode));known.add(skillNode.id);
    }
    const legacy=Object.fromEntries(Object.entries(base)
      .filter(([type])=>!type.startsWith('pointer:')));
    canvas.setSkillDefinitions({...legacy,...projected.skillDefinitions});
    canvas.applyWorkflowIR(projected.workflow,{center:false});
    return projected;
  }
  function statusNode(skillNode){
    if(!skillNode||!validRef(skillNode.skillNodeId))throw new Error('INVALID_RUN_SKILL_NODE');
    const mapping={running:'RUNNING',success:'SUCCESS',failed:'FAILED',cancelled:'SKIPPED',
      outcome_unknown:'FAILED'};
    const status=mapping[skillNode.status];
    if(!status)return null;
    return {skillNodeId:skillNode.skillNodeId,status,state:{status,
      report:status==='SUCCESS'?'결과 저장 완료':skillNode.reason||skillNode.code||'',
      ...(status==='SUCCESS'?{result:{outputRefs:clone(skillNode.outputRefs||[])}}:
        status==='FAILED'?{error:{code:skillNode.code||'SKILL_NODE_EXECUTION_FAILED'}}:{})}};
  }
  function applyRunState(canvas,result){
    if(!isObject(result?.run)||!Array.isArray(result.skillNodes))throw new Error('INVALID_RUN_STATE');
    for(const skillNode of result.skillNodes){
      const event=statusNode(skillNode);
      if(event)canvas?.setRuntimeSkillNodeState?.(event.skillNodeId,event.state);
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
  global.OvllPointerProjection=Object.freeze({projectGraph,applyGraph,resultFileSkillNodes,statusNode,applyRunState,artifactPreview});
})(window);
