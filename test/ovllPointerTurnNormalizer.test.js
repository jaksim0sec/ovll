import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeModelTurn,diagnoseModelTurn} from '../backend/ovllPointer/turnNormalizer.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';

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
