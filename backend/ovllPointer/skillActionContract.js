// Explicit v2 action ingress and egress. Only domain contract fields are
// translated; opaque user data, function inputs and port values are preserved.
import {normalizeSkillPatch} from '../../front/js/ovllSkillCodec.mjs';
import {SEMANTIC_ACTION_FIELDS} from './actionCompiler.js';
export const SKILL_ACTION_PLAN_CONTRACT='action-plan.v2';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>{const e=new Error(code);e.code=code;throw e};
const rename=(o,oldKey,newKey)=>{
 if(own(o,oldKey)&&own(o,newKey))fail('MIXED_SKILL_ACTION');
 if(own(o,newKey)){o[oldKey]=o[newKey];delete o[newKey]}
};
function selector(input){
 if(!object(input))fail('INVALID_SKILL_SELECTOR');
 const s=structuredClone(input);
 if(own(s,'nodeId')||own(s,'localNodeKey'))fail('MIXED_SKILL_ACTION');
 if(s.kind==='existing'){
  if(typeof s.skillId!=='string'||!s.skillId)fail('INVALID_SKILL_SELECTOR');
  rename(s,'nodeId','skillId');
 }else if(s.kind==='created'){
  if(typeof s.alias!=='string'||!s.alias)fail('INVALID_SKILL_SELECTOR');
 }else if(s.kind!=='function')fail('INVALID_SKILL_SELECTOR');
 return s;
}
function endpoint(value){
 if(!object(value)||!object(value.skill)||own(value,'node')||
   typeof value.port!=='string')fail('INVALID_SKILL_ENDPOINT');
 const {skill,...rest}=value;
 return {...structuredClone(rest),node:selector(skill)};
}
const actions=Object.freeze({
 'skill.define':'node.define','skill.revise':'definition.revise',
 'skill.add':'node.add','skill.update':'node.update','skill.delete':'node.delete',
 'skill.appearance':'definition.appearance','skill.definition.delete':'definition.delete',
 'link.add':'link.add','link.remove':'link.remove',
 execute:'execute','function.save':'function.save','question.ask':'question.ask'
});
export const SKILL_SEMANTIC_ACTION_FIELDS=Object.freeze(Object.fromEntries(
  Object.entries(actions).map(([canonical,legacy])=>[
    canonical,SEMANTIC_ACTION_FIELDS[legacy]
  ])
));
export function legacySemanticKind(kind){
  return own(actions,kind)?actions[kind]:kind;
}
export function skillSemanticKind(kind){
  const match=Object.entries(actions).find(([,legacy])=>legacy===kind);
  return match?.[0]||kind;
}
function functionDraft(value){
 if(!object(value))return value;
 const fn=structuredClone(value);
 for(const field of ['inputMap','outputMap']){
  if(!object(fn[field]))continue;
  for(const entry of Object.values(fn[field])){
   if(!object(entry))continue;
   if(own(entry,'skill')&&own(entry,'node'))fail('MIXED_SKILL_ACTION');
   if(own(entry,'skill')){entry.node=selector(entry.skill);delete entry.skill}
   if(own(entry,'skillId'))rename(entry,'nodeId','skillId');
  }
 }
 return fn;
}
export function toLegacySkillActionPlan(plan){
 if(!object(plan)||plan.contract!==SKILL_ACTION_PLAN_CONTRACT||
   plan.actions!==undefined&&!Array.isArray(plan.actions))
   fail('INVALID_SKILL_ACTION_PLAN');
 const result={...structuredClone(plan),contract:'action-plan.v1'};
 result.actions=(result.actions||[]).map(action=>{
  if(!object(action)||typeof action.action!=='string'||!own(actions,action.action))
    fail('INVALID_SKILL_ACTION');
  if(Object.keys(action).some(k=>['nodeId','localNodeKey','nodeRef','definitionRef'].includes(k)))
    fail('MIXED_SKILL_ACTION');
  const value={...action,action:actions[action.action]};
  if(['node.update','node.delete'].includes(value.action))value.target=selector(value.target);
  if(value.action==='execute'&&value.target?.kind!=='function'){
   if(value.target!==undefined)value.target=selector(value.target);
   if(Array.isArray(value.targets))value.targets=value.targets.map(selector);
  }
  if(value.action==='link.add'){value.from=endpoint(value.from);value.to=endpoint(value.to)}
  if(value.action==='function.save')value.function=functionDraft(value.function);
  return value;
 });
 return result;
}
function skillSelector(value){
 const s=structuredClone(value);
 rename(s,'skillId','nodeId');
 rename(s,'localSkillKey','localNodeKey');
 return s;
}
function skillDraft(value){
 if(!object(value))return value;
 const draft=structuredClone(value);
 for(const name of ['inputMap','outputMap'])
  for(const target of Object.values(draft[name]||{})){
   if(!object(target))continue;
   if(own(target,'nodeId'))rename(target,'skillId','nodeId');
   if(own(target,'node')){target.skill=skillSelector(target.node);delete target.node}
  }
 return draft;
}
export function toSkillCompiledTurn(turn){
 const result=structuredClone(turn);
 if(!Array.isArray(result.actions))return result;
 result.actions=result.actions.map(a=>{
  if(a.kind==='ir.applyPatch')a.args.patch=normalizeSkillPatch(a.args.patch,{source:'legacy'});
  if(a.kind==='run.start'&&Array.isArray(a.args.targets))
    a.args.targets=a.args.targets.map(skillSelector);
  if(a.kind==='function.save'&&a.args.function)
    a.args.function=skillDraft(a.args.function);
  return a;
 });
 return result;
}
