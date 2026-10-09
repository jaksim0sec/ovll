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
    messages.splice(1,0,{role:'developer',content:nodeContext?
      'Return exactly one JSON object with outputs.status produced or blocked and declared port values. No fabricated tool use.':
      'Return exactly one valid JSON ModelTurn object. For ordinary conversation use only message. For a reusable task create dynamic model_task definitions with text output ports and an ir.applyPatch action scoped to the given graphId and expectedGraphRevision. You may include run.start dependent on the patch, targeting the new node through fromAction and localNodeKey. Do not claim any action applied before confirmation. Suggest function.save only when the user asks to reuse the work. Do not invent tool execution or capability access.'});
    const config=await resolveModel();
    const result=await gateway.complete({providerId:config.providerId,model:config.model,
      output:'json',messages,maxOutputTokens:config.maxOutputTokens??1500,signal});
    let turn;
    try{turn=JSON.parse(result.text);}catch{fail('MODEL_INVALID_JSON');}
    if(!validation.validateTurn(turn))fail('INVALID_MODEL_TURN');
    return {turn,usage:result.usage||null};
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
