import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function createBrowser(){
  const listeners=new Map();
  const entries=[
    {
      state:null,
      url:"https://ovll.test/home?mode=chat"
    }
  ];
  let index=0;

  const window={
    location:{
      href:entries[0].url
    },
    addEventListener(type,handler){
      if(!listeners.has(type)){
        listeners.set(type,new Set());
      }
      listeners.get(type).add(handler);
    },
    removeEventListener(type,handler){
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event){
      for(const handler of listeners.get(event.type)||[]){
        handler.call(window,event);
      }
      return true;
    }
  };

  const history={
    get state(){
      return entries[index].state;
    },
    get length(){
      return entries.length;
    },
    replaceState(state,_title,url){
      entries[index]={
        state,
        url:String(url||window.location.href)
      };
      window.location.href=
        entries[index].url;
    },
    pushState(state,_title,url){
      entries.splice(index+1);
      entries.push({
        state,
        url:String(url||window.location.href)
      });
      index=entries.length-1;
      window.location.href=
        entries[index].url;
    },
    back(){
      history.go(-1);
    },
    go(delta){
      const next=
        Math.max(
          0,
          Math.min(
            entries.length-1,
            index+Number(delta||0)
          )
        );

      if(next===index){
        return;
      }

      index=next;
      window.location.href=
        entries[index].url;

      window.dispatchEvent({
        type:"popstate",
        state:entries[index].state
      });
    }
  };

  window.history=history;

  class CustomEvent{
    constructor(type,options={}){
      this.type=type;
      this.detail=options.detail;
    }
  }

  const context={
    window,
    CustomEvent,
    Date,
    Math,
    Object,
    String,
    Number,
    Set
  };

  vm.createContext(context);

  return {
    window,
    history,
    entries,
    context
  };
}

test("PWA navigation closes stacked UI before leaving the app",()=>{
  const source=
    fs.readFileSync(
      new URL(
        "../front/js/navigation.js",
        import.meta.url
      ),
      "utf8"
    );

  const browser=
    createBrowser();

  vm.runInContext(
    source,
    browser.context
  );

  const nav=
    browser.window
      .OvllNavigation;

  assert.equal(
    nav.current().layer,
    "base"
  );
  assert.equal(
    nav.current().depth,
    0
  );

  const backs=[];

  browser.window
    .addEventListener(
      "ovll:navigation-back",
      event=>{
        backs.push(
          event.detail.layer
        );
      }
    );

  nav.open("sidebar");
  nav.open("artifact-preview");

  assert.equal(
    nav.current().layer,
    "artifact-preview"
  );
  assert.equal(
    nav.current().depth,
    2
  );

  browser.history.back();

  assert.deepEqual(
    backs,
    ["artifact-preview"]
  );
  assert.equal(
    nav.current().layer,
    "sidebar"
  );

  let manualClose=0;

  nav.close(
    "sidebar",
    ()=>{
      manualClose+=1;
    }
  );

  assert.equal(
    manualClose,
    1
  );
  assert.deepEqual(
    backs,
    ["artifact-preview"]
  );
  assert.equal(
    nav.current().layer,
    "base"
  );
  assert.equal(
    nav.current().depth,
    0
  );
});

test("history replacement preserves the underlying canvas parent",()=>{
  const source=
    fs.readFileSync(
      new URL(
        "../front/js/navigation.js",
        import.meta.url
      ),
      "utf8"
    );

  const browser=
    createBrowser();

  vm.runInContext(
    source,
    browser.context
  );

  const nav=
    browser.window
      .OvllNavigation;

  nav.open(
    "canvas",
    {
      url:
        "https://ovll.test/home?mode=canvas"
    }
  );

  nav.open("sidebar");

  assert.equal(
    nav.current().parentLayer,
    "canvas"
  );

  nav.replace("library");

  assert.equal(
    nav.current().layer,
    "library"
  );
  assert.equal(
    nav.current().parentLayer,
    "canvas"
  );
  assert.equal(
    nav.current().depth,
    2
  );

  let collapsed=0;

  nav.goToDepth(
    0,
    ()=>{
      collapsed+=1;
    }
  );

  assert.equal(
    collapsed,
    1
  );
  assert.equal(
    nav.current().layer,
    "base"
  );
  assert.equal(
    nav.current().depth,
    0
  );
});

test("frontend split and PWA shell include navigation infrastructure",()=>{
  const boot=
    fs.readFileSync(
      new URL(
        "../front/js/boot.js",
        import.meta.url
      ),
      "utf8"
    );

  const worker=
    fs.readFileSync(
      new URL(
        "../front/sw.js",
        import.meta.url
      ),
      "utf8"
    );

  const server=
    fs.readFileSync(
      new URL(
        "../server.js",
        import.meta.url
      ),
      "utf8"
    );

  const vercel=
    JSON.parse(
      fs.readFileSync(
        new URL(
          "../front/vercel.json",
          import.meta.url
        ),
        "utf8"
      )
    );

  assert.ok(
    boot.indexOf(
      "./js/navigation.js"
    )<
    boot.indexOf(
      "./js/ui.js"
    )
  );

  assert.match(
    worker,
    /ovll-shell-v53/
  );
  assert.match(
    worker,
    /\/js\/navigation\.js/
  );
  assert.match(
    server,
    /const APP_VERSION = ['"]\d{4}\.\d{2}\.\d{2}\.\d+['"];/
  );

  const apiRewrite=
    vercel.rewrites.find(
      item=>
        item.source===
        "/api/:path*"
    );

  assert.equal(
    apiRewrite?.destination,
    "https://astra-ep6m.onrender.com/api/:path*"
  );
});
