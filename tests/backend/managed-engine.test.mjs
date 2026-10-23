import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngine} from '../../back/js/engine/engine.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';

const sample=roomId=>({roomId,request:{parts:[{type:'text',text:'안녕'}],attachments:[]},initialResources:[]});
test('one managed engine tracks independently submitted requests',async()=>{
 const composer={compose:async()=>''};
 const modelCaller={generate:async ({layer})=>({jsonText:JSON.stringify(layer==='gate'?{need:[]}:{languageBlock:'안녕하세요',contextBlock:{intent:'인사',progress:'완료'},contextData:{overallFlow:'인사',currentTopic:'인사',details:''}})})};
 const engine=createEngine({composer,modelCaller,dataProvider:createMemoryDataProvider()});
 const a=engine.submit(sample('room-a')),b=engine.submit(sample('room-b'));
 assert.notEqual(a.requestId,b.requestId);
 const [ar,br]=await Promise.all([a.completion,b.completion]);
 assert.equal(ar.status,'completed');assert.equal(br.status,'completed');
 assert.equal(engine.getRequest({roomId:'room-a',requestId:a.requestId}).roomId,'room-a');
 assert.equal(engine.getRequest({roomId:'room-b',requestId:a.requestId}),null);
 await engine.whenIdle();
});
