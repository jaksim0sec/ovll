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
  value.history.push(copy({requestId,request,contextBlock,contextData,assistantResponse,verifiedResults}));
  if(value.history.length>8)value.history.splice(0,value.history.length-8);
  rows.set(scope,copy(value));return {status:'committed',revision:value.revision};
 }
 return Object.freeze({load,commit});
}