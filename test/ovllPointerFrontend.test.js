import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../front/js/ovllPointerApi.js',import.meta.url),'utf8');
function client(responses=[]){
  const calls=[];
  class EventSource {
    constructor(url,opts){this.url=url;this.opts=opts;EventSource.last=this;this.handlers={};}
    addEventListener(type,fn){this.handlers[type]=fn;}
    emit(type,value){this.handlers[type]?.({data:JSON.stringify(value)});}
    close(){this.closed=true;}
  }
  const window={OVLL_RUNTIME:{apiOrigin:'https://api.example.com',pointerCsrfToken:'csrf'},
    crypto:{randomUUID:()=> 'uuid'},EventSource,setInterval:()=>1,clearInterval:()=>{},
    fetch:async(url,init)=>{calls.push({url,init});return {ok:true,status:200,
      json:async()=>responses.shift()||{events:[],hasMore:false,latestId:0}};}};
  vm.runInNewContext(source,{window});
  return {...window,calls};
}
test('OvllPointer POST is session-aware, uses idempotency and CSRF, and does not post model output',async()=>{
  const x=client([{requestRef:'req_uuid',message:'ok',results:[]}]);
  const result=await x.OvllPointerApi.submit({requestText:'hello'});
  assert.equal(result.message,'ok');
  assert.match(x.calls[0].url,/\/api\/pointer\/requests$/);
  assert.equal(x.calls[0].init.credentials,'include');
  assert.equal(x.calls[0].init.headers['Idempotency-Key'],'req_uuid');
  assert.equal(x.calls[0].init.headers['X-CSRF-Token'],'csrf');
  assert.deepEqual(JSON.parse(x.calls[0].init.body),{requestText:'hello'});
});
test('state and action routes use JSON, scoped graph and no direct AI authority',async()=>{
  const x=client([{graph:{graph:{revision:3}},eventCursor:8,runs:[]},{results:[{status:'scheduled',runRef:'r1'}]}]);
  const snapshot=await x.OvllPointerApi.state('g1','t1');
  assert.equal(snapshot.eventCursor,8);
  await x.OvllPointerApi.turn({graphId:'g1',taskRef:'t1',actions:[{kind:'run.start',localKey:'run',args:{targets:[{nodeId:'n1'}]}}]});
  assert.match(x.calls[0].url,/state\?graphId=g1&taskRef=t1/);
  assert.match(x.calls[1].url,/turns$/);
});
test('SSE retains durable cursor and suppresses duplicate events',async()=>{
  const x=client([{events:[{id:1,type:'run.queued',data:{runRef:'r'}}],latestId:1,hasMore:false}]);
  const got=[],stop=x.OvllPointerApi.watch({onEvent:e=>got.push(e.id)});
  await new Promise(resolve=>setTimeout(resolve,30));
  const stream=x.EventSource.last;
  assert.match(stream.url,/after=1$/);
  stream.emit('ovll',{id:1,type:'run.queued'});
  stream.emit('ovll',{id:2,type:'run.running'});
  stop();
  assert.deepEqual(got,[1,2]);
  assert.equal(stream.closed,true);
});

test('frontend keeps local provider retry timing without exposing upstream messages',async()=>{
 const window={OVLL_RUNTIME:{},crypto:{randomUUID:()=> 'uuid'},
   fetch:async()=>({ok:false,status:429,json:async()=>({
     error:{code:'PROVIDER_RATE_LIMIT',retryAfterSeconds:9,debug:'private upstream response'}
   })})};
 vm.runInNewContext(source,{window});
 await assert.rejects(window.OvllPointerApi.localTurn({snapshot:{},requestText:'hello'}),error=>
   error.code==='PROVIDER_RATE_LIMIT'&&error.retryAfterSeconds===9&&
   !String(error.message).includes('private'));
});
test('runtime activity layout keeps full-width labels on narrow screens',()=>{
 const css=readFileSync(new URL('../front/css/chat.css',import.meta.url),'utf8');
 const step=css.match(/\.ovll-runtime-step \{([^}]+)\}/)?.[1]||'';
 const content=css.match(/\.ovll-runtime-step-content \{([^}]+)\}/)?.[1]||'';
 const label=css.match(/\.ovll-runtime-step-label \{([^}]+)\}/)?.[1]||'';
 assert.match(step,/display: flex;/);
 assert.match(step,/max-width: 100%/);
 assert.match(content,/flex: 1 1 auto/);
 assert.match(label,/width: 100%/);
 assert.doesNotMatch(step,/grid-template-columns/);
 assert.match(css,/\.ovll-runtime-step-icon\[hidden\] \{\s*display: none;/);
});
