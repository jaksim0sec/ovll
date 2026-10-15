import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSkillSnapshot,validateSkillPatch,validateSkillRun} from '../front/js/ovllSkillCodec.mjs';
const graph=()=>({skillDefinitions:[{definitionId:'d',version:1}],graph:{graphId:'g',revision:1,
 skillNodes:[{skillNodeId:'n',skillDefinitionRef:{definitionId:'d',version:1},settings:{nodeId:'opaque',skills:[]}}],connections:[]}});
test('native validation preserves instance identity, definition reference and opaque settings',()=>{
 const before=graph(),after=validateSkillSnapshot(before);
 assert.deepEqual(after,before);assert.notEqual(after,before);
 after.graph.skillNodes[0].settings.nodeId='edit';assert.equal(before.graph.skillNodes[0].settings.nodeId,'opaque');
});
test('old and mixed graph names are rejected rather than translated',()=>{
 for(const key of ['nodes','skills']){const value=graph();value.graph[key]=[];assert.throws(()=>validateSkillSnapshot(value));}
 for(const key of ['nodeId','skillId','definitionRef']){const value=graph();value.graph.skillNodes[0][key]='old';assert.throws(()=>validateSkillSnapshot(value));}
 const old=graph();old.definitions=[];assert.throws(()=>validateSkillSnapshot(old));
});
test('duplicate or empty instance IDs, malformed endpoints and excessive graphs reject without mutation',()=>{
 const value=graph();value.graph.skillNodes.push(structuredClone(value.graph.skillNodes[0]));assert.throws(()=>validateSkillSnapshot(value));
 value.graph.skillNodes[1].skillNodeId='';assert.throws(()=>validateSkillSnapshot(value));
 const large=graph();large.graph.skillNodes=Array.from({length:65},(_,i)=>({...large.graph.skillNodes[0],skillNodeId:String(i)}));assert.throws(()=>validateSkillSnapshot(large),e=>e.code==='SKILL_SNAPSHOT_TOO_LARGE');
 const link=graph();link.graph.connections=[{from:{skillNodeId:'n'},to:{skillNodeId:'n',port:'x'}}];assert.throws(()=>validateSkillSnapshot(link));
});
test('native patches validate instance selectors while leaving user data untouched',()=>{
 const patch={graphId:'g',skillDefinitions:[],operations:[{op:'skillNode.add',localSkillNodeKey:'draft',skillDefinitionRef:{definitionId:'d',version:1},settings:{nodeId:'opaque'}},
 {op:'link.add',from:{skillNode:{localSkillNodeKey:'draft'},port:'out'},to:{skillNode:{skillNodeId:'n'},port:'in'}}]};
 assert.deepEqual(validateSkillPatch(patch),patch);
 const mixed=structuredClone(patch);mixed.operations[1].from.skillNode.nodeId='old';assert.throws(()=>validateSkillPatch(mixed));
 const invalid=structuredClone(patch);invalid.operations[0].op='skill.add';assert.throws(()=>validateSkillPatch(invalid));
});
test('run validation retains result fingerprints, outputs and stable target IDs',()=>{
 const run={runId:'r',targets:['n'],skillNodes:[{skillNodeId:'n',semanticFingerprint:'unchanged',outputs:{inline:{nodeId:'user payload'}}}]};
 assert.deepEqual(validateSkillRun(run),run);
 const mixed=structuredClone(run);mixed.nodes=[];assert.throws(()=>validateSkillRun(mixed));
});
