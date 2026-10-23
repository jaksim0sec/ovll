import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryActionStore} from '../../back/js/assets/memoryActionStore.js';

const skill={name:'식물 조사',description:'식물 조사 정의',instruction:'입력받은 식물을 조사하도록 정의한다.',
 icon:'globe',color:'#4F8EF7',inputs:[{id:'in',label:'입력',type:'any',multiple:true}],
 outputs:[{id:'result',label:'결과',type:'research',multiple:true}],
 fields:[{id:'request',label:'대상',placeholder:'예: 나무',default:'',maxLength:1800}]};
const run=(store,scope,operationId,action,args,expectedRevision)=>store.apply({scope,requestId:'req',operationId,action,args,expectedRevision});
test('server creates a real Skill then a distinct Block with revisions',()=>{
 const store=createMemoryActionStore();
 assert.deepEqual(store.read({scope:'room'}),{revision:0,skills:[],blocks:[],links:[]});
 const define=run(store,'room','op1','skillDefine.defineDirect',skill,0);
 assert.equal(define.status,'applied');
 const actual=store.read({scope:'room'});
 assert.equal(actual.revision,1);
 assert.equal(actual.skills.length,1);
 assert.match(actual.skills[0].id,/^skill-/);
 assert.equal(actual.skills[0].revision,1);
 const args={skillId:actual.skills[0].id,x:100,y:200,expanded:true,values:{request:'은행나무'}};
 const block=run(store,'room','op2','canvasEdit.addBlock',args,1);
 assert.equal(block.status,'applied');
 const next=store.read({scope:'room'});
 assert.equal(next.revision,2);
 assert.equal(next.blocks[0].skillId,actual.skills[0].id);
 assert.match(next.blocks[0].id,/^block-/);
 assert.equal(next.blocks[0].values.request,'은행나무');
 assert.equal(next.blocks[0].expanded,true);
 assert.equal(next.links.length,0);
 assert.deepEqual(store.getOperation({scope:'room',operationId:'op2'}),block);
});
test('operation replay is idempotent but mismatched arguments cannot reuse its ID',()=>{
 const store=createMemoryActionStore();
 const first=run(store,'r','same','skillDefine.defineDirect',skill,0);
 const replay=run(store,'r','same','skillDefine.defineDirect',skill,0);
 assert.deepEqual(replay,first);
 assert.equal(store.read({scope:'r'}).skills.length,1);
 assert.throws(()=>run(store,'r','same','skillDefine.defineDirect',{...skill,name:'Different'},0),e=>e.code==='OPERATION_ID_REUSED');
 assert.equal(run(store,'r','later','skillDefine.defineDirect',{...skill,name:'Second'},0).status,'conflict');
 assert.equal(store.read({scope:'other'}).skills.length,0);
});
test('invalid model arguments and forged block Skill ID cause zero changes',()=>{
 const store=createMemoryActionStore();
 assert.throws(()=>run(store,'r','bad','skillDefine.defineDirect',{...skill,icon:'not-a-glyph'},0),e=>e.code==='ACTION_ARGS_INVALID');
 assert.equal(store.read({scope:'r'}).revision,0);
 assert.throws(()=>run(store,'r','badblock','canvasEdit.addBlock',{skillId:'skill-fake',x:1,y:1,expanded:false,values:{}},0),e=>e.code==='ACTION_ARGS_INVALID');
 assert.equal(store.read({scope:'r'}).revision,0);
 assert.equal(store.getOperation({scope:'r',operationId:'bad'}),null);
});
