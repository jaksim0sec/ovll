/** Beta client read-only state views. Never treat these as backend need data or execution IR. */
const CACHE_KINDS=new Set(['roomInfo','chatRecord','chatDraft','contextData','canvasState']);
export function createWorkspaceDataAccess({roomId,model,canvas,composer,data,listSkills,isAlive=()=>true}){
  if(typeof roomId!=='string'||!roomId||!model?.getSnapshot||!canvas?.flushPendingEdits||!composer?.getDraft||!data?.cache?.read||!data?.cache?.list||typeof listSkills!=='function')
    throw new TypeError('Workspace data readers are required');
  if(typeof isAlive!=='function')throw new TypeError('isAlive must be a function');
  const assertAlive=()=>{if(!isAlive())throw new Error('Workspace has been destroyed');};
  const clone=value=>structuredClone(value);
  function readCanvasSnapshot(){
    assertAlive();
    // Buffered textarea values must be applied before inspecting the actual graph.
    canvas.flushPendingEdits();
    const snapshot=model.getSnapshot();
    return {roomId,source:'local-view',format:'beta-local-edit-graph-v1',snapshot:{
      version:snapshot.version,
      blocks:snapshot.blocks.map(block=>{
        const {file,...rest}=block;
        if(!file)return rest;
        return {...rest,file:{
          ...(typeof file.localId==='string'?{localId:file.localId}:{}),
          name:file.name,type:file.type,size:file.size,
          localBlobAvailable:typeof Blob!=='undefined'&&file.blob instanceof Blob,
          textPreviewAvailable:typeof file.text==='string'
        }};
      }),links:snapshot.links
    }};
  }
  // One-shot JSON export; transport and executable IR are separate responsibilities.
  function exportCanvasJSON(){return JSON.stringify(readCanvasSnapshot());}
  function readSkillCatalog(){assertAlive();return {source:'local-presentation-catalog',definitions:clone(listSkills())};}
  function readComposerDraft(){
    assertAlive();
    const draft=composer.getDraft();
    return {roomId,source:'local-unsent-draft',parts:clone(draft.parts),
      attachments:draft.attachments.map(file=>({
        ...(typeof file.id==='string'?{id:file.id}:{}),
        name:file.name,type:file.type,size:file.size,
        ...(typeof file.lastModified==='number'?{lastModified:file.lastModified}:{}),
        localBlobAvailable:typeof Blob!=='undefined'&&file.file instanceof Blob
      }))};
  }
  async function readCached(kind,{limit=50}={}){
    assertAlive();
    if(!CACHE_KINDS.has(kind))throw new TypeError('Unsupported Workspace cache kind');
    // Key order != chronological history. The cache is not authoritative.
    const result=kind==='chatRecord' ? await data.cache.list(kind,roomId,{limit}) : await data.cache.read(kind,roomId,'state');
    assertAlive();
    return clone(result);
  }
  return Object.freeze({readCanvasSnapshot,exportCanvasJSON,readSkillCatalog,readComposerDraft,readCached});
}
