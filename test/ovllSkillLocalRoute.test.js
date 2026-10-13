import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {createLocalPointerHost} from '../backend/ovllPointer/localHost.js';
import {mountLocalPointerRoutes} from '../backend/ovllPointer/localHttp.js';

const def={definitionId:'d1',version:1,purpose:'Research',
 instruction:'Provide a result',executorKind:'model_task',inputs:[],
 outputs:[{name:'result',representation:'text'}]};
const graph=()=>({skillDefinitions:[def],graph:{graphId:'g1',revision:0,
 skills:[{skillId:'n_old',skillDefinitionRef:{definitionId:'d1',version:1},settings:{request:'Test task'}}],
 connections:[]}});

test('new Skill host uses canonical input/output without extra provider calls',async()=>{
 let calls=0;
 const host=createLocalPointerHost({
  gateway:{complete:async()=>{calls++;return{text:JSON.stringify({
    outputs:{status:'produced',values:{result:{inline:'Succeeded'}}}
  })};}},
  resolveModel:async()=>({providerId:'fixture',model:'test',maxOutputTokens:200})
 });
 const result=await host.skill({snapshot:graph(),requestRef:'req1',skillId:'n_old'});
 assert.equal(result.skillId,'n_old');
 assert.equal('nodeId' in result,false);
 assert.equal(result.status,'success');
 assert.equal(result.outputs.values.result.inline,'Succeeded');
 assert.equal(calls,1);
});

test('Skill host rejects v1 graph and Node-shaped selectors without invoking the model',async()=>{
 let calls=0;
 const host=createLocalPointerHost({
  gateway:{complete:async()=>{calls++;return{text:'{}'};}},
  resolveModel:async()=>({providerId:'fixture',model:'test',maxOutputTokens:200})
 });
 const legacy=graph();legacy.graph.nodes=legacy.graph.skills;
 await assert.rejects(host.skill({snapshot:legacy,requestRef:'req2',skillId:'n_old'}),
   e=>e.code==='INVALID_SKILL_SNAPSHOT');
 await assert.rejects(host.skill({snapshot:graph(),requestRef:'req3',
   skillId:'n_old',nodeId:'n_old'}),e=>e.code==='INVALID_SKILL_REQUEST');
 assert.equal(calls,0);
});

test('Skill HTTP route validates canonical graph before rate budget and preserves old /node route',async()=>{
 let calls=0;
 const app=express();app.use(express.json());
 mountLocalPointerRoutes(app,{enabled:()=>true,createHost:()=>({
  skill:async body=>{calls++;return{skillId:body.skillId,status:'success',_meta:{providerCalls:1}};},
  node:async body=>{calls++;return{nodeId:body.nodeId,status:'success',_meta:{providerCalls:1}};}
 })});
 const server=await new Promise(resolve=>{
  const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));
 });
 const endpoint='http://127.0.0.1:'+server.address().port+'/api/pointer/local/';
 const send=(route,body)=>fetch(endpoint+route,{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
   const invalid=await send('skill',{snapshot:{},skillId:'n_old'});
   assert.equal(invalid.status,422);
   assert.equal((await invalid.json()).error.code,'INVALID_SKILL_SNAPSHOT');
   assert.equal(calls,0);
   const response=await send('skill',{snapshot:graph(),skillId:'n_old'});
   assert.equal(response.status,200);
   assert.equal((await response.json()).skillId,'n_old');
   assert.equal(calls,1);
   const old=await send('node',{nodeId:'n_old',requestText:'Run the old format'});
   assert.equal(old.status,200);
   assert.equal((await old.json()).nodeId,'n_old');
   assert.equal(calls,2);
 }finally{
   server.closeAllConnections?.();
   await new Promise(resolve=>server.close(resolve));
 }
});
