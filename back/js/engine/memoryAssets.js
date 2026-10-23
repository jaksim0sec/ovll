/** Volatile authoritative domain adapter. Replace this port with transactional storage, never import it into engine decisions. */
export function createMemoryAssets({createId=()=>crypto.randomUUID()}={}){
 const rooms=new Map(),copy=x=>structuredClone(x);
 const fail=(code,details)=>{throw Object.assign(new Error(code),{code,details});};
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 const string=(x,max=6000)=>typeof x==='string'&&x.length>0&&x.length<=max;
 const safe=(x,max=400)=>string(x,max);
 const fresh=()=>({revision:0,skills:[],blocks:[],links:[],operations:new Map()});
 const room=scope=>{if(!safe(scope,120))throw new TypeError('Invalid asset scope');if(!rooms.has(scope))rooms.set(scope,fresh());return rooms.get(scope);};
 const publicState=s=>copy({revision:s.revision,skills:s.skills,blocks:s.blocks,links:s.links});
 const find=(items,id)=>items.find(item=>item.id===id)||fail('NOT_FOUND',{id});
 const list=(x,kind)=>{if(!Array.isArray(x)||x.length>40)fail('INVALID_ARGUMENT',{kind});const keys=new Set();for(const o of x){if(!object(o)||!safe(o.id,80)||keys.has(o.id)||!safe(o.type,50)||typeof o.multiple!=='boolean'&&kind!=='fields')fail('INVALID_ARGUMENT',{kind});keys.add(o.id);}return copy(x);};
 const fields=x=>{if(!Array.isArray(x)||x.length>40)fail('INVALID_ARGUMENT',{field:'fields'});const ids=new Set();for(const f of x){if(!object(f)||!safe(f.id,80)||ids.has(f.id)||!Number.isSafeInteger(f.maxLength)||f.maxLength<0||f.maxLength>10000||typeof f.default!=='string'||f.default.length>f.maxLength)fail('INVALID_ARGUMENT',{field:'fields'});ids.add(f.id);}return copy(x);};
 function definition(d){
  if(!object(d)||!safe(d.name,120)||!safe(d.description,1200)||!safe(d.instruction,10000))fail('INVALID_ARGUMENT',{field:'definition'});
  const inputs=list(d.inputs,'inputs'),outputs=list(d.outputs,'outputs'),fs=fields(d.fields);
  return {name:d.name,description:d.description,instruction:d.instruction,inputs,outputs,fields:fs,icon:typeof d.icon==='string'?d.icon:'box',color:typeof d.color==='string'?d.color:'#718096'};
 }
 function validateBlock(b,skill){
  if(!Number.isFinite(b.x)||!Number.isFinite(b.y)||typeof b.expanded!=='boolean'||!object(b.values))fail('INVALID_ARGUMENT',{field:'block'});
  for(const [key,value] of Object.entries(b.values)){const field=skill.fields.find(f=>f.id===key);if(!field||typeof value!=='string'||value.length>field.maxLength)fail('INVALID_ARGUMENT',{field:key});}
 }
 function validLink(s,from,to,ignore){
  if(!object(from)||!object(to))fail('INVALID_ARGUMENT',{field:'endpoint'});
  const source=find(s.blocks,from.blockId),target=find(s.blocks,to.blockId);
  if(source.id===target.id)fail('INVALID_LINK');
  const src=find(s.skills,source.skillId),dst=find(s.skills,target.skillId);
  const output=src.outputs.find(p=>p.id===from.portId),input=dst.inputs.find(p=>p.id===to.portId);
  if(!output||!input||input.type!=='any'&&output.type!=='any'&&input.type!==output.type)fail('INVALID_LINK');
  if(s.links.some(l=>l.id!==ignore&&l.from.blockId===from.blockId&&l.from.portId===from.portId&&l.to.blockId===to.blockId&&l.to.portId===to.portId))fail('DUPLICATE_LINK');
  if(!input.multiple&&s.links.some(l=>l.id!==ignore&&l.to.blockId===to.blockId&&l.to.portId===to.portId))fail('PORT_OCCUPIED');
  const seen=new Set(),pending=[target.id];
  while(pending.length){const id=pending.pop();if(id===source.id)fail('CYCLIC_LINK');if(seen.has(id))continue;seen.add(id);for(const l of s.links)if(l.from.blockId===id)pending.push(l.to.blockId);}
 }
 function mutate(s,action,args){
  if(!object(args))fail('INVALID_ARGUMENT');
  let result;
  switch(action){
   case 'defineDirect':{
    const d=definition(args.definition);
    if(s.skills.some(x=>x.name===d.name))fail('DUPLICATE_NAME');
    result={id:createId(),revision:1,...d};s.skills.push(result);break;
   }
   case 'revise':{
    const old=find(s.skills,args.skillId);
    const updated=definition({...old,...args.patch});
    if(s.skills.some(x=>x.id!==old.id&&x.name===updated.name))fail('DUPLICATE_NAME');
    const target={...old,...updated,revision:old.revision+1};
    for(const b of s.blocks.filter(b=>b.skillId===old.id))validateBlock(b,target);
    const trial={...s,skills:s.skills.map(x=>x.id===old.id?target:x)};
    for(const link of s.links){const without={...trial,links:trial.links.filter(x=>x.id!==link.id)};validLink(without,link.from,link.to);}
    Object.assign(old,target);result=old;break;
   }
   case 'editAppearance':{
    const skill=find(s.skills,args.skillId);
    if(!object(args.patch)||!Object.keys(args.patch).length||Object.keys(args.patch).some(k=>!['icon','color'].includes(k)))fail('INVALID_ARGUMENT');
    for(const [k,v] of Object.entries(args.patch)){if(!safe(v,70))fail('INVALID_ARGUMENT');skill[k]=v;}
    skill.revision++;result=skill;break;
   }
   case 'delete':{
    const skill=find(s.skills,args.skillId);
    if(s.blocks.some(b=>b.skillId===skill.id))fail('SKILL_IN_USE');
    s.skills=s.skills.filter(x=>x.id!==skill.id);result={id:skill.id};break;
   }
   case 'addBlock':{
    const skill=find(s.skills,args.skillId);
    const b={id:createId(),skillId:skill.id,x:args.x??0,y:args.y??0,expanded:args.expanded??false,values:Object.fromEntries(skill.fields.map(f=>[f.id,f.default]))};
    if(args.values!==undefined){if(!object(args.values))fail('INVALID_ARGUMENT');Object.assign(b.values,copy(args.values));}
    validateBlock(b,skill);s.blocks.push(b);result=b;break;
   }
   case 'editBlock':{
    const b=find(s.blocks,args.blockId);
    if(!object(args.patch)||!Object.keys(args.patch).length||Object.keys(args.patch).some(k=>!['x','y','expanded','values'].includes(k)))fail('INVALID_ARGUMENT');
    const next={...b,...copy(args.patch),values:{...b.values,...(args.patch.values||{})}};
    validateBlock(next,find(s.skills,b.skillId));Object.assign(b,next);result=b;break;
   }
   case 'deleteBlock':{
    find(s.blocks,args.blockId);
    const before=s.links.length;s.links=s.links.filter(x=>x.from.blockId!==args.blockId&&x.to.blockId!==args.blockId);
    s.blocks=s.blocks.filter(x=>x.id!==args.blockId);result={id:args.blockId,removedLinks:before-s.links.length};break;
   }
   case 'addLink':{
    validLink(s,args.from,args.to);
    result={id:createId(),from:copy(args.from),to:copy(args.to)};s.links.push(result);break;
   }
   case 'removeLink':{
    const link=find(s.links,args.linkId);s.links=s.links.filter(x=>x.id!==link.id);result={id:link.id};break;
   }
   default: fail('UNSUPPORTED_ACTION',{action});
  }
  return copy(result);
 }
 function read({scope}){return publicState(room(scope));}
 function getOperation({scope,operationId}){const r=room(scope).operations.get(operationId);return r?copy(r.outcome):null;}
 function apply({scope,requestId,operationId,action,args,expectedRevision}={}){
  if(!safe(requestId,120)||!safe(operationId,160)||!safe(action,80)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw new TypeError('Invalid action port input');
  const current=room(scope);const existing=current.operations.get(operationId);
  // Identical retries return the same outcome; conflicting reuse can never impersonate success.
  const fingerprint=JSON.stringify({requestId,action,args,expectedRevision});
  if(existing){
    if(existing.fingerprint!==fingerprint)return {status:'rejected',operationId,code:'OPERATION_ID_CONFLICT',revision:current.revision};
    return copy(existing.outcome);
  }
  if(expectedRevision!==current.revision)return {status:'conflict',code:'REVISION_CONFLICT',revision:current.revision};
  const next={...publicState(current)};
  try{
   const artifact=mutate(next,action,args);
   next.revision++;
   current.revision=next.revision;current.skills=next.skills;current.blocks=next.blocks;current.links=next.links;
   const outcome={status:'applied',operationId,revision:current.revision,artifacts:[artifact],changeSet:publicState(current)};
   current.operations.set(operationId,{fingerprint,outcome:copy(outcome)});return copy(outcome);
  }catch(error){
   if(!error.code)throw error;
   const outcome={status:'rejected',operationId,code:error.code,details:error.details??null,revision:current.revision};
   current.operations.set(operationId,{fingerprint,outcome:copy(outcome)});return copy(outcome);
  }
 }
 return Object.freeze({read,apply,getOperation});
}