/** Frontend request preflight: dereference only explicitly attached references. */
export function prepareRequestInput({draft,dataAccess}={}) {
  if(!Array.isArray(draft?.parts)||!Array.isArray(draft?.attachments)||!dataAccess?.readCanvasSnapshot||!dataAccess?.readSkillCatalog)
    throw new TypeError('Invalid request input');
  const clone=v=>structuredClone(v);
  const hasBlock=draft.parts.some(p=>p.type==='block');
  const hasRef=draft.parts.some(p=>p.type==='skill'||p.type==='block');
  const blocks=hasBlock?dataAccess.readCanvasSnapshot()?.snapshot?.blocks:[];
  const skills=hasRef?dataAccess.readSkillCatalog()?.definitions:[];
  if(!Array.isArray(blocks)||!Array.isArray(skills))throw new TypeError('Invalid frontend resource snapshot');
  const resources=[],seen=new Set();
  function add(dataset,key,value,source,completeness){
    const fingerprint=JSON.stringify([dataset,key]);if(seen.has(fingerprint))return;seen.add(fingerprint);
    resources.push({dataset,key,source,completeness,value:value==null?null:clone(value)});
  }
  function skill(id){
    const found=skills.find(s=>s?.id===id);
    if(!found){add('skillDef',id,null,'local-presentation-catalog','missing');return;}
    add('skillDef',found.name,found,'local-presentation-catalog','metadata');
  }
  for(const part of draft.parts){
    if(part?.type==='skill')skill(part.id);
    if(part?.type==='block'){
      const b=blocks.find(b=>b?.id===part.id);
      if(!b){add('canvasSkill',part.id,null,'local-view','missing');continue;}
      const {file,...rest}=b;
      const safe=file?{...rest,file:{...(typeof file.localId==='string'?{localId:file.localId}:{}),name:file.name,type:file.type,size:file.size,
        ...(typeof file.localBlobAvailable==='boolean'?{localBlobAvailable:file.localBlobAvailable}:{})}}:rest;
      add('canvasSkill',b.id,safe,'local-view','complete');
      skill(b.skillId);
    }
  }
  const attachments=draft.attachments.map(({file,blob,...metadata})=>clone(metadata));
  return {request:{parts:clone(draft.parts),attachments},initialResources:resources};
}
