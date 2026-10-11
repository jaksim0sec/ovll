import {mkdirSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

export async function withPromptEvalSnapshots({repoRoot,baseline,candidate},evaluate){
 const workspace=mkdtempSync(join(tmpdir(),'ovll-prompt-eval-'));
 try{
  const variants=[];
  for(const [name,ref] of [['baseline',baseline],['candidate',candidate||'HEAD']]){
   const sha=execFileSync('git',['rev-parse','--verify',ref+'^{commit}'],{cwd:repoRoot,encoding:'utf8'}).trim();
   const archive=execFileSync('git',['archive','--format=tar',sha],{cwd:repoRoot,maxBuffer:32*1024*1024});
   const directory=join(workspace,name);mkdirSync(directory);
   execFileSync('tar',['-x','-C',directory],{input:archive});
   symlinkSync(join(repoRoot,'node_modules'),join(directory,'node_modules'),'dir');
   const {createLocalPointerHost}=await import(pathToFileURL(join(directory,'backend/ovllPointer/localHost.js')).href);
   variants.push({name,sha,createLocalPointerHost});
  }
  return await evaluate(variants);
 }finally{rmSync(workspace,{recursive:true,force:true});}
}
