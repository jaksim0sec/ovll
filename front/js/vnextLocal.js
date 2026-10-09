(function(global){
  "use strict";
  // Browser-owned graph snapshots, scoped to the existing local WorkspaceStore.
  // No SQL, login, server state or external execution is involved.
  function create({workspaceStore=global.OvllWorkspaceStore,
    loadCore=()=>import("/js/vnextGraphCore.mjs")}={}){
    if(!workspaceStore || typeof workspaceStore.updateConversationVNextGraph!=="function")
      throw new Error("LOCAL_WORKSPACE_UNAVAILABLE");
    const pending=new Map();
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
    async function repository(conversationId,graphId){
      const conversation=conversationFor(conversationId,graphId);
      const {MemoryGraphRepository}=await loadCore();
      const repo=new MemoryGraphRepository();
      const snapshot=conversation.state?.vnextGraph;
      if(snapshot){
        if(snapshot.graph?.graphId!==graphId)throw new Error("LOCAL_GRAPH_SCOPE_MISMATCH");
        repo.restore("local",graphId,snapshot);
      }else repo.create("local",graphId);
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
        workspaceStore.updateConversationVNextGraph(conversationId,repo.get("local",graphId));
        return {results:[{actionId:"local:"+actions[0].localKey,
          status:"applied",newRevision:applied.graphRef.revision,createdRefs:applied.createdRefs}]};
      });
      pending.set(conversationId,current);
      current.then(()=>{if(pending.get(conversationId)===current)pending.delete(conversationId);},
        ()=>{if(pending.get(conversationId)===current)pending.delete(conversationId);});
      return current;
    }

    async function run({conversationId,targets,damMode='closed',requestText='',
      executeNode=({snapshot,nodeId,inputArtifacts,requestText})=>global.OvllVNextApi.localNode({
        snapshot,nodeId,inputArtifacts,requestText}),onProgress=()=>{},signal}={}){
      const snapshot=(await state(conversationId)).graph;
      const {buildExecutionPlan}=await import('/js/vnextPlanCore.mjs');
      const targetIds=(targets||[]).map(x=>typeof x==='string'?x:x.nodeId);
      const plan=buildExecutionPlan(snapshot,{graphRef:{graphId:snapshot.graph.graphId,
        revision:snapshot.graph.revision},planEpoch:0,targets:targetIds,damMode});
      if(plan.order.length>64)throw new Error('LOCAL_RUN_LIMIT');
      const runId='r_'+(global.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
      const record={runId,graphRef:plan.graphRef,targets:targetIds,damMode,status:'running',
        startedAt:Date.now(),nodes:plan.order.map(x=>({nodeId:x.nodeId,status:'pending'}))};
      const persist=()=>{
        const existing=workspaceStore.getConversation(conversationId)?.state.vnextRuns||[];
        workspaceStore.updateConversationVNextRuns(conversationId,[...existing.filter(x=>x.runId!==runId),record]);
        onProgress(JSON.parse(JSON.stringify(record)));
      };
      persist();
      const resolved=new Map();
      for(const item of plan.order){
        const entry=record.nodes.find(n=>n.nodeId===item.nodeId);
        if(signal?.aborted){entry.status='cancelled';record.status='cancelled';break;}
        if(item.definition.executorKind!=='model_task'){
          entry.status='blocked';entry.error='LOCAL_EXECUTOR_UNAVAILABLE';record.status='waiting';break;
        }
        entry.status='running';persist();
        try{
          const inputs=snapshot.graph.connections.filter(link=>link.kind==='data'&&link.to.nodeId===item.nodeId)
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
          const output=await executeNode({snapshot,nodeId:item.nodeId,inputArtifacts:inputs,requestText,signal});
          if(output?.status==='blocked'){entry.status='blocked';entry.error=output.outputs?.reason||'CONTEXT_REQUIRED';record.status='waiting';break;}
          if(output?.status!=='success'||output.outputs?.status!=='produced')throw new Error('LOCAL_OUTPUT_NOT_VERIFIED');
          entry.status='success';entry.outputs=output.outputs;
          resolved.set(item.nodeId,output.outputs);
        }catch(error){entry.status='failed';entry.error=error?.code||error?.message||'LOCAL_EXECUTION_FAILED';
          record.status=signal?.aborted?'cancelled':'failed';break;}
        persist();
      }
      if(record.status==='running')record.status='completed';
      persist();
      return JSON.parse(JSON.stringify(record));
    }

    return Object.freeze({graphId:graphIdFor,state,turn,run});
  }
  global.createOvllVNextLocal=create;
  global.OvllVNextLocal=create();
})(window);
