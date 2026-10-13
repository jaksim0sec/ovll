// Canonical browser-facing Skill runtime; the frozen v1 scheduler remains the
// compatibility executor. Identities and ports are never regenerated.
import {normalizeSkillSnapshot,normalizeSkillRun} from './ovllSkillCodec.mjs';
import {toLegacySkillSnapshot,toLegacySkillPatch} from './ovllSkillGraph.mjs';
const renameRefs=refs=>Object.fromEntries(
 Object.entries(refs||{}).map(([key,value])=>
   [key.startsWith('node:')?'skill:'+key.slice(5):key,value]));
const toLegacyOutput=output=>{
 const {skillId,...rest}=output;
 if(typeof skillId!=='string')throw Error('INVALID_SKILL_OUTPUT');
 return {...rest,nodeId:skillId};
};
const toLegacyRows=rows=>{
 if(!Array.isArray(rows))throw Error('INVALID_SKILL_RESULTS');
 return rows.map(row=>{
  const {skillId,...other}=row;
  if(typeof skillId!=='string')throw Error('INVALID_SKILL_RESULT_ID');
  return {...other,nodeId:skillId};
 });
};
export function createSkillLocal({legacy,api}={}){
 if(!legacy||typeof legacy.state!=='function'||typeof legacy.turn!=='function'||
    typeof legacy.run!=='function')throw Error('SKILL_LEGACY_EXECUTOR_UNAVAILABLE');
 if(typeof api?.localSkill!=='function')throw Error('SKILL_MODEL_API_UNAVAILABLE');
 async function state(conversationId,graphId){
  const result=await legacy.state(conversationId,graphId);
  return {...result,graph:normalizeSkillSnapshot(result.graph,{source:'legacy'}),
    runs:(result.runs||[]).map(run=>normalizeSkillRun(run,{source:'legacy'}))};
 }
 async function turn({conversationId,graphId,actions}={}){
  if(!Array.isArray(actions)||actions.length!==1||
     actions[0]?.kind!=='ir.applyPatch')throw Error('INVALID_SKILL_TURN');
  const action=structuredClone(actions[0]);
  action.args={...action.args,patch:toLegacySkillPatch(action.args?.patch)};
  const result=await legacy.turn({conversationId,graphId,actions:[action]});
  return {...result,results:(result.results||[]).map(item=>({
    ...item,createdRefs:renameRefs(item.createdRefs)
  }))};
 }
 async function run(options={}){
  const {snapshotOverride,executeSkill,onProgress,...rest}=options;
  const executeNode=async args=>{
   const canonical=normalizeSkillSnapshot(args.snapshot,{source:'legacy'});
   const execute=executeSkill||api.localSkill;
   return toLegacyOutput(await execute({
    ...args,snapshot:canonical,skillId:args.nodeId,
    nodeId:undefined
   }));
  };
  const result=await legacy.run({
   ...rest,
   ...(snapshotOverride?{snapshotOverride:toLegacySkillSnapshot(snapshotOverride)}:{}),
   executeNode,
   onProgress:run=>{
    if(onProgress)onProgress(normalizeSkillRun(run,{source:'legacy'}));
   }
  });
  return normalizeSkillRun(result,{source:'legacy'});
 }
 async function validateResults(snapshot,rows,options){
  const valid=await legacy.validateResults(
    toLegacySkillSnapshot(snapshot),toLegacyRows(rows),options);
  return valid.map(({nodeId,...other})=>({skillId:nodeId,...other}));
 }
 return Object.freeze({graphId:legacy.graphId,state,turn,run,validateResults});
}
