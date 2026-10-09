import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {ModelGateway} from '../backend/vnext/providers.js';
import {createVNextRuntime} from '../backend/vnext/runtime.js';

if(!process.env.VNEXT_TEST_DATABASE_URL)throw new Error('Isolated PostgreSQL integration database required');
const pool=new Pool({connectionString:process.env.VNEXT_TEST_DATABASE_URL,max:8});
const id=s=>s+'_'+randomUUID().replaceAll('-','').slice(0,18);
before(async()=>{for(const name of ['001_initial.sql','002_node_evidence.sql','003_lifecycle.sql'])
  await pool.query(await readFile(new URL('../backend/vnext/sql/'+name,import.meta.url),'utf8'));});
after(async()=>pool.end());
test('HTTP natural request -> vendor-neutral gateway -> durable Patch/Run -> replayable event',async()=>{
  const actorRef=id('actor'),workspaceRef=id('ws'),graphId=id('graph'),taskRef=id('task');
  const scope={actorRef,workspaceRef};
  let calls=0;
  const gateway=new ModelGateway();
  gateway.register('mock',{complete:async({messages})=>{
    calls++;
    const data=JSON.parse(messages.at(-1).content);
    if(data.context.requestText==='hello')return {text:JSON.stringify({message:'hello back'})};
    const patch={graphId,expectedGraphRevision:0,
      definitions:[{localKey:'d',purpose:'Summarize',instruction:'Produce an accurate summary',
        executorKind:'model_task',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}]}],
      operations:[{op:'node.add',localNodeKey:'n',definitionRef:{localDefinitionKey:'d'}}]};
    return {text:JSON.stringify({actions:[
      {localKey:'p',kind:'ir.applyPatch',args:{patch}},
      {localKey:'r',kind:'run.start',args:{targets:[{fromAction:'p',localNodeKey:'n'}]},dependsOn:['p']}
    ]})};
  }},{json:true});
  const runtime=createVNextRuntime({pool,executeNode:async()=>({status:'blocked',reason:'Host executor not configured'}),
    workerRef:id('worker'),authenticate:async req=>req.get('x-user')===actorRef?scope:null,
    verifyMutation:async req=>req.get('x-csrf')==='ok',modelGateway:gateway,
    prepareTurnContext:async({scope:s,requestText})=>({requestRef:s.requestRef,
      ...(s.taskRef?{taskRef:s.taskRef}:{}),objective:requestText,requestText,outputContract:'ModelTurn',
      constraints:[],capabilities:[],materials:[]}),
    resolveTurnModel:async()=>({providerId:'mock',model:'test-model',output:'json'})});
  await runtime.store.provisionWorkspace(workspaceRef,actorRef);
  await runtime.store.createGraph(scope,graphId);
  await runtime.store.createTask(scope,{taskId:taskRef,requestRef:id('req'),objective:'Summarize source'});
  const server=await new Promise(resolve=>{const s=runtime.app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port+'/api/vnext';
  const post=async(requestText,requestRef,extra={})=>fetch(base+'/requests',{method:'POST',
    headers:{'x-user':actorRef,'x-csrf':'ok','Idempotency-Key':requestRef,'content-type':'application/json'},
    body:JSON.stringify({requestText,...extra})});
  try {
    assert.equal((await fetch(base+'/requests',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({requestText:'hello'})})).status,401);
    const hello=await post('hello',id('req'));
    assert.equal(hello.status,200);
    assert.equal((await hello.json()).message,'hello back');
    const requestRef=id('req'),created=await post('build and run',requestRef,{graphId,taskRef});
    assert.equal(created.status,200);
    const result=await created.json();
    assert.deepEqual(result.results.map(x=>x.status),['applied','scheduled']);
    assert.equal(result.message,'','model cannot certify execution before Run completes');
    assert.equal((await runtime.store.inspectRun(scope,result.results[1].runRef)).status,'queued');
    assert.equal((await runtime.store.readGraph(scope,graphId)).graph.revision,1);
    const streamData=await runtime.store.readEvents(scope,0,100);
    assert.ok(streamData.events.some(e=>e.type==='controller.model_requested'&&e.data.requestRef===requestRef));
    assert.ok(streamData.events.some(e=>e.type==='graph.applied'));
    assert.ok(streamData.events.some(e=>e.type==='run.queued'));
    const canvas=await fetch(base+'/state?graphId='+graphId+'&taskRef='+taskRef,
      {headers:{'x-user':actorRef}});
    assert.equal(canvas.status,200);
    const view=await canvas.json();
    assert.equal(view.graph.graph.revision,1);
    assert.ok(view.runs.some(r=>r.runId===result.results[1].runRef));
    assert.ok(view.eventCursor>=streamData.latestId);
    const state=await fetch(base+'/runs/'+result.results[1].runRef+'/state',
      {headers:{'x-user':actorRef}});
    assert.equal(state.status,200);
    assert.equal((await state.json()).run.status,'queued');
    assert.equal((await fetch(base+'/state?graphId='+graphId)).status,401);
    assert.ok(calls>=3);
    const ctrl=new AbortController();
    const stream=await fetch(base+'/events/stream?after=0',{headers:{'x-user':actorRef},signal:ctrl.signal});
    assert.equal(stream.status,200);
    assert.match(stream.headers.get('content-type'),/text\/event-stream/);
    ctrl.abort();
  }finally{await new Promise(resolve=>server.close(resolve));}
});
