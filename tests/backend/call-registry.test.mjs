import test from 'node:test';
import assert from 'node:assert/strict';
import {createCallRegistry} from '../../back/js/request/callRegistry.js';

test('call ids are globally distinct and routes explicitly name actions',()=>{
 let seq=0;const r=createCallRegistry({createId:()=> 'c'+(++seq)});
 const a=r.register({roomId:'room',requestId:'one',route:{layer:'workshop',workshop:'skillDefine',action:'defineDirect'},requestRevision:2});
 const b=r.register({roomId:'room',requestId:'one',route:{layer:'hallway',phase:'initial'}});
 assert.equal(a.path,'c1.workshop.skillDefine.defineDirect');
 assert.equal(b.path,'c2.hallway.initial');
 assert.equal(r.get({roomId:'other',requestId:'one',callId:a.callId}),null);
 assert.equal(r.list({roomId:'room',requestId:'one'}).length,2);
 a.route.action='delete';assert.equal(r.get({roomId:'room',requestId:'one',callId:'c1'}).route.action,'defineDirect');
 const started=r.start({roomId:'room',requestId:'one',callId:'c1'});
 const ended=r.finish({roomId:'room',requestId:'one',callId:'c1',status:'unsupported',expectedRevision:started.revision});
 assert.equal(ended.status,'unsupported');
 assert.throws(()=>r.finish({roomId:'room',requestId:'one',callId:'c1',status:'completed',expectedRevision:ended.revision}),/Stale/);
});
test('fake tools and duplicate identities are rejected',()=>{
 const r=createCallRegistry({createId:()=> 'duplicate'});
 assert.throws(()=>r.register({roomId:'a',requestId:'b',route:{layer:'workshop',workshop:'skillDefine',action:'fake'}}));
 r.register({roomId:'a',requestId:'b',route:{layer:'gate'}});
 assert.throws(()=>r.register({roomId:'a',requestId:'c',route:{layer:'gate'}}),/Duplicate/);
});
