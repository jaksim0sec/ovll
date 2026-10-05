(function(global){
"use strict";

const STATE_KEY="__ovllNavigation";
const SESSION_ID=[
  Date.now().toString(36),
  Math.random().toString(36).slice(2,10)
].join("-");
let sequence=0;
const suppressed=new Set();

function nextId(){
  sequence+=1;
  return SESSION_ID+"-"+sequence.toString(36);
}

function markerFrom(state){
  const marker=state?.[STATE_KEY];

  if(
    !marker||
    marker.session!==SESSION_ID||
    !Number.isInteger(marker.depth)||
    marker.depth<0
  ){
    return null;
  }

  return marker;
}

function stateWith(marker){
  const source=
    global.history.state&&
    typeof global.history.state==="object"
      ?global.history.state
      :{};

  return {
    ...source,
    [STATE_KEY]:marker
  };
}

function createMarker(
  layer,
  depth,
  parentLayer
){
  return {
    session:SESSION_ID,
    id:nextId(),
    layer:String(layer||"base"),
    depth:Math.max(0,Number(depth)||0),
    parentLayer:
      parentLayer==null
        ?null
        :String(parentLayer)
  };
}

let current=
  createMarker(
    "base",
    0,
    null
  );

try{
  global.history.replaceState(
    stateWith(current),
    "",
    global.location.href
  );
}catch{}

function snapshot(){
  return {
    ...current
  };
}

function isCurrent(layer){
  return (
    current.layer===
    String(layer||"")
  );
}

function write(
  method,
  marker,
  url
){
  const targetUrl=
    typeof url==="string"&&
    url
      ?url
      :global.location.href;

  global.history[method](
    stateWith(marker),
    "",
    targetUrl
  );

  current=marker;

  return snapshot();
}

function open(
  layer,
  options={}
){
  const name=
    String(layer||"").trim();

  if(!name){
    return snapshot();
  }

  if(
    isCurrent(name)&&
    options.force!==true
  ){
    if(
      typeof options.url==="string"&&
      options.url
    ){
      try{
        global.history.replaceState(
          stateWith(current),
          "",
          options.url
        );
      }catch{}
    }

    return snapshot();
  }

  if(options.replace===true){
    const marker=
      createMarker(
        name,
        current.depth,
        current.parentLayer
      );

    return write(
      "replaceState",
      marker,
      options.url
    );
  }

  const marker=
    createMarker(
      name,
      current.depth+1,
      current.layer
    );

  return write(
    "pushState",
    marker,
    options.url
  );
}

function replace(
  layer,
  options={}
){
  return open(
    layer,
    {
      ...options,
      replace:true,
      force:true
    }
  );
}

function close(
  layer,
  closeNow
){
  const name=
    String(layer||"").trim();

  if(
    !name||
    !isCurrent(name)
  ){
    closeNow?.();
    return false;
  }

  suppressed.add(
    current.id
  );

  closeNow?.();

  try{
    global.history.back();
    return true;
  }catch{
    suppressed.delete(
      current.id
    );
    return false;
  }
}

function goToDepth(
  depth,
  closeNow
){
  const target=
    Math.max(
      0,
      Math.min(
        current.depth,
        Number(depth)||0
      )
    );

  const distance=
    current.depth-target;

  if(distance<=0){
    closeNow?.();
    return false;
  }

  suppressed.add(
    current.id
  );

  closeNow?.();

  try{
    global.history.go(
      -distance
    );
    return true;
  }catch{
    suppressed.delete(
      current.id
    );
    return false;
  }
}

function handlePopState(event){
  const previous=
    current;

  const next=
    markerFrom(
      event.state
    );

  if(!next){
    return;
  }

  current=next;

  const direction=
    next.depth<
      previous.depth
      ?"back"
      :next.depth>
          previous.depth
        ?"forward"
        :"replace";

  if(
    direction==="back"&&
    previous.id!==next.id
  ){
    if(
      suppressed.has(
        previous.id
      )
    ){
      suppressed.delete(
        previous.id
      );
    }else{
      global.dispatchEvent(
        new CustomEvent(
          "ovll:navigation-back",
          {
            detail:{
              layer:
                previous.layer,
              from:
                {...previous},
              to:
                {...next}
            }
          }
        )
      );
    }
  }

  global.dispatchEvent(
    new CustomEvent(
      "ovll:navigation-change",
      {
        detail:{
          direction,
          from:
            {...previous},
          to:
            {...next}
        }
      }
    )
  );
}

global.addEventListener(
  "popstate",
  handlePopState
);

global.OvllNavigation=
  Object.freeze({
    open,
    replace,
    close,
    goToDepth,
    current:snapshot,
    isCurrent
  });

})(window);
