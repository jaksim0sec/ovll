import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PROMPT_EVAL_CASES,gradePromptEvalTurn,promptEvalSnapshot,promptEvalExtra}
 from '../backend/ovllPointer/promptEval.js';
const patch=(skillDefinitions,operations)=>({kind:'ir.applyPatch',localKey:'p',
 args:{patch:{graphId:'g_eval',expectedGraphRevision:0,skillDefinitions,operations}}});
const run=()=>({kind:'run.start',localKey:'r',dependsOn:['p'],
 args:{targets:[{fromAction:'p',localSkillNodeKey:'n'}]}});
test('evaluator retains six task behaviors and adds four held-out boundaries',()=>{
 assert.deepEqual(PROMPT_EVAL_CASES.map(c=>c.id),['chat','new-kind','edit-only','reuse-run','compose-run','pdf-export',
  'explain-save','new-kind-run','multi-source','read-before-plan']);
 assert.equal(promptEvalSnapshot('reuse-run').graph.skillNodes[0].skillNodeId,'existing-write');
 assert.equal(promptEvalExtra('pdf-export').availableResults.items[0].resultCurrent,true);
});
test('direct answer must not contain unauthorized actions',()=>{
 assert.ok(gradePromptEvalTurn('chat',{message:'Done'}).pass);
 assert.equal(gradePromptEvalTurn('chat',{message:'Done',executionIntent:'requested',actions:[run()]}).pass,false);
});
test('new kind requires a new definition and matching instance',()=>{
 const n={op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{localDefinitionKey:'d'}};
 assert.ok(gradePromptEvalTurn('new-kind',{actions:[patch([{localKey:'d'}],[n])]}).pass);
 assert.equal(gradePromptEvalTurn('new-kind',{actions:[patch([],[{
  ...n,skillDefinitionRef:{definitionId:'builtin:write'}}])]}).pass,false);
});
test('editing a graph does not approve running it',()=>{
 const p=patch([],[{op:'skillNode.update',skillNodeId:'existing-write'}]);
 assert.ok(gradePromptEvalTurn('edit-only',{actions:[p]}).pass);
 assert.equal(gradePromptEvalTurn('edit-only',{executionIntent:'requested',actions:[p,run()]}).pass,false);
});
test('reuse existing writing skillNode does not create duplicates',()=>{
 const existing={kind:'run.start',args:{targets:[{skillNodeId:'existing-write'}]}};
 assert.ok(gradePromptEvalTurn('reuse-run',{executionIntent:'requested',actions:[existing]}).pass);
 assert.equal(gradePromptEvalTurn('reuse-run',{executionIntent:'requested',actions:[
  patch([],[{op:'skillNode.add',localSkillNodeKey:'duplicate'}]),existing]}).pass,false);
});
test('composite skillNode creation and execution require same local key and dependency',()=>{
 const p=patch([],[{op:'skillNode.add',localSkillNodeKey:'n'}]);
 assert.ok(gradePromptEvalTurn('compose-run',{executionIntent:'requested',actions:[p,run()]}).pass);
 assert.equal(gradePromptEvalTurn('compose-run',{executionIntent:'requested',actions:[
  p,{...run(),dependsOn:[]}]}).pass,false);
});
test('PDF export needs a real data link from the existing source',()=>{
 const file={op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{definitionId:'builtin:createFile'}};
 const link={op:'link.add',kind:'data',
  from:{skillNode:{skillNodeId:'existing-research'}},to:{skillNode:{localSkillNodeKey:'n'}}};
 assert.ok(gradePromptEvalTurn('pdf-export',{executionIntent:'requested',
  actions:[patch([],[file,link]),run()]}).pass);
 assert.equal(gradePromptEvalTurn('pdf-export',{executionIntent:'requested',
  actions:[patch([],[file]),run()]}).pass,false);
});
test('structural grade is not proof of completed execution',()=>{
 const g=gradePromptEvalTurn('chat',{message:'Done'});
 assert.equal(g.proposedOnly,true);
 assert.equal(Object.hasOwn(g,'completed'),false);
});

test('CLI dry run never accesses a live model or needs a key',()=>{
 const script=fileURLToPath(new URL('../scripts/eval-pointer-prompts.mjs',import.meta.url));
 const run=spawnSync(process.execPath,[script,'--cases','chat,new-kind'],{
  encoding:'utf8',env:{...process.env,GEMINI_API_KEY:'',GROQ_API_KEY:'',
   OVLL_POINTER_MODEL_API_KEY:'',OVLL_VNEXT_MODEL_API_KEY:''}});
 assert.equal(run.status,0,run.stderr);
 const output=JSON.parse(run.stdout);
 assert.equal(output.dryRun,true);
 assert.deepEqual(output.cases,['chat','new-kind']);
 assert.equal(output.maximumHostCalls,12);
 assert.equal(output.maximumPhysicalCalls,48);
});
