// Full pinned source snapshots; --inspect is offline, --allow-live is opt-in.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createConfiguredModelProvider} from '../backend/ovllPointer/configuredProvider.js';
import {PROMPT_EVAL_CASES,promptEvalSnapshot,promptEvalExtra,gradePromptEvalTurn} from '../backend/ovllPointer/promptEval.js';
import {withPromptEvalSnapshots} from './prompt-eval-snapshots.mjs';

const args=process.argv.slice(2),values=new Map(),switches=new Set();
for(let n=0;n<args.length;n++){
 const key=args[n];
 if(['--inspect','--allow-live'].includes(key)){
  if(switches.has(key))throw Error('INVALID_PROMPT_EVAL_ARGS');
  switches.add(key);
 }else if(['--baseline','--candidate','--cases','--samples','--repo'].includes(key)){
  if(values.has(key)||!args[n+1]||args[n+1].startsWith('--'))throw Error('INVALID_PROMPT_EVAL_ARGS');
  values.set(key,args[++n]);
 }else throw Error('INVALID_PROMPT_EVAL_ARGS');
}
const baseline=values.get('--baseline')||'2face8a',candidate=values.get('--candidate');
const ids=(values.get('--cases')||PROMPT_EVAL_CASES.map(c=>c.id).join(',')).split(',');
const samples=Number(values.get('--samples')||1),inspect=switches.has('--inspect');
// One initial completion + optional standby + one repair; each gateway call can
// use two adapter attempts, then two more on structured-schema rejection.
const maxHostCalls=3,maxTransportCalls=maxHostCalls*4;
if(!/^[a-f0-9]{7,40}$/.test(baseline)||candidate&&!/^[a-f0-9]{7,40}$/.test(candidate)||
 !Number.isInteger(samples)||samples<1||samples>10||!ids.length||new Set(ids).size!==ids.length||
 ids.some(id=>!PROMPT_EVAL_CASES.some(c=>c.id===id))||inspect&&switches.has('--allow-live'))
 throw Error('INVALID_PROMPT_EVAL_ARGS');
if(!inspect&&!switches.has('--allow-live')){
 console.log(JSON.stringify({dryRun:true,baseline,candidate:candidate||'HEAD',cases:ids,samples,
  maximumHostCalls:ids.length*samples*2*maxHostCalls,
  maximumPhysicalCalls:ids.length*samples*2*maxTransportCalls,
  note:'No provider calls made. Budgets include standby, one repair and adapter/schema retries; --inspect captures both formats offline.'},null,2));
 process.exit(0);
}
const repoRoot=resolve(values.get('--repo')||fileURLToPath(new URL('..',import.meta.url)));
const providerEnv={...process.env};
const config=inspect?{providerId:'inspection',model:'offline',maxOutputTokens:2048}:
 await createConfiguredModelProvider({env:providerEnv}).resolveModel();
