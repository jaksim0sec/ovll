import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
const moduleURL=new URL('../front/js/ovllPointerResults.mjs',import.meta.url);
const helper=existsSync(moduleURL)?await import(moduleURL):{};
const clone=x=>JSON.parse(JSON.stringify(x));
function sample(){return {skillDefinitions:[{definitionId:'d',version:1,purpose:'Preserve sources',instruction:'Write',executorKind:'model_task',inputs:[{name:'in',representation:'text'}],outputs:[{name:'out',representation:'text'}]}],graph:{graphId:'g',revision:1,skillNodes:['a','b','other'].map(skillNodeId=>({skillNodeId,skillDefinitionRef:{definitionId:'d',version:1},settings:{request:skillNodeId},inputBindings:{}})),connections:[{id:'edge',kind:'data',from:{skillNodeId:'a',port:'out'},to:{skillNodeId:'b',port:'in'}}]}};}
test('result identity ignores revision, unrelated skillNodes, layout and presentation, while retaining ancestor meaning',()=>{
 assert.equal(typeof helper.skillNodeSemanticFingerprint,'function');
 const s=sample(),original=helper.skillNodeSemanticFingerprint(s,'b');
 const next=clone(s);next.graph.revision=9;next.graph.graphId='replayed';next.graph.skillNodes[2].settings.request='Unrelated';next.graph.skillNodes[1].settings.position={x:200,y:300};next.skillDefinitions[0].presentation={color:'#ffffff'};
 assert.equal(helper.skillNodeSemanticFingerprint(next,'b'),original);
 next.graph.skillNodes[0].settings.request='New source';assert.notEqual(helper.skillNodeSemanticFingerprint(next,'b'),original);
});
test('result validity checks recorded execution context, inputs and executor identity',()=>{
 assert.equal(typeof helper.isCurrentSkillNodeResult,'function');
 const s=sample(),semanticContext={requestText:'Original task',taskConstraints:['Keep citations'],executorIdentity:'model-v1',inputArtifacts:[{port:'in',sourceSkillNodeId:'a',value:'Real content',valueRef:'run-one'}]};
 const result={skillNodeId:'b',status:'success',semanticContext,semanticFingerprint:helper.skillNodeSemanticFingerprint(s,'b',semanticContext),outputs:{status:'produced',values:{out:{inline:'Actual summary'}}}};
 assert.equal(helper.isCurrentSkillNodeResult(s,'b',result),true);
 assert.equal(helper.isCurrentSkillNodeResult(s,'b',result,{executorIdentity:'model-v2'}),false);
 assert.equal(helper.isCurrentSkillNodeResult(s,'b',result,{inputArtifacts:[{...semanticContext.inputArtifacts[0],valueRef:'new-run'}]}),true);
 assert.equal(helper.isCurrentSkillNodeResult(s,'b',result,{inputArtifacts:[{...semanticContext.inputArtifacts[0],value:'Changed'}]}),false);
 const current=helper.currentResultSkillNodes(s,[result,{skillNodeId:'a',status:'running'}]);assert.equal(current[0].resultCurrent,false,'a running predecessor is not current execution evidence');assert.equal(current[1].status,'running');
 s.graph.skillNodes[0].settings.request='New source';assert.equal(helper.currentResultSkillNodes(s,[result])[0].status,'stale');
 assert.equal(helper.isCurrentSkillNodeResult(s,'b',{skillNodeId:'b',status:'success'}),false,'legacy successes lack validity evidence');
});

test('synchronous fingerprint digest matches SHA-256 including Unicode execution context',()=>{
 assert.equal(typeof helper.semanticDigest,'function');
 for(const value of ['', 'Hello', '한글 🌍', 'a'.repeat(1000)])assert.equal(helper.semanticDigest(value),createHash('sha256').update(value).digest('hex'));
});

test('changed recorded predecessor results invalidate a downstream current success',()=>{
 const s=sample(),upstreamContext={requestText:'First task'},upstream={skillNodeId:'a',status:'success',semanticContext:upstreamContext,
   semanticFingerprint:helper.skillNodeSemanticFingerprint(s,'a',upstreamContext),outputs:{status:'produced',values:{out:{inline:'First output'}}}};
 const semanticContext={dependencyResults:{a:{semanticFingerprint:upstream.semanticFingerprint,outputs:upstream.outputs}}};
 const downstream={skillNodeId:'b',status:'success',semanticContext,semanticFingerprint:helper.skillNodeSemanticFingerprint(s,'b',semanticContext),outputs:{status:'produced',values:{out:{inline:'Actual downstream summary'}}}};
 assert.equal(helper.currentResultSkillNodes(s,[upstream,downstream])[1].resultCurrent,true);
 const changed={...upstream,outputs:{status:'produced',values:{out:{inline:'Changed output'}}}};
 assert.equal(helper.currentResultSkillNodes(s,[changed,downstream])[1].status,'stale');
});

test('arbitrary instance task settings remain semantic even when used for output appearance',()=>{
 const s=sample(),fingerprint=helper.skillNodeSemanticFingerprint(s,'b');
 s.graph.skillNodes[1].settings.color='#000000';assert.notEqual(helper.skillNodeSemanticFingerprint(s,'b'),fingerprint);
});
