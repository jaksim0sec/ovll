import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const window={};
vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerLocalActions.js',import.meta.url),'utf8'),{window});
const actions=window.OvllPointerLocalActions;
const file=(id='pdf')=>({id,name:id+'.pdf',format:'PDF',mime:'application/pdf',size:120,
  downloadUrl:'/api/artifacts/'+id,previewUrl:'/api/artifacts/'+id+'?inline=1',
  localFileId:'saved-'+id,availability:{localBytes:true,durable:true},coverage:{complete:true}});
const node=(nodeId,value,extra={})=>({nodeId,status:'success',outputs:{values:{result:{inline:value}}},...extra});
const exportNode=(nodeId,artifact,extra={})=>node(nodeId,artifact,{toolEffectStarted:true,effectConfirmed:true,...extra});
const run=(nodes,targets,status='completed')=>({status,graphRef:{graphId:'g'},nodes,targets});

test('confirmed artifact delivery preserves metadata for existing file cards without raw Markdown URLs',()=>{
  assert.equal(typeof actions.presentation,'function');
  const artifact=file(),result=actions.presentation({runs:[run([exportNode('export',artifact)],['export'])]});
  assert.deepEqual(JSON.parse(JSON.stringify(result.artifacts)),[artifact]);
  assert.match(result.text,/pdf.pdf/);
  assert.doesNotMatch(result.text,/\/api\/artifacts\/|\]\(/);
  assert.doesNotMatch(actions.deliver(run([exportNode('export',artifact)],['export'])),/\/api\/artifacts\//);
});

test('latest target selection keeps independent files and deduplicates actual artifacts',()=>{
  assert.equal(typeof actions.presentation,'function');
  const old=file('old'),current=file('current'),independent=file('independent');
  const result=actions.presentation({runs:[run([exportNode('a',old)],['a']),
    run([exportNode('b',independent),node('internal','Internal trace')],['b']),
    run([exportNode('a',current),exportNode('c',current)],['a','c'])]});
  assert.deepEqual(Array.from(result.artifacts,a=>a.id),['current','independent']);
  assert.doesNotMatch(result.text,/old.pdf|Internal trace/);
  assert.equal(result.text.split('current.pdf').length-1,1);
});

test('cancelled confirmed file effects remain deliverable with notices while stale files are suppressed',()=>{
  assert.equal(typeof actions.presentation,'function');
  const artifact=file(),partial=run([exportNode('a',artifact),{nodeId:'b',status:'cancelled'}],['a','b'],'cancelled');
  partial.coverage={outputTruncated:true};partial.storage={status:'failed',error:'QUOTA'};
  const result=actions.presentation({runs:[partial],facts:[{run:partial}]});
  assert.equal(result.artifacts.length,1);assert.match(result.text,/중단/);
  assert.match(result.text,/일부가 생략/);assert.match(result.text,/저장하지 못/);
  const stale=actions.presentation({runs:[run([exportNode('a',artifact,{resultCurrent:false})],['a'])]});
  assert.equal(stale.artifacts.length,0);assert.doesNotMatch(stale.text,/pdf.pdf/);
});

test('model text and unconfirmed objects cannot supply file card metadata',()=>{
  assert.equal(typeof actions.presentation,'function');
  const text='[made-up.pdf](/api/artifacts/made-up)',artifact=file();
  const result=actions.presentation({runs:[run([node('text',text),node('object',artifact),
    exportNode('unknown',artifact,{effectConfirmed:false}),
    exportNode('unsafe',{...artifact,downloadUrl:'javascript:alert(1)'})],['text','object','unknown','unsafe'])]});
  assert.equal(result.artifacts.length,0);assert.ok(result.text.includes(text));
});

test('ordinary target outputs retain their complete text alongside structured file delivery',()=>{
  assert.equal(typeof actions.presentation,'function');
  const text='Complete report. '.repeat(1000),artifact=file();
  const result=actions.presentation({runs:[run([node('report',text),exportNode('export',artifact)],['report','export'])],messages:['Follow-up']});
  assert.ok(result.text.includes(text));assert.match(result.text,/Follow-up/);assert.equal(result.artifacts.length,1);
  assert.equal(actions.needsLanguage({runs:[run([exportNode('export',artifact)],['export'])]}),false);
});
