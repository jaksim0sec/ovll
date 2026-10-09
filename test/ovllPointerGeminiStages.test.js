import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfiguredLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {MemoryGraphRepository} from '../backend/ovllPointer/graph.js';

test('Gemini uses one selected provider for entry, node execution and final language',async()=>{
  const repository=new MemoryGraphRepository();
  repository.create('local','g_gemini');
  const empty=repository.get('local','g_gemini');
  repository.apply('local',{graphId:'g_gemini',expectedGraphRevision:0,
    definitions:[{localKey:'writer',purpose:'Write summary',instruction:'Write a summary',
      executorKind:'model_task',inputs:[],outputs:[{name:'result',representation:'text'}]}],
    operations:[{op:'node.add',localNodeKey:'n',
      definitionRef:{localDefinitionKey:'writer'}}]});
  const graph=repository.get('local','g_gemini');
  const nodeId=graph.graph.nodes[0].nodeId;
  const messages=[
    '{"message":"안녕하세요"}',
    '{"outputs":{"status":"produced","values":{"result":{"inline":"요약 결과"}}}}',
    '{"message":"필요한 입력을 알려줘."}'
  ];
  const calls=[];
  const host=createConfiguredLocalPointerHost({env:{
    OVLL_POINTER_PROVIDER_ID:'gemini',GEMINI_API_KEY:'test-key',
    OVLL_POINTER_MODEL_ID:'gemini-3.5-flash-lite'
  },fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    calls.push({url,body});
    return {ok:true,status:200,json:async()=>({candidates:[{finishReason:'STOP',
      content:{parts:[{text:messages.shift()}]}}]})};
  }});
  const first=await host.turn({snapshot:empty,requestRef:'r_turn',requestText:'안녕'});
  assert.equal(first.message,'안녕하세요');
  const node=await host.node({snapshot:graph,requestRef:'r_node',requestText:'요약',nodeId});
  assert.equal(node.status,'success');
  assert.equal(node.outputs.values.result.inline,'요약 결과');
  const final=await host.response({snapshot:graph,requestRef:'r_final',requestText:'요약',
    actionResults:[{kind:'run.start',status:'failed',error:'INPUT_REQUIRED'}]});
  assert.match(final.message,/입력을/);
  assert.equal(calls.length,3);
  for(const {url,body} of calls){
    assert.match(url,/generativelanguage\.googleapis\.com/);
    assert.equal(body.generationConfig.responseMimeType,'application/json');
    assert.ok(body.systemInstruction.parts.some(x=>x.text.includes('ModelTurn')));
  }
});
