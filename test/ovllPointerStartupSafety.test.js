import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source=fs.readFileSync(new URL("../front/js/app.js",import.meta.url),"utf8");
const start=source.indexOf("async function connectPointer(){");
const end=source.indexOf("  function showLocalRun",start);
assert.ok(start>=0&&end>start,"Pointer startup boundary must exist");
const createConnect=new Function("pointerScope","state","refreshPointerCanvas",
  "PointerAPI","showErrorNotice","console","handlePointerServerEvent","setRuntimeActivity",
  source.slice(start,end)+"\nreturn connectPointer;");

test("Pointer snapshot failure cannot reject workspace startup or clear saved data",async()=>{
  const state={canvas:{},pointerWatch:null,pointerLocalReady:true};
  const notices=[],errors=[],failure=new Error("CATALOG_UNAVAILABLE");
  const connect=createConnect(()=>({storageMode:"local"}),state,
    async()=>{throw failure;},{watch(){throw Error("unexpected watch");}},
    (error,options)=>notices.push({error,options}),{error:(...x)=>errors.push(x)},
    ()=>{},()=>{});
  await assert.doesNotReject(connect());
  assert.equal(state.pointerLocalReady,false);
  assert.equal(notices.length,1);
  assert.equal(notices[0].error,failure);
  assert.equal(errors.length,1);
});

test("healthy local Pointer restores normally without disabling it",async()=>{
  const state={canvas:{},pointerWatch:null,pointerLocalReady:true};
  let restored=0;
  const connect=createConnect(()=>({storageMode:"local"}),state,
    async()=>{restored++;return 0;},{watch(){throw Error("unexpected watch");}},
    ()=>{throw Error("unexpected notice");},{error(){throw Error("unexpected error");}},
    ()=>{},()=>{});
  await connect();
  assert.equal(restored,1);
  assert.equal(state.pointerLocalReady,true);
});

test("saved conversation errors are isolated from the final app-ready signal",()=>{
  const i=source.indexOf("async function initialize()");
  const tail=source.slice(i,source.indexOf("  const app = {",i));
  assert.match(tail,/try\s*\{\s*await openConversation\(active\.id,\{skipSave:true\}\)/);
  assert.match(tail,/catch\(error\)\s*\{[\s\\S]*?state\.pointerLocalReady=false/);
  assert.match(tail,/dispatchEvent\([\s\\S]*?"ovll:app-ready"/);
});