const sha256=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const requestSummary=request=>({
 modelConfig:{providerId:request.providerId,model:request.model,maxOutputTokens:request.maxOutputTokens,output:request.output},
 messages:request.messages.map(m=>({role:m.role,bytes:Buffer.byteLength(m.content,'utf8'),sha256:sha256(m.content)})),
 schema:request.wireSchema?{name:request.wireSchema.name,sha256:sha256(request.wireSchema.schema)}:null,
 sha256:sha256({messages:request.messages,wireSchema:request.wireSchema??null,
  providerId:request.providerId,model:request.model,maxOutputTokens:request.maxOutputTokens})
});
const report=await withPromptEvalSnapshots({repoRoot,baseline,candidate},async variants=>{
 const requests=[],transportRequests=[],results=[];
 for(const id of ids)for(let sample=1;sample<=samples;sample++){
  const scenario=PROMPT_EVAL_CASES.find(c=>c.id===id);
  for(const mode of inspect?['canonical','wire']:['configured'])for(const variant of variants){
   let promptBytes=0,requestCalls=0,physicalCalls=0,output,meta=null,error=null;
   // A fresh gateway per sample/variant prevents schema/cooldown state crossing
   // the comparison. Capture the adapter's actual payload after any fallback.
   const configured=inspect?null:createConfiguredModelProvider({env:providerEnv,fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body),native=!!body.generationConfig;
    const schema=native?body.generationConfig.responseJsonSchema:body.response_format?.json_schema?.schema;
    const attempt={id,sample,variant:variant.name,hostAttempt:requestCalls,physicalAttempt:++physicalCalls,
     transport:native?'gemini-native':'openai-chat',
     mode:schema?'wire':native&&body.generationConfig.responseMimeType==='application/json'||body.response_format?.type==='json_object'?'json':'text',
     modelConfig:{...requests.at(-1).modelConfig},
     schema:schema?{sha256:sha256(schema)}:null,bytes:Buffer.byteLength(options.body,'utf8'),sha256:sha256(options.body)};
    transportRequests.push(attempt);
    try{const response=await fetch(url,options);attempt.status=response.status;return response;}
    catch(error){attempt.networkError=true;throw error;}
   }});
   const gateway={
    capabilities:provider=>inspect?{structuredOutput:mode==='wire'}:configured.modelGateway.capabilities(provider),
    complete:async request=>{
     if(requestCalls>=maxHostCalls){
      const error=Error('EVAL_CALL_LIMIT');error.code='EVAL_CALL_LIMIT';error.providerCalls=0;throw error;
     }
     requestCalls++;
     promptBytes+=Buffer.byteLength(JSON.stringify(request.messages),'utf8');
     requests.push({id,sample,variant:variant.name,hostAttempt:requestCalls,
      mode:request.wireSchema?'wire':'canonical',...requestSummary(request)});
     if(!inspect)return configured.modelGateway.complete(request);
     return {text:JSON.stringify(request.wireSchema?
      {executionIntent:null,message:'Offline request inspection.',actions:[],needs:[]}:
      {message:'Offline request inspection.'}),providerCalls:0};
    }
   };
   const host=variant.createLocalPointerHost({gateway,resolveModel:async()=>config});
   try{
    output=await host.turn({snapshot:promptEvalSnapshot(id),requestRef:'prompt_eval_'+id.replace(/-/g,'_')+'_'+sample,
     requestText:scenario.requestText,extraContext:promptEvalExtra(id)});
    meta=output._meta;
   }catch(e){error=e?.code||e?.message||'EVAL_ERROR';meta=e?._meta||null}
   if(inspect){if(error)throw Error('EVAL_INSPECTION_FAILED: '+error);continue;}
   const grade=error?{pass:false,reasons:[error],actionKinds:[]}:gradePromptEvalTurn(id,output);
   results.push({id,sample,variant:variant.name,pass:grade.pass,reasons:grade.reasons,actionKinds:grade.actionKinds,
    hostCalls:requestCalls,providerCalls:physicalCalls,reportedProviderCalls:meta?.providerCalls??null,
    repairs:meta?.repairCount??0,fallback:meta?.fallback??null,
    schemaFallbacks:meta?.calls?.filter(c=>c.schemaFallbackUsed).length??0,
    promptBytes,totalTokens:meta?.usage?.total_tokens??null});
  }
 }
 const refs={baselineRef:variants[0].sha,candidateRef:variants[1].sha};
 if(inspect)return {...refs,inspectionOnly:true,providerCalls:0,cases:ids,samples,requests,
  limitation:'Captured real host requests with an offline response. No model behavior, execution or result quality measured.'};
 const summary=variant=>{
  const list=results.filter(r=>r.variant===variant);
  return {passed:list.filter(r=>r.pass).length,total:list.length,
   providerCalls:list.reduce((n,r)=>n+r.providerCalls,0),repairs:list.reduce((n,r)=>n+r.repairs,0),
   promptBytes:list.reduce((n,r)=>n+r.promptBytes,0),totalTokens:list.every(r=>typeof r.totalTokens==='number')?
    list.reduce((n,r)=>n+r.totalTokens,0):null};
 };
 return {...refs,cases:ids,samples,budgets:{maximumHostCallsPerEvaluation:maxHostCalls,
  maximumPhysicalCallsPerEvaluation:maxTransportCalls,maximumRepairsPerEvaluation:1},
  baseline:summary('baseline'),candidate:summary('candidate'),results,requests,transportRequests,
  limitation:'Structural proposals only, NOT result quality or verified execution. Pinned hosts share dependency/configuration settings with independent cold gateways. requests are host projections; transportRequests are actual HTTP attempts after fallback.'};
});
console.log(JSON.stringify(report,null,2));
