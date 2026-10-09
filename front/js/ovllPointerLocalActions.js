(function(global){
"use strict";
// The model may return actions in any order. Dependencies decide the sequence.
function order(actions){
  if(!Array.isArray(actions)||actions.length>32)throw new Error("LOCAL_ACTION_LIMIT");
  const map=new Map(),ordered=[],active=new Set(),done=new Set();
  for(const action of actions){
    if(!action||typeof action.localKey!=="string"||!action.localKey||map.has(action.localKey))
      throw new Error("DUPLICATE_LOCAL_ACTION");
    map.set(action.localKey,action);
  }
  function visit(key){
    if(!map.has(key))throw new Error("LOCAL_ACTION_DEPENDENCY_MISSING");
    if(active.has(key))throw new Error("LOCAL_ACTION_DEPENDENCY_CYCLE");
    if(done.has(key))return;
    active.add(key);
    for(const dep of map.get(key).dependsOn||[])visit(dep);
    active.delete(key);done.add(key);ordered.push(map.get(key));
  }
  for(const action of actions)visit(action.localKey);
  return ordered;
}
global.OvllPointerLocalActions=Object.freeze({order});
})(window);
