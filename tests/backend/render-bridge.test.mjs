import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequestHttpServer} from '../../back/js/httpServer.js';
import {createRequestBridge} from '../../front/js/workspace/requestBridge.js';

const secret='example-access-key-12345678';
const request={roomId:'beta-local-workspace',request:{parts:[{type:'text',text:'안녕'}],attachments:[]},initialResources:[]};
async function serve(){
 const root=await mkdtemp(path.join(tmpdir(),'ovll-render-'));
 await writeFile(path.join(root,'index.html'),'Ovll beta');
 const jobs=new Map();let counter=0;
 const scheduler={
  enqueue(input){
   const id='req'+ ++counter;
   jobs.set(id,{roomId:input.roomId,requestId:id,status:'queued',currentLayer:'gate'});
   return {roomId:input.roomId,requestId:id,completion:new Promise(()=>{})};
  },
  get(room,id){const record=jobs.get(id);return record?.roomId===room?record:null;}
 };
 const server=createRequestHttpServer({scheduler,testToken:secret,frontRoot:root});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 return {url,jobs,async close(){await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}};
}
test('Render origin serves frontend and health; API requires test token',async()=>{
 const app=await serve();
 try{
  assert.equal((await fetch(app.url+'/api/health')).status,200);
  assert.match(await (await fetch(app.url+'/')).text(),/Ovll beta/);
  assert.equal((await fetch(app.url+'/package.json')).status,404);
  assert.equal((await fetch(app.url+'/api/requests',{method:'POST',body:JSON.stringify(request)})).status,401);
  const authorized=await fetch(app.url+'/api/requests',{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify(request)});
  assert.equal(authorized.status,202);
  const {requestId}=await authorized.json();
  const get=room=>fetch(app.url+'/api/requests/'+requestId+'?roomId='+room,{headers:{authorization:'Bearer '+secret}});
  assert.equal((await get(request.roomId)).status,200);
  assert.equal((await get('another-room')).status,404);
  const invalid=await fetch(app.url+'/api/requests',{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify({...request,roomId:'../wrong'})});
  assert.equal(invalid.status,400);
 }finally{await app.close();}
});
test('Chat bridge shows remote Gate and Hallway states before confirmed assistant answer',async()=>{
 const draft={parts:[{type:'text',text:'안녕'},{type:'block',id:'block-1',label:'예시'}],attachments:[]};
 const dataAccess={readCanvasSnapshot:()=>({snapshot:{blocks:[{id:'block-1',skillId:'research',x:0,y:0,expanded:false,values:{request:'안녕'}}]}}),readSkillCatalog:()=>({definitions:[{id:'research',name:'조사하기'}]})};
 let ticks=0,body,resolveFinished;const finished=new Promise(resolve=>resolveFinished=resolve);
 const shown=[];
 const transport=createRequestBridge({pollDelay:5,promptForToken:()=>secret,onRecords:records=>{if(records.some(r=>r.role==='assistant'))resolveFinished(records);},
   onActivities:states=>{shown.push(states.map(x=>x.label).join(' / '));},
   fetchImpl:async(path,options)=>{
    if(path==='/api/requests'){body=JSON.parse(options.body);return {ok:true,status:202,json:async()=>({roomId:request.roomId,requestId:'r01'})};}
    ticks++;
    const info=ticks===1?{status:'running',currentLayer:'gate'}:ticks===2?{status:'running',currentLayer:'hallwayInitial'}:{status:'completed',result:{languageBlock:'반가워요'}};
    return {ok:true,status:200,json:async()=>({roomId:request.roomId,requestId:'r01',...info})};
   }});
 try{
  assert.deepEqual(await transport.submit({draft,roomId:request.roomId,dataAccess}),{accepted:true});
  assert.equal(body.initialResources[0].dataset,'canvasSkill');
  assert.equal(body.initialResources[1].completeness,'metadata');
  const records=await Promise.race([finished,new Promise((_,reject)=>setTimeout(()=>reject(new Error('progress timeout')),1800))]);
  assert.equal(records[1].text,'반가워요');
  assert.ok(shown.some(s=>s.includes('Gate')));assert.ok(shown.some(s=>s.includes('Hallway')));
 }finally{transport.destroy();}
});
