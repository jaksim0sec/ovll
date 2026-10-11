import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const script=join(root,'scripts/eval-pointer-prompts.mjs');
const noKeys={...process.env,GEMINI_API_KEY:'',GROQ_API_KEY:'',
 OVLL_POINTER_MODEL_API_KEY:'',OVLL_VNEXT_MODEL_API_KEY:''};
test('snapshot inspection uses each pinned contract, schema and product policy in actual canonical and wire calls',()=>{
 const repo=mkdtempSync(join(tmpdir(),'ovll-eval-fixture-'));
 try{
  for(const path of ['backend','front','instructions','docs','package.json'])cpSync(join(root,path),join(repo,path),{recursive:true});
  symlinkSync(join(root,'node_modules'),join(repo,'node_modules'),'dir');
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','Prompt evaluation fixture');git('config','user.email','fixture@example.invalid');
  const contractPath=join(repo,'backend/ovllPointer/modelContract.js');
  const productPath=join(repo,'backend/ai/productInstructions.js');
  const contract=readFileSync(contractPath,'utf8'),product=readFileSync(productPath,'utf8');
  let baseline;
  for(const marker of ['before','after']){
   writeFileSync(contractPath,contract.replace('export function localModelContract(', 'function snapshotContract(')
    .replace("name:'ovll_'+phase",`name:'${marker}_ovll_'+phase`)+
    `\nexport function localModelContract(...args){return snapshotContract(...args)+'\\ncontract-${marker}';}\n`);
   writeFileSync(productPath,product.replace('= [','= [\n  "product-'+marker+'",'));
   git('add','backend','front','instructions','docs','package.json');git('commit','-m',marker);
   if(marker==='before')baseline=git('rev-parse','HEAD');
  }
  const candidate=git('rev-parse','HEAD');
  const run=spawnSync(process.execPath,[script,'--inspect','--repo',repo,
   '--baseline',baseline,'--candidate',candidate,'--cases','chat'],{encoding:'utf8',env:noKeys});
  assert.equal(run.status,0,run.stderr);
  const result=JSON.parse(run.stdout);
  assert.equal(result.inspectionOnly,true,'inspect assembles actual host calls without a live provider');
  assert.equal(result.providerCalls,0);
  assert.equal(result.baselineRef,baseline);assert.equal(result.candidateRef,candidate);
  assert.equal(result.requests.length,4);
  for(const mode of ['canonical','wire']){
   const before=result.requests.find(r=>r.variant==='baseline'&&r.mode===mode);
   const after=result.requests.find(r=>r.variant==='candidate'&&r.mode===mode);
   assert.notEqual(before.messages[0].sha256,after.messages[0].sha256,'product policy comes from its snapshot');
   assert.notEqual(before.messages[1].sha256,after.messages[1].sha256,'output contract comes from its snapshot');
   assert.equal(before.messages.find(m=>m.role==='user').sha256,after.messages.find(m=>m.role==='user').sha256,'same scenario and request identity');
   assert.deepEqual(before.modelConfig,after.modelConfig);
   if(mode==='wire'){
    assert.equal(before.schema.name,'before_ovll_turn');assert.equal(after.schema.name,'after_ovll_turn');
   }else assert.equal(before.schema,null);
  }
 }finally{rmSync(repo,{recursive:true,force:true});}
});
test('inspection rejects combining offline mode with live authorization',()=>{
 const run=spawnSync(process.execPath,[script,'--inspect','--allow-live'],{encoding:'utf8',env:noKeys});
 assert.notEqual(run.status,0);
 assert.match(run.stderr,/INVALID_PROMPT_EVAL_ARGS/);
});
