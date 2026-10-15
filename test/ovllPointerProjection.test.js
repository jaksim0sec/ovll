import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getPointerCatalog,skillDefinitionsPublic} from '../backend/ovllPointer/skillCatalog.js';
import {MemoryGraphRepository} from '../front/js/ovllPointerGraphCore.mjs';
const source=readFileSync(new URL('../front/js/ovllPointerProjection.js',import.meta.url),'utf8');
const window={};vm.runInNewContext(source,{window});
const p=window.OvllPointerProjection;
const snapshot={
  graph:{graphId:'g1',revision:2,skillNodes:[{skillNodeId:'n1',
    skillDefinitionRef:{definitionId:'d1',version:3},inputBindings:{topic:'text'}},
    {skillNodeId:'n2',skillDefinitionRef:{definitionId:'d2',version:1},inputBindings:{}}],
    connections:[{kind:'data',from:{skillNodeId:'n1',port:'result'},to:{skillNodeId:'n2',port:'source'}}]},
  skillDefinitions:[{definitionId:'d1',version:3,purpose:'Research',instruction:'Inspect evidence',
      inputs:[],outputs:[{name:'result',role:'Result',representation:'text'}]},
    {definitionId:'d2',version:1,purpose:'Summarize',instruction:'Short summary',
      inputs:[{name:'source',role:'Source',representation:'text'}],
      outputs:[{name:'text',role:'Result',representation:'text'}]}]
};
test('dynamic skillDefinitions and port identities survive frontend projection',()=>{
  const result=p.projectGraph(snapshot,{skillNodes:[{id:'n1',x:12,y:40,expanded:true}]});
  assert.equal(result.revision,2);
  assert.equal(result.workflow.skillNodes[0].x,12);
  assert.equal(result.workflow.skillNodes[0].expanded,true);
  assert.equal(result.workflow.skillNodes[0].type,'pointer:d1:3');
  assert.equal(result.skillDefinitions['pointer:d2:1'].inputs[0].id,'source');
  assert.equal(result.workflow.data[0][0],'n1.result');
  assert.equal(result.workflow.data[0][1],'n2.source');
  assert.equal(result.workflow.skillNodes[1].x,undefined,'new skillNodes use layout engine');
});
test('persisted frontend-only view coordinates survive server graph rehydration',()=>{
  const captured=[];
  const canvas={getWorkflow:()=>({skillNodes:[]}),getBaseSkillDefinitions:()=>({}),
    setSkillDefinitions:x=>captured.push(x),applyWorkflowIR:x=>captured.push(x)};
  p.applyGraph(canvas,snapshot,{skillNodes:[{id:'n2',x:82,y:94,expanded:true}]});
  assert.equal(captured[1].skillNodes[1].x,82);
  assert.equal(captured[1].skillNodes[1].y,94);
  assert.equal(captured[1].skillNodes[1].expanded,true);
});
test('projection rejects unknown definition and edge instead of dropping meaningful state',()=>{
  const broken=JSON.parse(JSON.stringify(snapshot));broken.graph.skillNodes[0].skillDefinitionRef.version=99;
  assert.throws(()=>p.projectGraph(broken),/UNRESOLVED_SKILL_NODE_DEFINITION/);
  const link=JSON.parse(JSON.stringify(snapshot));link.graph.connections[0].kind='unknown';
  assert.throws(()=>p.projectGraph(link),/UNSUPPORTED_CONNECTION_KIND/);
});
test('graph renders via existing canvas methods without replacing legacy skillDefinitions',()=>{
  const calls=[];
  const canvas={getWorkflow:()=>({skillNodes:[]}),getBaseSkillDefinitions:()=>({file:{name:'File'}}),
    setSkillDefinitions:x=>calls.push(['defs',x]),applyWorkflowIR:x=>calls.push(['ir',x])};
  p.applyGraph(canvas,snapshot);
  assert.equal(calls[0][1].file.name,'File');
  assert.equal(calls[1][1].skillNodes.length,2);
});
test('artifact previews read actual content without inventing download URLs',()=>{
  const preview=p.artifactPreview([
    {artifact:{semanticRole:'summary'},content:{representation:'text',value:'A useful result'}},
    {artifact:{semanticRole:'metadata'},content:{representation:'json',value:{count:2}}}
  ]);
  assert.match(preview,/summary: A useful result/);
  assert.match(preview,/metadata:.*count/);
});
test('server skillNode evidence status maps to existing canvas runtime state without fake file links',()=>{
  const entries=[],canvas={setRuntimeSkillNodeState:(...xs)=>entries.push(xs)};
  const state={run:{runId:'r1',status:'running'},skillNodes:[
    {skillNodeId:'n1',status:'success',outputRefs:['v1']},
    {skillNodeId:'n2',status:'outcome_unknown',code:'EXTERNAL_UNKNOWN'}]};
  assert.equal(p.applyRunState(canvas,state),'running');
  assert.equal(entries[0][1].status,'SUCCESS');
  assert.deepEqual(Array.from(entries[0][1].result.outputRefs),['v1']);
  assert.equal(entries[1][1].status,'FAILED');
  assert.equal(entries[0][1].result.downloadUrl,undefined);
});
test('existing data ports remain unchanged and sequencing uses reversible control sockets',()=>{
  const skillDefinitions=getPointerCatalog().skillDefinitions;
  const graph={graphId:'g_controls',revision:1,skillNodes:['write','organize'].map(type=>({skillNodeId:type,
    skillDefinitionRef:{definitionId:'builtin:'+type,version:1},settings:{},inputBindings:{}})),connections:[]};
  const snapshot={graph,skillDefinitions},projected=p.projectGraph(snapshot);
  assert.deepEqual(projected.skillDefinitions.write.inputs.map(port=>port.id),['in']);
  assert.deepEqual(projected.skillDefinitions.write.outputs.map(port=>port.id),['result']);
  assert.deepEqual(projected.skillDefinitions.organize.inputs.map(port=>port.id),['in']);
  assert.deepEqual(projected.skillDefinitions.organize.outputs.map(port=>port.id),['result']);
  assert.equal(projected.workflow.skillNodes[0].params.request,'');
  const canvasSource=readFileSync(new URL('../front/js/canvasSkill.js',import.meta.url),'utf8');
  const compatible=vm.runInNewContext('('+canvasSource.slice(canvasSource.indexOf('function compatible('),canvasSource.indexOf('function wouldCycle(')).trim()+')');
  assert.equal(compatible(projected.skillDefinitions.write.outputs[0],projected.skillDefinitions.organize.inputs[0]),true);
  const w={};vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerGraphPatch.js',import.meta.url),'utf8'),{window:w});
  const edit=w.OvllPointerGraphPatch.build(snapshot,{skillNodes:projected.workflow.skillNodes,
    connections:[{from:{skillNode:'write',port:'result'},to:{skillNode:'organize',port:'in'},data:{kind:'links'}}]});
  assert.equal(edit.patch.operations[0].kind,'flow');
  const repo=new MemoryGraphRepository();repo.restore('local',graph.graphId,snapshot);
  repo.apply('local',JSON.parse(JSON.stringify(edit.patch)));
  const saved=repo.get('local',graph.graphId);
  assert.equal(saved.graph.connections[0].to.port,'in');
  const restored=p.projectGraph(saved);
  assert.deepEqual(Array.from(restored.workflow.links[0]),['write.result','organize.in']);
  assert.deepEqual(restored.skillDefinitions.write.outputs.map(p=>p.id),['result']);
  assert.deepEqual(restored.skillDefinitions.organize.inputs.map(p=>p.id),['in']);
  assert.equal(w.OvllPointerGraphPatch.build(saved,{skillNodes:restored.workflow.skillNodes,connections:restored.workflow.connections}),null);
  const collision={...skillDefinitions[0],definitionId:'custom_controls',
    inputs:[{name:'in',role:'data',representation:'text'},{name:'flow_in',role:'more data',representation:'text'}],
    outputs:[{name:'next',role:'result',representation:'text'}]};
  const custom=p.projectGraph({skillDefinitions:[collision],graph:{...graph,skillNodes:[{skillNodeId:'custom',skillDefinitionRef:{definitionId:collision.definitionId,version:1}}]}}).skillDefinitions['pointer:custom_controls:1'];
  assert.deepEqual(custom.inputs.map(port=>port.id),['in','flow_in']);
  assert.deepEqual(custom.outputs.map(port=>port.id),['next']);
});

