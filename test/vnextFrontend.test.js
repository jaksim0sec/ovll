import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../front/js/vnextApi.js',import.meta.url),'utf8');
function client(responses=[]){
  const calls=[];
  class EventSource {
    constructor(url,opts){this.url=url;this.opts=opts;EventSource.last=this;this.handlers={};}
    addEventListener(type,fn){this.handlers[type]=fn;}
    emit(type,value){this.handlers[type]?.({data:JSON.stringify(value)});}
    close(){this.closed=true;}
  }
  const window={OVLL_RUNTIME:{apiOrigin:'https://api.example.com',vnextCsrfToken:'csrf'},
    crypto:{randomUUID:()=> 'uuid'},EventSource,setInterval:()=>1,clearInterval:()=>{},
    fetch:async(url,init)=>{calls.push({url,init});return {ok:true,status:200,
      json:async()=>responses.shift()||{events:[],hasMore:false,latestId:0}};}};
  vm.runInNewContext(source,{window});
  return {...window,calls};
}
test('vNext POST is session-aware, uses idempotency and CSRF, and does not post model output',async()=>{
  const x=client([{requestRef:'req_uuid',message:'ok',results:[]}]);
  const result=await x.OvllVNextApi.submit({requestText:'hello'});
  assert.equal(result.message,'ok');
  assert.match(x.calls[0].url,/\/api\/vnext\/requests$/);
  assert.equal(x.calls[0].init.credentials,'include');
  assert.equal(x.calls[0].init.headers['Idempotency-Key'],'req_uuid');
  assert.equal(x.calls[0].init.headers['X-CSRF-Token'],'csrf');
  assert.deepEqual(JSON.parse(x.calls[0].init.body),{requestText:'hello'});
});
test('SSE retains durable cursor and suppresses duplicate events',async()=>{
  const x=client([{events:[{id:1,type:'run.queued',data:{runRef:'r'}}],latestId:1,hasMore:false}]);
  const got=[],stop=x.OvllVNextApi.watch({onEvent:e=>got.push(e.id)});
  await new Promise(resolve=>setTimeout(resolve,30));
  const stream=x.EventSource.last;
  assert.match(stream.url,/after=1$/);
  stream.emit('ovll',{id:1,type:'run.queued'});
  stream.emit('ovll',{id:2,type:'run.running'});
  stop();
  assert.deepEqual(got,[1,2]);
  assert.equal(stream.closed,true);
});
