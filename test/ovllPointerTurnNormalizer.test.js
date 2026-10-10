import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeModelTurn,diagnoseModelTurn,modelTurnShape,repairTargetHints} from '../backend/ovllPointer/turnNormalizer.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';

const nodeAdd=(definitionRef={definitionId:'builtin:write',version:1})=>({
  op:'node.add',definitionRef
});
const action=(operations,other={})=>({localKey:'patch',kind:'ir.applyPatch',
  args:{patch:{graphId:'g',expectedGraphRevision:0,operations,...other}}});
const validator=createContractValidation();
test('multiple independent new instances get unique local handles without changing their definition refs',()=>{
  const turn={actions:[action([nodeAdd(),nodeAdd(),nodeAdd()])]};
  const out=normalizeModelTurn(turn);
  assert.deepEqual(out.actions[0].args.patch.operations.map(op=>op.localNodeKey),
    ['node1','node2','node3']);
  assert.deepEqual(out.actions[0].args.patch.definitions,[]);
  assert.equal(validator.validateTurn(out),true);
  assert.equal(turn.actions[0].args.patch.operations[0].localNodeKey,undefined);
});
test('preserve explicit keys and allocate free values without colliding',()=>{
  const turn={actions:[action([{...nodeAdd(),localNodeKey:'node1'},nodeAdd(),
    {...nodeAdd(),localNodeKey:'node2'},nodeAdd()])]};
  const out=normalizeModelTurn(turn);
  assert.deepEqual(out.actions[0].args.patch.operations.map(op=>op.localNodeKey),
    ['node1','node3','node2','node4']);
  assert.equal(validator.validateTurn(out),true);
});
test('one missing node.add key is recovered from its actual link endpoint',()=>{
  const turn={actions:[action([nodeAdd(),
    {op:'link.add',localLinkKey:'e',kind:'data',from:{node:{localNodeKey:'vocab'},port:'result'},
      to:{node:{nodeId:'n_existing'},port:'in'}}
  ])]};
  const out=normalizeModelTurn(turn);
  assert.equal(out.actions[0].args.patch.operations[0].localNodeKey,'vocab');
  assert.equal(validator.validateTurn(out),true);
});
test('one new node with run.start target omitting handle inherits a unique one',()=>{
  const turn={actions:[action([nodeAdd()]),{localKey:'execute',kind:'run.start',
    dependsOn:['patch'],args:{targets:[{fromAction:'patch'}],damMode:'closed'}}]};
  const out=normalizeModelTurn(turn);
  assert.equal(out.actions[0].args.patch.operations[0].localNodeKey,'node1');
  assert.equal(out.actions[1].args.targets[0].localNodeKey,'node1');
  assert.equal(validator.validateTurn(out),true);
});
test('multiple dependent new nodes are not silently assigned to ambiguous links',()=>{
  const turn={actions:[action([nodeAdd(),nodeAdd(),
    {op:'link.add',localLinkKey:'e',kind:'data',
      from:{node:{localNodeKey:'a'},port:'result'},
      to:{node:{localNodeKey:'b'},port:'in'}}])]};
  const out=normalizeModelTurn(turn);
  assert.equal(out.actions[0].args.patch.operations[0].localNodeKey,undefined);
  assert.equal(validator.validateTurn(out),false);
  assert.deepEqual(diagnoseModelTurn(out,validator.explainTurn(out))[0],{
    path:'/actions/0/args/patch/operations/0/localNodeKey',
    rule:'required',missing:'localNodeKey'
  });
});
test('multiple new nodes never infer an unspecified run target',()=>{
  const turn={actions:[action([{...nodeAdd(),localNodeKey:'a'},{...nodeAdd(),localNodeKey:'b'}]),
    {localKey:'execute',kind:'run.start',dependsOn:['patch'],
      args:{targets:[{fromAction:'patch'}]}}]};
  const out=normalizeModelTurn(turn);
  assert.equal(out.actions[1].args.targets[0].localNodeKey,undefined);
  assert.equal(validator.validateTurn(out),false);
  assert.deepEqual(diagnoseModelTurn(out,validator.explainTurn(out))[0],{
    path:'/actions/1/args/targets/0/localNodeKey',rule:'required',missing:'localNodeKey'
  });
});
test('valid existing node ref is never misreported as a missing localNodeKey from a oneOf branch',()=>{
  const broken={actions:[action([{
    op:'link.add',localLinkKey:'link',kind:'data',
    from:{node:{nodeId:'n_existing'},port:'result'},
    to:{node:{nodeId:'n_other'},port:'in'},unexpected:true
  }])]};
  assert.equal(validator.validateTurn(broken),false);
  const reported=diagnoseModelTurn(broken,[
    {path:'/actions/0/args/patch/operations/0/from/node',rule:'required',missing:'localNodeKey'},
    {path:'/actions/0/args/patch/operations/0',rule:'additionalProperties',extra:'unexpected'}
  ]);
  assert.ok(reported.every(issue=>issue.missing!=='localNodeKey'));
  assert.equal(reported[0].rule,'additionalProperties');
});
test('missing link node reference reports the link endpoint, not a fabricated key',()=>{
  const broken={actions:[action([{
    op:'link.add',localLinkKey:'link',kind:'data',
    from:{node:{},port:'result'},to:{node:{nodeId:'n_existing'},port:'in'}
  }])]};
  const errors=diagnoseModelTurn(broken,validator.explainTurn(broken));
  assert.deepEqual(errors[0],{path:'/actions/0/args/patch/operations/0/from/node',rule:'oneOf'});
});
test('no model actions, nodes, links, or user requests are synthesized by normalization',()=>{
  const turn={message:'질문이 있어',actions:[],needs:[]};
  assert.deepEqual(normalizeModelTurn(turn),{message:'질문이 있어'});
  const actual={actions:[action([], {definitions:[]})]};
  assert.deepEqual(normalizeModelTurn(actual).actions[0].args.patch.operations,[]);
});