test('file-to-analysis-to-PDF edges use the same semantic types in the canvas and execution plan',()=>{
 const catalog=getPointerCatalog().skillDefinitions;
 const custom={definitionId:'d_school',version:1,purpose:'Reflect on reading',
   instruction:'Read the supplied document and organize learning',
   executorKind:'model_task',inputs:[{name:'in',role:'자료',representation:'json'}],
   outputs:[{name:'result',role:'정리',representation:'json'}]};
 const graph={graphId:'school',revision:1,skillNodes:[
   {skillNodeId:'upload',skillDefinitionRef:{definitionId:'builtin:file',version:1}},
   {skillNodeId:'notes',skillDefinitionRef:{definitionId:'d_school',version:1}},
   {skillNodeId:'pdf',skillDefinitionRef:{definitionId:'builtin:createFile',version:1}}
 ],connections:[
   {id:'read',kind:'data',from:{skillNodeId:'upload',port:'file'},to:{skillNodeId:'notes',port:'in'}},
   {id:'export',kind:'data',from:{skillNodeId:'notes',port:'result'},to:{skillNodeId:'pdf',port:'in'}}
 ]};
 const projected=p.projectGraph({graph,skillDefinitions:[...catalog,custom]},undefined,skillDefinitionsPublic);
 const fileOut=projected.skillDefinitions.file.outputs.find(port=>port.id==='file');
 const notesIn=projected.skillDefinitions['pointer:d_school:1'].inputs[0];
 const notesOut=projected.skillDefinitions['pointer:d_school:1'].outputs[0];
 const pdfIn=projected.skillDefinitions.createFile.inputs.find(port=>port.id==='in');
 assert.equal(fileOut.type,'json');
 assert.equal(pdfIn.type,'json');
 assert.equal(notesIn.type,'json');
 assert.equal(notesOut.type,'json');
 assert.equal(notesIn.accepts.includes(fileOut.type),true);
 assert.equal(pdfIn.accepts.includes(notesOut.type),true);
 assert.equal(projected.workflow.connections.length,2);
 const repo=new MemoryGraphRepository();
 assert.doesNotThrow(()=>repo.restore('w','school',{graph,skillDefinitions:[...catalog,custom]}));
});

test('reserved flow next shares the visible semantic output',()=>{
  const skillDefinitions=getPointerCatalog().skillDefinitions;
  const graph={graphId:'g_next',revision:1,skillNodes:['write','organize'].map(type=>({skillNodeId:type,
    skillDefinitionRef:{definitionId:'builtin:'+type,version:1},settings:{},inputBindings:{}})),
    connections:[{id:'flow1',kind:'flow',from:{skillNodeId:'write',port:'next'},to:{skillNodeId:'organize',port:'in'}}]};
  const projected=p.projectGraph({graph,skillDefinitions},undefined,skillDefinitionsPublic);
  assert.deepEqual(Array.from(projected.skillDefinitions.write.outputs,x=>x.id),['result']);
  assert.deepEqual(Array.from(projected.skillDefinitions.organize.inputs,x=>x.id),['in']);
  assert.deepEqual(Array.from(projected.workflow.links[0]),['write.result','organize.in']);
  assert.equal(projected.workflow.connections[0].data.pointer.from.port,'next');
});
