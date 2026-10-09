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
    return Object.freeze({graphId:graphIdFor,state,turn});
  }
  global.createOvllVNextLocal=create;
  global.OvllVNextLocal=create();
})(window);