test('missing definition handle points to the exact field rather than the definition object',()=>{
  const turn=normalizeModelTurn({actions:[action([], {definitions:[{
    purpose:'단어 정리',instruction:'읽기와 뜻을 정리'
  }]})]});
  assert.equal(validator.validateTurn(turn),false);
  assert.deepEqual(diagnoseModelTurn(turn,validator.explainTurn(turn))[0],{
    path:'/actions/0/args/patch/definitions/0/localKey',rule:'required',missing:'localKey'
  });
});
test('malformed and duplicate definition handles have distinct diagnostics',()=>{
  const turn=normalizeModelTurn({actions:[action([], {definitions:[
    {localKey:'bad key',purpose:'A',instruction:'A'},
    {localKey:'same',purpose:'B',instruction:'B'},
    {localKey:'same',purpose:'C',instruction:'C'}
  ]})]});
  const diagnostics=diagnoseModelTurn(turn,validator.explainTurn(turn));
  assert.equal(diagnostics[0].rule,'invalid');
  assert.equal(diagnostics[1].rule,'duplicate');
  assert.equal(diagnostics[1].path,'/actions/0/args/patch/definitions/2/localKey');
});

test('flat graph patch envelope is restored without changing graph intent',()=>{
 const source={actions:[{localKey:'p',kind:'ir.applyPatch',args:{
  graphId:'g',expectedGraphRevision:0,operations:[nodeAdd()]}}]};
 const normalizations=[];
 const output=normalizeModelTurn(source,{normalizations});
 assert.equal(output.actions[0].args.patch.graphId,'g');
 assert.equal(output.actions[0].args.patch.operations[0].localNodeKey,'node1');
 assert.deepEqual(output.actions[0].args.patch.definitions,[]);
 assert.equal(source.actions[0].args.patch,undefined);
 assert.deepEqual(normalizations,['wrapPatch@0']);
 assert.equal(validator.validateTurn(output),true);
});
test('a missing patch is diagnosed before missing dependent run handles',()=>{
 const bad=normalizeModelTurn({actions:[
  {localKey:'p',kind:'ir.applyPatch',args:{unknown:'shape'}},
  {localKey:'r',kind:'run.start',dependsOn:['p'],args:{targets:[{fromAction:'p'}]}}
 ]});
 assert.deepEqual(diagnoseModelTurn(bad,validator.explainTurn(bad))[0],
  {path:'/actions/0/args',rule:'required',missing:'patch'});
});
test('flat patch restoration rejects unknown fields and missing graph revisions',()=>{
 const withExtras={actions:[{kind:'ir.applyPatch',args:{
  graphId:'g',expectedGraphRevision:0,operations:[],secret:'untrusted'}}]};
 assert.equal(normalizeModelTurn(withExtras).actions[0].args.patch,undefined);
 const noRevision={actions:[{kind:'ir.applyPatch',args:{graphId:'g',operations:[]}}]};
 assert.equal(normalizeModelTurn(noRevision).actions[0].args.patch,undefined);
});
test('structural telemetry never contains model values or arbitrary property names',()=>{
 const raw={actions:[{kind:'ir.applyPatch',args:{
  graphId:'g',expectedGraphRevision:0,operations:[{
   op:'node.add',localNodeKey:'SENSITIVE-NODE',settings:{request:'SECRET PROMPT'}
  }],privateProperty:'TOKEN-SECRET'}}]};
 const shape=JSON.stringify(modelTurnShape(raw));
 assert.ok(!shape.includes('SENSITIVE-NODE'));
 assert.ok(!shape.includes('SECRET PROMPT'));
 assert.ok(!shape.includes('TOKEN-SECRET'));
 assert.ok(!shape.includes('privateProperty'));
});

