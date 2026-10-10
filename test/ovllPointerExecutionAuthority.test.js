import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
import {phaseOutputIssues} from '../backend/ovllPointer/modelContract.js';
import {getPointerCatalog} from '../backend/ovllPointer/nodeCatalog.js';

const graph=()=>({graph:{graphId:'g',revision:1,nodes:[{
  nodeId:'n_vocabulary',definitionRef:{definitionId:'d_vocab',version:1},
  settings:{request:'Write vocabulary'},inputBindings:{}
}],connections:[]},definitions:[{
  definitionId:'d_vocab',version:1,purpose:'Japanese vocabulary list',
  executorKind:'model_task',instruction:'Write Japanese words and meanings',
  inputs:[],outputs:[{name:'result',role:'result',representation:'json'}],
  presentation:{name:'일본어 단어장'}
}]});
const patch={graphId:'g',expectedGraphRevision:1,definitions:[],operations:[{
  op:'node.add',localNodeKey:'copy',definitionRef:{definitionId:'d_vocab',version:1},
  settings:{request:'Write vocabulary'},inputBindings:{}
}]};
const edit={localKey:'edit',kind:'ir.applyPatch',args:{patch}};
const run={localKey:'run',kind:'run.start',dependsOn:['edit'],
  args:{targets:[{fromAction:'edit',localNodeKey:'copy'}]}};
const host=(responses,received)=>createLocalPointerHost({
  gateway:{complete:async args=>{received.push(args);return{text:JSON.stringify(responses.shift())};}},
  resolveModel:async()=>({providerId:'mock',model:'mock',maxOutputTokens:1024})
});

test('structural execution intent gate refuses an unsolicited run and repairs before any action',async()=>{
  const wrong={actions:[edit,run]},corrected={actions:[edit]},requests=[];
  assert.equal(createContractValidation().validateTurn(wrong),true);
  assert.ok(phaseOutputIssues(wrong,'turn').some(e=>e.path==='/executionIntent'));
  assert.equal(phaseOutputIssues(corrected,'turn').length,0);
  const response=await host([wrong,corrected],requests).turn({
    snapshot:graph(),requestRef:'copy1',requestText:'일본어 단어장 노드 복제해줘'
  });
  assert.equal(requests.length,2);
  assert.deepEqual(response.actions,[edit]);
  assert.equal(response.executionIntent,undefined);
});

test('authorized graph build and run still completes the planning phase in one call',async()=>{
  const requested={executionIntent:'requested',actions:[edit,run]},requests=[];
  assert.equal(createContractValidation().validateTurn(requested),true);
  assert.equal(phaseOutputIssues(requested,'turn').length,0);
  const response=await host([requested],requests).turn({
    snapshot:graph(),requestRef:'run1',requestText:'Create and run a Japanese vocabulary workflow'
  });
  assert.equal(requests.length,1);
  assert.equal(response.actions.length,2);
});

test('a node execution receives its own task rather than an earlier unrelated workspace objective',async()=>{
  const observed=[];
  const fake=createLocalPointerHost({
    gateway:{complete:async ({messages})=>{
      const data=JSON.parse(messages.findLast(m=>m.role==='user'&&m.content.startsWith('{"context"'))?.content||'{}');
      observed.push(data);
      return{text:JSON.stringify({outputs:{status:'produced',values:{result:{inline:'こんにちは'}}}})};
    }},
    resolveModel:async()=>({providerId:'mock',model:'mock'})
  });
  await fake.node({snapshot:graph(),nodeId:'n_vocabulary',requestRef:'node1',
    requestText:'Write vocabulary',taskContext:{objective:'식물 연구하기',
    requestText:'일본어 노드 복제해줘',constraints:['Only plants']},taskConstraints:[]});
  assert.equal(observed[0].context.objective,'Write vocabulary');
  assert.deepEqual(observed[0].context.constraints,[]);
  assert.equal(observed[0].nodeContext.instruction,'Write Japanese words and meanings');
});

test('new chat instruction becomes current objective and old requirements stay historical',()=>{
  const window={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerActivity.js',import.meta.url),'utf8'),{window});
  const previous={objective:'식물 조사하기',requestText:'식물 성장 조사해줘',
    constraints:['Only plant data'],requestHistory:['Plant history']};
  const current=window.OvllPointerActivity.createTaskContext(previous,'일본어 단어장 노드 복제해줘');
  assert.equal(current.objective,'일본어 단어장 노드 복제해줘');
  assert.deepEqual(Array.from(current.constraints),[]);
  assert.ok(current.requestHistory.includes('식물 성장 조사해줘'));
});

test('chat orchestration text is never reused as node execution content',()=>{
  const src=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  const handler=src.slice(src.indexOf("'run.start':async(action,applied)=>"),src.indexOf("'function.run':async action=>"));
  assert.ok(handler.includes('runLocalNodes({targets'));
  assert.doesNotMatch(handler,/requestText:\s*value/);
  assert.match(src,/const run=await runLocalNodes\(\{targets,damMode:action\.args\.damMode\|\|'closed',/);
 assert.match(handler,/taskContext,taskConstraints:taskContext\.constraints,cache,operation/);
 assert.doesNotMatch(handler,/requestText:\s*value/);
});
