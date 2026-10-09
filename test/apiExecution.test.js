import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

function loadApi(fetchImpl){
  const calls=[],memory=new Map(),localStorage={
    getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,String(value))
  };
  const window={OVLL_RUNTIME:{apiOrigin:'https://api.example.test'},setTimeout,clearTimeout,
    OvllSvgLibrary:{setServerIcons:()=>true}};
  const fetch=async(url,options)=>{calls.push({url,options});return fetchImpl(url,options)};
  vm.runInNewContext(readFileSync(new URL('../front/js/api.js',import.meta.url),'utf8'),
    {window,fetch,localStorage,AbortController,setTimeout,clearTimeout,console});
  return {api:window.AstraAPI,calls};
}
test('the frontend API exposes only active node catalog and artifact operations',()=>{
  const {api}=loadApi(async()=>({ok:true,json:async()=>({ok:true})}));
  assert.equal(typeof api.getNodeDefinitions,'function');
  assert.equal(typeof api.createArtifact,'function');
  for(const retired of ['chat','planWorkflow','executeGroup','finalizeRun','execute'])
    assert.equal(api[retired],undefined,retired);
});
test('node catalog uses server icon authority and retains data shape',async()=>{
  const {api,calls}=loadApi(async()=>({ok:true,json:async()=>({
    ok:true,nodes:{write:{name:'작성하기'}},iconSvg:{pen:'<svg></svg>'}
  })}));
  const nodes=await api.getNodeDefinitions();
  assert.equal(nodes.write.name,'작성하기');
  assert.match(calls[0].url,/\/api\/node-definitions$/);
});
test('artifact creation preserves requested format, page target and absolute download link',async()=>{
  const {api,calls}=loadApi(async()=>({ok:true,json:async()=>({
    ok:true,artifact:{downloadUrl:'/api/artifacts/abc',previewUrl:'/api/artifacts/abc?inline=1'}
  })}));
  const result=await api.createArtifact({format:'PDF',targetPages:3,
    sources:[{text:'한글 원문 내용',title:'source'}]});
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.targetPages,3);
  assert.equal(body.format,'PDF');
  assert.ok(JSON.stringify(body.sources).includes('한글 원문 내용'));
  assert.equal(result.artifact.downloadUrl,'https://api.example.test/api/artifacts/abc');
});
test('mobile Enter keeps native multiline insertion while desktop Enter sends',()=>{
  const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
  const begin=app.indexOf('function handleComposerKeydown('),end=app.indexOf('/* =======================================================',begin);
  const handler=app.slice(begin,end);
  assert.match(handler,/event\.key !== "Enter"/);
  assert.match(handler,/hover: none/);
  assert.match(handler,/pointer: coarse/);
  assert.match(handler,/composerForm\.requestSubmit\(\)/);
  assert.ok(handler.indexOf('pointer: coarse')<handler.indexOf('event.preventDefault()'));
});
