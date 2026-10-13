import test from 'node:test';
import assert from 'node:assert/strict';
import {PROMPT_EVAL_CASES,promptEvalSnapshot,promptEvalExtra,gradePromptEvalTurn} from '../backend/ovllPointer/promptEval.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {toWireTurnExample} from '../backend/ovllPointer/modelContract.js';
import {createContractValidation,splitModelMetadata} from '../backend/ovllPointer/validation.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';
import {withPointerCatalog} from '../backend/ovllPointer/skillCatalog.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const draft={localKey:'review',purpose:'Review source reliability',executorKind:'model_task',
 instruction:'Assess supplied sources and preserve their evidence.',
 inputs:[{name:'in',role:'sources',representation:'json'}],outputs:[{name:'result',role:'review',representation:'json'}]};
const node={op:'node.add',localNodeKey:'reviewer',definitionRef:{localDefinitionKey:'review'}};
const patch=(definitions,operations)=>({localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId:'g_eval',expectedGraphRevision:0,definitions,operations}}});
const run=target=>({localKey:'r',kind:'run.start',...(target.fromAction?{dependsOn:['p']}:{}),args:{targets:[target],damMode:'closed'}});
const link=(source,target='reviewer',key=source)=>({op:'link.add',localLinkKey:key,kind:'data',
 from:{node:{nodeId:source},port:'result'},to:{node:{localNodeKey:target},port:'in'}});
const save={localKey:'s',kind:'function.save',args:{function:{purpose:'Review source reliability',
 inputs:draft.inputs,outputs:draft.outputs,invariants:['Preserve evidence'],procedure:{kind:'model_task',instruction:draft.instruction}}}};
