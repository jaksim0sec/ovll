const TEXT_LIMIT=64*1024;

/** Keep file bytes local; only a bounded plain-text excerpt is read for preview. */
export async function readLocalFile(file) {
  if(!(file instanceof Blob)||typeof file.name!=='string')throw new TypeError('기기에서 선택한 파일이 필요합니다.');
  const metadata={localId:crypto.randomUUID(),name:file.name,type:file.type||'application/octet-stream',size:file.size,blob:file};
  if(/^(text\/|application\/(json|xml))/.test(file.type)||/\.(txt|md|csv|json|xml|ya?ml)$/i.test(file.name))metadata.text=await file.slice(0,TEXT_LIMIT).text();
  return metadata;
}

/** URLs belong to a block's selected local file, never to an activation session. */
export function createFileResources() {
  const resources=new Map();
  function release(id){const entry=resources.get(id);if(entry){URL.revokeObjectURL(entry.url);resources.delete(id)}}
  return {
    sync(blocks){
      const keep=new Set();
      for(const block of blocks){
        const file=block.file;if(!(file?.blob instanceof Blob))continue;
        const key=file.localId||`legacy:${file.name}:${file.type}:${file.size}`;keep.add(block.id);
        if(resources.get(block.id)?.key===key)continue;
        release(block.id);resources.set(block.id,{key,url:URL.createObjectURL(file.blob)});
      }
      for(const id of resources.keys())if(!keep.has(id))release(id);
    },
    getUrl:id=>resources.get(id)?.url||null,
    destroy(){for(const id of resources.keys())release(id)}
  };
}