test('single explicit producer target restores only the missing dependency',()=>{
 const input={executionIntent:'requested',actions:[
  action([{...nodeAdd(),localNodeKey:'writer'}]),
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'patch',localNodeKey:'writer'}],damMode:'closed'}}
 ]};
 const events=[],out=normalizeModelTurn(input,{normalizations:events});
 assert.deepEqual(out.actions[1].dependsOn,['patch']);
 assert.deepEqual(out.actions[1].args.targets,[{fromAction:'patch',localNodeKey:'writer'}]);
 assert.equal(input.actions[1].dependsOn,undefined);
 assert.deepEqual(events,['dependsOn@1']);
 assert.equal(validator.validateTurn(out),true);
 assert.deepEqual(normalizeModelTurn(out),out);
});
test('single producer may infer missing target handle and dependency together',()=>{
 const input={executionIntent:'requested',actions:[
  action([{...nodeAdd(),localNodeKey:'writer'}]),
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'patch'}]}}
 ]};
 const events=[],out=normalizeModelTurn(input,{normalizations:events});
 assert.deepEqual(out.actions[1].dependsOn,['patch']);
 assert.equal(out.actions[1].args.targets[0].localNodeKey,'writer');
 assert.deepEqual(events,['targetKey@1','dependsOn@1']);
 assert.equal(validator.validateTurn(out),true);
});
test('ambiguous multiple node additions never acquire a dependency or guessed target',()=>{
 const input={actions:[
  action([{...nodeAdd(),localNodeKey:'one'},{...nodeAdd(),localNodeKey:'two'}]),
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'patch'}]}}
 ]};
 const out=normalizeModelTurn(input);
 assert.equal(out.actions[1].dependsOn,undefined);
 assert.equal(out.actions[1].args.targets[0].localNodeKey,undefined);
});
test('foreign targets and mismatched explicit keys are not rewritten',()=>{
 const mismatch={actions:[action([{...nodeAdd(),localNodeKey:'good'}]),
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'patch',localNodeKey:'wrong'}]}}]};
 assert.equal(normalizeModelTurn(mismatch).actions[1].dependsOn,undefined);
 const unknown={actions:[action([{...nodeAdd(),localNodeKey:'good'}]),
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'not_patch',localNodeKey:'good'}]}}]};
 assert.equal(normalizeModelTurn(unknown).actions[1].dependsOn,undefined);
});
test('cycle or duplicate action keys prevent inferred dependency',()=>{
 const cycle={actions:[{...action([{...nodeAdd(),localNodeKey:'good'}]),dependsOn:['execute']},
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'patch',localNodeKey:'good'}]}}]};
 assert.equal(normalizeModelTurn(cycle).actions[1].dependsOn,undefined);
 const duplicate={actions:[action([{...nodeAdd(),localNodeKey:'good'}]),
  {localKey:'patch',kind:'ir.applyPatch',args:{patch:{graphId:'g',expectedGraphRevision:0,definitions:[],operations:[]}}},
  {localKey:'execute',kind:'run.start',args:{targets:[{fromAction:'patch',localNodeKey:'good'}]}}]};
 assert.equal(normalizeModelTurn(duplicate).actions[2].dependsOn,undefined);
});
test('existing node IDs, no-run intent and invalid dependency shapes remain unchanged',()=>{
 const source=action([{...nodeAdd(),localNodeKey:'good'}]);
 const explicit={actions:[source,{localKey:'execute',kind:'run.start',args:{targets:[{nodeId:'already_exists'}]}}]};
 assert.equal(normalizeModelTurn(explicit).actions[1].dependsOn,undefined);
 const invalid={actions:[source,{localKey:'execute',kind:'run.start',dependsOn:'bad',
  args:{targets:[{fromAction:'patch',localNodeKey:'good'}]}}]};
 assert.equal(normalizeModelTurn(invalid).actions[1].dependsOn,'bad');
 const noRun={actions:[source]};
 assert.equal(normalizeModelTurn(noRun).actions.length,1);
 assert.equal(normalizeModelTurn(noRun).executionIntent,undefined);
});

