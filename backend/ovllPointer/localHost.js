import {localModelContract} from './modelContract.js';
import {MemoryGraphRepository,KernelError} from './graph.js';
import {createContractValidation} from './validation.js';
import {createPromptComposer} from './promptComposer.js';
import {validateNodeOutput} from './nodeOutput.js';
import {createConfiguredModelProvider} from './configuredProvider.js';

import {withPointerCatalog,getPointerCatalog} from './nodeCatalog.js';
const fail=(code,status=422)=>{throw new KernelError(code,code,status);};
const safe=s=>typeof s==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(s);
const clone=x=>JSON.parse(JSON.stringify(x));
function contextSnapshot(snapshot,nodeIdScope){
  const view=clone(snapshot);let truncated=false;
  if(nodeIdScope){
    view.graph.nodes=view.graph.nodes.filter(n=>n.nodeId===nodeIdScope);
    view.graph.connections=[];
    view.definitions=view.definitions.filter(d=>view.graph.nodes.some(n=>n.definitionRef.definitionId===d.definitionId&&n.definitionRef.version===d.version));
    for(const node of view.graph.nodes)node.inputBindings={}; // Exact bindings live once in nodeContext.
  }
  for(const node of view.graph.nodes){
    const file=node.settings?.file;
    if(file?.textPreview?.length>1000){file.valueRef='file:'+node.nodeId;file.textAvailableChars=file.textPreview.length;file.textPreview=file.textPreview.slice(0,1000);file.textTruncated=true;truncated=true;}
    if(!nodeIdScope)for(const [port,value] of Object.entries(node.inputBindings||{})){
      const raw=JSON.stringify(value);
      if(Buffer.byteLength(raw,'utf8')>3000){node.inputBindings[port]={valueRef:'binding:'+node.nodeId+':'+port,preview:raw.slice(0,1000),truncated:true};truncated=true;}
    }
  }
  return {view,truncated};
}
function prepare({snapshot,requestRef,requestText,history=[],capabilities=[],nodeIdScope}){
  if(!safe(requestRef)||typeof requestText!=='string'||!requestText.trim()||requestText.length>2400||
    !snapshot?.graph||!safe(snapshot.graph.graphId)||!Array.isArray(snapshot.graph.nodes)||
    snapshot.graph.nodes.length>64||!Array.isArray(snapshot.graph.connections)||
    snapshot.graph.connections.length>128||!Array.isArray(snapshot.definitions)||
    snapshot.definitions.length>128||Buffer.byteLength(JSON.stringify(snapshot),'utf8')>262144)
    fail('INVALID_LOCAL_MODEL_REQUEST');
  snapshot=withPointerCatalog(snapshot);
  const repo=new MemoryGraphRepository();
  repo.restore('local',snapshot.graph.graphId,snapshot);
  const {view,truncated}=contextSnapshot(snapshot,nodeIdScope);
  const context={requestRef,objective:requestText,requestText,constraints:[],capabilities,
    outputContract:'ModelTurn',historyDigest:(Array.isArray(history)?history:[])
      .slice(-6).filter(x=>typeof x==='string').map(x=>x.slice(0,800)),
    materials:[{ref:'graph',kind:'graph_snapshot',source:'user_input',content:view,truncated}]};
  return {snapshot:clone(snapshot),context};
}
export function createLocalPointerHost({gateway,resolveModel,validation=createContractValidation(),
  composer=createPromptComposer({validation})}={}){
  if(typeof gateway?.complete!=='function'||typeof resolveModel!=='function')
    fail('LOCAL_MODEL_NOT_CONFIGURED',503);
  async function invoke({context,modules,nodeContext,extraContext,signal}){
    const {messages}=composer.assemble({moduleIds:modules,context,nodeContext,extraContext});
    const contract=localModelContract(nodeContext);
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
  async function turn({snapshot,requestRef,requestText,history,extraContext,signal}={}){
    const {context}=prepare({snapshot,requestRef,requestText,history,capabilities:getPointerCatalog().capabilities});
    const result=await invoke({context,modules:['layer.entry','layer.chat','layer.ir',
      'ir.define','ir.patch','ir.connect','layer.function','fn.extract','fn.reuse'],extraContext,signal});
    if(result.turn.outputs||result.turn.needs?.length&&result.turn.actions?.length)
      fail('UNSUPPORTED_LOCAL_MODEL_TURN');
    return result.turn;
  }
  async function node({snapshot,requestRef,requestText,nodeId,inputArtifacts=[],taskConstraints=[],signal}={}){
    snapshot=withPointerCatalog(snapshot||{});
    const requested=snapshot.graph?.nodes?.find(n=>n.nodeId===nodeId);
    const requestedDefinition=snapshot.definitions?.find(d=>d.definitionId===requested?.definitionRef?.definitionId&&d.version===requested?.definitionRef?.version);
    requestText=requestText?.trim()||requested?.settings?.request?.trim()||requestedDefinition?.purpose;
    const {context}=prepare({snapshot,requestRef,requestText,capabilities:['model_task'],nodeIdScope:nodeId});
    if(!Array.isArray(taskConstraints)||taskConstraints.length>64||taskConstraints.some(x=>typeof x!=='string'||!x.trim()||x.length>2400))fail('INVALID_TASK_CONSTRAINTS');
    context.constraints=taskConstraints;
    if(!safe(nodeId)||!Array.isArray(inputArtifacts)||inputArtifacts.length>48||
      Buffer.byteLength(JSON.stringify(inputArtifacts),'utf8')>60000)fail('INVALID_LOCAL_NODE_INPUT');
    const target=snapshot.graph.nodes.find(n=>n.nodeId===nodeId);
    if(!target)fail('LOCAL_NODE_NOT_FOUND',404);
    const definition=snapshot.definitions.find(d=>d.definitionId===target.definitionRef.definitionId&&
      d.version===target.definitionRef.version);
    if(!definition||definition.executorKind!=='model_task'||(definition.requiredCapabilities||[]).some(c=>!['model_task','branch.exclusive'].includes(c)))fail('LOCAL_EXECUTOR_UNAVAILABLE',501);
    const nodeContext={nodeId,purpose:definition.purpose,instruction:definition.instruction,
      instanceRequest:target.settings?.request||'',inputPorts:definition.inputs,outputPorts:definition.outputs,inputBindings:target.inputBindings||{},
      upstreamArtifacts:inputArtifacts.map(a=>({port:a.port,sourceNodeId:a.sourceNodeId,
        sourcePort:a.sourcePort,valueRef:a.valueRef,representation:a.representation,value:a.value}))};
    const result=await invoke({context,modules:['run.perform'],nodeContext:clone(nodeContext),signal});
    if(result.turn.needs?.length||result.turn.actions?.length||!result.turn.outputs)
      fail('LOCAL_NODE_OUTPUT_REQUIRED');
    const checked=await validateNodeOutput(definition,result.turn.outputs,{inputArtifacts});
    return {nodeId,status:result.turn.outputs.status==='blocked'?'blocked':'success',
      outputs:result.turn.outputs.status==='blocked'?result.turn.outputs:{status:'produced',
        values:Object.fromEntries(checked.map(x=>[x.port.name,{inline:x.value}]))},
      provenance:Object.fromEntries(Array.isArray(checked)?checked.map(x=>[x.port.name,x.sourceRefs]):[]),validatedPorts:checked.length||0};
  }
  async function response({snapshot,requestRef,requestText,actionResults=[],history=[],signal}={}){
    if(!Array.isArray(actionResults)||actionResults.length>32||
      Buffer.byteLength(JSON.stringify(actionResults),'utf8')>24000)
      fail('INVALID_LOCAL_RESPONSE_FACTS');
    const {context}=prepare({snapshot,requestRef,requestText,history,
      capabilities:[]});
    const result=await invoke({context,modules:['layer.response','response.present'],
      extraContext:{actionResults:clone(actionResults)},signal});
    const message=result.turn.message;
    if(typeof message!=='string'||!message.trim()||
      result.turn.actions?.length||result.turn.needs?.length||result.turn.outputs)
      fail('INVALID_LOCAL_RESPONSE');
    return {message};
  }
  return Object.freeze({turn,node,response});
}
export function createConfiguredLocalPointerHost({env=process.env,fetchImpl=fetch}={}){
  const selected=env.OVLL_POINTER_PROVIDER_ID||env.OVLL_VNEXT_PROVIDER_ID;
  const endpoint=env.OVLL_POINTER_MODEL_ENDPOINT||env.OVLL_VNEXT_MODEL_ENDPOINT;
  // Preserve the Groq default, but never override an explicit Gemini selection.
  const useGroqDefault=!endpoint&&(!selected||selected==='groq');
  const merged=useGroqDefault?{
    ...env,OVLL_POINTER_MODEL_ENDPOINT:'https://api.groq.com/openai/v1/chat/completions',
    OVLL_POINTER_MODEL_API_KEY:env.OVLL_POINTER_MODEL_API_KEY||env.GROQ_API_KEY,
    OVLL_POINTER_MODEL_ID:env.OVLL_POINTER_MODEL_ID||env.GROQ_MODEL||'openai/gpt-oss-120b',
    OVLL_POINTER_PROVIDER_ID:'groq'
  }:env;
  const {modelGateway,resolveModel}=createConfiguredModelProvider({env:merged,fetchImpl});
  return createLocalPointerHost({gateway:modelGateway,resolveModel});
}
