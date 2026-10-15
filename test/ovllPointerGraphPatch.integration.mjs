import {applyPointerMigrations} from './helpers/pointerMigrations.mjs';
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
before(()=>applyPointerMigrations(pool));
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
  const initial={graphId,expectedGraphRevision:0,skillDefinitions:[def],operations:[
    {op:'skillNode.add',localSkillNodeKey:'a',skillDefinitionRef:{localDefinitionKey:'draft'}},
    {op:'skillNode.add',localSkillNodeKey:'b',skillDefinitionRef:{localDefinitionKey:'draft'}},
    {op:'link.add',localLinkKey:'one',kind:'data',
      from:{skillNode:{localSkillNodeKey:'a'},port:'out'},to:{skillNode:{localSkillNodeKey:'b'},port:'in'}}
  ]};
  assert.equal((await send(initial)).results[0].status,'applied');
  const graph=await store.readGraph(scope,graphId);
  assert.equal(graph.graph.revision,1);
  const d=graph.skillDefinitions[0];
  const skillNodes=graph.graph.skillNodes.map(n=>({id:n.skillNodeId,type:'pointer:'+n.skillDefinitionRef.definitionId+':'+n.skillDefinitionRef.version,
    data:{params:{request:''},pointer:{inputBindings:n.inputBindings}}}));
  const links=graph.graph.connections.map(l=>({from:{skillNode:l.from.skillNodeId,port:l.from.port},
    to:{skillNode:l.to.skillNodeId,port:l.to.port},data:{kind:l.kind}}));
  const canvas={skillNodes,connections:links};
  assert.equal(editor.build(graph,{skillNodes:skillNodes.map(x=>({...x,x:99})),connections:links}),null);
  canvas.skillNodes.push({id:'temporary',type:skillNodes[0].type,x:50,y:20,data:{}});
  canvas.connections.push({from:{skillNode:skillNodes[1].id,port:'out'},
    to:{skillNode:'temporary',port:'in'},data:{kind:'flow'}});
  const diff=editor.build(graph,canvas);
  assert.equal(diff.patch.expectedGraphRevision,1);
  assert.equal((await send(diff.patch)).results[0].status,'applied');
  const updated=await store.readGraph(scope,graphId);
  assert.equal(updated.graph.revision,2);
  assert.equal(updated.graph.skillNodes.length,3);
  assert.equal(updated.graph.connections.length,2);
  assert.equal((await store.readGraph(scope,graphId,1)).graph.skillNodes.length,2);
  const stale=await send(diff.patch);
  assert.equal(stale.results[0].status,'rejected');
  assert.equal(stale.results[0].error.code,'STALE_REVISION');
  assert.equal((await store.readGraph(scope,graphId)).graph.revision,2);
  const stranger={workspaceRef:id('foreign'),actorRef};
  await assert.rejects(store.readGraph(stranger,graphId),e=>e.code==='FORBIDDEN');
});
