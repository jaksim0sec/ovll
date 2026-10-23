import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const swPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../front/sw.js');

test('beta retires old main service worker caches, unregisters and reloads clients',async()=>{
  const script=await readFile(swPath,'utf8');
  const events=new Map();
  const removed=[];const navigated=[];let unregistered=0,skipped=0;
  const self={
    location:{origin:'https://astra-ep6m.onrender.com'},
    addEventListener(type,fn){events.set(type,fn);},
    skipWaiting(){skipped++;return Promise.resolve();},
    registration:{unregister(){unregistered++;return Promise.resolve(true);}},
    clients:{matchAll:async()=>[
      {url:'https://astra-ep6m.onrender.com/?page=workspace',navigate:async url=>{navigated.push(url);}},
      {url:'https://other.example/',navigate:async()=>{throw Error('should not navigate');}}
    ]}
  };
  const caches={keys:async()=>['ovll-shell-v87','some-unrelated-cache'],delete:async key=>{removed.push(key);return true;}};
  runInNewContext(script,{self,caches,URL,Promise});
  let install;
  events.get('install')({waitUntil(p){install=p;}});
  await install;
  assert.equal(skipped,1);
  let activation;
  events.get('activate')({waitUntil(p){activation=p;}});
  await activation;
  assert.deepEqual(removed,['ovll-shell-v87']);
  assert.equal(unregistered,1);
  assert.deepEqual(navigated,['https://astra-ep6m.onrender.com/?page=workspace']);
  assert.equal(events.has('fetch'),false);
});