test('candidate repair identifies only valid handles from the referenced producer',()=>{
 const turn=normalizeModelTurn({actions:[action([
  {...nodeAdd(),localNodeKey:'writer'},{...nodeAdd(),localNodeKey:'reviewer'}
 ]),{localKey:'run',kind:'run.start',dependsOn:['patch'],
  args:{targets:[{fromAction:'patch'}]}}]});
 const issues=diagnoseModelTurn(turn,validator.explainTurn(turn));
 assert.deepEqual(repairTargetHints(turn,issues),[{
  path:'/actions/1/args/targets/0/localNodeKey',
  fromAction:'patch',allowedLocalNodeKeys:['writer','reviewer']
 }]);
});
test('irrelevant issue and unique targets do not receive candidate repair hints',()=>{
 const unique=normalizeModelTurn({actions:[action([
  {...nodeAdd(),localNodeKey:'single'}
 ]),{localKey:'run',kind:'run.start',dependsOn:['patch'],
  args:{targets:[{fromAction:'patch'}]}}]});
 assert.deepEqual(repairTargetHints(unique,[]),[]);
 const ambiguous=normalizeModelTurn({actions:[action([
  {...nodeAdd(),localNodeKey:'writer'},{...nodeAdd(),localNodeKey:'reviewer'}
 ]),{localKey:'run',kind:'run.start',args:{targets:[{fromAction:'patch'}]}}]});
 assert.deepEqual(repairTargetHints(ambiguous,[{path:'/actions/0/args',rule:'required',missing:'patch'}]),[]);
});
test('duplicate, malformed, unknown producer and persistent node target stay fail-closed',()=>{
 const producer=action([{...nodeAdd(),localNodeKey:'same'},
  {...nodeAdd(),localNodeKey:'same'}]);
 const run={localKey:'run',kind:'run.start',args:{targets:[{fromAction:'patch'}]}};
 const issues=[{path:'/actions/1/args/targets/0/localNodeKey',
   rule:'required',missing:'localNodeKey'}];
 assert.deepEqual(repairTargetHints({actions:[producer,run]},issues),[]);
 producer.args.patch.operations[1].localNodeKey='bad key';
 assert.deepEqual(repairTargetHints({actions:[producer,run]},issues),[]);
 producer.args.patch.operations[1].localNodeKey='good';
 assert.deepEqual(repairTargetHints({actions:[producer,{...run,
  args:{targets:[{fromAction:'elsewhere'}]}}]},issues),[]);
 assert.deepEqual(repairTargetHints({actions:[producer,{...run,
  args:{targets:[{nodeId:'existing'}]}}]},issues),[]);
});
test('candidate hints are capped and do not copy user requests or model instructions',()=>{
 const producer=action(Array.from({length:9},(_,i)=>({
  ...nodeAdd(),localNodeKey:'handle'+i,settings:{request:'PRIVATE '+i}
 })));
 const turn={actions:[producer,{localKey:'run',kind:'run.start',
  args:{targets:[{fromAction:'patch'}]}}]};
 const issues=[{path:'/actions/1/args/targets/0/localNodeKey',
  rule:'required',missing:'localNodeKey'}];
 assert.deepEqual(repairTargetHints(turn,issues),[]);
 producer.args.patch.operations.pop();
 const hints=repairTargetHints(turn,issues);
 assert.equal(hints[0].allowedLocalNodeKeys.length,8);
 assert.ok(!JSON.stringify(hints).includes('PRIVATE'));
});


