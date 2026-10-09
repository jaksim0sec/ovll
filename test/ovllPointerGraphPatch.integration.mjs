import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import vm from 'node:vm';
import {PostgresPointerStore} from '../backend/ovllPointer/durable.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
if(!process.env.POINTER_TEST_DATABASE_URL)throw new Error('Disposable PostgreSQL required');
const pool=new Pool({connectionString:process.env.POINTER_TEST_DATABASE_URL});
const id=type=>type+'_'+randomUUID().replaceAll('-','').slice(0,18);
const w={};
vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerGraphPatch.js',import.meta.url),'utf8'),{window:w});
const editor=w.OvllPointerGraphPatch;
before(async()=>{
  for(const filename of ['001_initial.sql','002_node_evidence.sql','003_lifecycle.sql']){
    const fs=await import('node:fs/promises');
    await pool.query(await fs.readFile(new URL('../backend/ovllPointer/sql/'+filename,import.meta.url),'utf8'));
  }
});
after(async()=>pool.end());
test('real server commits semantic canvas edits with a pinned revision, immutable history and conflict rejection',async()=>{
  const graphId=id('g'),workspaceRef=id('w'),actorRef=id('u'),scope={workspaceRef,actorRef};
  const validation=createContractValidation();
  const store=new PostgresPointerStore({pool,validateTurn:validation.validateTurn});
  await store.provisionWorkspace(workspaceRef,actorRef);
  await store.createGraph(scope,graphId);
  const def={localKey:'draft',purpose:'Write a summary',instruction:'Use only actual sources',
    executorKind:'model_task',inputs:[{name:'in',role:'input',representation:'text'}],
    outputs:[{name:'out',role:'result',representation:'text'}]};
  // Simulate the browser's actual JSON HTTP boundary: vm-created objects cross realms.
  const send=(patch,requestRef=id('req'))=>store.submit({actions:[{localKey:'edit',kind:'ir.applyPatch',
    args:{patch:JSON.parse(JSON.stringify(patch))}}]}, {...scope,graphId,requestRef});
  const initial={graphId,expectedGraphRevision:0,definitions:[def],operations:[
    {op:'node.add',localNodeKey:'a',definitionRef:{localDefinitionKey:'draft'}},
    {op:'node.add',localNodeKey:'b',definitionRef:{localDefinitionKey:'draft'}},
    {op:'link.add',localLinkKey:'one',kind:'data',
      from:{node:{localNodeKey:'a'},port:'out'},to:{node:{localNodeKey:'b'},port:'in'}}
  ]};
  assert.equal((await send(initial)).results[0].status,'applied');
  const graph=await store.readGraph(scope,graphId);
  assert.equal(graph.graph.revision,1);
  const d=graph.definitions[0];
  const nodes=graph.graph.nodes.map(n=>({id:n.nodeId,type:'pointer:'+n.definitionRef.definitionId+':'+n.definitionRef.version,
    data:{params:{request:d.instruction},pointer:{inputBindings:n.inputBindings}}}));
  const links=graph.graph.connections.map(l=>({from:{node:l.from.nodeId,port:l.from.port},
    to:{node:l.to.nodeId,port:l.to.port},data:{kind:l.kind}}));
  const canvas={nodes,connections:links};
  assert.equal(editor.build(graph,{nodes:nodes.map(x=>({...x,x:99})),connections:links}),null);
  canvas.nodes.push({id:'temporary',type:nodes[0].type,x:50,y:20,data:{}});
  canvas.connections.push({from:{node:nodes[1].id,port:'out'},
    to:{node:'temporary',port:'in'},data:{kind:'flow'}});
  const diff=editor.build(graph,canvas);
  assert.equal(diff.patch.expectedGraphRevision,1);
  assert.equal((await send(diff.patch)).results[0].status,'applied');
  const updated=await store.readGraph(scope,graphId);
  assert.equal(updated.graph.revision,2);
  assert.equal(updated.graph.nodes.length,3);
  assert.equal(updated.graph.connections.length,2);
  assert.equal((await store.readGraph(scope,graphId,1)).graph.nodes.length,2);
  const stale=await send(diff.patch);
  assert.equal(stale.results[0].status,'rejected');
  assert.equal(stale.results[0].error.code,'STALE_REVISION');
  assert.equal((await store.readGraph(scope,graphId)).graph.revision,2);
  const stranger={workspaceRef:id('foreign'),actorRef};
  await assert.rejects(store.readGraph(stranger,graphId),e=>e.code==='FORBIDDEN');
});
