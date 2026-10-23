/** Prototype data supply port. It contains no database or frontend dependencies. */
export function createMemoryDataProvider({fixtures={}}={}){
  const copy=x=>structuredClone(x);
  async function resolveNeed({need,availableResources=[],request,contextData,chatHistory=[]}={}){
    if(!Array.isArray(need)||!Array.isArray(availableResources)||!Array.isArray(chatHistory))throw Object.assign(new Error('Invalid data request'),{code:'UNSUPPORTED_DATASET'});
    const resources=copy(availableResources),missing=[];
    const findComplete=(dataset,key)=>resources.find(r=>r.dataset===dataset&&r.key===key&&r.completeness==='complete');
    const add=(dataset,key)=>{
      if(findComplete(dataset,key))return;
      let item=fixtures?.[dataset]?.[key];
      if(item?.completeness==='complete'){const next=copy({dataset,key,...item});const existing=resources.findIndex(r=>r.dataset===dataset&&r.key===key);if(existing<0)resources.push(next);else resources[existing]=next;return;}
      missing.push([dataset,key]);
    };
    for(const entry of need){
      if(!Array.isArray(entry)||typeof entry[0]!=='string')throw Object.assign(new Error('Invalid need'),{code:'UNSUPPORTED_DATASET'});
      const [dataset,arg]=entry;
      if(dataset==='skillDef'||dataset==='canvasSkill'){
        if(!Array.isArray(arg)||arg.some(v=>typeof v!=='string'||!v))throw Object.assign(new Error('Invalid data selector'),{code:'UNSUPPORTED_DATASET'});
        for(const key of [...new Set(arg)])add(dataset,key);
      }else if(dataset==='skillList'){
        if(arg!==undefined)throw Object.assign(new Error('Invalid skillList need'),{code:'UNSUPPORTED_DATASET'});
        add('skillList','list');
      }else if(dataset==='originalReq'){
        if(!Number.isSafeInteger(arg)||arg<0)throw Object.assign(new Error('Invalid originalReq need'),{code:'UNSUPPORTED_DATASET'});
        if(arg===0&&request){const key='0';if(!findComplete(dataset,key))resources.push({dataset,key,source:'current-request',completeness:'complete',value:copy(request)});}
        else if(arg>0&&arg<=chatHistory.length&&chatHistory[chatHistory.length-arg]?.request){
          const key=String(arg);if(!findComplete(dataset,key))resources.push({dataset,key,source:'room-history',completeness:'complete',value:copy(chatHistory[chatHistory.length-arg].request)});
        }else add(dataset,String(arg));
      }else if(dataset==='chatContext'){
        if(!Number.isSafeInteger(arg)||arg<1)throw Object.assign(new Error('Invalid chatContext need'),{code:'UNSUPPORTED_DATASET'});
        if(arg<=chatHistory.length){
          const key=String(arg);if(!findComplete(dataset,key))resources.push({dataset,key,source:'room-history',completeness:'complete',value:copy(chatHistory.slice(-arg).map(({requestId,contextBlock,contextData})=>({requestId,contextBlock,contextData})))});
        }else add(dataset,String(arg));
      }else throw Object.assign(new Error('Unknown data resource'),{code:'UNSUPPORTED_DATASET'});
    }
    return {resources,missing};
  }
  return Object.freeze({resolveNeed});
}