const proposals={
 'explain-save':{message:'This reusable task reviews supplied sources and preserves evidence.',actions:[save]},
 'new-kind-run':{executionIntent:'requested',actions:[patch([draft],[node,link('existing-research')]),run({fromAction:'p',localNodeKey:'reviewer'})]},
 'multi-source':{executionIntent:'requested',actions:[run({nodeId:'existing-review'})]},
 'read-before-plan':{needs:[{kind:'contract',selector:{scope:'ref',ref:'saved-review',depth:'full'},purpose:'Read the saved procedure and input contract'}]}
};
test('result fixtures match the real coordinator result index rather than invented inline fields',()=>{
 const context={window:{}};
 vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),context);
 for(const id of ['pdf-export','new-kind-run','multi-source']){
  const sources=id==='multi-source'?['source-a','source-b']:['existing-research'];
  const runs=sources.map((nodeId,i)=>({runId:'eval_'+nodeId.replace(/-/g,'_'),graphRef:{graphId:'g_eval'},nodes:[{
   nodeId,status:'success',resultCurrent:true,outputs:{values:{result:{inline:id==='multi-source'?'Source '+(i+1)+' evidence.':'Existing sourced research notes.'}}}
  }]}));
  const actual=context.window.OvllPointerLocalActions.resultIndex({snapshot:promptEvalSnapshot(id),runs});
  assert.deepEqual(promptEvalExtra(id).availableResults,JSON.parse(JSON.stringify(actual)),id);
 }
});
test('held-out boundaries are independently evaluated instead of teaching one exclusive action case',async()=>{
 for(const [id,turn] of Object.entries(proposals)){
  const scenario=PROMPT_EVAL_CASES.find(c=>c.id===id);
  assert.ok(scenario,'missing boundary scenario '+id);
  assert.ok(gradePromptEvalTurn(id,turn).pass,id);
  assert.equal(createContractValidation().validateTurn(turn),true,id);
  const snap=promptEvalSnapshot(id),repo=new MemoryGraphRepository();
  repo.restore('eval',snap.graph.graphId,withPointerCatalog(snap));
  for(const action of turn.actions||[])if(action.kind==='ir.applyPatch')repo.apply('eval',action.args.patch);
  for(const wire of [false,true]){
   let calls=0;
   const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{
    capabilities:()=>({structuredOutput:wire}),complete:async()=>{calls++;return {text:JSON.stringify(wire?toWireTurnExample(turn):turn)};}
   }});
   const result=await host.turn({snapshot:snap,requestText:scenario.requestText,requestRef:'boundary_'+id,
    extraContext:promptEvalExtra(id)});
   assert.deepEqual(splitModelMetadata(result).domain,turn);assert.equal(calls,1);
   assert.ok(gradePromptEvalTurn(id,result).pass);
  }
 }
});
test('explain and save needs both actions while rejecting unsolicited execution or edits',()=>{
 assert.ok(gradePromptEvalTurn('explain-save',proposals['explain-save']).pass);
 for(const wrong of [{message:'Only an explanation'}, {actions:[save]},
  {...proposals['explain-save'],executionIntent:'requested',actions:[save,run({nodeId:'x'})]},
  {...proposals['explain-save'],actions:[save,patch([],[])]}])
  assert.equal(gradePromptEvalTurn('explain-save',wrong).pass,false);
});
test('new kind with execution keeps its definition, real source link and producer dependency',()=>{
 const good=proposals['new-kind-run'];assert.ok(gradePromptEvalTurn('new-kind-run',good).pass);
 const variants=[patch([],[{...node,definitionRef:{definitionId:'builtin:write',version:1}},link('existing-research')]),
  patch([draft],[node]),patch([draft],[node,{...link('existing-research'),kind:'flow'}])];
 for(const p of variants)assert.equal(gradePromptEvalTurn('new-kind-run',{...good,actions:[p,good.actions[1]]}).pass,false);
 assert.equal(gradePromptEvalTurn('new-kind-run',{...good,actions:[good.actions[0],{...good.actions[1],dependsOn:[]}]}).pass,false);
});
test('multi-source evaluation requires both original producers on the actual target input',()=>{
 const snapshot=promptEvalSnapshot('multi-source');
 assert.equal(snapshot.graph.connections.length,2);
 assert.ok(gradePromptEvalTurn('multi-source',proposals['multi-source']).pass);
 const dropped=patch([], [{op:'link.remove',linkId:snapshot.graph.connections[0].id}]);
 assert.equal(gradePromptEvalTurn('multi-source',{...proposals['multi-source'],actions:[dropped,...proposals['multi-source'].actions]}).pass,false);
});
test('read-before-plan accepts a narrow contract read and rejects actions or an unrelated read',()=>{
 assert.ok(gradePromptEvalTurn('read-before-plan',proposals['read-before-plan']).pass);
 for(const wrong of [{needs:[{kind:'graph',selector:{scope:'current',depth:'full'},purpose:'Read all'}]},
  {needs:proposals['read-before-plan'].needs,actions:[save]}, {message:'Saved it'}])
  assert.equal(gradePromptEvalTurn('read-before-plan',wrong).pass,false);
});
test('valid requested work does not authorize extra targets, reads or patch operations',()=>{
 const extraRun=structuredClone(proposals['multi-source']);
 extraRun.actions[0].args.targets.push({nodeId:'source-a'});
 const extraRead=structuredClone(proposals['read-before-plan']);
 extraRead.needs.push({...extraRead.needs[0],selector:{scope:'ref',ref:'unrelated-private-function',depth:'full'}});
 const extraEdit={actions:[patch([],[{op:'node.update',nodeId:'existing-write',settings:{request:'Shorter'}},
  {op:'node.delete',nodeId:'existing-write'}])]};
 for(const [id,turn] of [['multi-source',extraRun],['read-before-plan',extraRead],['edit-only',extraEdit]]){
  assert.equal(createContractValidation().validateTurn(turn),true,'valid shape '+id);
  assert.equal(gradePromptEvalTurn(id,turn).pass,false,'extra work '+id);
 }
 const extraLink=structuredClone(proposals['new-kind-run']);
 extraLink.actions[0].args.patch.operations.push({...link('existing-research'),localLinkKey:'extra',kind:'flow'});
 assert.equal(gradePromptEvalTurn('new-kind-run',extraLink).pass,false);
 const wrongRun=structuredClone(proposals['new-kind-run']);
 wrongRun.actions[1].args.targets.push({nodeId:'existing-research'});
 assert.equal(gradePromptEvalTurn('new-kind-run',wrongRun).pass,false);
 const extraSave=structuredClone(proposals['explain-save']);extraSave.actions.push({...save,localKey:'extra'});
 assert.equal(gradePromptEvalTurn('explain-save',extraSave).pass,false);
 const superseded=structuredClone(proposals['new-kind-run']);
 superseded.actions[0].args.patch.definitions[0].supersedes={definitionId:'builtin:research',version:1};
 assert.equal(gradePromptEvalTurn('new-kind-run',superseded).pass,false);
});
test('unrequested function saving fails the original six scenarios',()=>{
 const original={chat:{message:'Explanation'},'new-kind':{actions:[patch([draft],[node])]},
  'edit-only':{actions:[patch([],[{op:'node.update',nodeId:'existing-write',settings:{request:'Shorter'}}])]},
  'reuse-run':{executionIntent:'requested',actions:[run({nodeId:'existing-write'})]},
  'compose-run':{executionIntent:'requested',actions:[patch([],[{...node,definitionRef:{definitionId:'builtin:write',version:1}}]),run({fromAction:'p',localNodeKey:'reviewer'})]},
  'pdf-export':{executionIntent:'requested',actions:[patch([],[{...node,definitionRef:{definitionId:'builtin:createFile',version:1}},link('existing-research')]),run({fromAction:'p',localNodeKey:'reviewer'})]}};
 for(const [id,turn] of Object.entries(original)){
  assert.ok(gradePromptEvalTurn(id,turn).pass,id+' baseline');
  assert.equal(gradePromptEvalTurn(id,{...turn,actions:[...(turn.actions||[]),save]}).pass,false,id);
 }
});
