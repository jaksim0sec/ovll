import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const window={};
for(const name of ['ovllPointerProjection','ovllPointerGraphPatch'])
  vm.runInNewContext(readFileSync(new URL('../front/js/'+name+'.js',import.meta.url),'utf8'),{window});
const projection=window.OvllPointerProjection,graphPatch=window.OvllPointerGraphPatch;
const artifact=(id='pdf-1')=>({id,name:'report.pdf',localFileId:'local-'+id,
  mime:'application/pdf',format:'PDF',size:123,downloadUrl:'/api/artifacts/'+id,
  previewUrl:'/api/artifacts/'+id+'?inline=1',previewKind:'pdf'});
const result=(file=artifact(),extra={})=>({nodeId:'export',status:'success',resultCurrent:true,
  toolEffectStarted:true,effectConfirmed:true,
  outputs:{values:{artifact:{inline:file}}},...extra});
const snapshot=()=>({graph:{graphId:'g',revision:1,nodes:[{
  nodeId:'export',definitionRef:{definitionId:'builtin:createFile',version:1},
  settings:{},inputBindings:{}}],connections:[]},definitions:[
  {definitionId:'builtin:createFile',version:1,purpose:'Export',inputs:[
    {name:'in',role:'content',representation:'json',required:false}],outputs:[]},
  {definitionId:'builtin:file',version:1,purpose:'File',inputs:[],outputs:[
    {name:'file',role:'file',representation:'file',required:false}]}
]});
const initial=[{id:'export',type:'createFile',x:40,y:80,expanded:false,data:{}}];

test('verified PDF becomes a stable, downloadable canvas file next to its source',()=>{
  const files=projection.resultFileNodes(snapshot(),[result()],initial);
  assert.equal(files.length,1);
  assert.equal(files[0].id,'result:pdf-1');
  assert.equal(files[0].type,'file');
  assert.equal(files[0].data.generated,true);
  assert.equal(files[0].data.sourceNodeId,'export');
  assert.equal(files[0].data.localFileId,'local-pdf-1');
  assert.equal(files[0].data.previewUrl,'/api/artifacts/pdf-1?inline=1');
  assert.deepEqual([files[0].x,files[0].y],[260,80]);
  let workflow={nodes:initial,connections:[]},definitions={};
  const canvas={getWorkflow:()=>workflow,getBaseNodeDefinitions:()=>({
    createFile:{name:'Export',inputs:[{id:'in',type:'any'}],outputs:[]},
    file:{name:'File',inputs:[],outputs:[{id:'file',type:'file'}]}
  }),setNodeDefinitions:d=>{definitions=d;},applyWorkflowIR:w=>{workflow=w;}};
  projection.applyGraph(canvas,snapshot(),null,files);
  assert.equal(workflow.nodes.length,2);
  assert.equal(workflow.nodes[1].data.artifactId,'pdf-1');
  assert.ok(definitions.file);
  assert.equal(graphPatch.build(snapshot(),workflow),null,
    'unconnected result-file presentation must not mutate the execution graph');
  const restored=projection.resultFileNodes(snapshot(),[result()],workflow.nodes);
  assert.deepEqual([restored[0].x,restored[0].y],[260,80]);
});

test('stale, unconfirmed, malformed, or no-longer-existing results never create file nodes',()=>{
  assert.equal(projection.resultFileNodes(snapshot(),[result(artifact(),{resultCurrent:false})],initial).length,0);
  assert.equal(projection.resultFileNodes(snapshot(),[result(artifact(),{effectConfirmed:false})],initial).length,0);
  assert.equal(projection.resultFileNodes(snapshot(),[result({...artifact(),downloadUrl:'javascript:alert(1)'})],initial).length,0);
  assert.equal(projection.resultFileNodes(snapshot(),[result(artifact(),{nodeId:'removed'})],initial).length,0);
});

test('duplicate artifacts and promoted canonical file nodes do not duplicate the canvas result',()=>{
  const multiple=result(artifact());
  multiple.outputs.values.copy={inline:artifact()};
  assert.equal(projection.resultFileNodes(snapshot(),[multiple],initial).length,1);
  const canonical=snapshot();
  canonical.graph.nodes.push({nodeId:'permanent',definitionRef:{definitionId:'builtin:file',version:1},
    settings:{file:{localFileId:'local-pdf-1'}}});
  assert.equal(projection.resultFileNodes(canonical,[result()],initial).length,0);
});

test('linking a result file promotes it into IR with source bytes, while preserving unrelated graph nodes',()=>{
  const files=projection.resultFileNodes(snapshot(),[result()],initial);
  const projected=projection.projectGraph(snapshot(),{nodes:initial});
  const workflow={nodes:[...projected.workflow.nodes,...files],
    connections:[{id:'edge',from:{node:files[0].id,port:'file'},
      to:{node:'export',port:'in'},data:{kind:'data'}}]};
  const diff=graphPatch.build(snapshot(),workflow);
  assert.ok(diff);
  assert.ok(diff.patch.operations.some(op=>op.op==='node.add'&&
    op.settings?.file?.localFileId==='local-pdf-1'));
  assert.ok(diff.patch.operations.some(op=>op.op==='link.add'&&op.kind==='data'));
});

test('app refresh path reprojects verified files after successful local execution',()=>{
  const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  assert.match(source,/resultFileNodes\(snapshot\.graph,localNodes,previousNodes\)/);
  assert.match(source,/applyGraph\(state\.canvas,snapshot\.graph,state\.pointerLocalView,resultFiles\)/);
  assert.match(source,/const run=await global\.OvllPointerLocal\.run\(/);
  assert.match(source,/await refreshPointerCanvas\(\{force:true\}\)/);
});
