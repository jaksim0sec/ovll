/** Versioned volatile request checkpoints; persistence is an injected port, not an engine concern. */
export function createMemoryCheckpoints(){
 const rows=new Map(),clone=x=>structuredClone(x);
 const key=(scope,requestId)=>JSON.stringify([scope,requestId]);
 function load({scope,requestId}={}){const value=rows.get(key(scope,requestId));return value?clone(value):null;}
 function save({scope,requestId,expectedRevision,next}={}){
  if(typeof scope!=='string'||!scope||typeof requestId!=='string'||!requestId||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!next||typeof next!=='object')throw new TypeError('Invalid checkpoint');
  const id=key(scope,requestId),previous=rows.get(id),version=previous?.revision??0;
  if(version!==expectedRevision)return {status:'conflict',revision:version};
  const value={revision:version+1,state:clone(next)};rows.set(id,clone(value));return {status:'saved',...clone(value)};
 }
 return Object.freeze({load,save});
}