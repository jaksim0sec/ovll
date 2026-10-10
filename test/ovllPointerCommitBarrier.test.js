import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app=readFileSync(new URL('../front/js/app.js',import.meta.url),'utf8');
const start=app.indexOf('  let pointerEditTask=null;');
const end=app.indexOf('  function handleCanvasChange(',start);
assert.ok(start>0&&end>start,'Pointer edit transaction functions must be present');
const factory=new Function('state','pointerScope','PointerGraphPatch','global',
  'PointerAPI','refreshPointerCanvas','showErrorNotice','setTimeout','clearTimeout',
  app.slice(start,end)+';return {queuePointerEdit,flushPointerCanvasEdit,startPointerEditCommit};');
function fixture({fail=false,wait}={}){
 const state={pointerGraphSnapshot:{graph:{graphId:'g',revision:0,nodes:[],connections:[]},
   definitions:[]},pointerHydrating:false,restoringConversation:false,destroyed:false,
   pointerEditInFlight:false,pointerEditTimer:null,canvas:{
     getWorkflow:()=>({nodes:[{id:'draft',type:'pointer:d:1'}],connections:[]}),
     isInteractionEnabled:()=>true,setInteractionEnabled:()=>{}
   }};
 const alerts=[];
 const pointer={build:()=>({patch:{graphId:'g',expectedGraphRevision:0,definitions:[],
     operations:[]},newNodeKeys:{draft:'new0'}}),
   resolvedView:()=>({nodes:[{id:'saved'}]})};
 const global={OvllPointerLocal:{turn:async()=>{
   if(wait)await wait;
   return {results:[fail?{status:'rejected',error:{code:'INVALID_GRAPH_EDIT'}}:
     {status:'applied',createdRefs:{'node:new0':'saved'}}]};
 }}};
 const actions=factory(state,()=>({storageMode:'local',conversationId:'c',graphId:'g'}),
   pointer,global,{},async()=>{
     state.pointerGraphSnapshot={graph:{graphId:'g',revision:1,nodes:
       fail?[]:[{nodeId:'saved'}],connections:[]},definitions:[]};
   },error=>alerts.push(error),setTimeout,clearTimeout);
 return {state,alerts,actions};
}

test('a just-added node is saved and its temporary canvas id is resolved before running',async()=>{
 const x=fixture();
 x.actions.queuePointerEdit();
 assert.ok(x.state.pointerEditTimer);
 const canonical=await x.actions.flushPointerCanvasEdit('draft');
 assert.equal(canonical,'saved');
 assert.equal(x.state.pointerEditTimer,null);
 assert.equal(x.state.pointerGraphSnapshot.graph.revision,1);
});

test('run waits for a currently in-flight graph commit instead of using the temporary id',async()=>{
 let unlock;
 const wait=new Promise(resolve=>unlock=resolve),x=fixture({wait});
 const commit=x.actions.startPointerEditCommit();
 const target=x.actions.flushPointerCanvasEdit('draft');
 unlock();
 assert.equal(await target,'saved');
 await commit;
});

test('failed graph saves stop execution rather than firing UNKNOWN_TARGET',async()=>{
 const x=fixture({fail:true});
 await assert.rejects(x.actions.flushPointerCanvasEdit('draft'),
   error=>error.code==='INVALID_GRAPH_EDIT');
 assert.equal(x.alerts.length,1);
});
test('unsupported legacy node types are filtered in Pointer mode, without hiding valid custom definitions',()=>{
 assert.match(app,/filter:type=>!pointerScope\(\)\|\|[\s\S]*?PointerGraphPatch\.supportedTypes\(state\.pointerGraphSnapshot\)\.has\(type\)/);
 assert.match(app,/const persistedNodeId=await flushPointerCanvasEdit\(nodeId\)/);
 assert.match(app,/runLocalNodes\(\{targets:\[persistedNodeId\]/);
});
