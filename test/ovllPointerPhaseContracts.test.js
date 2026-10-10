import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalPointerHost,createConfiguredLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';
import {createConfiguredModelProvider} from '../backend/ovllPointer/configuredProvider.js';
const snapshot=()=>({graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]});
function host(responses,calls=[]){return createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'actual'}),gateway:{complete:async x=>{calls.push(structuredClone(x));return {text:JSON.stringify(responses.shift()),usage:{total_tokens:5},providerId:'fixture',model:'actual'};}}});}
test('original task purpose, explicit constraints and digest survive a revision and node execution',async()=>{
 const calls=[],taskContext={objective:'Write a Korean report',requestText:'Shorten its conclusion',constraints:['Keep citations','Do not run'],historyDigest:['Audience: beginners']};
 await host([{message:'ok'}],calls).turn({snapshot:snapshot(),requestRef:'r',requestText:'Shorten its conclusion',taskContext});
 const data=JSON.parse(calls[0].messages.at(-1).content).context;
 assert.equal(data.objective,taskContext.objective);assert.deepEqual(data.constraints,taskContext.constraints);assert.deepEqual(data.historyDigest,taskContext.historyDigest);
 const catalog=getPointerCatalog();const snap=snapshot();snap.definitions=catalog.definitions;snap.graph.nodes=[{nodeId:'w',definitionRef:{definitionId:'builtin:write',version:1}}];
 await host([{outputs:{status:'produced',values:{result:{inline:'report'}}}}],calls).node({snapshot:snap,requestRef:'n',requestText:'Shorten',nodeId:'w',taskContext,taskConstraints:['Preserve names']});
 const nodeData=JSON.parse(calls[1].messages.at(-1).content).context;
 assert.equal(nodeData.objective,taskContext.objective);assert.equal(nodeData.requestText,taskContext.requestText);assert.deepEqual(nodeData.constraints,['Keep citations','Do not run','Preserve names']);
});
test('catalog definitions are compact but available operations remain discoverable',async()=>{
 const calls=[];await host([{message:'ok'}],calls).turn({snapshot:snapshot(),requestRef:'r',requestText:'What can you do?'});
 const data=JSON.parse(calls[0].messages.at(-1).content).context.materials[0].content;
 assert.equal(data.definitions.length,0);assert.ok(data.availableDefinitions.some(d=>d.definitionId==='builtin:write'));
 assert.ok(data.availableDefinitions.every(d=>!('instruction' in d)));
});
test('response repair is phase-specific and trusted usage metadata accounts for both calls',async()=>{
 const calls=[];const result=await host([{actions:[{kind:'run.start',localKey:'r',args:{targets:[{nodeId:'n'}],damMode:'closed'}}]},{message:'No work ran',_meta:{providerId:'forged'}}],calls).response({snapshot:snapshot(),requestRef:'r',requestText:'Explain the failure'});
 assert.equal(calls.length,2);assert.match(calls[1].messages.at(-1).content,/response/i);assert.doesNotMatch(calls[1].messages.at(-1).content,/Every node.add/);
 assert.equal(result._meta.providerId,'fixture');assert.equal(result._meta.model,'actual');assert.equal(result._meta.usage.total_tokens,10);assert.equal(result._meta.repairCount,1);assert.equal(result._meta.calls.length,2);
});
test('Gemini node wire schema converts strict projected values into canonical outputs',async()=>{
 let body;const snap=snapshot();snap.definitions=getPointerCatalog().definitions;snap.graph.nodes=[{nodeId:'w',definitionRef:{definitionId:'builtin:write',version:1}}];
 const h=createConfiguredLocalPointerHost({env:{GEMINI_API_KEY:'test'},fetchImpl:async(_u,opt)=>{body=JSON.parse(opt.body);return {ok:true,status:200,json:async()=>({modelVersion:'gemini-actual',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({status:'produced',values:[{port:'result',valueJson:'"done"',ref:null}],reason:null})}]}}]})};}});
 const result=await h.node({snapshot:snap,requestRef:'n',requestText:'Write',nodeId:'w'});
 assert.equal(body.generationConfig.responseJsonSchema.properties.status.enum[0],'produced');assert.equal(body.generationConfig.responseJsonSchema.oneOf,undefined);assert.deepEqual(body.generationConfig.responseJsonSchema.properties.values.items.properties.port.enum,['result']);assert.equal(result.outputs.values.result.inline,'done');assert.equal(result._meta.model,'gemini-actual');
});
test('Groq supported strict models get a phase schema; unknown compatible providers require explicit capability',async()=>{
 const run=async(env)=>{let body;const p=createConfiguredModelProvider({env,fetchImpl:async(_u,opt)=>{body=JSON.parse(opt.body);return{ok:true,json:async()=>({choices:[{message:{content:'{"message":"ok"}'}}]})};}});await p.modelGateway.complete({...await p.resolveModel(),messages:[],wireSchema:{name:'response',schema:{type:'object',properties:{message:{type:'string'}},required:['message'],additionalProperties:false}}});return body;};
 const base={OVLL_POINTER_MODEL_ENDPOINT:'https://test.invalid/chat',OVLL_POINTER_MODEL_API_KEY:'test',OVLL_POINTER_MODEL_ID:'openai/gpt-oss-120b'};
 const groq=await run({...base,OVLL_POINTER_PROVIDER_ID:'groq'});assert.equal(groq.response_format.type,'json_schema');assert.equal(groq.response_format.json_schema.strict,true);
 const compatible=await run({...base,OVLL_POINTER_PROVIDER_ID:'compatible'});assert.equal(compatible.response_format.type,'json_object');
 const capable=await run({...base,OVLL_POINTER_PROVIDER_ID:'compatible',OVLL_POINTER_STRUCTURED_OUTPUTS:'true'});assert.equal(capable.response_format.type,'json_schema');
});
test('long original task is preserved in explicit full context and failed HTTP calls remain accounted',async()=>{
 const calls=[],objective='Original '.repeat(900);const taskContext={objective,constraints:['Keep every source']};
 await host([{message:'ok'}],calls).turn({snapshot:snapshot(),requestRef:'long',requestText:'Revise',taskContext});
 const data=JSON.parse(calls[0].messages.at(-1).content);assert.equal(data.extraContext.taskContext.objective,objective);assert.match(data.context.omissions[0],/partial/);
 let attempts=0;const h=createConfiguredLocalPointerHost({env:{GEMINI_API_KEY:'test'},fetchImpl:async()=>{attempts++;return {ok:false,status:403,json:async()=>({error:{status:'PERMISSION_DENIED'}})};}});
 await assert.rejects(h.turn({snapshot:snapshot(),requestRef:'err',requestText:'Test'}),e=>e._meta.providerCalls===1&&e._meta.calls[0].error==='PROVIDER_HTTP_ERROR');assert.equal(attempts,1);
});
test('wire node output never drops unexpected fields or treats a missing value as JSON null',async()=>{
 const calls=[],snap=snapshot();snap.definitions=getPointerCatalog().definitions;snap.graph.nodes=[{nodeId:'w',definitionRef:{definitionId:'builtin:write',version:1}}];
 const invalid={status:'produced',values:[{port:'result',valueJson:null,ref:null}],reason:null,actions:[{kind:'run.start'}]};
 await assert.rejects(host([invalid,invalid],calls).node({snapshot:snap,requestRef:'r',requestText:'Write',nodeId:'w'}),e=>e.code==='MODEL_INVALID_JSON'||e.code==='INVALID_MODEL_TURN');assert.equal(calls.length,2);
});
test('metadata remains available when canonical output port verification fails',async()=>{
 const snap=snapshot();snap.definitions=getPointerCatalog().definitions;snap.graph.nodes=[{nodeId:'w',definitionRef:{definitionId:'builtin:write',version:1}}];
 await assert.rejects(host([{outputs:{status:'produced',values:{wrong:{inline:'bad'}}}}]).node({snapshot:snap,requestRef:'r',requestText:'Write',nodeId:'w'}),e=>e.code==='UNKNOWN_OUTPUT_PORT'&&e._meta.providerCalls===1);
});
test('ordinary result requests permit internal structuring while explicit no-run intent is retained',async()=>{
 const calls=[];await host([{message:'ok'}],calls).turn({snapshot:snapshot(),requestRef:'r',requestText:'Draft the report; do not run the existing flow'});
 const instructions=calls[0].messages.filter(m=>m.role!=='user').map(m=>m.content).join('\n');
 assert.match(instructions,/necessary internal structuring/i);assert.match(instructions,/explicit no-run/i);
 assert.doesNotMatch(instructions,/ordinary requests not authorizing graph creation, suggest it and ask first/);
});
test('strict turn payload retains dynamic definitions in canonical action args',async()=>{
 const patch={graphId:'g',expectedGraphRevision:0,definitions:[{localKey:'d',purpose:'Repeatable reviewer',executorKind:'model_task',instruction:'Review bound evidence',inputs:[],outputs:[{name:'result',role:'review',representation:'text'}]}],operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]};
 const wire={message:null,actions:[{localKey:'p',kind:'ir.applyPatch',argsJson:JSON.stringify({patch}),dependsOn:[]}],needs:[]};
 const h=createConfiguredLocalPointerHost({env:{GROQ_API_KEY:'test'},fetchImpl:async(_u,opt)=>{
 const request=JSON.parse(opt.body);assert.equal(request.response_format.type,'json_schema');assert.equal(request.response_format.json_schema.schema.oneOf,undefined);
 return {ok:true,json:async()=>({model:'openai/gpt-oss-120b',choices:[{message:{content:JSON.stringify(wire)}}]})};}});
 const result=await h.turn({snapshot:snapshot(),requestRef:'wire',requestText:'Create a reusable reviewer'});assert.deepEqual(result.actions[0].args.patch,patch);assert.equal(result.message,undefined);
});
test('context and complete node evidence have independent UTF-8 budgets',async()=>{
 const calls=[],snap=snapshot();snap.definitions=getPointerCatalog().definitions;snap.graph.nodes=[{nodeId:'w',definitionRef:{definitionId:'builtin:write',version:1}}];
 const constraints=Array.from({length:16},(_,i)=>i+':'+ 'q'.repeat(2300));const source='가'.repeat(15500);
 await host([{outputs:{status:'produced',values:{result:{inline:'summary'}}}}],calls).node({snapshot:snap,requestRef:'budget',requestText:'Summarize',nodeId:'w',taskContext:{objective:'Summarize evidence',constraints},inputArtifacts:[{port:'in',representation:'text',valueRef:'source',value:source}]});
 const data=JSON.parse(calls[0].messages.at(-1).content);assert.deepEqual(data.context.constraints,constraints);assert.equal(data.nodeContext.upstreamArtifacts[0].value,source);assert.ok(Buffer.byteLength(calls[0].messages.at(-1).content)>65536);
});
test('pre-provider admission failures report zero calls and preserve source constraints',async()=>{
 const calls=[];
 await assert.rejects(host([{message:'unused'}],calls).turn({snapshot:snapshot(),requestRef:'r',requestText:'Test',taskContext:{objective:'Work',constraints:['x'.repeat(2401)]}}),e=>e.code==='INVALID_TASK_CONTEXT'&&e._meta?.providerCalls===0);
 assert.equal(calls.length,0);
});
test('cancelled compatible-provider request is rejected before physical transport',async()=>{
 const abort=new AbortController();abort.abort();let physical=0;
 const h=createConfiguredLocalPointerHost({env:{OVLL_POINTER_PROVIDER_ID:'compatible',OVLL_POINTER_MODEL_ID:'test',OVLL_POINTER_MODEL_ENDPOINT:'https://test.invalid/chat',OVLL_POINTER_MODEL_API_KEY:'test'},fetchImpl:async()=>{physical++;return {ok:true,json:async()=>({choices:[{message:{content:'{"message":"wrong"}'}}]})};}});
 await assert.rejects(h.turn({snapshot:snapshot(),requestRef:'cancel',requestText:'Work',signal:abort.signal}),e=>e.code==='MODEL_REQUEST_CANCELLED'&&e._meta?.providerCalls===0);assert.equal(physical,0);
});
test('app task request history crosses every phase without losing accepted revisions',async()=>{
 const calls=[],taskContext={objective:'Summarize only the attached file',requestText:'Shorten conclusion',constraints:['Hide names'],requestHistory:['Summarize only the attached file','Use a table','Shorten conclusion']};
 const snap=snapshot();snap.definitions=getPointerCatalog().definitions;snap.graph.nodes=[{nodeId:'w',definitionRef:{definitionId:'builtin:write',version:1}}];
 await host([{message:'ok'},{outputs:{status:'produced',values:{result:{inline:'done'}}}},{message:'done'}],calls).turn({snapshot:snap,requestRef:'t',requestText:taskContext.requestText,taskContext});
 await host([{outputs:{status:'produced',values:{result:{inline:'done'}}}}],calls).node({snapshot:snap,requestRef:'n',requestText:'Write summary',nodeId:'w',taskContext});
 await host([{message:'done'}],calls).response({snapshot:snap,requestRef:'s',requestText:'Show summary',actionResults:[],taskContext});
 for(const call of calls){const data=JSON.parse(call.messages.at(-1).content);assert.deepEqual(data.extraContext.taskContext.requestHistory,taskContext.requestHistory);}
});

