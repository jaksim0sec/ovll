import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as catalog from '../backend/ovllPointer/nodeCatalog.js';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {createPromptComposer} from '../backend/ovllPointer/promptComposer.js';
const empty={graph:{graphId:'g',revision:0,nodes:[],connections:[]},definitions:[]};
const load=name=>{const window={};vm.runInNewContext(readFileSync(new URL('../front/js/'+name+'.js',import.meta.url),'utf8'),{window});return window;};
test('canonical builtins share reusable definitions, existing icons and executable capabilities',()=>{
 assert.equal(typeof catalog.getPointerCatalog,'function');
 const c=catalog.getPointerCatalog();
 assert.ok(c.definitions.some(d=>d.definitionId==='builtin:write'));
 assert.ok(c.definitions.some(d=>d.requiredCapabilities.includes('artifact.create')));
 assert.equal(c.definitions.find(d=>d.definitionId==='builtin:research').presentation.iconKey,'globe');
 assert.ok(!c.capabilities.includes('web.search'));
});
test('empty graph turn exposes existing work before offering dynamic creation',async()=>{
 let call;
 const host=createLocalPointerHost({gateway:{complete:async x=>{call=x;return{text:'{"message":"가능해"}'};}},resolveModel:async()=>({providerId:'mock',model:'test'})});
 await host.turn({snapshot:empty,requestRef:'r',requestText:'보고서 써줘'});
 assert.match(call.messages.at(-1).content,/builtin:write/);
});
test('manual node uses its purpose and instance request; refs normalize to transferable values',async()=>{
 const definition={definitionId:'d',version:1,purpose:'Summarize',instruction:'Preserve evidence',executorKind:'model_task',inputs:[{name:'in',role:'source',representation:'text'}],outputs:[{name:'result',role:'summary',representation:'text'}]};
 const snapshot={...empty,definitions:[definition],graph:{...empty.graph,nodes:[{nodeId:'n',definitionRef:{definitionId:'d',version:1},settings:{request:'One paragraph'}}]}};
 let call;
 const host=createLocalPointerHost({gateway:{complete:async x=>{call=x;return{text:'{"outputs":{"status":"produced","values":{"result":{"ref":"v1"}}}}'};}},resolveModel:async()=>({providerId:'mock',model:'test'})});
 const result=await host.node({snapshot,requestRef:'r',requestText:'',nodeId:'n',inputArtifacts:[{port:'in',representation:'text',valueRef:'v1',value:'Full result'}]});
 assert.equal(result.outputs.values.result.inline,'Full result');
 assert.deepEqual(result.provenance.result,['v1']);
 assert.match(call.messages.at(-1).content,/One paragraph/);
});
test('canvas keeps existing visual identity and separates per-instance instructions',()=>{
 const d={definitionId:'builtin:write',version:1,purpose:'Write',instruction:'Write faithfully',inputs:[],outputs:[{name:'result',role:'result',representation:'text'}],presentation:{name:'작성하기',iconKey:'pen',color:'#D96F83'}};
 const snapshot={definitions:[d],graph:{...empty.graph,nodes:[{nodeId:'n',definitionRef:{definitionId:d.definitionId,version:1},settings:{request:'Five paragraphs'}}]}};
 const p=load('ovllPointerProjection').OvllPointerProjection.projectGraph(snapshot);
 assert.equal(p.workflow.nodes[0].type,'write');
 assert.equal(p.definitions.write.iconKey,'pen');
 assert.equal(p.workflow.nodes[0].params.request,'Five paragraphs');
 const patch=load('ovllPointerGraphPatch').OvllPointerGraphPatch.build(snapshot,{nodes:[{id:'n',type:'write',data:{params:{request:'Three paragraphs'}}}],connections:[]});
 assert.equal(patch.patch.definitions.length,0);
 assert.equal(patch.patch.operations[0].settings.request,'Three paragraphs');
});
test('review and language context does not receive node-only output instructions',()=>{
 const context={requestRef:'r',objective:'Review',requestText:'Review',constraints:[],capabilities:[],outputContract:'ModelTurn',materials:[]};
 const a=createPromptComposer().assemble({moduleIds:['layer.response'],context,extraContext:{actionResults:[{status:'failed'}]}});
 assert.match(a.messages.at(-1).content,/actionResults/);
 assert.doesNotMatch(a.messages[1].content,/containing only "outputs"/);
});
