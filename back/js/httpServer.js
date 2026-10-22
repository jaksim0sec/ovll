import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';

const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
const json=(res,code,payload)=>{res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(payload));};
const safeRecord=r=>r&&({roomId:r.roomId,requestId:r.requestId,status:r.status,currentLayer:r.currentLayer,...(r.result?{result:r.result}:{}),...(r.error?{error:r.error}:{}),...(r.plan?{plan:r.plan}:{} )});
const sameString=(a,b)=>{
 const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);
};
function validRequest(value){
 if(!value||typeof value!=='object'||!/^[a-zA-Z0-9._-]{1,100}$/.test(value.roomId||''))return false;
 const req=value.request;
 if(!req||!Array.isArray(req.parts)||!req.parts.length||req.parts.length>60||!Array.isArray(req.attachments)||req.attachments.length>20)return false;
 for(const p of req.parts){
  if(p?.type==='text'){if(typeof p.text!=='string'||p.text.length>8000) return false;}
  else if(p?.type==='skill'||p?.type==='block'){if(typeof p.id!=='string'||!p.id||p.id.length>200||typeof p.label!=='string'||p.label.length>200)return false;}
  else return false;
 }
 if(!req.parts.some(p=>p.type!=='text'||p.text.trim()))return false;
 if(!Array.isArray(value.initialResources)||value.initialResources.length>100)return false;
 for(const item of value.initialResources)if(!item||!['skillDef','canvasSkill'].includes(item.dataset)||typeof item.key!=='string'||item.key.length>200||!['complete','metadata','missing'].includes(item.completeness))return false;
 if(req.attachments.some(a=>!a||typeof a.name!=='string'||a.name.length>256||typeof a.size!=='number'||!Number.isFinite(a.size)||a.size<0))return false;
 return true;
}
async function readJsonBody(req){
 const max=131072;let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('payload too large'),{statusCode:413});chunks.push(chunk);}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid json'),{statusCode:400});}
}
/** Minimal authenticated, same-origin test boundary; queue belongs to the scheduler. */
export function createRequestHttpServer({scheduler,testToken,frontRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../front')}={}){
 if(!scheduler?.enqueue||!scheduler?.get||(testToken!==undefined&&typeof testToken!=='string'))throw new TypeError('Scheduler and test token (16+ chars) required');
 const root=path.resolve(frontRoot);let activeCount=0;
 return createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');const pathname=url.pathname;
   if(pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,service:'ovll-beta',memoryOnly:true});
   if(pathname.startsWith('/api/')){
    if(testToken && !sameString(req.headers.authorization,'Bearer '+testToken))return json(res,401,{error:'UNAUTHORIZED'});
    if(pathname==='/api/requests'&&req.method==='POST'){
     if(activeCount>=6)return json(res,429,{error:'QUEUE_BUSY'});
     const body=await readJsonBody(req);
     if(!validRequest(body))return json(res,400,{error:'INVALID_REQUEST'});
     const input={roomId:body.roomId,request:body.request,initialResources:body.initialResources,contextData:{overallFlow:'',currentTopic:'',details:''}};
     const job=scheduler.enqueue(input);activeCount++;
     job.completion.then(()=>{activeCount--;},()=>{activeCount--;});
     return json(res,202,{roomId:job.roomId,requestId:job.requestId,status:'queued'});
    }
    const match=/^\/api\/requests\/([a-zA-Z0-9._-]+)$/.exec(pathname);
    if(match&&req.method==='GET'){
     const roomId=url.searchParams.get('roomId');
     if(typeof roomId!=='string'||!/^[a-zA-Z0-9._-]{1,100}$/.test(roomId))return json(res,400,{error:'INVALID_ROOM'});
     const record=scheduler.get(roomId,match[1]);return record?json(res,200,safeRecord(record)):json(res,404,{error:'REQUEST_NOT_FOUND'});
    }
    return json(res,404,{error:'NOT_FOUND'});
   }
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'allow':'GET, HEAD'});return res.end();}
   // Only front/ is exposed. Never serve back/, prompts/, or secrets.
   let file;
   try{file=decodeURIComponent(pathname);}catch{return json(res,400,{error:'BAD_PATH'});}
   if(file.includes('\0')||file.includes('\\')||file.split('/').includes('..'))return json(res,400,{error:'BAD_PATH'});
   if(file==='/')file='/index.html';
   const absolute=path.resolve(root,'.'+file);
   if(!absolute.startsWith(root+path.sep))return json(res,403,{error:'FORBIDDEN'});
   const fstat=await stat(absolute).catch(()=>null);
   if(!fstat?.isFile())return json(res,404,{error:'NOT_FOUND'});
   const bytes=await readFile(absolute);
   res.writeHead(200,{'content-type':MIME[path.extname(absolute)]||'application/octet-stream','content-length':bytes.length,'x-content-type-options':'nosniff','cache-control':'no-store'});
   return res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){
   if(res.headersSent){res.end();return;}
   const code=error?.statusCode===413?413:error?.statusCode===400?400:500;
   return json(res,code,{error:code===413?'BODY_TOO_LARGE':code===400?'INVALID_JSON':'SERVER_ERROR'});
  }
 });
}
