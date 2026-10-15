import { KernelError } from './graph.js';
import { createContractValidation } from './validation.js';
import { validateSkillNodeOutput } from './skillOutput.js';

const fail=code=>{throw new KernelError(code,code,422);};

// Only the host decides actual context, model and provider; skillNode skillDefinitions cannot gain tools or credentials.
export function createModelSkillNodeExecutor({gateway,composer,loadContext,resolveModel,
  validation=createContractValidation(),onUsage}={}) {
  if(typeof gateway?.complete!=='function'||typeof composer?.assemble!=='function'||
    typeof loadContext!=='function'||typeof resolveModel!=='function')fail('MODEL_SKILL_NODE_DEPENDENCIES_REQUIRED');
  return async ({job,skillNode,definition,inputBindings={},inputArtifacts=[],signal})=>{
    if(definition?.executorKind!=='model_task')fail('MODEL_SKILL_NODE_KIND_REQUIRED');
    const context=await loadContext({job,skillNode,definition,signal});
    if(!validation.validate('ContextBundle',context))fail('INVALID_CONTEXT_BUNDLE');
    const config=await resolveModel({job,skillNode,definition});
    if(!config||typeof config.providerId!=='string'||!config.providerId||
      typeof config.model!=='string'||!config.model||
      (config.output!==undefined&&!['json','text'].includes(config.output)))fail('INVALID_MODEL_CONFIGURATION');
    const prompt=composer.assemble({moduleIds:['run.perform'],context,skillNodeContext:{
      skillNodeId:skillNode.skillNodeId,purpose:definition.purpose,instruction:definition.instruction,
      inputPorts:definition.inputs,outputPorts:definition.outputs,inputBindings,
      upstreamArtifacts:inputArtifacts.map(a=>({port:a.port,sourceSkillNodeId:a.sourceSkillNodeId,
        sourcePort:a.sourcePort,valueRef:a.valueRef,representation:a.representation,value:a.value}))
    }});
    const result=await gateway.complete({providerId:config.providerId,model:config.model,
      output:config.output||'json',maxOutputTokens:config.maxOutputTokens,
      messages:prompt.messages,signal});
    if(typeof onUsage==='function')try{
      await onUsage({runRef:job.runRef,skillNodeId:skillNode.skillNodeId,usage:result.usage,
        providerId:result.providerId,model:result.model,providerRequestId:result.providerRequestId,
        assemblyVersion:prompt.assemblyVersion,moduleIds:prompt.moduleIds});
    }catch{/* Usage callback is not execution evidence. */}
    let turn;
    try{turn=JSON.parse(result.text);}catch{fail('MODEL_INVALID_JSON');}
    if(!validation.validateTurn(turn))fail('INVALID_MODEL_TURN');
    if(turn.needs?.length)return {status:'blocked',reason:'Additional authorized context is required'};
    if(turn.actions?.length||!turn.outputs)fail('MODEL_SKILL_NODE_OUTPUT_REQUIRED');
    await validateSkillNodeOutput(definition,turn.outputs,{inputArtifacts});
    return turn.outputs;
  };
}