test('missing definition localKey is recovered from the unique explicit node.add reference',()=>{
 const definition={purpose:'Reusable reviewer',instruction:'Review the supplied evidence'};
 const original={actions:[action([{...nodeAdd({localDefinitionKey:'reviewDraft'}),localNodeKey:'review'}],
  {definitions:[definition]})]};
 const events=[];
 const turn=normalizeModelTurn(original,{normalizations:events});
 assert.equal(turn.actions[0].args.patch.definitions[0].localKey,'reviewDraft');
 assert.equal(original.actions[0].args.patch.definitions[0].localKey,undefined);
 assert.equal(validator.validateTurn(turn),true);
 assert.deepEqual(events,['definitionKey@0:0']);
 assert.deepEqual(normalizeModelTurn(turn),turn);
});
test('new definition key may be recovered from node.update references, without changing nodeId',()=>{
 const turn=normalizeModelTurn({actions:[action([{
  op:'node.update',nodeId:'existing',definitionRef:{localDefinitionKey:'nextDefinition'}
 }],{definitions:[{purpose:'Updated reviewer',instruction:'Keep evidence'}]})]});
 assert.equal(turn.actions[0].args.patch.definitions[0].localKey,'nextDefinition');
 assert.equal(turn.actions[0].args.patch.operations[0].nodeId,'existing');
 assert.equal(validator.validateTurn(turn),true);
});
test('shared exact references to the same missing definition remain unambiguous',()=>{
 const turn=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'shared'}),localNodeKey:'one'},
  {...nodeAdd({localDefinitionKey:'shared'}),localNodeKey:'two'}
 ],{definitions:[{purpose:'Shared',instruction:'Reuse'}]})]});
 assert.equal(turn.actions[0].args.patch.definitions[0].localKey,'shared');
 assert.equal(validator.validateTurn(turn),true);
});
test('unreferenced, multiple missing definitions and multiple unbound handles stay invalid',()=>{
 const def=()=>({purpose:'Unique',instruction:'Work'});
 const standalone=normalizeModelTurn({actions:[action([],{definitions:[def()]})]});
 assert.equal(standalone.actions[0].args.patch.definitions[0].localKey,undefined);
 assert.equal(validator.validateTurn(standalone),false);
 const multiple=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'draft'}),localNodeKey:'n'}
 ],{definitions:[def(),def()]})]});
 assert.deepEqual(multiple.actions[0].args.patch.definitions.map(d=>d.localKey),[undefined,undefined]);
 const twoHandles=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'first'}),localNodeKey:'a'},
  {...nodeAdd({localDefinitionKey:'second'}),localNodeKey:'b'}
 ],{definitions:[def()]})]});
 assert.equal(twoHandles.actions[0].args.patch.definitions[0].localKey,undefined);
});
test('unknown, invalid and duplicate definition keys cannot be silently reassigned',()=>{
 const def={purpose:'Check',instruction:'Verify'};
 const missing=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'saved'}),localNodeKey:'n'}
 ],{definitions:[{localKey:'saved',...def},{...def}]})]});
 assert.equal(missing.actions[0].args.patch.definitions[1].localKey,undefined);
 const invalid=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'saved'}),localNodeKey:'n'}
 ],{definitions:[{localKey:'bad key',...def},{...def}]})]});
 assert.equal(invalid.actions[0].args.patch.definitions[1].localKey,undefined);
 const duplicate=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'other'}),localNodeKey:'n'}
 ],{definitions:[{localKey:'dup',...def},{localKey:'dup',...def},{...def}]})]});
 assert.equal(duplicate.actions[0].args.patch.definitions[2].localKey,undefined);
});
test('cross-action and invalid referenced handles never supply missing localKey',()=>{
 const draft={purpose:'Current',instruction:'Only local refs'};
 const patches={actions:[
  action([],{definitions:[draft]}),
  {...action([{...nodeAdd({localDefinitionKey:'fromOtherPatch'}),localNodeKey:'n'}]),localKey:'next'}
 ]};
 assert.equal(normalizeModelTurn(patches).actions[0].args.patch.definitions[0].localKey,undefined);
 const malformed={actions:[action([{...nodeAdd({localDefinitionKey:'bad key'}),localNodeKey:'n'}],
  {definitions:[draft]})]};
 assert.equal(normalizeModelTurn(malformed).actions[0].args.patch.definitions[0].localKey,undefined);
});

test('recovered definition localKey resolves to persisted definition and node refs in graph kernel',()=>{
 const turn=normalizeModelTurn({actions:[action([
  {...nodeAdd({localDefinitionKey:'reference'}),localNodeKey:'reviewNode'}
 ],{definitions:[{purpose:'Review',instruction:'Check sources'}]})]});
 const store=new MemoryGraphRepository();
 store.create('workspace','g');
 let id=0;
 const applied=store.apply('workspace',turn.actions[0].args.patch,()=>String(++id));
 assert.equal(typeof applied.createdRefs['definition:reference'],'string');
 assert.equal(typeof applied.createdRefs['node:reviewNode'],'string');
 const item=store.get('workspace','g');
 assert.equal(item.graph.nodes.length,1);
 assert.equal(item.definitions.length,1);
 assert.equal(item.graph.nodes[0].definitionRef.definitionId,item.definitions[0].definitionId);
});
