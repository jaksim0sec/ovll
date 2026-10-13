import test from 'node:test';
import assert from 'node:assert/strict';
import {createSkillLocal} from '../front/js/ovllSkillLocal.mjs';
const snapshot=()=>({
 graph:{graphId:'g',revision:1,nodes:[{nodeId:'n_old',
  definitionRef:{definitionId:'d',version:1},settings:{}}],connections:[]},
 definitions:[{definitionId:'d',version:1,purpose:'Read'}]
});
test('new Skill runtime turns a canonical edit into one original kernel edit',async()=>{
 const calls=[],legacy={
  graphId:id=>'g',state:async()=>({graph:snapshot(),runs:[]}),
  turn:async request=>{calls.push(request);return {results:[{createdRefs:{'node:x':'n_old','definition:d':'d'}}]};},
  run:async()=>({runId:'r',nodes:[{nodeId:'n_old',status:'success'}]}),
  validateResults:async(s,rows)=>rows
 };
 const skill=createSkillLocal({legacy,api:{localSkill:async()=>({skillId:'n_old'})}});
 const read=await skill.state('c','g');
 assert.equal(read.graph.graph.skills[0].skillId,'n_old');
 assert.equal(read.graph.graph.nodes,undefined);
 const edit=await skill.turn({conversationId:'c',graphId:'g',actions:[{
  localKey:'p',kind:'ir.applyPatch',args:{patch:{graphId:'g',
   expectedGraphRevision:1,skillDefinitions:[],
   operations:[{op:'skill.update',skillId:'n_old',settings:{request:'New'}}]}}
 }]});
 assert.equal(calls.length,1);
 assert.equal(calls[0].actions[0].args.patch.operations[0].op,'node.update');
 assert.equal(calls[0].actions[0].args.patch.operations[0].nodeId,'n_old');
 assert.equal(edit.results[0].createdRefs['skill:x'],'n_old');
 assert.equal(edit.results[0].createdRefs['node:x'],undefined);
});
test('execution passes only canonical Skill snapshots and IDs to v2 model endpoint',async()=>{
 const requests=[],legacy={
  graphId:id=>'g',state:async()=>({graph:snapshot(),runs:[]}),
  turn:async()=>({results:[]}),
  run:async options=>{
   const value=await options.executeNode({snapshot:snapshot(),nodeId:'n_old',
    requestText:'Read',inputArtifacts:[]});
   assert.equal(value.nodeId,'n_old');
   const result={runId:'r',status:'completed',nodes:[{nodeId:'n_old',status:'success'}]};
   options.onProgress(result);
   return result;
  },
  validateResults:async(s,rows)=>rows
 };
 const skill=createSkillLocal({legacy,api:{localSkill:async request=>{
  requests.push(request);
  return {skillId:request.skillId,status:'success',outputs:{status:'produced',values:{}}};
 }}});
 const progress=[];
 const run=await skill.run({conversationId:'c',targets:['n_old'],onProgress:x=>progress.push(x)});
 assert.equal(requests.length,1);
 assert.equal(requests[0].skillId,'n_old');
 assert.equal(requests[0].nodeId,undefined);
 assert.equal('nodes' in requests[0].snapshot.graph,false);
 assert.equal(requests[0].snapshot.graph.skills[0].skillId,'n_old');
 assert.equal(run.skills[0].skillId,'n_old');
 assert.equal(progress[0].skills[0].skillId,'n_old');
});
