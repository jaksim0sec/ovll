import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
function extract(start,end){const from=source.indexOf(start),to=source.indexOf(end,from);
 assert.ok(from>0&&to>from,'required runtime UI helper exists');
 return source.slice(from,to);
}
const code=extract('  function runtimeStepPresentation(', '  function runtimeStepMarkup()');
const stages=extract('  function pointerActionStages(action){','  function pointerActionStarted(action){');
const iconLibrary={get:key=>key?'<svg data-icon="'+key+'"></svg>':''};
test('actual node progress IDs look up canvas nodes without the node: prefix',()=>{
 const requested=[];
 const state={canvas:{getNode:id=>{requested.push(id);return {type:'pointer:d_vocab:1'};},
  getNodeDefinitions:()=>({'pointer:d_vocab:1':{iconKey:'open-book',color:'#123456'}})}};
 const fn=new Function('state','SvgLibrary',code+';return runtimeStepPresentation;')(state,iconLibrary);
 const p=fn('node:n123');
 assert.equal(requested[0],'n123');
 assert.equal(p.iconKey,'open-book');
 assert.equal(p.color,'#123456');
 assert.match(p.icon,/data-icon="open-book"/);
});
test('action progress uses defined custom icon and system actions have mini icons',()=>{
 const state={canvas:{getNode:()=>null,getNodeDefinitions:()=>({})},
  pointerGraphSnapshot:{definitions:[{definitionId:'d_prev',version:1,presentation:{
   iconKey:'graduation-cap',color:'#778899'}}]}};
 const fn=new Function('state',stages+';return pointerActionStages;')(state);
 const patch={localKey:'p',kind:'ir.applyPatch',args:{patch:{
  definitions:[{localKey:'d',presentation:{iconKey:'open-book',color:'#abcdef'}}],
  operations:[{op:'node.add',localNodeKey:'new',definitionRef:{localDefinitionKey:'d'}},
   {op:'link.add',localLinkKey:'c',kind:'data'}]}}};
 const list=fn(patch);
 assert.equal(list.find(s=>s.id==='action:p:define').iconKey,'open-book');
 assert.equal(list.find(s=>s.id==='action:p:add').iconKey,'open-book');
 assert.equal(list.find(s=>s.id==='action:p:connect').iconKey,'canvasLayout');
 assert.equal(fn({localKey:'r',kind:'run.start'})[0].iconKey,'play');
 assert.equal(fn({localKey:'save',kind:'function.save'})[0].iconKey,'folder');
 assert.equal(fn({localKey:'q',kind:'question.ask'})[0].iconKey,'open-book');
 assert.equal(fn({localKey:'del',kind:'ir.applyPatch',args:{patch:{
  definitions:[],operations:[{op:'definition.delete',
   definitionRef:{definitionId:'d_prev',version:1}}]}}})[0].iconKey,'graduation-cap');
});
test('restored activity retains icon keys rather than requiring current canvas state',()=>{
 assert.match(source,/iconKey:\s*String\(step\.dataset\?\.iconKey\|\|""\)/);
 assert.match(source,/color:\s*String\(step\.dataset\?\.nodeColor\|\|""\)/);
 assert.match(source,/iconKey:item\.iconKey,nodeType:item\.nodeType,color:item\.color/);
 assert.match(source,/step\.dataset\.iconKey\s*=\s*presentation\.iconKey/);
 assert.match(source,/upsertRuntimeStep\(step\.id,step\.label\+' 중','running','',step\)/);
});
