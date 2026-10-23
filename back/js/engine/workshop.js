/** Model-neutral Workshop decision boundary. No side effects until verified executor is called. */
export function createWorkshopExecutor({modelCaller,composer,assets}={}){
 if(!modelCaller?.generate||!composer?.compose||!assets?.apply||!assets?.read)throw new TypeError('Workshop dependencies required');
 const groups=Object.freeze({
   skillDefine:['defineDirect','revise'],skillEdit:['editAppearance','delete'],
   canvasEdit:['addBlock','editBlock','deleteBlock','addLink','removeLink'],
   textGenerate:['basicText','question']
 });
 const invalid=(code='ENGINE_OUTPUT_INVALID',detail='')=>Object.assign(new Error(code),{code,...(detail?{detail}: {})});
 function check(candidate,workshop){
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate))throw invalid();
  if(Object.keys(candidate).length===1&&candidate.done===true)return {done:true};
  if(Object.keys(candidate).length!==2||typeof candidate.action!=='string'||!candidate.args||typeof candidate.args!=='object'||Array.isArray(candidate.args))throw invalid();
  if(!groups[workshop]?.includes(candidate.action))throw invalid('UNSUPPORTED_ACTION','Workshop '+workshop+' rejected action '+candidate.action.slice(0,80)+'; allowed: '+groups[workshop].join(', '));
  if(workshop==='textGenerate'&&(typeof candidate.args.text!=='string'||!candidate.args.text.trim()||candidate.args.text.length>8000))throw invalid();
  return structuredClone(candidate);
 }
 async function decide({workshop,objective,scope,request,contextBlock,resources=[],verifiedResults=[],focus='',answer=null}={}){
  if(!groups[workshop]||typeof objective!=='string'||!objective.trim())throw invalid('UNSUPPORTED_ACTION');
  const prompt=await composer.compose('workshop',{languageSettings:'',interfaceSyntax:''});
  const context={
   workshop,objective,availableActions:groups[workshop],userRequest:request,contextBlock:{...contextBlock,focus},
   resources,verifiedResults,answer,assets:assets.read({scope})
  };
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
   const result=await modelCaller.generate({layer:'workshop',prompt,format:'json',context});
   let parsed;
   try{parsed=JSON.parse(result.jsonText);}
   catch{lastError=invalid('ENGINE_OUTPUT_INVALID','Workshop '+workshop+' returned malformed JSON');}
   if(parsed!==undefined){
    try{return check(parsed,workshop);}
    catch(error){
     if(!['UNSUPPORTED_ACTION','ENGINE_OUTPUT_INVALID'].includes(error?.code))throw error;
     lastError=error;
    }
   }
   if(attempt===0){
    // The invalid proposal is diagnostic context, NEVER an execution authorization.
    context.invalidAction={...(parsed&&typeof parsed==='object'?{action:typeof parsed.action==='string'?parsed.action.slice(0,80):'invalid shape'}:{action:'invalid JSON'}),error:lastError?.detail??lastError?.code};
    context.correction='Your last action was invalid. Choose ONLY one of availableActions, with the exact argument schema; or return done:true only after this step has a verified applied result. No invented action names.';
    context.assets=assets.read({scope});
   }
  }
  throw lastError??invalid();
 }
 function apply({scope,requestId,operationId,action,args,expectedRevision}){
  if(!Object.values(groups).some(a=>a.includes(action))||action==='basicText'||action==='question')throw invalid('UNSUPPORTED_ACTION');
  return assets.apply({scope,requestId,operationId,action,args,expectedRevision});
 }
 return Object.freeze({decide,apply,read:({scope})=>assets.read({scope})});
}