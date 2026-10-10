(function(global){
  "use strict";
  // Browser-owned graph snapshots, scoped to the existing local WorkspaceStore.
  // No SQL or user login; node inference delegates to the existing stateless server.
  async function readLocalSource(store,file,{maxBytes=64000,maxSerializedBytes=48000}={}){
    const provenance={kind:'local_file',localFileId:String(file?.localFileId||'')};
    if(!file?.localFileId||typeof store?.getBlob!=='function')
      return {status:'blocked',reason:'LOCAL_FILE_BYTES_UNAVAILABLE',provenance};
    let blob;
    try{blob=await store.getBlob(file.localFileId);}catch(error){
      return {status:'blocked',reason:'LOCAL_FILE_BYTES_UNAVAILABLE',provenance:{...provenance,error:error?.code||error?.message}};
    }
    if(!blob||typeof blob.text!=='function')return {status:'blocked',reason:'LOCAL_FILE_BYTES_UNAVAILABLE',provenance};
    const mime=String(blob.type||file.mime||'').toLowerCase().split(';')[0];
    const textMime=/^text\//.test(mime)||['application/json','application/xml','application/csv','application/javascript','application/x-ndjson'].includes(mime);
    const textName=/\.(txt|md|markdown|csv|tsv|json|jsonl|ndjson|xml|html?|css|js|mjs|yaml|yml|log)$/i.test(file.name||'');
    if(mime==='application/pdf'||/^image\//.test(mime)||/\.(pdf|png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(file.name||'')||!textMime&&!textName)
      return {status:'blocked',reason:'LOCAL_FILE_PARSER_UNAVAILABLE',provenance:{...provenance,mime,availability:'local_bytes',parsing:'unsupported'}};
    const limit=Math.max(1,Math.min(256000,Number.isFinite(maxBytes)?Math.floor(maxBytes):64000));
    const selected=blob.slice(0,limit);let truncated=selected.size<blob.size,readBytes=selected.size;
    const Decoder=global.TextDecoder||(typeof TextDecoder==='function'?TextDecoder:null);
    let text;try{text=Decoder?new Decoder('utf-8',{fatal:true}).decode(await selected.arrayBuffer(),{stream:truncated}):await selected.text();}
    catch{return {status:'blocked',reason:'LOCAL_FILE_PARSER_UNAVAILABLE',provenance:{...provenance,parsing:'unsupported_encoding'}};}
    if(text.includes('\u0000')||/^%PDF-/.test(text))return {status:'blocked',reason:'LOCAL_FILE_PARSER_UNAVAILABLE',provenance:{...provenance,parsing:'binary'}};
    const utf8Bytes=value=>Array.from(value).reduce((total,c)=>{const p=c.codePointAt(0);return total+(p>65535?4:p>2047?3:p>127?2:1);},0);
    if(utf8Bytes(JSON.stringify(text))>maxSerializedBytes){
      let low=0,high=text.length;
      while(low<high){const mid=Math.ceil((low+high)/2);
        if(utf8Bytes(JSON.stringify(text.slice(0,mid)))<=maxSerializedBytes)low=mid;else high=mid-1;}
      text=text.slice(0,low).replace(/[\uD800-\uDBFF]$/,'');
      readBytes=utf8Bytes(text);truncated=true;
    }
    let metadata;try{metadata=await store.getMetadata?.(file.localFileId);}catch{}
    const coverage={unit:'bytes',start:0,end:readBytes,readBytes,totalBytes:blob.size,truncated,complete:!truncated};
    return {status:'success',value:{name:String(file.name||'파일'),localFileId:file.localFileId,mime,size:blob.size,text,textTruncated:truncated,
      availability:'local_bytes',parsing:'utf8_text',coverage,provenance:{...provenance,mime,byteLength:blob.size,contentRevision:metadata?.contentRevision||'',updatedAt:metadata?.updatedAt||0}}};
  }
  async function captureArtifact(store,artifact,blob,{conversationId,signal}={}){
    const priorAvailability=artifact.availability&&typeof artifact.availability==='object'?artifact.availability:{};
    const value={...artifact,...(artifact.availability!==undefined?{remoteAvailability:artifact.availability}:{}),
      availability:{...priorAvailability,remoteUrl:true,localBytes:false,durable:false}};
    if(artifact.localFileId){
      try{const existing=await store?.getBlob?.(artifact.localFileId);
        if(existing){value.availability={...value.availability,localBytes:true,durable:true};return value;}}catch{}
    }
    if(!store||!store.putBlob&&!store.putRemote)return value;
    try{
      const metadata={...artifact,source:'artifact',originId:artifact.id||artifact.downloadUrl,conversationId};
      const saved=blob&&store.putBlob?await store.putBlob(blob,metadata):
        store.putRemote?await store.putRemote(artifact.downloadUrl,metadata,{signal}):null;
      if(saved?.id){value.localFileId=saved.id;value.availability={...value.availability,localBytes:true,durable:true};}
    }catch(error){value.availability.localSaveError=error?.code||error?.message||'LOCAL_ARTIFACT_SAVE_FAILED';}
    return value;
  }
  function create({workspaceStore=global.OvllWorkspaceStore,fileStore=global.OvllFileStore,
    loadResults=()=>import("/js/ovllPointerResults.mjs"),
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
      const saved=snapshot.definitions||[];
      const shared=workspaceStore.getPointerDefinitions?.()||[];
      const match=(a,b)=>a.definitionId===b.definitionId&&a.version===b.version;
      return {...snapshot,definitions:[
        ...shared.filter(d=>!saved.some(s=>match(s,d))&&!builtins.some(b=>match(b,d))),
        ...saved.filter(d=>!builtins.some(b=>match(b,d))),
        ...builtins
      ]};
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
        const patch=actions[0].args.patch;
        const applied=repo.apply("local",patch);
        const deletedDefinitions=(patch.operations||[]).filter(op=>op.op==='definition.delete')
          .map(op=>op.definitionRef);
        workspaceStore.updateConversationPointerGraph(conversationId,repo.get("local",graphId),
          {deletedDefinitions});
        return {results:[{actionId:"local:"+actions[0].localKey,
          status:"applied",newRevision:applied.graphRef.revision,createdRefs:applied.createdRefs}]};
      });
      pending.set(conversationId,current);
      current.then(()=>{if(pending.get(conversationId)===current)pending.delete(conversationId);},
        ()=>{if(pending.get(conversationId)===current)pending.delete(conversationId);});
      return current;
    }

    async function run({conversationId,targets,deliverableTargets,damMode='closed',requestText='',snapshotOverride,taskConstraints=[],taskContext,executorIdentity,
      maxSourceBytes=64000,
      createArtifact=(input,options)=>global.AstraAPI.createArtifact(input,options),
      resolveArtifactRequest=params=>global.OvllArtifactRequest.resolve(params),cache=new Map(),
      executeNode=({snapshot,nodeId,inputArtifacts,requestText,taskConstraints,taskContext,signal})=>global.OvllPointerApi.localNode({
        snapshot,nodeId,inputArtifacts,requestText,taskConstraints,taskContext,signal}),onProgress=()=>{},signal}={}){
      const copy=value=>JSON.parse(JSON.stringify(value));
      const snapshot=copy(snapshotOverride||(await state(conversationId)).graph);
      const results=await loadResults();
      const {buildExecutionPlan,matchesInputRepresentation,matchesRuntimeRepresentation}=await loadPlan();
      const matchesValue=matchesRuntimeRepresentation||matchesInputRepresentation;
      const targetIds=(targets||[]).map(x=>typeof x==='string'?x:x.nodeId);
      const plan=buildExecutionPlan(snapshot,{graphRef:{graphId:snapshot.graph.graphId,
        revision:snapshot.graph.revision},planEpoch:0,targets:targetIds,damMode});
      if(plan.order.length>64)throw new Error('LOCAL_RUN_LIMIT');
      const runId='r_'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
      const deliveryIds=(deliverableTargets||targetIds).map(x=>typeof x==='string'?x:x.nodeId);
      if(!deliveryIds.length||deliveryIds.some(id=>!plan.order.some(item=>item.nodeId===id)))
        throw new Error('LOCAL_DELIVERABLE_OUT_OF_SCOPE');
      const history=new Map();
      for(const previous of workspaceStore.getConversation(conversationId)?.state?.pointerRuns||[]){
        if(previous.graphRef?.graphId!==snapshot.graph.graphId)continue;
        for(const row of previous.nodes||[])history.set(row.nodeId,{...row,previousRunId:previous.runId});
      }
      const priorResults=new Map((await validateResults(snapshot,[...history.values()],taskContext?{taskContext}:{}))
        .map(row=>[row.nodeId,row]));
      const record={runId,graphRef:plan.graphRef,targets:targetIds,deliverableTargets:deliveryIds,
        executionScope:plan.order.map(item=>item.nodeId),snapshot,taskContext:taskContext?copy(taskContext):undefined,
        requestText,taskConstraints:copy(taskConstraints),damMode,status:'running',
        startedAt:Date.now(),nodes:plan.order.map(x=>({nodeId:x.nodeId,status:'pending'}))};
      const persist=(durable=false)=>{
        if(durable){
          try{
            const existing=workspaceStore.getConversation(conversationId)?.state.pointerRuns||[];
            record.storage={status:'saved'};
            workspaceStore.updateConversationPointerRuns(conversationId,[...existing.filter(x=>x.runId!==runId),record]);
          }catch(error){record.storage={status:'failed',error:error?.code||error?.message||'LOCAL_RUN_SAVE_FAILED'};}
        }
        try{onProgress(copy(record));}catch(error){console.warn('Pointer progress callback failed',error);}
      };
      const finish=async()=>{
        for(const entry of record.nodes)if(['pending','running'].includes(entry.status)){
          entry.status=record.status==='cancelled'?'cancelled':'blocked';
          if(entry.status==='blocked')entry.error=entry.error||'LOCAL_RUN_NOT_REACHED';
        }
        const states=deliveryIds.map(nodeId=>({nodeId,status:record.nodes.find(n=>n.nodeId===nodeId)?.status||'missing'}));
        const active=states.filter(n=>n.status!=='skipped');
        const sourceTruncated=record.nodes.some(n=>n.provenance?.coverage?.truncated===true);
        const outputTruncated=record.nodes.some(n=>Object.values(n.outputs?.values||{}).some(v=>v.inline?.truncated===true));
        record.coverage={targets:states,complete:active.length>0&&active.every(n=>n.status==='success')&&!sourceTruncated&&!outputTruncated,
          sourceTruncated,outputTruncated,
          skippedTargets:states.filter(n=>n.status==='skipped').map(n=>n.nodeId)};
        const current=workspaceStore.getConversation(conversationId)?.state?.pointerGraph;
        const currentSnapshot=!snapshotOverride&&current?.graph?.graphId===snapshot.graph.graphId?current:snapshot;
        const checked=await validateResults(currentSnapshot,record.nodes);
        for(const entry of record.nodes)if(entry.status==='success')entry.resultCurrent=checked.find(n=>n.nodeId===entry.nodeId)?.resultCurrent===true;
        record.validity={snapshotCurrent:record.nodes.filter(n=>n.status==='success').every(n=>n.resultCurrent),
          graphRef:currentSnapshot.graph?{graphId:currentSnapshot.graph.graphId,revision:currentSnapshot.graph.revision}:null};
        record.finishedAt=Date.now();
        for(const entry of record.nodes)entry.finishedAt=entry.finishedAt||record.finishedAt;
        persist(true);return copy(record);
      };
      persist(true);
      if(record.storage.status==='failed'){
        record.status='failed';record.nodes[0].error=record.storage.error;return finish();
      }
      const unavailable=plan.order.find(item=>{
        const d=item.definition,caps=d.requiredCapabilities||[];
        return d.executorKind==='model_task'?caps.some(c=>!['model_task','branch.exclusive'].includes(c)):
          d.executorKind!=='tool_task'||caps.length!==1||!['file.read_local','artifact.create'].includes(caps[0])||d.outputs.length!==1||d.outputs[0].representation!=='json';
      });
      if(unavailable){
        const entry=record.nodes.find(n=>n.nodeId===unavailable.nodeId);
        entry.status='blocked';entry.error='LOCAL_EXECUTOR_UNAVAILABLE';record.status='waiting';return finish();
      }
      const resolved=new Map(),skipped=new Set();
      const definitionFor=id=>{const node=snapshot.graph.nodes.find(n=>n.nodeId===id);
        return snapshot.definitions.find(d=>d.definitionId===node?.definitionRef.definitionId&&d.version===node?.definitionRef.version);};
      const exclusive=id=>definitionFor(id)?.requiredCapabilities?.includes('branch.exclusive');
      const semanticContextFor=(item,incoming,inputs=[])=>({
        requestText:(item.definition.requiredCapabilities?.includes('file.read_local')?'':requestText.trim())||
          item.node.settings?.request?.trim()||item.definition.purpose,
        taskConstraints:copy(taskConstraints),...(taskContext?{taskContext:copy(taskContext)}:{}),
        ...(executorIdentity!==undefined?{executorIdentity:copy(executorIdentity)}:{}),inputArtifacts:copy(inputs),
        dependencyResults:Object.fromEntries(incoming.map(link=>{
          const prior=record.nodes.find(n=>n.nodeId===link.from.nodeId);
          return [link.from.nodeId,{status:prior?.status,semanticFingerprint:prior?.semanticFingerprint,outputs:prior?.outputs}];
        }).filter(([,evidence])=>evidence.semanticFingerprint))});
      const artifactContent=value=>{
        if(typeof value==='string')return !!value.trim();
        if(typeof value==='number')return Number.isFinite(value);
        if(typeof value==='boolean')return true;
        if(Array.isArray(value))return value.some(artifactContent);
        if(!value||typeof value!=='object')return false;
        const content=['result','text','content','markdown','html','previewText'].filter(key=>Object.hasOwn(value,key));
        if(value.outputs&&Object.hasOwn(value.outputs,'result'))content.push('outputs');
        return content.length?content.some(key=>artifactContent(value[key])):Object.keys(value).length>0;
      };
      for(const item of plan.order){
        const entry=record.nodes.find(n=>n.nodeId===item.nodeId);
        if(signal?.aborted){entry.status='cancelled';record.status='cancelled';break;}
        const incoming=snapshot.graph.connections.filter(l=>l.to.nodeId===item.nodeId);
        const inactive=link=>skipped.has(link.from.nodeId)||exclusive(link.from.nodeId)&&
          definitionFor(link.from.nodeId).outputs.some(p=>p.name===link.from.port)&&
          !resolved.get(link.from.nodeId)?.values?.[link.from.port];
        const gates=incoming.filter(l=>l.kind==='flow'),dataLinks=incoming.filter(l=>l.kind==='data');
        if(gates.length&&gates.every(inactive)||!gates.length&&dataLinks.length&&dataLinks.every(inactive)){
          entry.semanticContext=semanticContextFor(item,incoming);
          entry.semanticFingerprint=results.nodeSemanticFingerprint(snapshot,item.nodeId,entry.semanticContext);
          entry.status='skipped';skipped.add(item.nodeId);persist();continue;
        }
        if(dataLinks.some(l=>inactive(l)&&item.definition.inputs.some(p=>p.name===l.to.port&&p.required))){
          entry.status='blocked';entry.error='REQUIRED_INPUT_MISSING';record.status='waiting';persist();break;
        }
        entry.status='running';persist();
        try{
          for(const [name,value] of Object.entries(item.node.inputBindings||{})){
            const input=item.definition.inputs.find(port=>port.name===name);
            if(!input||typeof matchesValue!=='function'||!matchesValue(input.representation,value))
              throw new Error('INPUT_REPRESENTATION_MISMATCH');
          }
          const inputs=snapshot.graph.connections.filter(link=>link.kind==='data'&&link.to.nodeId===item.nodeId&&!inactive(link))
            .map(link=>{
              const source=resolved.get(link.from.nodeId)?.values?.[link.from.port];
              if(!source||!Object.prototype.hasOwnProperty.call(source,'inline'))
                throw new Error('UPSTREAM_OUTPUT_NOT_AVAILABLE');
              const input=item.definition.inputs.find(p=>p.name===link.to.port);
              if(!input||typeof matchesValue!=='function'||
                !matchesValue(input.representation,source.inline))
                throw new Error('INPUT_REPRESENTATION_MISMATCH');
              return {port:link.to.port,sourceNodeId:link.from.nodeId,
                sourcePort:link.from.port,valueRef:'local:'+runId+':'+link.from.nodeId+':'+link.from.port,
                representation:snapshot.definitions.find(d=>d.definitionId===
                  snapshot.graph.nodes.find(n=>n.nodeId===link.from.nodeId)?.definitionRef.definitionId&&
                  d.version===snapshot.graph.nodes.find(n=>n.nodeId===link.from.nodeId)?.definitionRef.version)
                  ?.outputs.find(p=>p.name===link.from.port)?.representation,value:source.inline};
            });
          const objective=requestText.trim()||item.node.settings?.request?.trim()||item.definition.purpose;
          entry.semanticContext=semanticContextFor(item,incoming,inputs);
          entry.semanticFingerprint=results.nodeSemanticFingerprint(snapshot,item.nodeId,entry.semanticContext);
          entry.startedAt=Date.now();
          const fingerprint=JSON.stringify({semanticFingerprint:entry.semanticFingerprint,nodeId:item.nodeId,definition:item.definition,
            settings:item.node.settings||{},bindings:item.node.inputBindings||{},objective,taskConstraints,
            inputs:inputs.map(({valueRef,...rest})=>rest),taskContext});
          let output;
          if(item.definition.executorKind==='model_task'){
            if((item.definition.requiredCapabilities||[]).some(c=>!['model_task','branch.exclusive'].includes(c)))
              throw new Error('LOCAL_EXECUTOR_UNAVAILABLE');
            const prior=!targetIds.includes(item.nodeId)&&priorResults.get(item.nodeId);
            const dependencies=Object.fromEntries(Object.entries(entry.semanticContext.dependencyResults).map(([id,evidence])=>{
              // Historical successful evidence predates explicit branch statuses.
              if(evidence.status==='success'&&prior?.semanticContext?.dependencyResults?.[id]&&
                !Object.hasOwn(prior.semanticContext.dependencyResults[id],'status')){
                const {status,...legacy}=evidence;return [id,legacy];
              }
              return [id,evidence];
            }));
            const consumable=prior&&snapshot.graph.connections.filter(link=>link.kind==='data'&&link.from.nodeId===item.nodeId&&
              plan.order.some(next=>next.nodeId===link.to.nodeId)).every(link=>{
                const value=prior.outputs?.values?.[link.from.port],input=definitionFor(link.to.nodeId)?.inputs.find(port=>port.name===link.to.port);
                return !value?exclusive(item.nodeId):input&&matchesValue(input.representation,value.inline);
              });
            const reusable=prior?.status==='success'&&prior.resultCurrent&&consumable&&results.isCurrentNodeResult(snapshot,item.nodeId,prior,
              {inputArtifacts:inputs,dependencyResults:dependencies,taskConstraints,...(taskContext?{taskContext}:{}),
                ...(executorIdentity!==undefined?{executorIdentity}:{})});
            if(reusable){
              entry.reused=true;entry.reusedFromRunId=prior.previousRunId;
              entry.semanticContext=copy(prior.semanticContext||{});entry.semanticFingerprint=prior.semanticFingerprint;
              output={status:'success',outputs:copy(prior.outputs),provenance:copy(prior.provenance||{}),_meta:copy(prior.execution||{})};
            }else {
              output=cache.get(fingerprint);
              if(output)entry.reused=true;
              else output=await executeNode({snapshot,nodeId:item.nodeId,inputArtifacts:inputs,requestText:objective,taskConstraints,taskContext,signal});
            }
          }else {
            const caps=item.definition.requiredCapabilities||[];
            const port=item.definition.outputs[0];
            if(caps.length!==1||item.definition.outputs.length!==1||port.representation!=='json')
              throw new Error('LOCAL_EXECUTOR_UNAVAILABLE');
            let value;
            if(caps[0]==='file.read_local'){
              const source=item.node.settings?.file;
              const read=await readLocalSource(fileStore,source,{maxBytes:maxSourceBytes});
              if(read.status==='blocked')output={status:'blocked',outputs:{status:'blocked',reason:read.reason},provenance:read.provenance};
              else {value=read.value;entry.provenance={...value.provenance,coverage:value.coverage};
                entry.semanticContext.executorIdentity={capability:'file.read_local',localFileId:value.provenance.localFileId,contentRevision:value.provenance.contentRevision};
                entry.semanticFingerprint=results.nodeSemanticFingerprint(snapshot,item.nodeId,entry.semanticContext);}
            }else if(caps[0]==='artifact.create'){
              const bound=Object.values(item.node.inputBindings||{}),sources=[...inputs.map(x=>x.value),...bound];
              if(!sources.some(artifactContent))output={status:'blocked',outputs:{status:'blocked',reason:'파일로 내보낼 완성된 내용을 연결해줘.'}};
              else {
                const params=resolveArtifactRequest({request:item.node.settings?.request||objective});
                entry.toolEffectStarted=true;persist(true);
                if(record.storage.status==='failed'){
                  entry.toolEffectStarted=false;const error=new Error(record.storage.error);error.code=record.storage.error;throw error;
                }
                const result=await createArtifact({...params,sources},{signal});
                value=result?.artifact;
                if(!value?.downloadUrl||!/^(https?:\/\/|\/(?!\/)|blob:)/.test(String(value.downloadUrl)))throw new Error('LOCAL_ARTIFACT_NOT_VERIFIED');
                entry.effectConfirmed=true;
                value=await captureArtifact(fileStore,value,result?.blob,{conversationId,signal});
              }
            }else throw new Error('LOCAL_EXECUTOR_UNAVAILABLE');
            if(!output)output={status:'success',outputs:{status:'produced',values:{[port.name]:{inline:value}}}};
          }
          const metadata=copy(output?._meta||{});
          entry.execution=entry.reused?{...metadata,reused:true,usage:null,providerCalls:0,calls:[]}:metadata;
          if(entry.reused)entry.reusedExecution=metadata;
          if(signal?.aborted){
            if(entry.toolEffectStarted&&output?.status==='success'&&output.outputs?.status==='produced'){
              entry.status='success';entry.outputs=output.outputs;entry.effectConfirmed=true;
              entry.finishedAt=Date.now();
              entry.outputRefs=Object.keys(output.outputs.values||{}).map(port=>'local:'+runId+':'+item.nodeId+':'+port);
            }else entry.status='cancelled';
            record.status='cancelled';break;
          }

          if(output?.status==='blocked'){entry.status='blocked';entry.error=output.outputs?.reason||'CONTEXT_REQUIRED';entry.provenance=output.provenance||entry.provenance||{};record.status='waiting';break;}
          if(output?.status!=='success'||output.outputs?.status!=='produced')throw new Error('LOCAL_OUTPUT_NOT_VERIFIED');
          const values=output.outputs.values;
          if(!results.isVerifiedProducedOutput(item.definition,output.outputs))throw new Error('LOCAL_OUTPUT_NOT_VERIFIED');
          if(exclusive(item.nodeId)&&Object.keys(values).length!==1)throw new Error('EXCLUSIVE_BRANCH_OUTPUT_REQUIRED');
          entry.status='success';entry.outputs=output.outputs;
          entry.provenance={...entry.provenance,...output.provenance};
          if(executorIdentity===undefined&&(metadata.providerId||metadata.provider||metadata.model)){
            entry.semanticContext.executorIdentity={providerId:metadata.providerId||metadata.provider||'',model:metadata.model||''};
            entry.semanticFingerprint=results.nodeSemanticFingerprint(snapshot,item.nodeId,entry.semanticContext);
          }
          entry.finishedAt=Date.now();
          entry.outputRefs=Object.keys(values).map(port=>'local:'+runId+':'+item.nodeId+':'+port);
          entry.resultCurrent=true;
          if(item.definition.executorKind==='model_task')cache.set(fingerprint,output);
          resolved.set(item.nodeId,output.outputs);
        }catch(error){entry.status='failed';entry.error=error?.code||error?.message||'LOCAL_EXECUTION_FAILED';
          entry.execution=copy(error?._meta||{});entry.finishedAt=Date.now();
          record.status=entry.toolEffectStarted&&!entry.effectConfirmed?'outcome_unknown':signal?.aborted?'cancelled':'failed';
          if(entry.toolEffectStarted&&!entry.effectConfirmed)entry.status='outcome_unknown';break;}
        persist();
      }
      if(record.status==='running'){
        const intended=record.nodes.filter(n=>deliveryIds.includes(n.nodeId)&&n.status!=='skipped');
        record.status=intended.length&&intended.every(n=>n.status==='success')?'completed':intended.length?'waiting':'skipped';
      }
      return finish();
    }

    async function validateResults(snapshot,nodes,options={}){
      const results=await loadResults();let checked=results.currentResultNodes(snapshot,nodes,options);
      checked=await Promise.all(checked.map(async row=>{
        if(row.status!=='success'||row.provenance?.kind!=='local_file')return row;
        let current=false;
        try{
          const id=row.provenance.localFileId;
          if(row.provenance.contentRevision&&fileStore?.getMetadata){
            const metadata=await fileStore.getMetadata(id);
            current=metadata?.contentRevision===row.provenance.contentRevision;
          }else{
            const node=snapshot.graph.nodes.find(n=>n.nodeId===row.nodeId);
            const value=Object.values(row.outputs?.values||{})[0]?.inline;
            const read=await readLocalSource(fileStore,node?.settings?.file,{maxBytes:Math.max(1,row.provenance.coverage?.readBytes||64000)});
            current=read.status==='success'&&read.value.text===value?.text&&read.value.size===value?.size;
          }
        }catch{}
        return current?row:{...row,status:'stale',resultCurrent:false,sourceCurrent:false};
      }));
      return results.currentResultNodes(snapshot,checked,options);
    }
    return Object.freeze({graphId:graphIdFor,state,turn,run,validateResults,readSource:(file,options)=>readLocalSource(fileStore,file,options),migrateConversation,projectCanvasDraft});
  }
  global.createOvllPointerLocal=create;
  global.OvllPointerLocal=create();
})(window);
