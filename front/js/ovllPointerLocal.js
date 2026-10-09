(function(global){
  "use strict";
  // Browser-owned graph snapshots, scoped to the existing local WorkspaceStore.
  // No SQL or user login; node inference delegates to the existing stateless server.
  function create({workspaceStore=global.OvllWorkspaceStore,
    loadCore=()=>import("/js/ovllPointerGraphCore.mjs"),loadPlan=()=>import("/js/ovllPointerPlanCore.mjs"),
    loadCatalog=()=>global.OvllPointerApi?.localCatalog?.()||{definitions:[]}}={}){
    if(!workspaceStore || typeof workspaceStore.updateConversationPointerGraph!=="function")
      throw new Error("LOCAL_WORKSPACE_UNAVAILABLE");
    const pending=new Map();
    let catalog;
    async function seed(snapshot){
      if(!catalog){
        try{catalog=await loadCatalog();}
        catch(error){
          // Existing graphs carry their definitions; a catalog outage must not hide those nodes.
          if(snapshot.definitions?.length){
            console.warn('OvllPointer catalog unavailable; using saved definitions',error);
            return snapshot;
          }
          throw error;
        }
      }
      const builtins=catalog?.definitions||[];
      return {...snapshot,definitions:[...snapshot.definitions.filter(d=>!builtins.some(b=>
        b.definitionId===d.definitionId&&b.version===d.version)),...builtins]};
    }
    const safe=s=>typeof s==="string"&&/^[A-Za-z0-9_.:-]{1,150}$/.test(s);
    const graphIdFor=id=>{
      if(!safe(id))throw new Error("INVALID_CONVERSATION_ID");
      return "g_"+id;
    };
    const conversationFor=(conversationId,graphId)=>{
      if(graphId!==graphIdFor(conversationId))throw new Error("LOCAL_GRAPH_SCOPE_MISMATCH");
      const conversation=workspaceStore.getConversation(conversationId);
      if(!conversation)throw new Error("CONVERSATION_NOT_FOUND");
      return conversation;
    };
    // Upgrade saved canvas graphs without invoking the retired planner. On any
    // unsupported shape leave the original conversation untouched.
    function migratedCanvas(canvas,graphId,definitions){
      const workflow=canvas?.workflow;
      if(!Array.isArray(workflow?.nodes)||!Array.isArray(workflow?.connections))
        throw new Error('LEGACY_GRAPH_INVALID');
      if(workflow.nodes.length>64||workflow.connections.length>128)
        throw new Error('LEGACY_GRAPH_TOO_LARGE');
      const catalog=new Map(definitions.map(d=>[d.definitionId,d]));
      const nodes=[],connections=[],seen=new Set(),types=new Map();
      for(const node of workflow.nodes){
        if(!safe(node?.id)||seen.has(node.id))throw new Error('LEGACY_GRAPH_NODE_INVALID');
        seen.add(node.id);
        if(node.type==='start')continue;
        const def=catalog.get('builtin:'+node.type);
        if(!def)throw new Error('LEGACY_GRAPH_REQUIRES_REVIEW');
        types.set(node.id,def);
        const params=node.data?.params||node.params||{};
        const request=typeof params.request==='string'&&params.request.trim()
          ?params.request.trim():Object.entries(params).filter(([key,value])=>
            key!=='request'&&typeof value==='string'&&value.trim()).map(([key,value])=>
            key+': '+value.trim()).join('\n');
        const settings={request:request.slice(0,2400)};
        if(node.type==='file'){
          const file={};
          for(const key of ['source','localFileId','name','mime','size','lastModified',
            'downloadUrl','previewUrl','textPreview','textTruncated']){
            if(node.data?.[key]!==undefined)file[key]=node.data[key];
          }
          if(file.textPreview)file.textPreview=String(file.textPreview).slice(0,12000);
          settings.file=file;
        }
        nodes.push({nodeId:node.id,
          definitionRef:{definitionId:def.definitionId,version:def.version},
          inputBindings:{},settings});
      }
      for(const [index,link] of workflow.connections.entries()){
        const from=link?.from,to=link?.to;
        if(!seen.has(from?.node)||!seen.has(to?.node)||
          !safe(from?.port)||!safe(to?.port))throw new Error('LEGACY_GRAPH_LINK_INVALID');
        if(!types.has(from.node)){
          if(workflow.nodes.some(n=>n.id===from.node&&n.type==='start'))continue;
          throw new Error('LEGACY_GRAPH_LINK_INVALID');
        }
        if(!types.has(to.node))throw new Error('LEGACY_GRAPH_LINK_INVALID');
        const source=types.get(from.node),target=types.get(to.node);
        const dataCompatible=source.outputs.some(p=>p.name===from.port)&&
          target.inputs.some(p=>p.name===to.port);
        const requestedKind=link.data?.kind;
        const kind=requestedKind==='flow'||requestedKind==='data'
          ?requestedKind:dataCompatible?'data':'flow';
        if(kind==='data'&&!dataCompatible)throw new Error('LEGACY_GRAPH_PORT_MISMATCH');
        connections.push({id:'migrated_link_'+index,kind,
          from:{nodeId:from.node,port:from.port},
          to:{nodeId:to.node,port:to.port}});
      }
      return {graph:{graphId,revision:1,nodes,connections},definitions};
    }
    async function projectCanvasDraft(canvas,graphId){
      if(!safe(graphId))throw new Error('INVALID_DRAFT_GRAPH_ID');
      const base={graph:{graphId,revision:0,nodes:[],connections:[]},definitions:[]};
      const seeded=await seed(base);
      return migratedCanvas(canvas,graphId,seeded.definitions);
    }
    async function migrateConversation(conversationId,canvas){
      const graphId=graphIdFor(conversationId);
      const conversation=conversationFor(conversationId,graphId);
      if(conversation.state?.pointerGraph)return false;
      const legacy=canvas||conversation.state?.canvas;
      if(!legacy?.workflow?.nodes?.length)return false;
      const empty={graph:{graphId,revision:0,nodes:[],connections:[]},definitions:[]};
      const seeded=await seed(empty);
      const converted=migratedCanvas(legacy,graphId,seeded.definitions);
      const {MemoryGraphRepository}=await loadCore(),repo=new MemoryGraphRepository();
      repo.restore('local',graphId,converted);
      workspaceStore.updateConversationPointerGraph(conversationId,repo.get('local',graphId));
      return true;
    }
    async function repository(conversationId,graphId){
      const conversation=conversationFor(conversationId,graphId);
      const {MemoryGraphRepository}=await loadCore();
      const repo=new MemoryGraphRepository();
      const snapshot=conversation.state?.pointerGraph;
      if(snapshot){
        if(snapshot.graph?.graphId!==graphId)throw new Error("LOCAL_GRAPH_SCOPE_MISMATCH");
        repo.restore("local",graphId,await seed(snapshot));
      }else repo.restore("local",graphId,await seed(repo.create("local",graphId)));
      return repo;
    }
    async function state(conversationId,graphId=graphIdFor(conversationId)){
      const repo=await repository(conversationId,graphId);
      return {graph:repo.get("local",graphId),eventCursor:0,runs:[]};
    }
    function turn({conversationId,graphId,actions}={}){
      const previous=pending.get(conversationId)||Promise.resolve();
      const current=previous.catch(()=>{}).then(async()=>{
        if(!Array.isArray(actions)||actions.length!==1||
          actions[0]?.kind!=="ir.applyPatch"||
          actions[0]?.args?.patch?.graphId!==graphId)
          throw new Error("LOCAL_GRAPH_PATCH_ONLY");
        const repo=await repository(conversationId,graphId);
        const applied=repo.apply("local",actions[0].args.patch);
        workspaceStore.updateConversationPointerGraph(conversationId,repo.get("local",graphId));
        return {results:[{actionId:"local:"+actions[0].localKey,
          status:"applied",newRevision:applied.graphRef.revision,createdRefs:applied.createdRefs}]};
      });
      pending.set(conversationId,current);
      current.then(()=>{if(pending.get(conversationId)===current)pending.delete(conversationId);},
        ()=>{if(pending.get(conversationId)===current)pending.delete(conversationId);});
      return current;
    }

    async function run({conversationId,targets,damMode='closed',requestText='',snapshotOverride,taskConstraints=[],
      createArtifact=(input,options)=>global.AstraAPI.createArtifact(input,options),
      resolveArtifactRequest=params=>global.OvllArtifactRequest.resolve(params),cache=new Map(),
      executeNode=({snapshot,nodeId,inputArtifacts,requestText,taskConstraints,signal})=>global.OvllPointerApi.localNode({
        snapshot,nodeId,inputArtifacts,requestText,taskConstraints,signal}),onProgress=()=>{},signal}={}){
      const snapshot=snapshotOverride||(await state(conversationId)).graph;
      const {buildExecutionPlan}=await loadPlan();
      const targetIds=(targets||[]).map(x=>typeof x==='string'?x:x.nodeId);
      const plan=buildExecutionPlan(snapshot,{graphRef:{graphId:snapshot.graph.graphId,
        revision:snapshot.graph.revision},planEpoch:0,targets:targetIds,damMode});
      if(plan.order.length>64)throw new Error('LOCAL_RUN_LIMIT');
      const runId='r_'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
      const record={runId,graphRef:plan.graphRef,targets:targetIds,damMode,status:'running',
        startedAt:Date.now(),nodes:plan.order.map(x=>({nodeId:x.nodeId,status:'pending'}))};
      const persist=()=>{
        const existing=workspaceStore.getConversation(conversationId)?.state.pointerRuns||[];
        workspaceStore.updateConversationPointerRuns(conversationId,[...existing.filter(x=>x.runId!==runId),record]);
        onProgress(JSON.parse(JSON.stringify(record)));
      };
      persist();
      const unavailable=plan.order.find(item=>{
        const d=item.definition,caps=d.requiredCapabilities||[];
        return d.executorKind==='model_task'?caps.some(c=>!['model_task','branch.exclusive'].includes(c)):
          d.executorKind!=='tool_task'||caps.length!==1||!['file.read_local','artifact.create'].includes(caps[0])||d.outputs.length!==1||d.outputs[0].representation!=='json';
      });
      if(unavailable){
        const entry=record.nodes.find(n=>n.nodeId===unavailable.nodeId);
        entry.status='blocked';entry.error='LOCAL_EXECUTOR_UNAVAILABLE';record.status='waiting';persist();
        return JSON.parse(JSON.stringify(record));
      }
      const resolved=new Map(),skipped=new Set();
      const definitionFor=id=>{const node=snapshot.graph.nodes.find(n=>n.nodeId===id);
        return snapshot.definitions.find(d=>d.definitionId===node?.definitionRef.definitionId&&d.version===node?.definitionRef.version);};
      const exclusive=id=>definitionFor(id)?.requiredCapabilities?.includes('branch.exclusive');
      for(const item of plan.order){
        const entry=record.nodes.find(n=>n.nodeId===item.nodeId);
        if(signal?.aborted){entry.status='cancelled';record.status='cancelled';break;}
        const incoming=snapshot.graph.connections.filter(l=>l.to.nodeId===item.nodeId);
        const inactive=link=>skipped.has(link.from.nodeId)||exclusive(link.from.nodeId)&&
          definitionFor(link.from.nodeId).outputs.some(p=>p.name===link.from.port)&&
          !resolved.get(link.from.nodeId)?.values?.[link.from.port];
        const gates=incoming.filter(l=>l.kind==='flow'),dataLinks=incoming.filter(l=>l.kind==='data');
        if(gates.length&&gates.every(inactive)||!gates.length&&dataLinks.length&&dataLinks.every(inactive)){
          entry.status='skipped';skipped.add(item.nodeId);persist();continue;
        }
        if(dataLinks.some(l=>inactive(l)&&item.definition.inputs.some(p=>p.name===l.to.port&&p.required))){
          entry.status='blocked';entry.error='REQUIRED_INPUT_MISSING';record.status='waiting';persist();break;
        }
        entry.status='running';persist();
        try{
          const inputs=snapshot.graph.connections.filter(link=>link.kind==='data'&&link.to.nodeId===item.nodeId&&!inactive(link))
            .map(link=>{
              const source=resolved.get(link.from.nodeId)?.values?.[link.from.port];
              if(!source||!Object.prototype.hasOwnProperty.call(source,'inline'))
                throw new Error('UPSTREAM_OUTPUT_NOT_AVAILABLE');
              return {port:link.to.port,sourceNodeId:link.from.nodeId,
                sourcePort:link.from.port,valueRef:'local:'+runId+':'+link.from.nodeId+':'+link.from.port,
                representation:snapshot.definitions.find(d=>d.definitionId===
                  snapshot.graph.nodes.find(n=>n.nodeId===link.from.nodeId)?.definitionRef.definitionId&&
                  d.version===snapshot.graph.nodes.find(n=>n.nodeId===link.from.nodeId)?.definitionRef.version)
                  ?.outputs.find(p=>p.name===link.from.port)?.representation,value:source.inline};
            });
          const objective=requestText.trim()||item.node.settings?.request?.trim()||item.definition.purpose;
          const fingerprint=JSON.stringify({nodeId:item.nodeId,definition:item.definition,
            settings:item.node.settings||{},bindings:item.node.inputBindings||{},objective,taskConstraints,
            inputs:inputs.map(({valueRef,...rest})=>rest)});
          let output;
          if(item.definition.executorKind==='model_task'){
            if((item.definition.requiredCapabilities||[]).some(c=>!['model_task','branch.exclusive'].includes(c)))
              throw new Error('LOCAL_EXECUTOR_UNAVAILABLE');
            output=cache.get(fingerprint);
            if(output)entry.reused=true;
            else output=await executeNode({snapshot,nodeId:item.nodeId,inputArtifacts:inputs,requestText:objective,taskConstraints,signal});
          }else {
            const caps=item.definition.requiredCapabilities||[];
            const port=item.definition.outputs[0];
            if(caps.length!==1||item.definition.outputs.length!==1||port.representation!=='json')
              throw new Error('LOCAL_EXECUTOR_UNAVAILABLE');
            let value;
            if(caps[0]==='file.read_local'){
              value=item.node.settings?.file;
              if(!value?.name){output={status:'blocked',outputs:{status:'blocked',reason:'파일을 먼저 추가해줘.'}};}
              else value=JSON.parse(JSON.stringify(value));
            }else if(caps[0]==='artifact.create'){
              const bound=Object.values(item.node.inputBindings||{}),sources=[...inputs.map(x=>x.value),...bound];
              if(!sources.length)output={status:'blocked',outputs:{status:'blocked',reason:'파일로 내보낼 완성된 내용을 연결해줘.'}};
              else {
                const params=resolveArtifactRequest({request:item.node.settings?.request||objective});
                entry.toolEffectStarted=true;persist();
                const result=await createArtifact({...params,sources},{signal});
                value=result?.artifact;
                if(!value?.downloadUrl)throw new Error('LOCAL_ARTIFACT_NOT_VERIFIED');
              }
            }else throw new Error('LOCAL_EXECUTOR_UNAVAILABLE');
            if(!output)output={status:'success',outputs:{status:'produced',values:{[port.name]:{inline:value}}}};
          }
          if(signal?.aborted){
            if(entry.toolEffectStarted&&output?.status==='success'&&output.outputs?.status==='produced'){
              entry.status='success';entry.outputs=output.outputs;entry.effectConfirmed=true;
            }else entry.status='cancelled';
            record.status='cancelled';break;
          }

          if(output?.status==='blocked'){entry.status='blocked';entry.error=output.outputs?.reason||'CONTEXT_REQUIRED';record.status='waiting';break;}
          if(output?.status!=='success'||output.outputs?.status!=='produced')throw new Error('LOCAL_OUTPUT_NOT_VERIFIED');
          const values=output.outputs.values||{},declared=item.definition.outputs;
          if(Object.keys(values).some(name=>!declared.some(p=>p.name===name))||
            declared.some(p=>p.required&&!Object.hasOwn(values,p.name))||
            Object.values(values).some(v=>!v||!Object.hasOwn(v,'inline')))throw new Error('LOCAL_OUTPUT_NOT_VERIFIED');
          if(exclusive(item.nodeId)&&Object.keys(values).length!==1)throw new Error('EXCLUSIVE_BRANCH_OUTPUT_REQUIRED');
          entry.status='success';entry.outputs=output.outputs;
          entry.provenance=output.provenance||{};
          if(item.definition.executorKind==='model_task')cache.set(fingerprint,output);
          resolved.set(item.nodeId,output.outputs);
        }catch(error){entry.status='failed';entry.error=error?.code||error?.message||'LOCAL_EXECUTION_FAILED';
          record.status=entry.toolEffectStarted?'outcome_unknown':signal?.aborted?'cancelled':'failed';
          if(entry.toolEffectStarted)entry.status='outcome_unknown';break;}
        persist();
      }
      if(record.status==='running')record.status=record.nodes.some(n=>targetIds.includes(n.nodeId)&&n.status==='success')?'completed':'skipped';
      persist();
      return JSON.parse(JSON.stringify(record));
    }

    return Object.freeze({graphId:graphIdFor,state,turn,run,migrateConversation,projectCanvasDraft});
  }
  global.createOvllPointerLocal=create;
  global.OvllPointerLocal=create();
})(window);
