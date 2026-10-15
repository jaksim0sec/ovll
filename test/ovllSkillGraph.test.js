import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryGraphRepository,computeScope} from '../front/js/ovllPointerGraphCore.mjs';
import {SkillSchemaError} from '../front/js/ovllSkillCodec.mjs';

const producer={localKey:'a',purpose:'Produce value',instruction:'Produce value',inputs:[],
  outputs:[{name:'result',role:'Result',representation:'text'}]};
const consumer={localKey:'b',purpose:'Consume value',instruction:'Consume value',
  inputs:[{name:'in',role:'Input',representation:'text',multiple:false}],
  outputs:[{name:'result',role:'Result',representation:'text'}]};
const patch=(graphId,revision,skillDefinitions=[],operations=[])=>({
  graphId,expectedGraphRevision:revision,skillDefinitions,operations
});
const add=(name,definition)=>({op:'skillNode.add',localSkillNodeKey:name,
  skillDefinitionRef:{localDefinitionKey:definition},settings:{skillNodeId:'opaque user field'}});
const link=(from,to)=>({op:'link.add',localLinkKey:'edge',kind:'data',
  from:{skillNode:{localSkillNodeKey:from},port:'result'},
  to:{skillNode:{localSkillNodeKey:to},port:'in'}});

function fixture(){
  const store=new MemoryGraphRepository();
  const first=store.create('ws','g');
  let n=0;
  const result=store.apply('ws',patch('g',0,[producer,consumer],[add('first','a'),add('second','b'),link('first','second')]),()=>String(++n));
  return {store,first,result,ids:{
    from:result.createdRefs['skillNode:first'],to:result.createdRefs['skillNode:second']}};
}

test('new graph and revision reads expose canonical Skill v2 only',()=>{
  const {store,first,result}=fixture();
  assert.deepEqual(first.graph.skillNodes,[]);
  assert.deepEqual(first.skillDefinitions,[]);
  assert.equal('nodes' in first.graph,false);
  assert.equal('definitions' in first,false);
  assert.equal(result.graphRef.revision,1);
  assert.equal(Object.keys(result.createdRefs).some(x=>x.startsWith('node:')),false);
  const live=store.get('ws','g');
  assert.equal(live.graph.skillNodes.length,2);
  assert.equal(live.graph.connections.length,1);
  assert.equal(live.graph.parentRevision,0);
  assert.deepEqual(store.getRevision('ws','g',0),first);
  assert.equal(live.graph.skillNodes[0].settings.skillNodeId,'opaque user field');
});

test('Skill add/link and scope preserve ports, revision and dependencies',()=>{
  const {store,ids,result}=fixture();
  const snapshot=store.get('ws','g');
  const producerSkill=snapshot.graph.skillNodes.find(x=>x.skillNodeId===ids.from);
  assert.equal(producerSkill.skillDefinitionRef.version,1);
  assert.equal(snapshot.graph.connections[0].from.skillNodeId,ids.from);
  assert.equal(snapshot.graph.connections[0].to.skillNodeId,ids.to);
  assert.equal(snapshot.graph.connections[0].from.port,'result');
  assert.equal(snapshot.graph.connections[0].to.port,'in');
  assert.ok(result.createdRefs['skillNode:first']);
  assert.equal(result.createdRefs['definition:a'].startsWith('d_'),true);
  assert.deepEqual(new Set(computeScope(snapshot.graph,[ids.to])),new Set([ids.from,ids.to]));
  assert.deepEqual(computeScope(snapshot.graph,[ids.from]),[ids.from]);
});

test('Skill update/delete remain atomic and obey graph revision',()=>{
  const {store,ids}=fixture();
  const change=store.apply('ws',patch('g',1,[],[
    {op:'skillNode.update',skillNodeId:ids.to,settings:{request:'new',skillNodeId:'user content'}}
  ]),()=>'42');
  assert.equal(change.graphRef.revision,2);
  assert.equal(store.get('ws','g').graph.skillNodes[1].settings.skillNodeId,'user content');
  assert.throws(()=>store.apply('ws',patch('g',1,[],[
    {op:'skillNode.delete',skillNodeId:ids.from}
  ]),()=>'99'),e=>e.code==='STALE_REVISION');
  assert.equal(store.get('ws','g').graph.revision,2);
  const connection=store.get('ws','g').graph.connections[0];
  store.apply('ws',patch('g',2,[],[
    {op:'link.remove',linkId:connection.id},
    {op:'skillNode.delete',skillNodeId:ids.from}
  ]),()=>'100');
  assert.equal(store.get('ws','g').graph.skillNodes.length,1);
});

test('restore accepts a canonical Skill snapshot and retains old ID values',()=>{
  const {store,ids}=fixture(),saved=store.get('ws','g');
  const another=new MemoryGraphRepository();
  another.restore('ws','g',saved);
  assert.deepEqual(another.get('ws','g'),saved);
  assert.deepEqual(new Set(computeScope(another.get('ws','g').graph,[ids.to])),
    new Set([ids.from,ids.to]));
});

test('historical aliases are rejected by the native kernel without partial mutation',()=>{
  const {store,ids}=fixture(),before=store.get('ws','g');
  assert.throws(()=>store.apply('ws',patch('g',1,[],[{op:'skillNode.update',nodeId:ids.to,settings:{}}]),()=>'3'));
  assert.throws(()=>store.apply('ws',patch('g',1,[],[{op:'skillNode.update',skillNodeId:ids.to,nodeId:ids.to,settings:{}}]),()=>'3'));
  assert.throws(()=>store.apply('ws',patch('g',1,[],[{op:'skillNode.revise',skillNodeId:ids.to}]),()=>'3'));
  assert.deepEqual(store.get('ws','g'),before);
});
test('historical aliases cannot be restored through the native repository',()=>{
  const {store}=fixture(),saved=store.get('ws','g');saved.graph.nodes=saved.graph.skillNodes;
  assert.throws(()=>new MemoryGraphRepository().restore('ws','g',saved));
});

test('existing graph validation and ports are still enforced',()=>{
  const store=new MemoryGraphRepository();
  store.create('ws','g');
  let n=0;
  assert.throws(()=>store.apply('ws',patch('g',0,[producer,consumer],[
    add('first','a'),add('second','b'),
    {...link('first','second'),to:{skillNode:{localSkillNodeKey:'second'},port:'unknown'}}
  ]),()=>String(++n)),e=>e.code==='PORT_MISMATCH');
  assert.equal(store.get('ws','g').graph.revision,0);
});
