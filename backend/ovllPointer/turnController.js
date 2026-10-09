import { KernelError } from './graph.js';
import { createContractValidation } from './validation.js';

const fail=(code,status=422)=>{throw new KernelError(code,code,status);};
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(value);

// Controller knows only the model gateway contract, never a vendor's wire format.
// prepareContext, resolveModel and fulfillNeeds are trusted host functions.
export function createTurnController({store,composer,gateway,prepareContext,resolveModel,
  fulfillNeeds,selectModules,validation=createContractValidation(),maxModelTurns=3,
  maxRequestMs=60000,languageAfterActions=false,refineProposals=true,onUsage}={}) {
  if(typeof store?.assertEditor!=='function'||typeof store?.recordControllerEvent!=='function'||
    typeof store?.submit!=='function'||typeof composer?.assemble!=='function'||
    typeof gateway?.complete!=='function'||typeof prepareContext!=='function'||
    typeof resolveModel!=='function')fail('CONTROLLER_DEPENDENCIES_REQUIRED',500);
  if(!Number.isInteger(maxModelTurns)||maxModelTurns<1||maxModelTurns>6||
    !Number.isInteger(maxRequestMs)||maxRequestMs<1000||maxRequestMs>300000)fail('CONTROLLER_BUDGET_INVALID');
  async function run({scope,requestRef,requestText,taskRef,graphId,signal}={}) {
    if(!safeId(requestRef)||typeof requestText!=='string'||!requestText.trim()||
      requestText.length>2400||taskRef!==undefined&&!safeId(taskRef)||
      graphId!==undefined&&!safeId(graphId))fail('INVALID_CONTROLLER_REQUEST');
    await store.assertEditor(scope);
    const deadline=AbortSignal.timeout(maxRequestMs);
    const bound=signal?AbortSignal.any([deadline,signal]):deadline;
    const trusted={...scope,requestRef,...(taskRef?{taskRef}:{}),...(graphId?{graphId}:{})};
    let phase='entry',turn=null,context=null,modelCalls=0;
    const progress=(state,data={})=>store.recordControllerEvent(scope,{
      requestRef,state,...data
    });
    const invoke=async(modules,nodeContext)=>{
      if(bound.aborted)fail('CONTROLLER_ABORTED',499);
      const selected=typeof selectModules==='function'?
        await selectModules({scope:trusted,phase,context,defaultModules:modules}):modules;
      const prompt=composer.assemble({moduleIds:selected,context,...(nodeContext?{extraContext:nodeContext}:{})});
      const config=await resolveModel({scope:trusted,phase,context});
      if(!config||typeof config.providerId!=='string'||!config.providerId||
        typeof config.model!=='string'||!config.model||
        config.output!==undefined&&!['json','text'].includes(config.output))fail('INVALID_MODEL_CONFIGURATION');
      modelCalls++;
      await progress('model_requested',{phase,modelCall:modelCalls,modules:prompt.moduleIds});
      const result=await gateway.complete({providerId:config.providerId,model:config.model,
        output:config.output||'json',messages:prompt.messages,signal:bound,
        maxOutputTokens:config.maxOutputTokens??1500});
      if(typeof onUsage==='function')try{
        await onUsage({scope:trusted,phase,usage:result.usage,providerId:result.providerId,
          model:result.model,providerRequestId:result.providerRequestId});
      }catch{/* Untrusted telemetry cannot certify execution. */}
      let value;
      try{value=JSON.parse(result.text);}catch{fail('MODEL_INVALID_JSON');}
      if(!validation.validateTurn(value))fail('INVALID_MODEL_TURN');
      return value;
    };
    try {
      await progress('started');
      context=await prepareContext({scope:trusted,requestText,signal:bound});
      function checkContext(next) {
        if(!validation.validate('ContextBundle',next)||next.requestRef!==requestRef||
          next.requestText!==requestText||
          (taskRef&&next.taskRef!==taskRef))fail('INVALID_CONTEXT_BUNDLE');
      }
      checkContext(context);
      for(let step=0;step<maxModelTurns;step++){
        phase=step===0?'entry':'context';
        turn=await invoke(step===0?['layer.entry']:['layer.entry','shared.context-read']);
        if(!turn.needs?.length)break;
        await progress('context_requested',{count:turn.needs.length});
        if(typeof fulfillNeeds!=='function'||step===maxModelTurns-1)break;
        const updated=await fulfillNeeds({scope:trusted,context,needs:turn.needs,signal:bound});
        checkContext(updated);
        context=updated;
      }
      if(!turn?.needs?.length&&turn?.actions?.length&&refineProposals&&modelCalls<maxModelTurns){
        const modules=new Set();
        for(const action of turn.actions){
          if(action.kind==='ir.applyPatch'){
            modules.add('layer.ir');
            if(action.args?.patch?.definitions?.length)modules.add('ir.define');
            modules.add('ir.patch');
            if(action.args?.patch?.operations?.some(o=>o.op?.startsWith('link.')))modules.add('ir.connect');
          }
          if(action.kind==='function.save'){modules.add('layer.function');modules.add('fn.extract');}
          if(action.kind==='question.ask'){modules.add('layer.chat');modules.add('chat.clarify');}
        }
        if(modules.size){
          phase='refine';
          turn=await invoke([...modules],{previousProposal:turn});
        }
      }
      if(turn?.needs?.length) {
        await progress('needs_pending',{count:turn.needs.length});
        return {requestRef,message:turn.message||'',needs:turn.needs,results:[],modelCalls};
      }
      if(turn?.outputs)fail('UNEXPECTED_NODE_OUTPUT');
      const applied=await store.submit(turn,trusted);
      if(applied.results.some(r=>r.status==='rejected'))await progress('actions_rejected',{
        rejected:applied.results.filter(r=>r.status==='rejected').length});
      else if(applied.results.length)await progress('actions_settled',{count:applied.results.length});
      // An uncommitted action proposal cannot certify success to the user.
      let message=turn.actions?.length?'':turn.message||'';
      if(!message&&applied.results.length&&languageAfterActions&&modelCalls<maxModelTurns){
        phase='response';
        try {
          const summary=await invoke(['layer.response','response.present'],{actionResults:applied.results});
          if(summary.message&&!summary.actions&&!summary.needs&&!summary.outputs)message=summary.message;
        }catch{/* Action results remain authoritative if optional wording fails. */}
      }
      await progress('responded',{hasMessage:!!message,actions:applied.results.length});
      return {requestRef,message,needs:[],results:applied.results,modelCalls};
    } catch(error) {
      try{await progress('failed',{code:error.code||'MODEL_REQUEST_FAILED'});}catch{}
      throw error;
    }
  }
  return Object.freeze({run});
}
