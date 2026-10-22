import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
/** Manifest-driven layer instruction composition, independent of the AI provider. */
export function createPromptComposer({promptsRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../prompts')}={}){
  const root=path.resolve(promptsRoot);
  async function compose(layer,bindings={}){
    const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
    const parts=manifest.layers?.[layer];
    if(!Array.isArray(parts)||parts.length===0)throw new TypeError('Unknown layer');
    const chunks=[];
    for(const relative of parts){
      if(typeof relative!=='string'||! /^(common|base|blocks)\/[A-Za-z0-9]+\.md$/.test(relative))throw new TypeError('Invalid prompt path');
      const raw=await readFile(path.join(root,relative),'utf8');
      const missing=[];
      const content=raw.replace(/\$\{([A-Za-z][A-Za-z0-9]*)\}/g,(full,key)=>{
        if(typeof bindings[key]!=='string'){missing.push(key);return full;}
        return bindings[key];
      });
      if(missing.length)throw new TypeError('Missing prompt binding: '+missing.join(','));
      chunks.push(content);
    }
    return chunks.join('\n\n---\n\n');
  }
  return Object.freeze({compose});
}
