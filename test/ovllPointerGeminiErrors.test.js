import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import express from 'express';
import {mountLocalPointerRoutes} from '../backend/ovllPointer/localHttp.js';
import {ProviderError} from '../backend/ovllPointer/providers.js';

test('upstream failure keeps HTTP diagnostics without exposing provider message',async()=>{
  const app=express();
  app.use(express.json());
  mountLocalPointerRoutes(app,{enabled:()=>true,createHost:()=>({
    turn:async()=>{
      const error=new ProviderError('PROVIDER_HTTP_ERROR','PROVIDER_HTTP_ERROR',400);
      error.providerStatus='INVALID_ARGUMENT';
      throw error;
    }
  })});
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/pointer/local/turn',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({requestText:'check'})
    });
    assert.equal(response.status,400);
    assert.deepEqual(await response.json(),{error:{
      code:'PROVIDER_HTTP_ERROR',providerStatus:'INVALID_ARGUMENT'
    }});
  }finally{
    await new Promise(resolve=>server.close(resolve));
  }
});
test('client preserves safe provider status and hides raw upstream errors',async()=>{
  const window={OVLL_RUNTIME:{},fetch:async()=>({
    ok:false,status:404,json:async()=>({error:{
      code:'PROVIDER_HTTP_ERROR',providerStatus:'NOT_FOUND',message:'private upstream text'
    }})
  })};
  const source=readFileSync(new URL('../front/js/ovllPointerApi.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{window,console});
  await assert.rejects(window.OvllPointerApi.localTurn({
    requestRef:'test_1',snapshot:{},requestText:'hello'
  }),error=>error.code==='PROVIDER_HTTP_ERROR'&&error.status===404&&
    error.providerStatus==='NOT_FOUND'&&!String(error.message).includes('private'));
  const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  assert.match(app,/status===400/);
  assert.match(app,/status===401\|\|status===403/);
  assert.match(app,/status===404/);
});
