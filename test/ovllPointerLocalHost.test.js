import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createContractValidation,splitModelMetadata} from '../backend/ovllPointer/validation.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';
const repo=new MemoryGraphRepository();
repo.create('local','g');
const initial=repo.get('local','g');
repo.apply('local',{graphId:'g',expectedGraphRevision:0,skillDefinitions:[
 {localKey:'write',executorKind:'model_task',purpose:'Write',instruction:'Write summary',inputs:[],outputs:[{name:'result',representation:'text'}]}],
 operations:[{op:'skillNode.add',localSkillNodeKey:'n',skillDefinitionRef:{localDefinitionKey:'write'}}]});
const snapshot=repo.get('local','g');
const mk=(responses)=>createLocalPointerHost({
  gateway:{complete:async()=>({text:JSON.stringify(responses.shift())})},
  resolveModel:async()=>({providerId:'mock',model:'test',maxOutputTokens:300})
});
test('stateless local model turn uses actual context and preserves plain language without SQL',async()=>{
  const h=mk([{message:'안녕하세요'}]);
  assert.deepEqual(splitModelMetadata(await h.turn({snapshot:initial,requestRef:'r1',requestText:'안녕'})).domain,{message:'안녕하세요'});
});
test('local model actions are proposals; graph state remains unchanged until browser commits',async()=>{
  const patch={graphId:'g',expectedGraphRevision:1,skillDefinitions:[],operations:[
    {op:'skillNode.add',localSkillNodeKey:'new',skillDefinitionRef:{definitionId:snapshot.skillDefinitions[0].definitionId,version:1}}]};
  const turn={actions:[{kind:'ir.applyPatch',localKey:'p',args:{patch}}]};
  const result=await mk([turn]).turn({snapshot,requestRef:'r2',requestText:'노드를 만들어'});
  assert.equal(result.actions[0].kind,'ir.applyPatch');
  assert.equal(snapshot.graph.revision,1);
});
test('local skillNode output validates declared ports and blocks invented outputs',async()=>{
  const h=mk([{outputs:{status:'produced',values:{result:{inline:'done'}}}}]);
  const skillNodeId=snapshot.graph.skillNodes[0].skillNodeId;
  const result=await h.skillNode({snapshot,requestRef:'r3',requestText:'요약',skillNodeId});
  assert.equal(result.status,'success');
  await assert.rejects(
    mk([{outputs:{status:'produced',values:{wrong:{inline:'invented'}}}}])
    .skillNode({snapshot,requestRef:'r4',requestText:'요약',skillNodeId}),
    error=>error.code==='UNKNOWN_OUTPUT_PORT');
  await assert.rejects(h.skillNode({snapshot,requestRef:'r5',requestText:'hi',skillNodeId:'missing'}),
    error=>error.code==='LOCAL_SKILL_NODE_NOT_FOUND');
});
test('invalid graph snapshots fail before the model is called',async()=>{
  let calls=0;const host=createLocalPointerHost({gateway:{complete:async()=>{calls++;return{text:'{}'};}},resolveModel:async()=>({providerId:'x',model:'x'})});
  await assert.rejects(host.turn({snapshot:{graph:{graphId:'g',revision:0,skillNodes:[{}],connections:[]},skillDefinitions:[]},
    requestRef:'r',requestText:'test'}));
  assert.equal(calls,0);
});
test('large Korean upload keeps planner context bounded and skillNode evidence available',async()=>{
 const {getPointerCatalog}=await import('../backend/ovllPointer/skillCatalog.js');const text='가'.repeat(10000);
 const snapshot={skillDefinitions:getPointerCatalog().skillDefinitions,graph:{graphId:'g',revision:1,skillNodes:[{skillNodeId:'f',skillDefinitionRef:{definitionId:'builtin:file',version:1},settings:{file:{name:'자료.txt',mime:'text/plain',textPreview:text,textTruncated:false}}},{skillNodeId:'w',skillDefinitionRef:{definitionId:'builtin:write',version:1}}],connections:[{id:'fw',kind:'data',from:{skillNodeId:'f',port:'file'},to:{skillNodeId:'w',port:'in'}}]}};
 const calls=[];const host=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'fixture'}),gateway:{complete:async args=>{const data=JSON.parse(args.messages.at(-1).content);calls.push(data);return{text:JSON.stringify(data.skillNodeContext?{outputs:{status:'produced',values:{result:{inline:'요약'}}}}:{message:'가능해'})};}}});
 await host.turn({snapshot,requestRef:'r',requestText:'할 수 있는 일 알려줘'});
 assert.equal(calls[0].context.materials[0].truncated,true);
 assert.ok(JSON.stringify(calls[0]).length<15000);
 await host.skillNode({snapshot,requestRef:'n',requestText:'요약',skillNodeId:'w',inputArtifacts:[{port:'in',sourceSkillNodeId:'f',sourcePort:'file',valueRef:'v',representation:'json',value:{name:'자료.txt',textPreview:text,textTruncated:false}}]});
 assert.equal(calls[1].skillNodeContext.upstreamArtifacts[0].value.textPreview.length,10000);
 assert.equal(snapshot.graph.skillNodes[0].settings.file.textPreview.length,10000);
});
