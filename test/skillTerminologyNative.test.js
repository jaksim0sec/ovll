import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryGraphRepository,computeScope} from '../front/js/ovllPointerGraphCore.mjs';

test('the original kernel directly edits independent skill nodes sharing one skill',()=>{
  const store=new MemoryGraphRepository();
  const empty=store.create('workspace','graph');
  assert.deepEqual(empty.graph.skillNodes,[]);
  assert.deepEqual(empty.skillDefinitions,[]);
  let sequence=0;
  const result=store.apply('workspace',{
    graphId:'graph',expectedGraphRevision:0,
    skillDefinitions:[{localKey:'vocabulary',purpose:'Japanese vocabulary',instruction:'Review words',
      inputs:[],outputs:[{name:'result',role:'Words',representation:'text'}]}],
    operations:['first','second'].map(localSkillNodeKey=>({op:'skillNode.add',localSkillNodeKey,
      skillDefinitionRef:{localDefinitionKey:'vocabulary'},
      settings:{request:localSkillNodeKey,payload:{nodeId:'user data',skills:['opaque']}}}))
  },()=>String(++sequence));
  const first=result.createdRefs['skillNode:first'];
  const second=result.createdRefs['skillNode:second'];
  assert.notEqual(first,second);
  const snapshot=store.get('workspace','graph');
  assert.equal(snapshot.skillDefinitions.length,1);
  assert.equal(snapshot.graph.skillNodes.length,2);
  assert.deepEqual(snapshot.graph.skillNodes[0].skillDefinitionRef,
    snapshot.graph.skillNodes[1].skillDefinitionRef);
  store.apply('workspace',{graphId:'graph',expectedGraphRevision:1,skillDefinitions:[],operations:[
    {op:'skillNode.update',skillNodeId:first,settings:{request:'Changed'}}]},()=>String(++sequence));
  const changed=store.get('workspace','graph');
  assert.equal(changed.graph.skillNodes.find(n=>n.skillNodeId===second).settings.request,'second');
  assert.deepEqual(changed.graph.skillNodes.find(n=>n.skillNodeId===second).settings.payload,
    {nodeId:'user data',skills:['opaque']});
  assert.deepEqual(computeScope(changed.graph,[first],'closed'),[first]);
  assert.throws(()=>store.apply('workspace',{graphId:'graph',expectedGraphRevision:1,skillDefinitions:[],
    operations:[{op:'skillNode.delete',skillNodeId:second}]},()=>String(++sequence)),
    error=>error.code==='STALE_REVISION');
});
