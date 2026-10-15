import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as catalog from '../backend/ovllPointer/skillCatalog.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createPromptComposer} from '../backend/ovllPointer/promptComposer.js';
const empty={graph:{graphId:'g',revision:0,skillNodes:[],connections:[]},skillDefinitions:[]};
const load=name=>{const window={};vm.runInNewContext(readFileSync(new URL('../front/js/'+name+'.js',import.meta.url),'utf8'),{window});return window;};
test('canonical builtins share reusable skillDefinitions, existing icons and executable capabilities',()=>{
 assert.equal(typeof catalog.getPointerCatalog,'function');
 const c=catalog.getPointerCatalog();
 assert.ok(c.skillDefinitions.some(d=>d.definitionId==='builtin:write'));
 assert.ok(c.skillDefinitions.some(d=>d.requiredCapabilities.includes('artifact.create')));
 assert.equal(c.skillDefinitions.find(d=>d.definitionId==='builtin:research').presentation.iconKey,'globe');
 assert.ok(!c.capabilities.includes('web.search'));
});
test('empty graph turn exposes existing work before offering dynamic creation',async()=>{
 let call;
 const host=createLocalPointerHost({gateway:{complete:async x=>{call=x;return{text:'{"message":"가능해"}'};}},resolveModel:async()=>({providerId:'mock',model:'test'})});
 await host.turn({snapshot:empty,requestRef:'r',requestText:'보고서 써줘'});
 assert.match(call.messages.at(-1).content,/builtin:write/);
});
test('manual skillNode uses its purpose and instance request; refs normalize to transferable values',async()=>{
 const definition={definitionId:'d',version:1,purpose:'Summarize',instruction:'Preserve evidence',executorKind:'model_task',inputs:[{name:'in',role:'source',representation:'text'}],outputs:[{name:'result',role:'summary',representation:'text'}]};
 const snapshot={...empty,skillDefinitions:[definition],graph:{...empty.graph,skillNodes:[{skillNodeId:'n',skillDefinitionRef:{definitionId:'d',version:1},settings:{request:'One paragraph'}}]}};
 let call;
 const host=createLocalPointerHost({gateway:{complete:async x=>{call=x;return{text:'{"outputs":{"status":"produced","values":{"result":{"ref":"v1"}}}}'};}},resolveModel:async()=>({providerId:'mock',model:'test'})});
 const result=await host.skillNode({snapshot,requestRef:'r',requestText:'',skillNodeId:'n',inputArtifacts:[{port:'in',representation:'text',valueRef:'v1',value:'Full result'}]});
 assert.equal(result.outputs.values.result.inline,'Full result');
 assert.deepEqual(result.provenance.result,['v1']);
 assert.match(call.messages.at(-1).content,/One paragraph/);
});
test('canvas keeps existing visual identity and separates per-instance instructions',()=>{
 const d={definitionId:'builtin:write',version:1,purpose:'Write',instruction:'Write faithfully',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}],presentation:{name:'작성하기',iconKey:'pen',color:'#D96F83'}};
 const snapshot={skillDefinitions:[d],graph:{...empty.graph,skillNodes:[{skillNodeId:'n',skillDefinitionRef:{definitionId:d.definitionId,version:1},settings:{request:'Five paragraphs'}}]}};
 const p=load('ovllPointerProjection').OvllPointerProjection.projectGraph(snapshot);
 assert.equal(p.workflow.skillNodes[0].type,'write');
 assert.equal(p.skillDefinitions.write.iconKey,'pen');
 assert.equal(p.workflow.skillNodes[0].params.request,'Five paragraphs');
 const patch=load('ovllPointerGraphPatch').OvllPointerGraphPatch.build(snapshot,{skillNodes:[{id:'n',type:'write',data:{params:{request:'Three paragraphs'}}}],connections:[]});
 assert.equal(patch.patch.skillDefinitions.length,0);
 assert.equal(patch.patch.operations[0].settings.request,'Three paragraphs');
});
test('review and language context does not receive skillNode-only output instructions',()=>{
 const context={requestRef:'r',objective:'Review',requestText:'Review',constraints:[],capabilities:[],outputContract:'ModelTurn',materials:[]};
 const a=createPromptComposer().assemble({moduleIds:['layer.response'],context,extraContext:{actionResults:[{status:'failed'}]}});
 assert.match(a.messages.at(-1).content,/actionResults/);
 assert.doesNotMatch(a.messages[1].content,/containing only "outputs"/);
});
