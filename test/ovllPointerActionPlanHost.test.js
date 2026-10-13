import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {phaseWireContract,decodePhaseOutput} from '../backend/ovllPointer/modelContract.js';
const snapshot={graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]};
const add={action:'node.add',alias:'report',definition:{kind:'builtin',type:'write'},request:'Write the report'};
const run={action:'execute',target:{kind:'created',alias:'report'}};
const plan=actions=>({contract:'action-plan.v1',actions});
function host(responses,calls=[],wire=false){return createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'offline'}),gateway:{capabilities:()=>({structuredOutput:wire}),complete:async options=>{calls.push(options);return {text:JSON.stringify(responses.shift()),providerCalls:1};}}});}
test('direct semantic output compiles before existing domain validation without a repair call',async()=>{
 const calls=[],result=await host([plan([add])],calls).turn({snapshot,requestRef:'direct',requestText:'Add a writing node'});
 assert.equal(result.actions[0].kind,'ir.applyPatch');assert.equal(calls.length,1);
 assert.equal(result._meta.repairCount,0);assert.equal(snapshot.graph.nodes.length,0);
});
test('semantic provider projection decodes the same plan without mechanical model keys',async()=>{
 const wire={contract:'action-plan.v1',executionIntent:'requested',message:null,actions:[{action:add.action,payloadJson:JSON.stringify({...add,action:undefined})},{action:run.action,payloadJson:JSON.stringify({...run,action:undefined})}],needs:[]};
 const calls=[],result=await host([wire],calls,true).turn({snapshot,requestRef:'wire',requestText:'Create the writer and run it'});
 assert.deepEqual(result.actions.map(a=>a.kind),['ir.applyPatch','run.start']);
 assert.equal(calls.length,1);assert.equal(calls[0].wireSchema.name,'ovll_selection');
 const schema=calls[0].wireSchema.schema;assert.equal(schema.properties.actions,undefined);assert.ok(schema.properties.actionKinds.items.enum.includes('skill.add'));
 assert.ok(!JSON.stringify(schema).includes('run.revise'));assert.ok(!JSON.stringify(schema).includes('task.complete'));
 const text=calls[0].messages.map(m=>m.content).join('\n');
 assert.ok(text.includes('skill.define'));assert.ok(!text.includes('expectedGraphRevision'));
 const context=JSON.parse(calls[0].messages.find(m=>m.role==='user').content).context;
 assert.equal(context.outputContract,'ModelTurn');assert.ok(context.capabilities.includes('execute'));
 assert.ok(!context.capabilities.includes('run.start'));assert.ok(!context.capabilities.includes('ir.applyPatch'));
});
test('compiler errors participate in the existing single repair with semantic paths',async()=>{
 const calls=[],bad=plan([{...add,definition:{kind:'created',alias:'missing'}}]);
 const result=await host([bad,plan([add])],calls).turn({snapshot,requestRef:'repair',requestText:'Create a writer node'});
 assert.equal(result._meta.repairCount,1);assert.match(calls[1].messages.at(-1).content,/unknownDefinitionAlias/);
 assert.doesNotMatch(calls[1].messages.at(-1).content,/Every node.add needs unique localNodeKey/);
});
test('execution still requires declared intent regardless of request wording',async()=>{
 const bad=plan([add,run]),warn=console.warn;console.warn=()=>{};
 try{
 for(const requestText of ['Run the writer','Add a writer node','작성 노드만 만들어 실행하지 마']){
  await assert.rejects(host([bad,bad]).turn({snapshot,requestRef:'no_intent',requestText}),e=>e.validationIssues?.[0]?.rule==='explicitExecutionRequired');
 }
 }finally{console.warn=warn;}
});
test('current explicit execution and computed deliverable requests remain usable',async()=>{
 for(const requestText of ['Run the new writer','Can you run the writer?','Can you write a report about chocolate?','자료 신뢰도를 평가해줘','보고서를 작성해','Write a report about chocolate','PDF 파일로 내보내줘']){
 const result=await host([{...plan([add,run]),executionIntent:'requested'}]).turn({snapshot,requestRef:'yes',requestText});
 assert.equal(result.actions[1].kind,'run.start');
 }
});
test('legacy execution uses declared intent without a lexical request veto',async()=>{
 const legacy={executionIntent:'requested',actions:[{kind:'run.start',localKey:'run',args:{targets:[{nodeId:'n'}]}}]};
 const result=await host([legacy]).turn({snapshot,requestRef:'legacy',requestText:'Run the node titled "Do not run"'});
 assert.equal(result.actions[0].kind,'run.start');
});
test('quoted words, explanations and other languages do not override model intent',async()=>{
 for(const requestText of ['Run the writer titled "Do not run"','Run the writer and explain the result','Exécute ce workflow','このノードを実行して']){
  const calls=[],result=await host([{...plan([add,run]),executionIntent:'requested'}],calls).turn({snapshot,requestRef:'semantic',requestText});
  assert.equal(result.actions[1].kind,'run.start');assert.equal(calls.length,1);
 }
});
test('request constraints and history stay available for model interpretation',async()=>{
 const calls=[];
 await host([plan([add])],calls).turn({snapshot,requestRef:'constraints',requestText:'Add the node',history:['Run everything'],taskContext:{constraints:['Do not run']}});
 const context=JSON.parse(calls[0].messages.find(m=>m.role==='user').content).context;
 assert.deepEqual(context.constraints,['Do not run']);assert.deepEqual(context.historyDigest,['Run everything']);
 assert.match(calls[0].messages.map(m=>m.content).join('\n'),/Honor explicit no-run/);
});
test('semantic contract decoder rejects payload discriminator collisions and unknown versions',()=>{
 assert.throws(()=>decodePhaseOutput({contract:'action-plan.v1',actions:[{action:'node.add',payloadJson:'{"action":"execute"}'}]},'turn'));
 assert.throws(()=>decodePhaseOutput({contract:'action-plan.v9',actions:[]},'turn'));
});
test('local legacy decoding refuses unsupported handlers without deleting the durable schema',async()=>{
 const calls=[],bad={actions:[{kind:'run.cancel',localKey:'cancel',args:{runRef:'run1'}}]},warn=console.warn;console.warn=()=>{};
 try{await assert.rejects(host([bad,bad],calls).turn({snapshot,requestRef:'support',requestText:'Cancel'}),e=>e.code==='INVALID_MODEL_TURN');}
 finally{console.warn=warn;}
 assert.equal(calls.length,2);assert.match(calls[1].messages.at(-1).content,/unsupportedAction/);
});
