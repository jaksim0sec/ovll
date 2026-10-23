/** Volatile versioned room context/history port. Swap this adapter for transactional persistence without changing engine decisions. */
export function createMemorySessions(){
 const rows=new Map(),copy=x=>structuredClone(x);
 const empty=()=>({overallFlow:'',currentTopic:'',details:''});
 function load({scope,initialContext}={}){
  if(typeof scope!=='string'||!scope)throw new TypeError('Invalid session scope');
  if(!rows.has(scope))rows.set(scope,{revision:0,contextData:copy(initialContext??empty()),history:[]});
  return copy(rows.get(scope));
 }
 function commit({scope,expectedRevision,requestId,request,contextBlock,contextData,assistantResponse='',verifiedResults=[]}={}){
  const value=load({scope});
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof requestId!=='string'||!requestId||!request||!contextBlock||!contextData)throw new TypeError('Invalid session commit');
  if(value.revision!==expectedRevision)return {status:'conflict',revision:value.revision};
  value.revision++;
  value.contextData=copy(contextData);
  value.history.push(copy({requestId,request,contextBlock,contextData,assistantResponse,verifiedResults,status:'completed'}));
  if(value.history.length>8)value.history.splice(0,value.history.length-8);
  rows.set(scope,copy(value));return {status:'committed',revision:value.revision};
 }
 function recordFailure({scope,requestId,request,contextBlock=null,error=null,verifiedResults=[]}={}){
  if(typeof requestId!=='string'||!requestId||!request)throw new TypeError('Invalid failed request');
  const value=load({scope});
  // Store a failed request as conversational evidence only; never replace confirmed contextData.
  const prior=value.history.find(x=>x.requestId===requestId);
  if(prior)return {status:'already_recorded',revision:value.revision};
  value.revision++;
  value.history.push(copy({requestId,request,status:'failed',contextBlock,contextData:value.contextData,assistantResponse:'',verifiedResults,error}));
  if(value.history.length>8)value.history.splice(0,value.history.length-8);
  rows.set(scope,copy(value));
  return {status:'recorded',revision:value.revision};
 }
 return Object.freeze({load,commit,recordFailure});
}