(function(global){
"use strict";
const KEY="ovll:pointer:functions:v1";
const clone=v=>JSON.parse(JSON.stringify(v));
function read(){
  try{const a=JSON.parse(global.localStorage.getItem(KEY)||global.localStorage.getItem('ovll:vnext:functions:v1')||"[]");
    return Array.isArray(a)?a.filter(x=>x&&x.id&&x.snapshot?.graph&&Array.isArray(x.targets)).slice(-30):[];}
  catch{return [];}
}
function save({purpose,snapshot,targets,inputs=[],outputs=[],invariants=[]}={}){
  if(typeof purpose!=="string"||!purpose.trim()||purpose.length>2400||
    !snapshot?.graph?.graphId||!Number.isInteger(snapshot.graph.revision)||
    !Array.isArray(snapshot.graph.nodes)||!Array.isArray(snapshot.definitions)||
    !Array.isArray(targets)||!targets.length||targets.some(id=>
      !snapshot.graph.nodes.some(n=>n.nodeId===id))||JSON.stringify(snapshot).length>50000)
    throw new Error("INVALID_LOCAL_FUNCTION");
  const a=read();if(a.length>=30)throw new Error("LOCAL_FUNCTION_LIMIT");
  const item={id:"fn_"+global.crypto.randomUUID().replace(/-/g,""),version:1,purpose:purpose.trim(),
    snapshot:clone(snapshot),targets:[...new Set(targets)],inputs:clone(inputs),outputs:clone(outputs),
    invariants:clone(invariants),verificationStatus:"draft",createdAt:Date.now()};
  global.localStorage.setItem(KEY,JSON.stringify([...a,item]));
  return clone(item);
}
const list=()=>clone(read().map(({snapshot,...rest})=>rest));
const get=id=>{const x=read().find(a=>a.id===id);return x?clone(x):null;};
global.OvllPointerFunctions=Object.freeze({save,list,get,storageKey:KEY});
})(window);
