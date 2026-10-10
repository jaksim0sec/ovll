import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createPromptComposer} from '../backend/ovllPointer/promptComposer.js';
import {createContractValidation} from '../backend/ovllPointer/validation.js';
import {canonicalTurnExample,toWireTurnExample,decodePhaseOutput} from '../backend/ovllPointer/modelContract.js';
const read=name=>readFileSync(new URL('../instructions/'+name,import.meta.url),'utf8');

test('entry differentiates chat, reuse, dynamic definition, edit-only and explicit execution',()=>{
 const entry=read('prompts/layers/entry.md');
 for(const term of ['Answer','Reuse','Define','Edit','Execute','new kind of node',
   'necessary internal structuring','explicit no-run','executionIntent:"requested"'])
   assert.ok(entry.includes(term),term);
 assert.doesNotMatch(entry,/Japanese vocabulary|일본어 단어장/);
});
test('definition guidance does not propose unsolicited graph structure',()=>{
 const d=read('prompts/micro/ir/define.md');
 assert.match(d,/builtin:write/);
 assert.match(d,/localDefinitionKey/);
 assert.doesNotMatch(d,/For an ordinary task without authorization for new workflow structure, propose/);
});
test('IR still distinguishes data flow, real file effects and atomic cosmetic edits',()=>{
 const x=read('prompts/layers/ir.md')+'\n'+read('prompts/micro/ir/patch.md');
 for(const term of ['multiple:false','file.read_local','artifact.create',
    'definition.appearance','definition.delete','runRef','ActionResults'])
    assert.ok(x.includes(term),term);
});
test('canonical action example still roundtrips wire and passes the frozen schema',()=>{
 const example=canonicalTurnExample();
 assert.deepEqual(decodePhaseOutput(toWireTurnExample(example),'turn'),example);
 assert.equal(createContractValidation().validateTurn(example),true);
});
test('composer preserves the full action repertoire without incident-specific cases',()=>{
 const registry=JSON.parse(read('registry.json'));
 assert.equal(registry.assemblyVersion,'0.4.0');
 const context={requestRef:'r1',objective:'Summarize notes',constraints:['Preserve sources'],
   capabilities:[],outputContract:'NodeOutput',requestText:'Summarize these notes',
   materials:[{ref:'source1',kind:'text',source:'user_input',content:'Actual source text',
     truncated:false,provenanceRefs:['user:r1']}]};
 const out=createPromptComposer().assemble({context,moduleIds:[
   'layer.entry','layer.chat','layer.ir','ir.define','ir.patch','ir.connect',
   'layer.function','fn.extract','fn.reuse']});
 for(const id of ['core','layer.entry','layer.ir','ir.define','layer.function','fn.reuse'])
    assert.ok(out.moduleIds.includes(id),id);
 const txt=out.messages.map(m=>m.content).join('\n');
 assert.match(txt,/dynamic/i);
 assert.match(txt,/new kind of node/);
 assert.doesNotMatch(txt,/Japanese vocabulary|일본어 단어장/);
});
