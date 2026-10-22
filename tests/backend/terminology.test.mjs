import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../../',import.meta.url);
async function files(dir){const items=await readdir(new URL(dir,root),{withFileTypes:true});return (await Promise.all(items.map(async e=>e.isDirectory()?files(dir+e.name+'/'):[dir+e.name]))).flat();}
test('active documentation and prompts consistently name Hallway and Workshop',async()=>{
 const all=[...(await files('docs/developing/')),...(await files('docs/notes/')),...(await files('prompts/'))];
 for(const p of all){const c=await readFile(new URL(p,root),'utf8');assert.doesNotMatch(c,/corridor|workroom/i,p);}
 const manifest=JSON.parse(await readFile(new URL('prompts/manifest.json',root),'utf8'));
 assert.deepEqual(Object.keys(manifest.layers),['gate','hallwayInitial','hallwayReturn','output']);
 for(const entries of Object.values(manifest.layers)){for(const p of entries)await access(new URL('prompts/'+p,root));}
});
