// Synchronous semantic identity for browser render-time validity checks.
// SHA-256 keeps stored result evidence bounded even when actual input text is large.
export function semanticDigest(text){
  const source=new TextEncoder().encode(text),length=Math.ceil((source.length+9)/64)*64;
  const bytes=new Uint8Array(length);bytes.set(source);bytes[source.length]=0x80;
  const view=new DataView(bytes.buffer),bits=source.length*8;
  view.setUint32(length-8,Math.floor(bits/4294967296));view.setUint32(length-4,bits>>>0);
  const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const state=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate=(value,count)=>(value>>>count)|(value<<(32-count)),words=new Uint32Array(64);
  for(let offset=0;offset<length;offset+=64){
    for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
    for(let i=16;i<64;i++){
      const a=words[i-15],b=words[i-2];
      words[i]=(words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;
    }
    let [a,b,c,d,e,f,g,h]=state;
    for(let i=0;i<64;i++){
      const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])>>>0;
      const t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
      h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((value,i)=>{state[i]=(state[i]+value)>>>0;});
  }
  return state.map(value=>value.toString(16).padStart(8,'0')).join('');
}
export function canonicalSemanticValue(value){
  return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?
    Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
}
const compareSemantic=(a,b)=>{a=canonicalSemanticValue(a);b=canonicalSemanticValue(b);return a<b?-1:a>b?1:0;};
const uiSettings=new Set(['position','x','y','expanded','collapsed','selected','viewport','layout','presentation']);
export function semanticSettings(settings={}){
  return Object.fromEntries(Object.entries(settings).filter(([key])=>!uiSettings.has(key)));
}
export function definitionSemantics(definition){
  const {presentation,localKey,...semantic}=definition||{};
  return semantic;
}
export function nodeSemanticFingerprint(snapshot,nodeId,options={}){
  if(!snapshot?.graph||!Array.isArray(snapshot.graph.nodes)||!Array.isArray(snapshot.definitions))throw new Error('INVALID_RESULT_CONTEXT');
  const nodes=new Map(snapshot.graph.nodes.map(node=>[node.nodeId,node]));
  const definitions=new Map(snapshot.definitions.map(def=>[def.definitionId+':'+def.version,def]));
  const selected=new Set(),queue=[nodeId];
  while(queue.length){
    const id=queue.pop();if(selected.has(id))continue;
    const node=nodes.get(id);if(!node)throw new Error('RESULT_NODE_NOT_FOUND');
    selected.add(id);
    for(const link of snapshot.graph.connections||[])if(link.to.nodeId===id)queue.push(link.from.nodeId);
  }
  const semantics=[...selected].sort().map(id=>{
    const node=nodes.get(id),definition=definitions.get(node.definitionRef?.definitionId+':'+node.definitionRef?.version);
    if(!definition)throw new Error('RESULT_DEFINITION_NOT_FOUND');
    return {nodeId:id,definitionRef:node.definitionRef,definition:definitionSemantics(definition),
      settings:semanticSettings(node.settings),inputBindings:node.inputBindings||{}};
  });
  const connections=(snapshot.graph.connections||[]).filter(link=>selected.has(link.to.nodeId))
    .map(({kind,from,to})=>({kind,from,to})).sort(compareSemantic);
  const inputArtifacts=(options.inputArtifacts||[]).map(({valueRef,runId,planEpoch,...input})=>input)
    .sort(compareSemantic);
  return semanticDigest(canonicalSemanticValue({nodeId,nodes:semantics,connections,context:{
    requestText:options.requestText||'',taskContext:options.taskContext||{},taskConstraints:options.taskConstraints||[],
    executorIdentity:options.executorIdentity||'local-v1',inputArtifacts,
    dependencyResults:options.dependencyResults||{}}}));
}
export function isCurrentNodeResult(snapshot,nodeId,result,options={}){
  if(result?.status!=='success'||result.nodeId!==nodeId||typeof result.semanticFingerprint!=='string')return false;
  try{return result.semanticFingerprint===nodeSemanticFingerprint(snapshot,nodeId,{...result.semanticContext,...options});}
  catch{return false;}
}
export function currentResultNodes(snapshot,nodes,options={}){
  const byId=new Map((nodes||[]).map(node=>[node.nodeId,node])),validity=new Map(),active=new Set();
  const current=id=>{
    if(validity.has(id))return validity.get(id);
    const node=byId.get(id);
    if(!node||active.has(id)||!isCurrentNodeResult(snapshot,id,node,options))return false;
    active.add(id);
    const dependencies={...node.semanticContext,...options}.dependencyResults||{};
    const valid=Object.entries(dependencies).every(([parentId,evidence])=>{
      const parent=byId.get(parentId);
      return current(parentId)&&parent.semanticFingerprint===evidence.semanticFingerprint&&
        canonicalSemanticValue(parent.outputs)===canonicalSemanticValue(evidence.outputs);
    });
    active.delete(id);validity.set(id,valid);return valid;
  };
  return (nodes||[]).map(node=>{
    if(node.status!=='success')return {...node};
    const resultCurrent=current(node.nodeId);
    return {...node,status:resultCurrent?'success':'stale',resultCurrent};
  });
}
