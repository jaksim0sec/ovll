import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemorySessions} from '../../back/js/request/memorySessions.js';
test('room-scoped context is revisioned and keeps last eight completed requests',()=>{
 const sessions=createMemorySessions(),scope='r';
 const initial=sessions.load({scope,initialContext:{overallFlow:'',currentTopic:'',details:''}});
 assert.equal(initial.revision,0);
 for(let i=0;i<9;i++){
  const cur=sessions.load({scope});
  const result=sessions.commit({scope,expectedRevision:cur.revision,requestId:'id'+i,request:{parts:[],attachments:[]},contextBlock:{intent:'x',progress:'done'},contextData:{overallFlow:String(i),currentTopic:'x',details:''}});
  assert.equal(result.status,'committed');
 }
 assert.equal(sessions.load({scope}).history.length,8);
 assert.equal(sessions.load({scope}).contextData.overallFlow,'8');
 assert.equal(sessions.load({scope:'different'}).contextData.overallFlow,'');
 assert.equal(sessions.commit({scope,expectedRevision:0,requestId:'stale',request:{},contextBlock:{},contextData:{}}).status,'conflict');
});
