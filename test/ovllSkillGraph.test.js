import test from 'node:test';
import assert from 'node:assert/strict';
import {SkillGraphRepository,computeSkillScope} from '../front/js/ovllSkillGraph.mjs';
import {SkillSchemaError} from '../front/js/ovllSkillCodec.mjs';

const producer={localKey:'a',purpose:'Produce value',instruction:'Produce value',inputs:[],
  outputs:[{name:'result',role:'Result',representation:'text'}]};
const consumer={localKey:'b',purpose:'Consume value',instruction:'Consume value',
  inputs:[{name:'in',role:'Input',representation:'text',multiple:false}],
  outputs:[{name:'result',role:'Result',representation:'text'}]};
const patch=(graphId,revision,skillDefinitions=[],operations=[])=>({
  graphId,expectedGraphRevision:revision,skillDefinitions,operations
});
const add=(name,definition)=>({op:'skill.add',localSkillKey:name,
  skillDefinitionRef:{localDefinitionKey:definition},settings:{nodeId:'opaque user field'}});
const link=(from,to)=>({op:'link.add',localLinkKey:'edge',kind:'data',
  from:{skill:{localSkillKey:from},port:'result'},
  to:{skill:{localSkillKey:to},port:'in'}});

function fixture(){
  const store=new SkillGraphRepository();
  const first=store.create('ws','g');
  let n=0;
  const result=store.apply('ws',patch('g',0,[producer,consumer],[add('first','a'),add('second','b'),link('first','second')]),()=>String(++n));
  return {store,first,result,ids:{
    from:result.createdRefs['skill:first'],to:result.createdRefs['skill:second']}};
}

test('new graph and revision reads expose canonical Skill v2 only',()=>{
  const {store,first,result}=fixture();
  assert.deepEqual(first.graph.skills,[]);
  assert.deepEqual(first.skillDefinitions,[]);
  assert.equal('nodes' in first.graph,false);
  assert.equal('definitions' in first,false);
  assert.equal(result.graphRef.revision,1);
  assert.equal(Object.keys(result.createdRefs).some(x=>x.startsWith('node:')),false);
  const live=store.get('ws','g');
  assert.equal(live.graph.skills.length,2);
  assert.equal(live.graph.connections.length,1);
  assert.equal(live.graph.parentRevision,0);
  assert.deepEqual(store.getRevision('ws','g',0),first);
  assert.equal(live.graph.skills[0].settings.nodeId,'opaque user field');
});

test('Skill add/link and scope preserve ports, revision and dependencies',()=>{
  const {store,ids,result}=fixture();
  const snapshot=store.get('ws','g');
  const producerSkill=snapshot.graph.skills.find(x=>x.skillId===ids.from);
  assert.equal(producerSkill.skillDefinitionRef.version,1);
  assert.equal(snapshot.graph.connections[0].from.skillId,ids.from);
  assert.equal(snapshot.graph.connections[0].to.skillId,ids.to);
  assert.equal(snapshot.graph.connections[0].from.port,'result');
  assert.equal(snapshot.graph.connections[0].to.port,'in');
  assert.ok(result.createdRefs['skill:first']);
  assert.equal(result.createdRefs['definition:a'].startsWith('d_'),true);
  assert.deepEqual(new Set(computeSkillScope(snapshot.graph,[ids.to])),new Set([ids.from,ids.to]));
  assert.deepEqual(computeSkillScope(snapshot.graph,[ids.from]),[ids.from]);
});

test('Skill update/delete remain atomic and obey graph revision',()=>{
  const {store,ids}=fixture();
  const change=store.apply('ws',patch('g',1,[],[
    {op:'skill.update',skillId:ids.to,settings:{request:'new',nodeId:'user content'}}
  ]),()=>'42');
  assert.equal(change.graphRef.revision,2);
  assert.equal(store.get('ws','g').graph.skills[1].settings.nodeId,'user content');
  assert.throws(()=>store.apply('ws',patch('g',1,[],[
    {op:'skill.delete',skillId:ids.from}
  ]),()=>'99'),e=>e.code==='STALE_REVISION');
  assert.equal(store.get('ws','g').graph.revision,2);
  const connection=store.get('ws','g').graph.connections[0];
  store.apply('ws',patch('g',2,[],[
    {op:'link.remove',linkId:connection.id},
    {op:'skill.delete',skillId:ids.from}
  ]),()=>'100');
  assert.equal(store.get('ws','g').graph.skills.length,1);
});

test('restore accepts a canonical Skill snapshot and retains old ID values',()=>{
  const {store,ids}=fixture(),saved=store.get('ws','g');
  const another=new SkillGraphRepository();
  another.restore('ws','g',saved);
  assert.deepEqual(another.get('ws','g'),saved);
  assert.deepEqual(new Set(computeSkillScope(another.get('ws','g').graph,[ids.to])),
    new Set([ids.from,ids.to]));
});

test('Node-shaped ingress and unsupported Skill operations fail closed',()=>{
  const {store,ids}=fixture(),before=store.get('ws','g');
  assert.throws(()=>store.apply('ws',patch('g',1,[],[
    {op:'node.update',nodeId:ids.to,settings:{}}
  ]),()=>'3'),e=>e instanceof SkillSchemaError);
  assert.throws(()=>store.apply('ws',patch('g',1,[],[
    {op:'skill.update',nodeId:ids.to,settings:{}}
  ]),()=>'3'),e=>e instanceof SkillSchemaError);
  assert.throws(()=>store.apply('ws',patch('g',1,[],[
    {op:'skill.revise',skillId:ids.to}
  ]),()=>'3'),e=>e.code==='UNSUPPORTED_SKILL_PATCH_OPERATION');
  assert.deepEqual(store.get('ws','g'),before);
});

test('legacy-shaped snapshots cannot be restored through the Skill-only endpoint',()=>{
  const {store}=fixture();
  const saved=store.get('ws','g');
  saved.graph.nodes=saved.graph.skills;
  assert.throws(()=>new SkillGraphRepository().restore('ws','g',saved),e=>e instanceof SkillSchemaError);
});

test('existing graph validation and ports are still enforced',()=>{
  const store=new SkillGraphRepository();
  store.create('ws','g');
  let n=0;
  assert.throws(()=>store.apply('ws',patch('g',0,[producer,consumer],[
    add('first','a'),add('second','b'),
    {...link('first','second'),to:{skill:{localSkillKey:'second'},port:'unknown'}}
  ]),()=>String(++n)),e=>e.code==='PORT_MISMATCH');
  assert.equal(store.get('ws','g').graph.revision,0);
});