test('canonical complete action example round-trips the provider wire projection',async()=>{
 const {canonicalTurnExample,toWireTurnExample,decodePhaseOutput,localModelContract}=
  await import('../backend/ovllPointer/modelContract.js');
 const example=canonicalTurnExample();
 assert.deepEqual(decodePhaseOutput(toWireTurnExample(example),'turn'),example);
 assert.match(localModelContract(),/"args":\{"patch"/);
 assert.match(localModelContract(undefined,{wire:true}),/"argsJson":/);
 assert.doesNotMatch(localModelContract(undefined,{wire:true}),/"args":\{"patch"/);
});
test('structured wire turn uses wire example and records unambiguous patch recovery',async()=>{
 const patch={graphId:'g',expectedGraphRevision:0,operations:[
  {op:'node.add',localNodeKey:'one',definitionRef:{definitionId:'builtin:write',version:1}}]};
 const wire={executionIntent:'requested',message:null,needs:[],actions:[
  {localKey:'p',kind:'ir.applyPatch',argsJson:JSON.stringify(patch),dependsOn:[]},
  {localKey:'r',kind:'run.start',argsJson:JSON.stringify({
   targets:[{fromAction:'p',localNodeKey:'one'}],damMode:'closed'}),dependsOn:['p']}
 ]};
 const calls=[],gateway={capabilities:()=>({structuredOutput:true}),
  complete:async options=>{calls.push(options);return {text:JSON.stringify(wire)};}};
 const h=createLocalPointerHost({resolveModel:async()=>({providerId:'fixture',model:'actual'}),gateway});
 const result=await h.turn({snapshot:snapshot(),requestRef:'flat_wire',requestText:'Write and run'});
 assert.equal(calls.length,1);
 assert.deepEqual(result._meta.normalizations,['wrapPatch@0']);
 assert.equal(result._meta.repairCount,0);
 assert.equal(result.actions[0].args.patch.graphId,'g');
 const policy=calls[0].messages.filter(x=>x.role==='developer').map(x=>x.content).join('\n');
 assert.match(policy,/"argsJson":/);
 assert.doesNotMatch(policy,/"args":\{"patch"/);
});

test('ambiguous run-target repair receives producer-scoped candidates without logging key values',async()=>{
 const patch={graphId:'g',expectedGraphRevision:0,definitions:[],operations:[
  {op:'node.add',localNodeKey:'writer',definitionRef:{definitionId:'builtin:write',version:1}},
  {op:'node.add',localNodeKey:'reviewer',definitionRef:{definitionId:'builtin:write',version:1}}
 ]};
 const first={executionIntent:'requested',actions:[
  {localKey:'p',kind:'ir.applyPatch',args:{patch}},
  {localKey:'r',kind:'run.start',dependsOn:['p'],
   args:{targets:[{fromAction:'p'}],damMode:'closed'}}
 ]};
 const corrected=structuredClone(first);
 corrected.actions[1].args.targets[0].localNodeKey='writer';
 const calls=[];
 const result=await host([first,corrected],calls).turn({
  snapshot:snapshot(),requestRef:'repair_candidates',requestText:'Run only the new writer'});
 assert.equal(calls.length,2);
 const repair=calls[1].messages.at(-1).content;
 assert.match(repair,/"fromAction":"p","allowedLocalNodeKeys":\["writer","reviewer"\]/);
 assert.match(repair,/do not guess|only if|only when/i);
 assert.equal(result.actions[1].args.targets[0].localNodeKey,'writer');
 assert.equal(result._meta.repairCount,1);
 const diagnostics=JSON.stringify(result._meta);
 assert.ok(!diagnostics.includes('"writer"'));
 assert.ok(!diagnostics.includes('"reviewer"'));
});
