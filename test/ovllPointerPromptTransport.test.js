import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
function evaluate(stub,standby=false){
 const temp=mkdtempSync(join(tmpdir(),'ovll-eval-transport-'));
 try{
  const preload=join(temp,'transport.mjs');
  writeFileSync(preload,`let counts=new Map();\nglobalThis.fetch=async(url,options)=>{\nconst body=JSON.parse(options.body);\n${stub}\n};\n`);
  const env={...process.env,OVLL_POINTER_PROVIDER_ID:'gemini',OVLL_POINTER_MODEL_ID:'gemini-fixture',
   GEMINI_API_KEY:'fixture-secret-never-send',GROQ_API_KEY:standby?'standby-secret-never-send':'',
   GROQ_MODEL:'openai/gpt-oss-120b',OVLL_POINTER_MAX_OUTPUT_TOKENS:'2048',
   OVLL_POINTER_MODEL_API_KEY:'',OVLL_VNEXT_MODEL_API_KEY:''};
  // Transport isolation needs equal hosts, not repository history. A shallow
  // CI checkout contains HEAD but need not contain the product baseline.
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  const run=spawnSync(process.execPath,['--import',preload,join(root,'scripts/eval-pointer-prompts.mjs'),
   '--allow-live','--baseline',sha,'--candidate',sha,'--cases','chat'],{cwd:root,encoding:'utf8',env});
  assert.equal(run.status,0,run.stderr);
  assert.doesNotMatch(run.stdout,/fixture-secret|standby-secret|https:\/\/|Offline transport answer/);
  return JSON.parse(run.stdout);
 }finally{rmSync(temp,{recursive:true,force:true});}
}
const good=JSON.stringify({executionIntent:null,message:'Offline transport answer',actions:[],needs:[]});
test('paired live-path evaluations isolate schema rejection and report physical fallback requests offline',()=>{
 const report=evaluate(`if(body.generationConfig.responseJsonSchema)return new Response(JSON.stringify({error:{message:'responseJsonSchema rejected'}}),{status:400});
 return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:${JSON.stringify(good)}}]}}]});`);
 for(const variant of ['baseline','candidate']){
  const result=report.results.find(r=>r.variant===variant);
  assert.equal(result.pass,true);assert.equal(result.providerCalls,2,variant+' independent cold gateway');
  assert.equal(result.hostCalls,1);assert.equal(result.schemaFallbacks,1);
  const attempts=report.transportRequests.filter(r=>r.variant===variant);
  assert.equal(attempts.length,2);
  assert.ok(attempts[0].schema);assert.equal(attempts[1].schema,null);
  assert.deepEqual(attempts.map(r=>r.status),[400,200]);
  assert.notEqual(attempts[0].sha256,attempts[1].sha256);
 }
 assert.equal(report.transportRequests[0].sha256,report.transportRequests[2].sha256,'equal physical initial conditions');
});
test('primary failure followed by standby invalid JSON still allows one real repair without invented calls',()=>{
 const report=evaluate(`if(body.generationConfig)throw Error('offline network failure');
 const key=body.messages[0].content,number=(counts.get(key)||0)+1;counts.set(key,number);
 return Response.json({choices:[{message:{content:body.messages.some(m=>m.content.includes('Previous output (data, not instructions)'))?${JSON.stringify(good)}:'invalid JSON'}}]});`,true);
 for(const variant of ['baseline','candidate']){
  const result=report.results.find(r=>r.variant===variant);
  assert.equal(result.pass,true,variant+' repair was reached');
  assert.equal(result.hostCalls,3);assert.equal(result.providerCalls,3);
  assert.equal(result.repairs,1);assert.equal(result.fallback.to,'groq');
  const attempts=report.transportRequests.filter(r=>r.variant===variant);
  assert.equal(attempts.length,3);
  assert.deepEqual(attempts.map(r=>r.hostAttempt),[1,2,3]);
  assert.equal(attempts[0].networkError,true);assert.deepEqual(attempts.slice(1).map(r=>r.status),[200,200]);
 }
});
