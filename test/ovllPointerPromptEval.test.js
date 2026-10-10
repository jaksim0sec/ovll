import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PROMPT_EVAL_CASES,gradePromptEvalTurn,promptEvalSnapshot,promptEvalExtra}
 from '../backend/ovllPointer/promptEval.js';
const patch=(definitions,operations)=>({kind:'ir.applyPatch',localKey:'p',
 args:{patch:{graphId:'g_eval',expectedGraphRevision:0,definitions,operations}}});
const run=()=>({kind:'run.start',localKey:'r',dependsOn:['p'],
 args:{targets:[{fromAction:'p',localNodeKey:'n'}]}});
test('evaluator represents six complementary task behaviors',()=>{
 assert.equal(PROMPT_EVAL_CASES.length,6);
 assert.equal(promptEvalSnapshot('reuse-run').graph.nodes[0].nodeId,'existing-write');
 assert.equal(promptEvalExtra('pdf-export').availableResults.items[0].resultCurrent,true);
});
test('direct answer must not contain unauthorized actions',()=>{
 assert.ok(gradePromptEvalTurn('chat',{message:'Done'}).pass);
 assert.equal(gradePromptEvalTurn('chat',{message:'Done',executionIntent:'requested',actions:[run()]}).pass,false);
});
test('new kind requires a new definition and matching instance',()=>{
 const n={op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}};
 assert.ok(gradePromptEvalTurn('new-kind',{actions:[patch([{localKey:'d'}],[n])]}).pass);
 assert.equal(gradePromptEvalTurn('new-kind',{actions:[patch([],[{
  ...n,definitionRef:{definitionId:'builtin:write'}}])]}).pass,false);
});
test('editing a graph does not approve running it',()=>{
 const p=patch([],[{op:'node.update',nodeId:'existing-write'}]);
 assert.ok(gradePromptEvalTurn('edit-only',{actions:[p]}).pass);
 assert.equal(gradePromptEvalTurn('edit-only',{executionIntent:'requested',actions:[p,run()]}).pass,false);
});
test('reuse existing writing node does not create duplicates',()=>{
 const existing={kind:'run.start',args:{targets:[{nodeId:'existing-write'}]}};
 assert.ok(gradePromptEvalTurn('reuse-run',{executionIntent:'requested',actions:[existing]}).pass);
 assert.equal(gradePromptEvalTurn('reuse-run',{executionIntent:'requested',actions:[
  patch([],[{op:'node.add',localNodeKey:'duplicate'}]),existing]}).pass,false);
});
test('composite node creation and execution require same local key and dependency',()=>{
 const p=patch([],[{op:'node.add',localNodeKey:'n'}]);
 assert.ok(gradePromptEvalTurn('compose-run',{executionIntent:'requested',actions:[p,run()]}).pass);
 assert.equal(gradePromptEvalTurn('compose-run',{executionIntent:'requested',actions:[
  p,{...run(),dependsOn:[]}]}).pass,false);
});
test('PDF export needs a real data link from the existing source',()=>{
 const file={op:'node.add',localNodeKey:'n',definitionRef:{definitionId:'builtin:createFile'}};
 const link={op:'link.add',kind:'data',
  from:{node:{nodeId:'existing-research'}},to:{node:{localNodeKey:'n'}}};
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
 assert.equal(output.maximumHostCalls,8);
});
