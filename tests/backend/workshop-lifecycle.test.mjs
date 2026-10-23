import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestEngine} from '../../back/js/engine/engine.js';
import {createWorkshopExecutor} from '../../back/js/engine/workshop.js';
import {createMemoryAssets} from '../../back/js/engine/memoryAssets.js';
import {createMemoryCheckpoints} from '../../back/js/engine/checkpoints.js';
import {createMemoryDataProvider} from '../../back/js/engine/dataProvider.js';
const ctx={overallFlow:'',currentTopic:'',details:''};
const request={roomId:'r',requestId:'req',request:{parts:[{type:'text',text:'Make a Skill'}],attachments:[]},contextData:ctx,initialResources:[],chatHistory:[]};
const definition={name:'Writer',description:'Create text',instruction:'Use clear language',inputs:[],outputs:[{id:'out',type:'any',multiple:true}],fields:[],icon:'pen',color:'#ff0000'};
const plan={plan:[{skillDefine:{objective:'Define Writer',need:[]}},{terminate:{objective:'Finish',need:[]}}],contextBlock:{intent:'Create Writer',progress:'pending'}};
const output={languageBlock:'Writer Skill saved',contextBlock:{intent:'Create Writer',progress:'completed'},contextData:{overallFlow:'created Writer',currentTopic:'Skills',details:''}};
const toJson=x=>({jsonText:JSON.stringify(x)});
test('planned Skill executes then Output confirms verified assets',async()=>{
 const assets=createMemoryAssets({createId:()=> 'writer-1'}),seen=[];
 const modelCaller={generate:async ({layer,context})=>{
  seen.push(layer);
  if(layer==='gate')return toJson({need:[]});
  if(layer==='hallwayInitial')return toJson(plan);
  if(layer==='workshop')return toJson(context.verifiedResults.length?{done:true}:{action:'defineDirect',args:{definition}});
  if(layer==='output')return toJson(output);
  throw new Error('Unexpected layer '+layer);
 }};
 const composer={compose:async layer=>'prompt:'+layer};
 const e=createRequestEngine({composer,modelCaller,dataProvider:createMemoryDataProvider({assets}),workshopExecutor:createWorkshopExecutor({modelCaller,composer,assets}),checkpoints:createMemoryCheckpoints()});
 const got=await e.run(request);
 assert.equal(got.status,'completed');assert.equal(got.currentLayer,'output');
 assert.equal(assets.read({scope:'r'}).skills.length,1);
 assert.ok(seen.includes('workshop'));assert.ok(seen.includes('output'));
 assert.equal(got.result.languageBlock,'Writer Skill saved');
});
test('question suspends request and resumes exact same request without duplicate side effects',async()=>{
 let asked=false;const modelCaller={generate:async ({layer,context})=>{
  if(layer==='gate')return toJson({need:[]});
  if(layer==='hallwayInitial')return toJson({plan:[{textGenerate:{objective:'Ask for favorite subject',need:[]}},{terminate:{objective:'done',need:[]}}],contextBlock:{intent:'ask subject',progress:'waiting'}});
  if(layer==='workshop'){if(!asked){asked=true;return toJson({action:'question',args:{text:'Which subject?'}});}return toJson({done:true});}
  if(layer==='output')return toJson(output);
 }};
 const composer={compose:async x=>x},assets=createMemoryAssets(),checkpoints=createMemoryCheckpoints();
 const e=createRequestEngine({composer,modelCaller,dataProvider:createMemoryDataProvider(),workshopExecutor:createWorkshopExecutor({modelCaller,composer,assets}),checkpoints});
 const first=await e.run(request);assert.equal(first.status,'awaiting_input');
 assert.match(first.waiting.text,/Which subject/);
 const second=await e.resume(request,{waitingId:first.waiting.id,text:'Chemistry'});
 assert.equal(second.status,'completed');
 await assert.rejects(e.resume(request,{waitingId:first.waiting.id,text:'again'}),/waiting|resume|already|state/i);
});
test('IR actions never mutate existing assets',async()=>{
 const assets=createMemoryAssets();
 const modelCaller={generate:async ({layer})=>toJson(layer==='gate'?{need:[]}:layer==='hallwayInitial'?plan:{action:'defineFromIR',args:{}})};
 const composer={compose:async x=>x};
 const e=createRequestEngine({composer,modelCaller,dataProvider:createMemoryDataProvider(),workshopExecutor:createWorkshopExecutor({modelCaller,composer,assets}),checkpoints:createMemoryCheckpoints()});
 const got=await e.run(request);
 assert.notEqual(got.status,'completed');assert.equal(assets.read({scope:'r'}).revision,0);
});

test('an exhausted mini-plan returns through Hallway Return before Output',async()=>{
 const assets=createMemoryAssets();const seen=[];let intermediate=false;
 const caller={generate:async ({layer,context})=>{
  seen.push(layer);
  if(layer==='gate')return toJson({need:[]});
  if(layer==='hallwayInitial')return toJson({plan:[{textGenerate:{objective:'Announce progress',need:[]}}],contextBlock:{intent:'report',progress:'starting'}});
  if(layer==='workshop'){if(!intermediate){intermediate=true;return toJson({action:'basicText',args:{text:'Starting'}});}return toJson({done:true});}
  if(layer==='hallwayReturn')return toJson({plan:[{terminate:{objective:'Final',need:[]}}],contextBlock:{intent:'report',progress:'ready'}});
  if(layer==='output')return toJson(output);
 }};
 const composer={compose:async x=>x};
 const e=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider(),workshopExecutor:createWorkshopExecutor({modelCaller:caller,composer,assets}),checkpoints:createMemoryCheckpoints()});
 const result=await e.run(request);assert.equal(result.status,'completed');
 assert.deepEqual(seen,['gate','hallwayInitial','workshop','workshop','hallwayReturn','output']);
 assert.equal(result.result.verifiedResults[0].text,'Starting');
});
test('Output failure retains applied Skill and a retry only calls Output',async()=>{
 let outputCalls=0,workshopCalls=0;
 const assets=createMemoryAssets(),checkpoints=createMemoryCheckpoints();
 const caller={generate:async ({layer,context})=>{
  if(layer==='gate')return toJson({need:[]});
  if(layer==='hallwayInitial')return toJson(plan);
  if(layer==='workshop'){workshopCalls++;return toJson(context.verifiedResults.length?{done:true}:{action:'defineDirect',args:{definition}});}
  if(layer==='output'){outputCalls++;return outputCalls===1?toJson({invalid:true}):toJson(output);}
 }};
 const composer={compose:async x=>x};
 const e=createRequestEngine({composer,modelCaller:caller,dataProvider:createMemoryDataProvider(),workshopExecutor:createWorkshopExecutor({modelCaller:caller,composer,assets}),checkpoints});
 const first=await e.run(request);assert.equal(first.status,'failed');assert.equal(assets.read({scope:'r'}).skills.length,1);
 const before=workshopCalls;
 const second=await e.retryOutput(request);
 assert.equal(second.status,'completed');assert.equal(workshopCalls,before);
 assert.equal(assets.read({scope:'r'}).skills.length,1);
});
