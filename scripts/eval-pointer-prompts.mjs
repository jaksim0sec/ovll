// Opt-in, local-git baseline against the current planner. No API use without --allow-live.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createPromptComposer} from '../backend/ovllPointer/promptComposer.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createConfiguredModelProvider} from '../backend/ovllPointer/configuredProvider.js';
import {PROMPT_EVAL_CASES,promptEvalSnapshot,promptEvalExtra,gradePromptEvalTurn} from '../backend/ovllPointer/promptEval.js';
const args=process.argv.slice(2);
const flag=k=>{const n=args.indexOf(k);return n<0?null:args[n+1]};
const baseline=flag('--baseline')||'4d79cc7';
const ids=(flag('--cases')||'chat,new-kind,compose-run').split(',');
if(!/^[a-f0-9]{7,40}$/.test(baseline)||!ids.length||new Set(ids).size!==ids.length||
 ids.some(id=>!PROMPT_EVAL_CASES.some(c=>c.id===id)))throw Error('INVALID_PROMPT_EVAL_ARGS');
if(!args.includes('--allow-live')){
 console.log(JSON.stringify({dryRun:true,baseline,cases:ids,maximumHostCalls:ids.length*4,
  note:'No provider calls made. Transport fallbacks may add requests if enabled.'},null,2));
 process.exit(0);
}
const readOld=path=>execFileSync('git',['show',baseline+':instructions/'+path],{
 cwd:new URL('..',import.meta.url),encoding:'utf8',maxBuffer:65536}).trim();
const registry=JSON.parse(readFileSync(new URL('../instructions/registry.json',import.meta.url),'utf8'));
const prevRegistry=JSON.parse(readOld('registry.json'));
const prevPaths=new Map(prevRegistry.modules.map(m=>[m.id,m.path]));
const currentCore=readFileSync(new URL('../instructions/prompts/core.md',import.meta.url),'utf8').trim();
const current=createPromptComposer();
const baselineComposer={assemble:opts=>{
 const assembled=current.assemble(opts),messages=assembled.messages.map(m=>({...m}));
 if(!messages[0].content.startsWith(currentCore)||messages[1]?.role!=='developer')
  throw Error('INCOMPARABLE_ASSEMBLY');
 messages[0].content=readOld(prevPaths.get('core'))+messages[0].content.slice(currentCore.length);
 messages[1].content=assembled.moduleIds.filter(id=>id!=='core').map(id=>{
  if(!prevPaths.has(id)||!registry.modules.some(m=>m.id===id))throw Error('MISSING_BASELINE_MODULE');
  return readOld(prevPaths.get(id));
 }).join('\n\n');
 return {...assembled,messages};
}};
const configured=createConfiguredModelProvider();
const results=[];
for(const id of ids){
 const scenario=PROMPT_EVAL_CASES.find(x=>x.id===id);
 for(const [variant,composer] of [['baseline',baselineComposer],['candidate',current]]){
  let promptBytes=0,requestCalls=0,output,meta=null,error=null;
  const gateway={
   capabilities:provider=>configured.modelGateway.capabilities(provider),
   complete:async request=>{
    if(++requestCalls>2)throw Error('EVAL_CALL_LIMIT');
    promptBytes+=Buffer.byteLength(JSON.stringify(request.messages),'utf8');
    return configured.modelGateway.complete(request);
   }
  };
  const host=createLocalPointerHost({gateway,resolveModel:configured.resolveModel,composer});
  try{
   output=await host.turn({snapshot:promptEvalSnapshot(id),requestRef:'prompt_eval_'+variant+'_'+id.replace(/-/g,'_'),
    requestText:scenario.requestText,extraContext:promptEvalExtra(id)});
   meta=output._meta;
  }catch(e){error=e?.code||'EVAL_ERROR';meta=e?._meta||null}
  const grade=error?{pass:false,reasons:[error],actionKinds:[]}:gradePromptEvalTurn(id,output);
  results.push({id,variant,pass:grade.pass,reasons:grade.reasons,actionKinds:grade.actionKinds,
   providerCalls:meta?.providerCalls??requestCalls,repairs:meta?.repairCount??0,
   promptBytes,totalTokens:meta?.usage?.total_tokens??null});
 }
}
const summary=variant=>{
 const list=results.filter(x=>x.variant===variant);
 return {passed:list.filter(x=>x.pass).length,total:list.length,
  providerCalls:list.reduce((n,x)=>n+x.providerCalls,0),
  repairs:list.reduce((n,x)=>n+x.repairs,0),
  promptBytes:list.reduce((n,x)=>n+x.promptBytes,0),
  totalTokens:list.every(x=>typeof x.totalTokens==='number')?
   list.reduce((n,x)=>n+x.totalTokens,0):null};
};
console.log(JSON.stringify({baselineRef:baseline,baseline:summary('baseline'),
 candidate:summary('candidate'),results,limitation:'One sample per scenario; structural proposals only, NOT result quality or verified execution.'},null,2));
