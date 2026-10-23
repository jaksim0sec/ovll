import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryAssets} from '../../back/js/engine/memoryAssets.js';
import {createMemoryCheckpoints} from '../../back/js/engine/checkpoints.js';

const def=(name='Writing')=>({name,description:'Generates text',instruction:'Write clearly',inputs:[{id:'in',type:'any',multiple:false}],outputs:[{id:'out',type:'any',multiple:true}],fields:[{id:'topic',default:'',maxLength:200}],icon:'pen',color:'#234567'});
let counter=0;
const setup=()=>{counter=0;return createMemoryAssets({createId:()=>`asset-${++counter}`});};
const apply=(a,action,args,scope='room')=>a.apply({scope,requestId:'req',operationId:`op-${++counter}`,action,args,expectedRevision:a.read({scope}).revision});
test('Skill create, read, revise, appearance, reference blocking, delete',()=>{
 const a=setup();const created=apply(a,'defineDirect',{definition:def()});assert.equal(created.status,'applied');
 const skill=a.read({scope:'room'}).skills[0];assert.equal(skill.name,'Writing');assert.equal(skill.revision,1);
 assert.equal(apply(a,'revise',{skillId:skill.id,patch:{instruction:'Better'}}).status,'applied');
 assert.equal(apply(a,'editAppearance',{skillId:skill.id,patch:{color:'#abcdef'}}).status,'applied');
 const b=apply(a,'addBlock',{skillId:skill.id,x:5,y:10,values:{topic:'Physics'}});
 assert.equal(b.status,'applied');
 assert.equal(apply(a,'delete',{skillId:skill.id}).status,'rejected');
 assert.equal(apply(a,'revise',{skillId:skill.id,patch:{fields:[]}}).status,'rejected');
 assert.equal(apply(a,'deleteBlock',{blockId:a.read({scope:'room'}).blocks[0].id}).status,'applied');
 assert.equal(apply(a,'delete',{skillId:skill.id}).status,'applied');
});
test('five canvas actions respect ports, links, deletion and rollback on invalid cycle',()=>{
 const a=setup();const s=apply(a,'defineDirect',{definition:def()});
 const skill=a.read({scope:'room'}).skills[0];
 apply(a,'addBlock',{skillId:skill.id,x:0,y:0});apply(a,'addBlock',{skillId:skill.id,x:20,y:20});
 const [b1,b2]=a.read({scope:'room'}).blocks;
 assert.equal(apply(a,'editBlock',{blockId:b1.id,patch:{x:44}}).status,'applied');
 assert.equal(apply(a,'addLink',{from:{blockId:b1.id,portId:'out'},to:{blockId:b2.id,portId:'in'}}).status,'applied');
 const state=a.read({scope:'room'}),failure=apply(a,'addLink',{from:{blockId:b2.id,portId:'out'},to:{blockId:b1.id,portId:'in'}});
 assert.equal(failure.status,'rejected');assert.equal(a.read({scope:'room'}).revision,state.revision);
 assert.equal(apply(a,'removeLink',{linkId:state.links[0].id}).status,'applied');
 assert.equal(apply(a,'deleteBlock',{blockId:b2.id}).status,'applied');
});
test('operation replay is idempotent and revisions reject stale mutation',()=>{
 const a=setup(),input={scope:'r',requestId:'req',operationId:'once',action:'defineDirect',args:{definition:def()},expectedRevision:0};
 const one=a.apply(input),two=a.apply(input);
 assert.deepEqual(two,one);assert.equal(a.read({scope:'r'}).skills.length,1);
 assert.equal(a.apply({...input,operationId:'stale',args:{definition:def('Other')}}).status,'conflict');
 assert.equal(a.read({scope:'r'}).skills.length,1);
 assert.equal(a.read({scope:'another'}).skills.length,0);
});
test('checkpoint CAS protects waiting and operation state',()=>{
 const cp=createMemoryCheckpoints(),scope='r',requestId='req';
 assert.equal(cp.load({scope,requestId}),null);
 assert.equal(cp.save({scope,requestId,expectedRevision:0,next:{status:'running',planCursor:0}}).status,'saved');
 assert.equal(cp.save({scope,requestId,expectedRevision:0,next:{status:'completed'}}).status,'conflict');
 assert.equal(cp.load({scope,requestId}).state.planCursor,0);
});

test('reusing an operationId for a different action never replays unrelated success',()=>{
 const a=setup(),first={scope:'room',requestId:'req',operationId:'same',action:'defineDirect',args:{definition:def('First')},expectedRevision:0};
 const created=a.apply(first);assert.equal(created.status,'applied');
 const skillId=a.read({scope:'room'}).skills[0].id;
 const mixed=a.apply({...first,action:'addBlock',args:{skillId,x:40,y:80}});
 assert.equal(mixed.status,'rejected');
 assert.equal(mixed.code,'OPERATION_ID_CONFLICT');
 assert.equal(a.read({scope:'room'}).blocks.length,0);
 assert.deepEqual(a.apply(first),created);
});
