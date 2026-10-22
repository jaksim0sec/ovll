import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareRequestInput} from '../../front/js/workspace/requestInput.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
test('typed references resolve only their block and referenced metadata',()=>{
 const reader={readCanvasSnapshot:()=>({snapshot:{blocks:[{id:'b1',skillId:'research',x:1,y:2,expanded:true,values:{request:'abc'},file:{name:'x.txt',size:3,blob:new Blob(['abc'])}},{id:'b2',skillId:'write',values:{}}],links:[{id:'l1'}]}}),readSkillCatalog:()=>({definitions:[{id:'research',name:'조사하기'},{id:'write',name:'작성하기'}]})};
 const draft={parts:[{type:'text',text:'please'},{type:'block',id:'b1',label:'fake'},{type:'skill',id:'research',label:'fake'}],attachments:[{name:'a',file:new Blob(['hello']),size:5}]};
 const {request,initialResources}=prepareRequestInput({draft,dataAccess:reader});
 assert.deepEqual(request.parts,draft.parts);assert.ok(!('file' in request.attachments[0]));
 assert.equal(initialResources.length,2);assert.equal(initialResources[0].dataset,'canvasSkill');
 assert.equal(initialResources[0].value.skillId,'research');assert.ok(!('blob' in initialResources[0].value.file));
 assert.equal(initialResources[1].key,'조사하기');assert.equal(initialResources[1].completeness,'metadata');
 assert.ok(!JSON.stringify(initialResources).includes('b2'));
});
test('missing references are not fabricated',()=>{
 const dataAccess={readCanvasSnapshot:()=>({snapshot:{blocks:[]}}),readSkillCatalog:()=>({definitions:[]})};
 const r=prepareRequestInput({draft:{parts:[{type:'block',id:'unknown',label:'Fake'}],attachments:[]},dataAccess});
 assert.equal(r.initialResources[0].completeness,'missing');assert.equal(r.initialResources[0].value,null);
});
test('complete need data replaces presentation-only metadata',async()=>{
 const available=[{dataset:'canvasSkill',key:'b1',source:'local-view',completeness:'complete',value:{id:'b1'}},{dataset:'skillDef',key:'조사하기',source:'local-presentation-catalog',completeness:'metadata',value:{name:'조사하기'}}];
 const provider=createMemoryDataProvider({fixtures:{skillDef:{'조사하기':{source:'fixture',completeness:'complete',value:{name:'조사하기',instruction:'research'}}}}});
 const r=await provider.resolveNeed({need:[['canvasSkill',['b1']],['skillDef',['조사하기']]],availableResources:available});
 assert.equal(r.missing.length,0);assert.equal(r.resources.filter(x=>x.dataset==='canvasSkill').length,1);
 assert.equal(r.resources.find(x=>x.dataset==='skillDef').value.instruction,'research');
 const missing=await createMemoryDataProvider().resolveNeed({need:[['skillDef',['조사하기']]],availableResources:available});
 assert.equal(missing.missing.length,1);
 await assert.rejects(createMemoryDataProvider().resolveNeed({need:[['whatElse']],availableResources:[]}),e=>e.code==='UNSUPPORTED_DATASET');
});
