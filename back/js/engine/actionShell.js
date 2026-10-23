/** Named action entry points only. No action prompts, Function Calling, mutations or success claims. */
export const actionCatalog=Object.freeze({
 skillDefine:Object.freeze(['defineDirect','defineFromIR','revise']),
 skillEdit:Object.freeze(['editAppearance','delete']),
 canvasEdit:Object.freeze(['addBlock','editBlock','deleteBlock','addLink','removeLink']),
 textGenerate:Object.freeze(['basicText','question'])
});
export const actionNames=Object.freeze(Object.entries(actionCatalog).flatMap(([prefix,actions])=>actions.map(action=>prefix+'.'+action)));
const supported=new Set(actionNames);
export function createActionShell(){
 return Object.freeze({
  accepts:action=>supported.has(action),
  enter({action,objective,need,resources}={}){
   if(!supported.has(action)||typeof objective!=='string'||!objective.trim()||!Array.isArray(need)||!Array.isArray(resources))
    throw Object.assign(new Error('Invalid action handoff'),{code:'ENGINE_OUTPUT_INVALID'});
   return {action,workshop:action.split('.')[0],objective,need:structuredClone(need),status:'not_implemented'};
  }
 });
}
