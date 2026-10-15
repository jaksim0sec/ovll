import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const svgLibrarySource=fs.readFileSync(new URL("../front/js/svgLibrary.js",import.meta.url),"utf8");
const apiSource=fs.readFileSync(new URL("../front/js/api.js",import.meta.url),"utf8");
const ICON_KEYS={start:"play",research:"globe",organize:"notebook",judge:"scales",write:"pen",file:"folder",createFile:"sparkle"};

function serverDefinitions(){
  return Object.fromEntries(Object.entries(ICON_KEYS).map(([type,iconKey])=>[type,{name:type,iconKey}]));
}
function serverIcons(source){
  return Object.fromEntries([...Object.values(ICON_KEYS),"custom"].map(key=>[key,`<svg data-source="${source}" data-key="${key}" viewBox="0 0 20 20"></svg>`]));
}
function createStorage(initial={}){
  const values=new Map(Object.entries(initial));
  return {
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    value:key=>values.get(key)
  };
}
function createBrowser({storedDefinitions=null,storedIcons=null,fetchDefinitions=null,fetchIcons=null,fetchError=null}={}){
  const storage=createStorage({
    ...(storedDefinitions?{"ovll:skill-definitions":JSON.stringify(storedDefinitions)}:{}),
    ...(storedIcons?{"ovll:server-icon-svg-cache":JSON.stringify(storedIcons)}:{})
  });
  const window={OVLL_RUNTIME:{},localStorage:storage,setTimeout,clearTimeout};
  const context={window,localStorage:storage,console,AbortController,URL,setTimeout,clearTimeout,
    fetch:async()=>{
      if(fetchError)throw fetchError;
      return {ok:true,status:200,json:async()=>({ok:true,skillDefinitions:fetchDefinitions||serverDefinitions(),iconSvg:fetchIcons||serverIcons("fresh")})};
    }
  };
  vm.createContext(context);
  vm.runInContext(svgLibrarySource,context);
  vm.runInContext(apiSource,context);
  return {window,storage};
}

test("fresh server skillNode skillDefinitions carry keys while SVGs live in the server catalog",async()=>{
  const skillDefinitions={...serverDefinitions(),"custom:demo":{name:"demo",iconKey:"custom"}};
  const browser=createBrowser({fetchDefinitions:skillDefinitions,fetchIcons:serverIcons("live")});
  const received=await browser.window.AstraAPI.getSkillDefinitions({force:true});
  for(const [type,key] of Object.entries(ICON_KEYS)){
    assert.equal(received[type].iconKey,key);
    assert.equal("icon" in received[type],false);
    assert.match(browser.window.OvllSvgLibrary.get(key),/data-source="live"/);
  }
  assert.equal(received["custom:demo"].iconKey,"custom");
  const stored=JSON.parse(browser.storage.value("ovll:skill-definitions"));
  assert.equal(stored.write.iconKey,"pen");
  assert.equal("icon" in stored.write,false);
});

test("online refresh replaces stale skillDefinitions and icon cache",async()=>{
  const browser=createBrowser({
    storedDefinitions:serverDefinitions(),
    storedIcons:serverIcons("cached"),
    fetchDefinitions:serverDefinitions(),
    fetchIcons:serverIcons("fresh")
  });
  const skillDefinitions=await browser.window.AstraAPI.getSkillDefinitions();
  assert.equal(skillDefinitions.research.iconKey,"globe");
  assert.match(browser.window.OvllSvgLibrary.get("globe"),/data-source="fresh"/);
});

test("offline boot uses cached skillDefinitions and cached SVGs without treating them as authority",async()=>{
  const browser=createBrowser({
    storedDefinitions:serverDefinitions(),
    storedIcons:serverIcons("cached"),
    fetchError:new Error("offline")
  });
  const defs=await browser.window.AstraAPI.getSkillDefinitions();
  assert.equal(defs.write.iconKey,"pen");
  assert.match(browser.window.OvllSvgLibrary.get("pen"),/data-source="cached"/);
});

test("generic UI glyphs remain available independently from server skillNode icons",()=>{
  const browser=createBrowser();
  const library=browser.window.OvllSvgLibrary;
  assert.equal(library.has("composerSend"),true);
  assert.match(library.get("composerSend"),/<svg/);
  assert.equal(library.getServerKeys().length,0);
  assert.equal(library.getSkillNodeIcon,undefined);
  assert.equal(library.hasSkillNodeIcon,undefined);
  assert.equal(library.skillNodeIcons,undefined);
});
