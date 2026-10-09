import {MemoryGraphRepository,KernelError} from './graph.js';
import {createContractValidation} from './validation.js';
import {createPromptComposer} from './promptComposer.js';
import {validateNodeOutput} from './nodeOutput.js';
import {createConfiguredModelProvider} from './configuredProvider.js';

const fail=(code,status=422)=>{throw new KernelError(code,code,status);};
const safe=s=>typeof s==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(s);
const clone=x=>JSON.parse(JSON.stringify(x));
function prepare({snapshot,requestRef,requestText,history=[],capabilities=[]}){
  if(!safe(requestRef)||typeof requestText!=='string'||!requestText.trim()||requestText.length>2400||
    !snapshot?.graph||!safe(snapshot.graph.graphId)||!Array.isArray(snapshot.graph.nodes)||
    snapshot.graph.nodes.length>64||!Array.isArray(snapshot.graph.connections)||
    snapshot.graph.connections.length>128||!Array.isArray(snapshot.definitions)||
    snapshot.definitions.length>128||Buffer.byteLength(JSON.stringify(snapshot),'utf8')>30000)
    fail('INVALID_LOCAL_MODEL_REQUEST');
  const repo=new MemoryGraphRepository();
  repo.restore('local',snapshot.graph.graphId,snapshot);
  const context={requestRef,objective:requestText,requestText,constraints:[],capabilities,
    outputContract:'ModelTurn',historyDigest:(Array.isArray(history)?history:[])
      .slice(-6).filter(x=>typeof x==='string').map(x=>x.slice(0,800)),
    materials:[{ref:'graph',kind:'graph_snapshot',source:'user_input',content:clone(snapshot),truncated:false}]};
  return {snapshot:clone(snapshot),context};
}
export function createLocalPointerHost({gateway,resolveModel,validation=createContractValidation(),
  composer=createPromptComposer({validation})}={}){
  if(typeof gateway?.complete!=='function'||typeof resolveModel!=='function')
    fail('LOCAL_MODEL_NOT_CONFIGURED',503);
  async function invoke({context,modules,nodeContext,signal}){
    const {messages}=composer.assemble({moduleIds:modules,context,nodeContext});
    // JSON mode guarantees JSON syntax, NOT the actual ModelTurn / GraphPatch contract.
    // Port.role and nested local refs are easy for a model to omit unless explicitly defined.
    const contract=nodeContext?
      'Return one JSON ModelTurn with ONLY "outputs". Example: {"outputs":{"status":"produced","values":{"result":{"inline":"your answer"}}}}. Replace result with the EXACT declared output port name; blocked outputs use {"outputs":{"status":"blocked","reason":"why"}}. No actions, tools or invented results.':
      'Return exactly one JSON ModelTurn object. Allowed top-level keys: "message" (string), "actions" (array), "needs" (array); do NOT add mode, workflow, plan, nodes, graph, explanation or markdown at top level. For ordinary chat use {"message":"answer"}. For a workflow create one ir.applyPatch action containing an atomic GraphPatch. Example, REPLACE graphId/revision with the actual graph snapshot values: {"message":"구성했어.","actions":[{"localKey":"p1","kind":"ir.applyPatch","args":{"patch":{"graphId":"g_example","expectedGraphRevision":0,"definitions":[{"localKey":"d1","purpose":"요약","executorKind":"model_task","instruction":"입력 내용을 요약한다","inputs":[],"outputs":[{"name":"result","role":"결과","representation":"text"}]}],"operations":[{"op":"node.add","localNodeKey":"n1","definitionRef":{"localDefinitionKey":"d1"}}]}}}]}. Every output/input port REQUIRES name,role,representation. Each definition REQUIRES localKey,purpose,executorKind,instruction,inputs,outputs (nonempty outputs). Node definitionRef with localDefinitionKey MUST point to a definition in the same patch. A run.start action is OPTIONAL (only when the user wants execution); if used it must dependOn ["p1"] and targets [{"fromAction":"p1","localNodeKey":"n1"}]. Use only model_task executors for this browser-local runtime. Never claim graph edits executed until confirmed.';
    messages.splice(1,0,{role:'developer',content:contract});
    const config=await resolveModel();
    const complete=()=>gateway.complete({providerId:config.providerId,model:config.model,
      output:'json',messages,maxOutputTokens:config.maxOutputTokens??2048,signal});
    let result=await complete();
    for(let attempt=0;attempt<2;attempt++){
      let turn,invalidJson=false;
      try{turn=JSON.parse(result.text);}catch{invalidJson=true;}
      if(!invalidJson&&validation.validateTurn(turn))return {turn,usage:result.usage||null};
      const issues=invalidJson?[{path:'/',rule:'invalidJson'}]:
        validation.explainTurn?.(turn)||[{path:'/',rule:'schemaMismatch'}];
      if(attempt===1||signal?.aborted){
        console.warn('[OvllPointer contract validation failed]',{
          phase:nodeContext?'node':'turn',issues,attempts:attempt+1
        });
        fail(invalidJson?'MODEL_INVALID_JSON':'INVALID_MODEL_TURN');
      }
      // One bounded correction, not an unvalidated auto-apply or repeated blind retries.
      messages.push({role:'assistant',content:result.text.slice(0,5500)});
      messages.push({role:'user',content:'The previous JSON violates the mandatory ModelTurn contract. '+
        'Correct its structure and preserve the original requested task. '+
        'Schema issues: '+JSON.stringify(issues)+'. '+
        'Return ONLY a valid JSON object matching the contract. '+
        'Do not invent completed actions, output, or tool calls.'});
      result=await complete();
    }
    fail('INVALID_MODEL_TURN');
  }
  async function turn({snapshot,requestRef,requestText,history,signal}={}){
    const {context}=prepare({snapshot,requestRef,requestText,history,capabilities:[
      'chat','ir.applyPatch','run.start','function.save','question.ask','model_task']});
    const result=await invoke({context,modules:['layer.entry','layer.chat','layer.ir',
      'ir.define','ir.patch','ir.connect','layer.function','fn.extract'],signal});
    if(result.turn.outputs||result.turn.needs?.length&&result.turn.actions?.length)
      fail('UNSUPPORTED_LOCAL_MODEL_TURN');
    return result.turn;
  }
  async function node({snapshot,requestRef,requestText,nodeId,inputArtifacts=[],signal}={}){
    const {context}=prepare({snapshot,requestRef,requestText,capabilities:['model_task']});
    if(!safe(nodeId)||!Array.isArray(inputArtifacts)||inputArtifacts.length>48||
      Buffer.byteLength(JSON.stringify(inputArtifacts),'utf8')>22000)fail('INVALID_LOCAL_NODE_INPUT');
    const target=snapshot.graph.nodes.find(n=>n.nodeId===nodeId);
    if(!target)fail('LOCAL_NODE_NOT_FOUND',404);
    const definition=snapshot.definitions.find(d=>d.definitionId===target.definitionRef.definitionId&&
      d.version===target.definitionRef.version);
    if(!definition||definition.executorKind!=='model_task')fail('LOCAL_EXECUTOR_UNAVAILABLE',501);
    const nodeContext={nodeId,purpose:definition.purpose,instruction:definition.instruction,
      inputPorts:definition.inputs,outputPorts:definition.outputs,inputBindings:target.inputBindings||{},
      upstreamArtifacts:inputArtifacts.map(a=>({port:a.port,sourceNodeId:a.sourceNodeId,
        sourcePort:a.sourcePort,valueRef:a.valueRef,representation:a.representation,value:a.value}))};
    const result=await invoke({context,modules:['run.perform'],nodeContext,signal});
    if(result.turn.needs?.length||result.turn.actions?.length||!result.turn.outputs)
      fail('LOCAL_NODE_OUTPUT_REQUIRED');
    const checked=await validateNodeOutput(definition,result.turn.outputs,{inputArtifacts});
    return {nodeId,status:result.turn.outputs.status==='blocked'?'blocked':'success',
      outputs:result.turn.outputs,validatedPorts:checked.length||0};
  }
  return Object.freeze({turn,node});
}
export function createConfiguredLocalPointerHost({env=process.env,fetchImpl=fetch}={}){
  const merged=(env.OVLL_POINTER_MODEL_ENDPOINT||env.OVLL_VNEXT_MODEL_ENDPOINT)?env:{
    ...env,OVLL_POINTER_MODEL_ENDPOINT:'https://api.groq.com/openai/v1/chat/completions',
    OVLL_POINTER_MODEL_API_KEY:env.GROQ_API_KEY,
    OVLL_POINTER_MODEL_ID:env.GROQ_MODEL||'openai/gpt-oss-120b',
    OVLL_POINTER_PROVIDER_ID:'groq'
  };
  const {modelGateway,resolveModel}=createConfiguredModelProvider({env:merged,fetchImpl});
  return createLocalPointerHost({gateway:modelGateway,resolveModel});
}
