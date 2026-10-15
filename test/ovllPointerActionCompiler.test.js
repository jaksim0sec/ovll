import test from 'node:test';
import assert from 'node:assert/strict';
import * as compiler from '../backend/ovllPointer/actionCompiler.js';
import {withPointerCatalog} from '../backend/ovllPointer/skillCatalog.js';
import {MemoryGraphRepository,computeScope} from '../backend/ovllPointer/graph.js';
const initial=()=>withPointerCatalog({graph:{graphId:'g',revision:4,skillNodes:[],connections:[]},skillDefinitions:[]});
const created=alias=>({kind:'created',alias});
const existing=skillNodeId=>({kind:'existing',skillNodeId});
const builtin=type=>({kind:'builtin',type});
const add=(alias='report',type='write')=>({action:'skillNode.add',alias,definition:builtin(type),request:'Write a report'});
const plan=actions=>({contract:'action-plan.v3',actions});
const compile=(p,context={})=>compiler.compileActionPlan(p,{snapshot:initial(),capabilities:['ir.applyPatch','run.start','function.save','function.run','question.ask'],executionAuthorization:'requested',...context});
const snapshot=()=>{
 const s=initial();s.graph.skillNodes=['source','writer','other'].map((skillNodeId,i)=>({skillNodeId,skillDefinitionRef:{definitionId:'builtin:'+(i===0?'research':'write'),version:1},settings:{request:'Keep',extra:1},inputBindings:{in:'old'}}));
 s.graph.connections=[{id:'edge',kind:'flow',from:{skillNodeId:'source',port:'next'},to:{skillNodeId:'writer',port:'in'}}];return s;
};
const rejected=(actions,code,context)=>assert.throws(()=>compile(plan(actions),context),e=>e.code===code);
test('compiler exists at the semantic to canonical boundary',()=>assert.equal(typeof compiler.compileActionPlan,'function'));
test('simple skillNode creation derives catalog refs, graph envelope and keys without mutating input',()=>{
 const p=plan([add()]),s=initial(),before=structuredClone(s),turn=compile(p,{snapshot:s});
 assert.deepEqual(s,before);assert.deepEqual(p,plan([add()]));
 const patch=turn.actions[0].args.patch;
 assert.equal(patch.graphId,'g');assert.equal(patch.expectedGraphRevision,4);
 assert.deepEqual(patch.operations[0].skillDefinitionRef,{definitionId:'builtin:write',version:1});
 assert.deepEqual(patch.operations[0].settings,{request:'Write a report'});
 assert.deepEqual(compile(p,{snapshot:s}),turn,'deterministic keys');
});
test('human-readable aliases do not inherit persistent ID restrictions',()=>{
 const p=plan([add('첫 보고서'),{action:'skillNode.update',target:created('첫 보고서'),request:'Shorten'}]);
 assert.equal(compile(p).actions[0].args.patch.operations[0].settings.request,'Shorten');
});
test('preview IDs cannot collide with existing graph identities',()=>{
 const s=initial();s.graph.skillNodes.push({skillNodeId:'n_1',skillDefinitionRef:{definitionId:'builtin:write',version:1},settings:{},inputBindings:{}});
 assert.equal(compile(plan([add()]),{snapshot:s}).actions[0].args.patch.operations[0].op,'skillNode.add');
});
test('dynamic declaration and instance compile atomically with explicit semantic ports intact',()=>{
 const inputs=[{name:'source',role:'Evidence',representation:'text',required:true}],outputs=[{name:'verdict',role:'Assessment',representation:'json'}];
 const turn=compile(plan([{action:'skill.define',alias:'review',purpose:'Assess',instruction:'Assess sources',inputs,outputs,name:'자료 평가',createInstance:true}]));
 const p=turn.actions[0].args.patch;assert.equal(p.skillDefinitions.length,1);assert.equal(p.operations.length,1);
 assert.deepEqual(p.skillDefinitions[0].inputs,inputs);assert.deepEqual(p.skillDefinitions[0].outputs,outputs);
 assert.deepEqual(p.operations[0].skillDefinitionRef,{localDefinitionKey:p.skillDefinitions[0].localKey});
 assert.equal(p.skillDefinitions[0].presentation.name,'자료 평가');
});
test('definition-only defaults use the existing model_task kernel rules',()=>{
 const p=compile(plan([{action:'skill.define',alias:'review',purpose:'Assess',instruction:'Assess'}])).actions[0].args.patch;
 assert.equal(p.operations.length,0);const repo=new MemoryGraphRepository();repo.restore('w','g',initial());repo.apply('w',p);
 assert.deepEqual(repo.get('w','g').skillDefinitions.find(d=>!d.definitionId.startsWith('builtin:')).inputs,[{name:'in',role:'입력',representation:'json',required:false}]);
});
test('explicit port omissions are rejected rather than repaired into JSON',()=>rejected([{action:'skill.define',alias:'x',purpose:'p',instruction:'i',outputs:[{name:'result',role:'r'}]}],'INVALID_COMPILED_TURN'));
test('tool_task and subgraph missing mandatory contracts remain invalid',()=>{
 for(const executorKind of ['tool_task','subgraph'])rejected([{action:'skill.define',alias:'x',purpose:'p',instruction:'i',executorKind}],'INVALID_COMPILED_TURN');
});
test('explicit valid tool and subgraph skillDefinitions preserve executor contracts',()=>{
 for(const draft of [{executorKind:'tool_task',requiredCapabilities:['artifact.create'],inputs:[],outputs:[{name:'artifact',role:'file',representation:'json'}]},
  {executorKind:'subgraph',procedureRef:{graphId:'sub',revision:2},inputs:[],outputs:[{name:'result',role:'r',representation:'text'}]}]){
 const d=compile(plan([{action:'skill.define',alias:'x',purpose:'p',instruction:'i',...draft}])).actions[0].args.patch.skillDefinitions[0];
 for(const [key,value] of Object.entries(draft))assert.deepEqual(d[key],value);
 }
});
test('existing instance edits preserve unrelated settings while explicit bindings replace bindings',()=>{
 const op=compile(plan([{action:'skillNode.update',target:existing('writer'),request:'Shorten',inputs:{in:'new'}}]),{snapshot:snapshot()}).actions[0].args.patch.operations[0];
 assert.deepEqual(op.settings,{request:'Shorten',extra:1});assert.deepEqual(op.inputBindings,{in:'new'});
});
test('inputs-only updates do not erase the settings base of a following update',()=>{
 const turn=compile(plan([{action:'skillNode.update',target:existing('writer'),inputs:{in:'new'}},
  {action:'skillNode.update',target:existing('writer'),request:'Shorten'}]),{snapshot:snapshot()});
 assert.deepEqual(turn.actions[0].args.patch.operations[1].settings,{request:'Shorten',extra:1});
});
test('created instance edits fold into skillNode.add without invented persistent IDs',()=>{
 const p=compile(plan([add(),{action:'skillNode.update',target:created('report'),request:'Shorten'}])).actions[0].args.patch;
 assert.equal(p.operations.length,1);assert.equal(p.operations[0].settings.request,'Shorten');
});
test('custom definition selector requires an exact unambiguous supplied version',()=>{
 const s=initial();s.skillDefinitions.push({definitionId:'custom',version:1,purpose:'p',instruction:'i',executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'r',representation:'text'}]});
 assert.equal(compile(plan([{...add(),definition:{kind:'existing',definitionId:'custom'}}]),{snapshot:s}).actions[0].args.patch.operations[0].skillDefinitionRef.version,1);
 s.skillDefinitions.push({...s.skillDefinitions.at(-1),version:2});
 rejected([{...add(),definition:{kind:'existing',definitionId:'custom'}}],'AMBIGUOUS_DEFINITION_VERSION',{snapshot:s});
});
test('definition revisions retain full behavior and appearance edits retain exact metadata',()=>{
 const s=initial();s.skillDefinitions.push({definitionId:'custom',version:1,purpose:'p',instruction:'i',executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'r',representation:'text'}],presentation:{name:'Old',iconKey:'pen',color:'#112233'}});
 const ref={kind:'existing',definitionId:'custom',version:1};
 const p=compile(plan([{action:'skill.appearance',definition:ref,presentation:{name:'New',color:'#445566',iconKey:'flask'}}]),{snapshot:s}).actions[0].args.patch;
 assert.deepEqual(p.operations[0].presentation,{name:'New',color:'#445566',iconKey:'flask'});
 const revision=compile(plan([{action:'skill.revise',alias:'v2',supersedes:ref,purpose:'New behavior',instruction:'Evaluate',executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'r',representation:'text'}]}]),{snapshot:s}).actions[0].args.patch;
 assert.deepEqual(revision.skillDefinitions[0].supersedes,{definitionId:'custom',version:1});
});
test('created definition may be reused by several instances',()=>{
 const p=compile(plan([{action:'skill.define',alias:'definition',purpose:'p',instruction:'i'},
 {action:'skillNode.add',alias:'one',definition:created('definition')},{action:'skillNode.add',alias:'two',definition:created('definition')}])).actions[0].args.patch;
 assert.equal(p.skillDefinitions.length,1);assert.deepEqual(p.operations[0].skillDefinitionRef,p.operations[1].skillDefinitionRef);
});
test('data links preserve multiple upstream sources and flow has separate ports',()=>{
 const s=snapshot();s.graph.skillNodes[1].inputBindings={};
 const p=compile(plan([add('second','research'),{action:'link.add',kind:'data',from:{skillNode:existing('source'),port:'result'},to:{skillNode:existing('writer'),port:'in'}},
 {action:'link.add',kind:'data',from:{skillNode:created('second'),port:'result'},to:{skillNode:existing('writer'),port:'in'}}]),{snapshot:s}).actions[0].args.patch;
 assert.equal(p.operations.filter(o=>o.op==='link.add').length,2);
 rejected([{action:'link.add',kind:'flow',from:{skillNode:existing('source'),port:'unknown'},to:{skillNode:existing('writer'),port:'in'}}],'PORT_MISMATCH',{snapshot:s});
});
test('linked skillNode deletion removes only explicitly approved incident links',()=>{
 const s=snapshot();const p=compile(plan([{action:'skillNode.delete',target:existing('writer'),removeIncidentLinks:true}]),{snapshot:s}).actions[0].args.patch;
 assert.deepEqual(p.operations.map(o=>o.op),['link.remove','skillNode.delete']);assert.equal(p.operations[0].linkId,'edge');
 rejected([{action:'skillNode.delete',target:existing('writer')}],'SKILL_NODE_HAS_LINKS',{snapshot:s});
 const r=new MemoryGraphRepository();r.restore('w','g',s);r.apply('w',p);assert.ok(r.get('w','g').graph.skillNodes.some(n=>n.skillNodeId==='other'));
});
test('compiled deletion keeps the optimistic revision check at commit',()=>{
 const s=snapshot(),p=compile(plan([{action:'skillNode.delete',target:existing('writer'),removeIncidentLinks:true}]),{snapshot:s}).actions[0].args.patch;
 const r=new MemoryGraphRepository();r.restore('w','g',s);r.apply('w',{graphId:'g',expectedGraphRevision:4,skillDefinitions:[],operations:[{op:'skillNode.update',skillNodeId:'other',settings:{request:'User edit'}}]});
 assert.throws(()=>r.apply('w',p),e=>e.code==='STALE_REVISION');
});
test('skillNode creation and execution compile exact producer references and closed default',()=>{
 const turn=compile({...plan([add(),{action:'execute',target:created('report')}]),executionIntent:'requested'});
 const [p,r]=turn.actions;assert.equal(r.kind,'run.start');assert.deepEqual(r.dependsOn,[p.localKey]);
 assert.deepEqual(r.args.targets,[{fromAction:p.localKey,localSkillNodeKey:p.args.patch.operations[0].localSkillNodeKey}]);assert.equal(r.args.damMode,'closed');
});
test('existing-skillNode execution after edits also depends on those edits',()=>{
 const turn=compile({...plan([{action:'skillNode.update',target:existing('writer'),request:'New'},{action:'execute',target:existing('writer'),damMode:'open'}]),executionIntent:'requested'},{snapshot:snapshot()});
 assert.deepEqual(turn.actions[1].dependsOn,[turn.actions[0].localKey]);assert.equal(turn.actions[1].args.damMode,'open');
});
test('missing or denied independent execution authorization is not granted by model intent',()=>{
 for(const executionAuthorization of [undefined,'denied'])rejected([{action:'execute',target:existing('writer')}],'EXECUTION_NOT_AUTHORIZED',{snapshot:snapshot(),executionAuthorization});
 assert.throws(()=>compile({...plan([add(),{action:'execute',target:created('report')}]),executionIntent:'requested'},{executionAuthorization:'denied'}),e=>e.code==='EXECUTION_NOT_AUTHORIZED');
 assert.throws(()=>compile(plan([add(),{action:'execute',target:created('report')}])),e=>e.code==='EXPLICIT_EXECUTION_REQUIRED');
});
test('function execution retains exact reference and fresh named input values',()=>{
 const fn={id:'fn_123',version:1,inputs:[{name:'topic',representation:'text',required:true}],outputs:[]};
 const t=compile({...plan([{action:'execute',target:{kind:'function',ref:'fn_123'},inputs:{topic:'초콜릿'}}]),executionIntent:'requested'},{savedFunctions:[fn]});
 assert.equal(t.actions[0].kind,'function.run');assert.deepEqual(t.actions[0].args,{functionRef:'fn_123',inputBindings:{topic:'초콜릿'}});
 assert.throws(()=>compile({...plan([{action:'execute',target:{kind:'function',ref:'missing'}}]),executionIntent:'requested'},{savedFunctions:[fn]}),e=>e.code==='UNKNOWN_FUNCTION');
 assert.throws(()=>compile({...plan([{action:'execute',target:{kind:'function',ref:'fn_123'}}]),executionIntent:'requested'},{savedFunctions:[fn]}),e=>e.code==='FUNCTION_INPUT_REQUIRED');
});
test('function saving retains semantic contracts and derives current graph revision',()=>{
 const fn={purpose:'Reuse',inputs:[],outputs:[{name:'result',role:'Output',representation:'json'}],invariants:['Keep sources'],procedure:{kind:'graph'},outputMap:{result:{skillNodeId:'writer',port:'result'}}};
 const turn=compile(plan([{action:'skillNode.update',target:existing('writer'),request:'Shorten'},{action:'function.save',function:fn}]),{snapshot:snapshot()});
 assert.deepEqual(turn.actions[1].args.function,{...fn,procedure:{kind:'graph',graphRef:{graphId:'g',revision:5}}});
 assert.deepEqual(turn.actions[1].dependsOn,[turn.actions[0].localKey]);
});
test('reads and questions use existing contracts and no actions means no fabricated completion',()=>{
 assert.deepEqual(compile({contract:'action-plan.v3',message:'안녕',actions:[]}),{message:'안녕'});
 const needs=[{kind:'contract',selector:{scope:'ref',ref:'fn_123',depth:'full'},purpose:'Read actual contract'}];
 assert.deepEqual(compile({contract:'action-plan.v3',needs}),{needs});
 assert.equal(compile(plan([{action:'question.ask',question:'어떤 자료를 사용할까요?'}])).actions[0].kind,'question.ask');
});
test('unknown refs, duplicate aliases and unsupported local actions fail precisely',()=>{
 rejected([add(),add()],'DUPLICATE_ALIAS');rejected([{...add(),definition:created('missing')}],'UNKNOWN_DEFINITION_ALIAS');
 rejected([{action:'execute',target:created('missing')}],'EXPLICIT_EXECUTION_REQUIRED');
 rejected([{action:'skillNode.update',target:existing('missing'),request:'x'}],'UNKNOWN_SKILL_NODE');
 rejected([{...add(),definition:builtin('invented')}],'UNKNOWN_DEFINITION');
 rejected([{action:'run.revise'}],'UNSUPPORTED_SEMANTIC_ACTION');rejected([add()],'UNSUPPORTED_ACTION',{capabilities:[]});
});
test('unknown fields and ambiguous reference objects cannot be silently stripped',()=>{
 rejected([{...add(),graphId:'fake'}],'INVALID_ACTION_FIELDS');
 rejected([{action:'skillNode.update',target:{...existing('writer'),alias:'report'},request:'x'}],'INVALID_SELECTOR',{snapshot:snapshot()});
 rejected([{...add(),request:'x',settings:{request:'different'}}],'CONFLICTING_REQUEST');
});
test('graph validation preserves cycle, explicit binding and missing-port guards',()=>{
 const s=snapshot();
 rejected([{action:'link.add',kind:'data',from:{skillNode:existing('source'),port:'missing'},to:{skillNode:existing('writer'),port:'in'}}],'PORT_MISMATCH',{snapshot:s});
 rejected([{action:'link.add',kind:'data',from:{skillNode:existing('source'),port:'result'},to:{skillNode:existing('writer'),port:'in'}}],'AMBIGUOUS_INPUT_PRODUCERS',{snapshot:s});
 rejected([{action:'link.add',kind:'flow',from:{skillNode:existing('writer'),port:'next'},to:{skillNode:existing('source'),port:'in'}}],'GRAPH_CYCLE',{snapshot:s});
});
