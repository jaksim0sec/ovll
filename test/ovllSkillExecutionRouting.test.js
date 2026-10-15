import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('browser sends one native skill-node request with the original snapshot and instance ID',async()=>{
 const calls=[],snapshot={graph:{graphId:'g',revision:0,skillNodes:[],connections:[]},skillDefinitions:[]};
 const window={fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({skillNodeId:'n_original',status:'success'})};}};
 vm.runInNewContext(readFileSync(new URL('../front/js/ovllPointerApi.js',import.meta.url),'utf8'),{window,Date,Math});
 const result=await window.OvllPointerApi.localSkillNode({snapshot,requestRef:'r',skillNodeId:'n_original'});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/pointer/local/skill-node');
 assert.deepEqual(calls[0].body.snapshot,snapshot);assert.equal(calls[0].body.skillNodeId,'n_original');
 assert.equal('nodeId' in calls[0].body,false);assert.equal(result.skillNodeId,'n_original');
 assert.equal(window.OvllPointerApi.localSkill,undefined);assert.equal(window.OvllPointerApi.localNode,undefined);
});
