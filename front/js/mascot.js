(function(global){
"use strict";

const STYLE_ID="ovll-mascot-style";
const DEFAULT_COLOR="#4b94ff";

function installStyle(){
  if(document.getElementById(STYLE_ID)) return;

  const style=document.createElement("style");
  style.id=STYLE_ID;
  style.textContent=`
.ovll-mascot{
  --agent-color:#4b94ff;
  --react-color:var(--agent-color);
  --agent-size:2.08rem;

  --body-color:#202120;
  --eye-color:#efefec;

  --eye-w:.425rem;
  --eye-h:.445rem;
  --eye-radius:.17rem;

  --ex:0rem;
  --ey:0rem;
  --gaze-sx:1;
  --gaze-sy:1;
  --eye-tilt:0deg;

  --mood-ex:0rem;
  --mood-ey:0rem;
  --mood-eye-tilt:0deg;
  --mood-lean:0deg;

  --blink:1;
  --lean:0deg;
  --sx:1;
  --sy:1;

  position:absolute;
  z-index:1000;
  left:0;
  top:0;

  width:var(--agent-size);
  aspect-ratio:1;

  display:flex;
  align-items:center;
  justify-content:center;

  padding:0;
  overflow:hidden;

  border:
    .0625rem solid
    var(--body-color);
  border-radius:50%;

  background:var(--body-color);

  box-shadow:
    0 .1rem .36rem
      rgba(0,0,0,.17);

  transform:translate(-50%,-50%);
  rotate:
    calc(
      var(--lean) +
      var(--mood-lean)
    );
  scale:var(--sx) var(--sy);

  transition:
    rotate .3s cubic-bezier(.16,.84,.22,1),
    scale .28s cubic-bezier(.16,.84,.22,1),
    background .2s ease,
    box-shadow .2s ease,
    filter .18s ease;

  animation:ovll-idle 6.5s ease-in-out infinite;

  cursor:grab;
  touch-action:none;
  user-select:none;
  -webkit-user-select:none;
}

.ovll-mascot-eye{
  position:relative;
  z-index:1;

  width:var(--eye-w);
  height:var(--eye-h);

  border-radius:var(--eye-radius);
  background:var(--eye-color);

  transform:
    translate(
      calc(
        var(--ex) +
        var(--mood-ex)
      ),
      calc(
        var(--ey) +
        var(--mood-ey)
      )
    )
    rotate(
      calc(
        var(--eye-tilt) +
        var(--mood-eye-tilt)
      )
    )
    scale(
      var(--gaze-sx),
      calc(var(--blink) * var(--gaze-sy))
    );

  transition:
    transform .24s cubic-bezier(.16,.84,.22,1),
    width .24s cubic-bezier(.16,.84,.22,1),
    height .24s cubic-bezier(.16,.84,.22,1),
    border-radius .24s cubic-bezier(.16,.84,.22,1),
    background .2s ease;

  pointer-events:none;
}

.ovll-mascot[data-mood="idle"]{
  --eye-w:.425rem;
  --eye-h:.445rem;
  --eye-radius:.17rem;
}

.ovll-mascot[data-mood="thinking"]{
  --eye-w:.51rem;
  --eye-h:.16rem;
  --eye-radius:.1rem;
  --mood-ey:-.035rem;
}

.ovll-mascot[data-mood="focus"],
.ovll-mascot[data-mood="attention"]{
  --eye-w:.32rem;
  --eye-h:.5rem;
  --eye-radius:.14rem;
}

.ovll-mascot[data-mood="curious"]{
  --eye-w:.49rem;
  --eye-h:.5rem;
  --eye-radius:.2rem;
  --mood-lean:5deg;
}

.ovll-mascot[data-mood="surprised"]{
  --eye-w:.56rem;
  --eye-h:.56rem;
  --eye-radius:50%;
}

.ovll-mascot[data-mood="annoyed"]{
  --eye-w:.53rem;
  --eye-h:.105rem;
  --eye-radius:.06rem;
  --mood-eye-tilt:-1.5deg;
  --mood-lean:-.75deg;
}

.ovll-mascot[data-mood="success"],
.ovll-mascot[data-mood="happy"]{
  --eye-w:.49rem;
  --eye-h:.22rem;
  --eye-radius:.07rem .07rem .24rem .24rem;
  --mood-ey:.03rem;
}

.ovll-mascot[data-mood="working"]{
  --eye-w:.28rem;
  --eye-h:.54rem;
  --eye-radius:.13rem;
}

.ovll-mascot[data-mood="bumped"]{
  --eye-w:.5rem;
  --eye-h:.075rem;
  --eye-radius:999px;
  --mood-eye-tilt:0deg;
  --mood-lean:0deg;
}

.ovll-mascot[data-mood="sleepy"]{
  --eye-w:.5rem;
  --eye-h:.07rem;
  --eye-radius:999px;
  --mood-ey:.05rem;
}

.ovll-mascot[data-mood="confused"]{
  --eye-w:.405rem;
  --eye-h:.405rem;
  --eye-radius:.15rem;
  --mood-eye-tilt:9deg;
  --mood-lean:-6deg;
}

.ovll-mascot[data-mood="suspicious"]{
  --eye-w:.53rem;
  --eye-h:.095rem;
  --eye-radius:.055rem;
  --mood-ex:.07rem;
  --mood-eye-tilt:1.5deg;
  --mood-lean:1.5deg;
}

:root.dark .ovll-mascot{
  --body-color:#dededb;
  --eye-color:#151617;

  border-color:
    var(--body-color);

  box-shadow:
    0 .1rem .36rem
      rgba(0,0,0,.24);
}

.ovll-mascot.connecting{
  background:
    radial-gradient(
      circle at 27% 74%,
      color-mix(
        in srgb,
        var(--react-color) 78%,
        transparent
      ),
      transparent 60%
    ),
    radial-gradient(
      circle at 78% 20%,
      color-mix(
        in srgb,
        var(--react-color) 34%,
        transparent
      ),
      transparent 52%
    ),
    var(--body-color);

  box-shadow:
    0 .1rem .38rem rgba(0,0,0,.2),
    0 0 .62rem
      color-mix(
        in srgb,
        var(--react-color) 22%,
        transparent
      );
}

.ovll-mascot.moving,
.ovll-mascot.pushed,
.ovll-mascot.returning,
.ovll-mascot.curious{
  animation:none;
}

.ovll-mascot.grabbed{
  animation:none;
  --sx:1.07;
  --sy:.93;
  cursor:grabbing;
}

.ovll-mascot.working{
  animation:ovll-working 1.25s ease-in-out infinite;
}

.ovll-mascot.thinking{
  animation:ovll-thinking 1.9s ease-in-out infinite;
}

.ovll-mascot[data-task="research"].working{
  animation:ovll-task-research 1.45s ease-in-out infinite;
}

.ovll-mascot[data-task="organize"].working{
  animation:ovll-task-organize 1.7s ease-in-out infinite;
}

.ovll-mascot[data-task="judge"].working{
  animation:ovll-task-judge 1.35s ease-in-out infinite;
}

.ovll-mascot[data-task="write"].working{
  animation:ovll-task-write 1.05s ease-in-out infinite;
}

.ovll-mascot[data-task="createFile"].working{
  animation:ovll-task-create 1.3s ease-in-out infinite;
}

.ovll-mascot.pop{
  animation:ovll-pop .3s cubic-bezier(.18,.88,.25,1.2);
}

.ovll-mascot.boop{
  animation:ovll-boop .34s cubic-bezier(.18,.88,.25,1.25);
}

.ovll-mascot.bump{
  animation:ovll-bump .24s cubic-bezier(.18,.9,.25,1);
}

@keyframes ovll-task-research{
  0%,100%{translate:-.025rem 0}
  50%{translate:.025rem -.018rem}
}

@keyframes ovll-task-organize{
  0%,100%{translate:0 -.018rem}
  50%{translate:0 .018rem}
}

@keyframes ovll-task-judge{
  0%,100%{rotate:-2.4deg}
  50%{rotate:2.4deg}
}

@keyframes ovll-task-write{
  0%,100%{translate:0 0}
  45%{translate:0 .028rem}
}

@keyframes ovll-task-create{
  0%,100%{filter:brightness(1)}
  50%{filter:brightness(.82)}
}

@keyframes ovll-idle{
  0%,100%{translate:0 0}
  50%{translate:0 -.03rem}
}

@keyframes ovll-working{
  0%,100%{filter:brightness(1)}
  50%{filter:brightness(.86)}
}

@keyframes ovll-thinking{
  0%,100%{filter:brightness(1)}
  50%{filter:brightness(.94)}
}

@keyframes ovll-pop{
  0%,100%{scale:var(--sx) var(--sy)}
  48%{scale:1.1 .9}
}

@keyframes ovll-boop{
  0%,100%{scale:var(--sx) var(--sy)}
  30%{scale:1.1 .9}
  58%{scale:.97 1.05}
}

@keyframes ovll-bump{
  0%,100%{scale:var(--sx) var(--sy)}
  45%{scale:1.05 .95}
}

.ovll-mascot-satellite{
  --sat-size:.48rem;
  --sat-angle:0deg;
  --sat-radius:1.02rem;
  --sat-color:#202120;

  position:absolute;
  z-index:1001;
  left:var(--ovll-world-x,0px);
  top:var(--ovll-world-y,0px);

  width:var(--sat-size);
  height:var(--sat-size);

  border:.0625rem solid var(--sat-color);
  border-radius:50%;
  background:var(--sat-color);
  box-shadow:
    0 .06rem .2rem rgba(0,0,0,.18);

  opacity:0;
  pointer-events:none;
  will-change:transform,opacity;

  transform:
    translate(-50%,-50%)
    rotate(var(--sat-angle))
    translateX(var(--sat-radius))
    scale(.32);

  transition:
    opacity .18s ease,
    transform .28s cubic-bezier(.16,.84,.22,1),
    width .2s ease,
    height .2s ease,
    background .2s ease;
}

.ovll-mascot-satellite[data-mode="thought"]{
  --sat-size:.4rem;
  --sat-radius:.88rem;
  --sat-angle:-38deg;

  opacity:.88;
  transform:
    translate(-50%,-50%)
    rotate(var(--sat-angle))
    translateX(var(--sat-radius))
    scale(.78);
}

.ovll-mascot-satellite[data-mode="orbit"]{
  --sat-size:.42rem;
  --sat-radius:1.06rem;

  opacity:.86;
  animation:
    ovll-satellite-orbit
    2.7s linear infinite;
}

.ovll-mascot-satellite[data-mode="point"]{
  --sat-radius:.98rem;

  width:.72rem;
  height:.28rem;
  border-radius:999px;
  opacity:.98;
  box-shadow:
    0 .045rem .16rem rgba(0,0,0,.16);
  transform:
    translate(-50%,-50%)
    rotate(var(--sat-angle))
    translateX(var(--sat-radius));
  transition:
    opacity .12s ease,
    transform .18s cubic-bezier(.16,.84,.22,1),
    width .16s ease,
    height .16s ease,
    background .16s ease;
}

.ovll-mascot-satellite[data-mode="celebrate"]{
  --sat-size:.48rem;

  animation:
    ovll-satellite-celebrate
    .66s cubic-bezier(.18,.88,.25,1.14)
    both;
}

.ovll-mascot-satellite[data-mode="drop"]{
  --sat-size:.46rem;

  animation:
    ovll-satellite-drop
    .62s cubic-bezier(.25,.7,.3,1)
    both;
}

:root.dark
.ovll-mascot-satellite{
  --sat-color:#dededb;
}

@keyframes ovll-satellite-orbit{
  from{
    transform:
      translate(-50%,-50%)
      rotate(0deg)
      translateX(var(--sat-radius))
      scale(.78);
  }

  to{
    transform:
      translate(-50%,-50%)
      rotate(360deg)
      translateX(var(--sat-radius))
      scale(.78);
  }
}

@keyframes ovll-satellite-celebrate{
  0%{
    opacity:0;
    transform:
      translate(-50%,-50%)
      rotate(-25deg)
      translateX(.45rem)
      scale(.3);
  }

  35%{
    opacity:1;
    transform:
      translate(-50%,-50%)
      rotate(-52deg)
      translateX(1rem)
      scale(.92);
  }

  100%{
    opacity:0;
    transform:
      translate(-50%,-50%)
      rotate(18deg)
      translateX(.52rem)
      scale(.2);
  }
}

@keyframes ovll-satellite-drop{
  0%{
    opacity:.95;
    transform:
      translate(-50%,-50%)
      translate(.58rem,-.22rem)
      scale(.82);
  }

  100%{
    opacity:0;
    transform:
      translate(-50%,-50%)
      translate(.42rem,1.12rem)
      scale(.4);
  }
}

@media(prefers-reduced-motion:reduce){
  .ovll-mascot,
  .ovll-mascot-satellite{
    animation:none!important;
  }
}
`;

  document.head.appendChild(style);
}

function mount(world,canvas,options={}){
  installStyle();

  const documentRef=
    options.document||
    global.document;

  const UI=
    options.ui||
    UI;

  const App=
    options.app||
    App;

  const busyTarget=
    options.busyTarget||
    global;

  const composerElement=
    options.composer||
    documentRef.querySelector(
      "#composer-form"
    );

  const topbarElement=
    options.topbar||
    documentRef.querySelector(
      "#topbar"
    );

  const viewport=canvas.root;
  const orb=documentRef.createElement("button");
  const satellite=
    documentRef.createElement("span");

  orb.type="button";
  orb.className="ovll-mascot";
  orb.tabIndex=-1;
  orb.setAttribute("aria-label","OVLL");
  orb.innerHTML=
    '<span class="ovll-mascot-eye"></span>';

  satellite.className=
    "ovll-mascot-satellite";
  satellite.dataset.mode=
    "hidden";
  satellite.setAttribute(
    "aria-hidden",
    "true"
  );

  world.append(
    orb,
    satellite
  );

  orb.dataset.mood="idle";

  const agentColor=
    options.color||
    DEFAULT_COLOR;

  orb.style.setProperty(
    "--agent-color",
    agentColor
  );

  orb.style.setProperty(
    "--react-color",
    agentColor
  );

  if(options.size){
    orb.style.setProperty(
      "--agent-size",
      String(options.size)
    );
  }

  let x=0;
  let y=0;

  let drag=null;
  let motion=null;
  let focusId=null;
  let attentionUntil=0;
  let connectionClose=false;
  let lastIntentMove=0;
  let lastObservedId=null;
  let gazePriority=0;
  let gazeUntil=0;
  let layoutAnchor=null;
  let moodTimer=null;
  let thinkingTimer=null;
  let satelliteTimer=null;
  let satelliteTarget=null;
  let taskTimer=null;
  let idleBehaviorTimer=null;
  let activeTaskId=null;
  let taskStep=0;
  let connectionColor=false;
  let lastActivity=performance.now();

  let blinkTimer=null;
  let viewportTimer=null;
  let gazeTimer=null;
  let motionFrame=null;

  const cleanup=[];

  const center=rect=>({
    x:rect.left+rect.width/2,
    y:rect.top+rect.height/2
  });

  const nodeEl=id=>{
    if(id==null) return null;

    return[
      ...viewport.querySelectorAll(
        ".vc-node"
      )
    ].find(
      node=>
        node.dataset.nodeId===
        String(id)
    )||null;
  };

  function nodeColor(id){
    const node=nodeEl(id);

    return node
      ?getComputedStyle(node)
        .getPropertyValue("--node-color")
        .trim()||DEFAULT_COLOR
      :DEFAULT_COLOR;
  }

  function worldPoint(clientX,clientY){
    const rect=
      viewport.getBoundingClientRect();

    const raw=
      getComputedStyle(world).transform;

    const matrix=
      raw==="none"
        ?new DOMMatrix()
        :new DOMMatrix(raw);

    return new DOMPoint(
      clientX-rect.left,
      clientY-rect.top
    ).matrixTransform(
      matrix.inverse()
    );
  }

  function clientPoint(wx,wy){
    const rect=
      viewport.getBoundingClientRect();

    const raw=
      getComputedStyle(world).transform;

    const matrix=
      raw==="none"
        ?new DOMMatrix()
        :new DOMMatrix(raw);

    const point=
      new DOMPoint(
        wx,
        wy
      ).matrixTransform(matrix);

    return{
      x:rect.left+point.x,
      y:rect.top+point.y
    };
  }

  function render(){
    const left=x+"px";
    const top=y+"px";

    orb.style.left=left;
    orb.style.top=top;

    world.style.setProperty(
      "--ovll-world-x",
      left
    );
    world.style.setProperty(
      "--ovll-world-y",
      top
    );

    syncPointSatellite();
  }

  function syncPointSatellite(){
    if(
      satellite.dataset.mode!=="point"||
      !satelliteTarget
    ){
      return;
    }

    const c=
      clientPoint(x,y);

    const angle=
      Math.atan2(
        satelliteTarget.y-c.y,
        satelliteTarget.x-c.x
      )*
      180/
      Math.PI;

    satellite.style.setProperty(
      "--sat-angle",
      angle+"deg"
    );
  }

  const SATELLITE_MODES=
    new Set([
      "hidden",
      "thought",
      "orbit",
      "point",
      "celebrate",
      "drop"
    ]);

  function setSatellite(
    mode="hidden",
    {
      x:clientX=null,
      y:clientY=null,
      hold=0
    }={}
  ){
    clearTimeout(
      satelliteTimer
    );

    let next=
      SATELLITE_MODES.has(mode)
        ?mode
        :"hidden";

    const pointAllowed=
      next!=="point"||
      orb.classList.contains(
        "working"
      )||
      orb.classList.contains(
        "connecting"
      );

    if(!pointAllowed){
      next="hidden";
    }

    if(
      next==="point"&&
      Number.isFinite(clientX)&&
      Number.isFinite(clientY)
    ){
      satelliteTarget={
        x:clientX,
        y:clientY
      };
    }else if(next!=="point"){
      satelliteTarget=null;
    }

    satellite.dataset.mode=
      next;

    syncPointSatellite();

    if(hold>0){
      satelliteTimer=
        setTimeout(
          ()=>{
            satelliteTarget=null;
            satellite.dataset.mode=
              "hidden";
          },
          hold
        );
    }
  }

  function pointSatelliteAt(
    clientX,
    clientY,
    hold=0
  ){
    setSatellite(
      "point",
      {
        x:clientX,
        y:clientY,
        hold
      }
    );
  }

  function eyes(dx=0,dy=0){
    const max=.19;

    const nx=Math.max(
      -1,
      Math.min(
        1,
        dx/max
      )
    );

    const ny=Math.max(
      -1,
      Math.min(
        1,
        dy/max
      )
    );

    orb.style.setProperty(
      "--ex",
      `${dx}rem`
    );

    orb.style.setProperty(
      "--ey",
      `${dy}rem`
    );

    orb.style.setProperty(
      "--gaze-sx",
      String(
        1-Math.abs(nx)*.34
      )
    );

    orb.style.setProperty(
      "--gaze-sy",
      String(
        1-Math.abs(ny)*.12
      )
    );

    const tiltFactor=
      orb.dataset.mood===
        "annoyed"
        ?-1.4
        :-7;

    orb.style.setProperty(
      "--eye-tilt",
      `${nx*ny*tiltFactor}deg`
    );
  }

  function lookAt(clientX,clientY,amount=.175){
    const c=
      center(
        orb.getBoundingClientRect()
      );

    const dx=clientX-c.x;
    const dy=clientY-c.y;
    const d=
      Math.hypot(dx,dy)||1;

    eyes(
      dx/d*amount,
      dy/d*amount*.82
    );
  }

  function blink(){
    orb.style.setProperty(
      "--blink",
      ".08"
    );

    setTimeout(
      ()=>orb.style.setProperty(
        "--blink",
        "1"
      ),
      90
    );
  }

  const PULSE_CLASSES=
    [
      "pop",
      "boop",
      "bump"
    ];

  function pulse(name,duration){
    for(
      const className
      of PULSE_CLASSES
    ){
      orb.classList.remove(
        className
      );
    }

    void orb.offsetWidth;

    orb.classList.add(name);

    setTimeout(
      ()=>orb.classList.remove(name),
      duration
    );
  }

  function setEffectMode(
    mode="idle"
  ){
    orb.classList.toggle(
      "thinking",
      mode==="thinking"
    );

    orb.classList.toggle(
      "working",
      mode==="working"
    );
  }

  function react(){
    noteActivity();
    setMood("surprised",360);
    setSatellite(
      "celebrate",
      {hold:460}
    );
    pulse("boop",280);
    blink();
    eyes(.045,-.02);

    setTimeout(()=>{
      if(!drag&&!motion){
        restoreGaze();
      }
    },320);
  }

  function nodeVisible(node){
    const view=
      viewport.getBoundingClientRect();

    const composer=
      composerElement?.getBoundingClientRect();

    const topbar=
      topbarElement?.getBoundingClientRect();

    const rect=
      node.getBoundingClientRect();

    const safeTop=
      Math.max(
        view.top,
        topbar?.bottom??view.top
      )+8;

    const safeBottom=
      Math.min(
        view.bottom,
        composer?.top??view.bottom
      )-8;

    return(
      rect.right>view.left&&
      rect.left<view.right&&
      rect.bottom>safeTop&&
      rect.top<safeBottom
    );
  }

  function interestingNode(){
    const nodes=[
      ...viewport.querySelectorAll(
        ".vc-node"
      )
    ].filter(nodeVisible);

    if(!nodes.length)
      return null;

    const currentIndex=
      nodes.findIndex(
        node=>
          node.dataset.nodeId===
          String(lastObservedId)
      );

    return nodes[
      (currentIndex+1+nodes.length)%
      nodes.length
    ];
  }

  function restoreGaze(){
    clearTimeout(gazeTimer);

    const now=performance.now();

    const active=
      focusId&&
      now<attentionUntil
        ?nodeEl(focusId)
        :null;

    if(
      active&&
      nodeVisible(active)
    ){
      const c=
        center(
          active.getBoundingClientRect()
        );

      lookAt(
        c.x,
        c.y,
        .205
      );

      return;
    }

    const observed=
      interestingNode();

    if(observed){
      const c=
        center(
          observed.getBoundingClientRect()
        );

      lastObservedId=
        observed.dataset.nodeId||null;

      lookAt(
        c.x,
        c.y,
        .11
      );

      gazeTimer=setTimeout(
        ()=>{
          if(
            !drag&&
            !motion&&
            !connectionClose&&
            !App?.isBusy?.()&&
            performance.now()>=attentionUntil
          ){
            restoreGaze();
          }
        },
        1800+Math.random()*1400
      );

      return;
    }

    eyes();
  }

  function stopMotion(){
    if(motionFrame!==null){
      cancelAnimationFrame(motionFrame);
      motionFrame=null;
    }

    motion=null;

    orb.classList.remove(
      "moving",
      "pushed",
      "returning"
    );

    orb.style.setProperty("--lean","0deg");
    orb.style.setProperty("--sx","1");
    orb.style.setProperty("--sy","1");

    restoreGaze();
  }

  /*
    이동은 직선이 아니라 quadratic bezier.
    경로 근처 node가 있으면 반대쪽으로 control point를 밀어
    자연스럽게 피해 간다.
  */
  function swooshToward(
    clientX,
    clientY,
    {
      step=2.35,
      duration=380
    }={}
  ){
    if(drag)
      return false;

    const rect=
      orb.getBoundingClientRect();

    const current=
      center(rect);

    const dx=
      clientX-current.x;

    const dy=
      clientY-current.y;

    const distance=
      Math.hypot(dx,dy);

    if(distance<rect.width*.8)
      return false;

    if(motionFrame!==null)
      cancelAnimationFrame(motionFrame);

    const moveDistance=
      Math.min(
        distance,
        rect.width*step
      );

    const ux=dx/distance;
    const uy=dy/distance;

    const endClient={
      x:current.x+ux*moveDistance,
      y:current.y+uy*moveDistance
    };

    const lineX=
      endClient.x-current.x;

    const lineY=
      endClient.y-current.y;

    const lineLength=
      Math.hypot(lineX,lineY)||1;

    const normal={
      x:-lineY/lineLength,
      y:lineX/lineLength
    };

    let bend=
      Math.min(
        rect.width*.72,
        lineLength*.14
      );

    let bendSign=
      lineX>=0
        ?-1
        :1;

    let closest=
      Infinity;

    viewport
      .querySelectorAll(".vc-node")
      .forEach(node=>{
        if(!nodeVisible(node))
          return;

        const r=
          node.getBoundingClientRect();

        const nc=
          center(r);

        const projection=
          Math.max(
            0,
            Math.min(
              1,
              (
                (nc.x-current.x)*lineX+
                (nc.y-current.y)*lineY
              )/
              (lineLength*lineLength)
            )
          );

        if(
          projection<.08||
          projection>.92
        ){
          return;
        }

        const px=
          current.x+
          lineX*projection;

        const py=
          current.y+
          lineY*projection;

        const signed=
          (nc.x-px)*normal.x+
          (nc.y-py)*normal.y;

        const clearance=
          Math.abs(signed)-
          Math.max(
            r.width,
            r.height
          )*.56-
          rect.width*.78;

        if(clearance<closest){
          closest=clearance;

          if(clearance<0){
            bendSign=
              signed>=0
                ?-1
                :1;

            bend=Math.max(
              bend,
              Math.min(
                lineLength*.42,
                Math.abs(signed)+
                Math.max(
                  r.width,
                  r.height
                )*.62+
                rect.width*1.15
              )
            );
          }
        }
      });

    const controlClient={
      x:
        (current.x+endClient.x)/2+
        normal.x*bend*bendSign,
      y:
        (current.y+endClient.y)/2+
        normal.y*bend*bendSign
    };

    const startWorld={
      x,
      y
    };

    const controlWorld=
      worldPoint(
        controlClient.x,
        controlClient.y
      );

    const endWorld=
      worldPoint(
        endClient.x,
        endClient.y
      );

    const started=
      performance.now();

    motion={
      x:endClient.x,
      y:endClient.y
    };

    orb.classList.add("moving");

    orb.style.setProperty(
      "--lean",
      `${Math.max(
        -5,
        Math.min(
          5,
          ux*4.5
        )
      )}deg`
    );

    orb.style.setProperty("--sx","1.018");
    orb.style.setProperty("--sy",".986");

    eyes(
      ux*.17,
      uy*.14
    );

    function frame(now){
      const t=Math.min(
        1,
        (now-started)/duration
      );

      const eased=
        t<.5
          ?4*t*t*t
          :1-Math.pow(-2*t+2,3)/2;

      const omt=
        1-eased;

      x=
        omt*omt*startWorld.x+
        2*omt*eased*controlWorld.x+
        eased*eased*endWorld.x;

      y=
        omt*omt*startWorld.y+
        2*omt*eased*controlWorld.y+
        eased*eased*endWorld.y;

      render();

      if(t<1){
        motionFrame=
          requestAnimationFrame(frame);

        return;
      }

      motionFrame=null;
      motion=null;

      orb.classList.remove("moving");

      orb.style.setProperty("--lean","0deg");
      orb.style.setProperty("--sx","1");
      orb.style.setProperty("--sy","1");

      restoreGaze();
    }

    motionFrame=
      requestAnimationFrame(frame);

    return true;
  }

  /*
    node 중심이 아니라 node 바깥의 가장 가까운 쪽을 향한다.
    그래서 node 위로 파고드는 이상한 이동 방지.
  */
  function nodeTarget(
    node,
    gapScale=.9
  ){
    const nodeRect=node.getBoundingClientRect();
    const orbRect=orb.getBoundingClientRect();

    const current=center(orbRect);
    const nodeCenter=center(nodeRect);
    const gap=
      orbRect.width*
      gapScale;

    /*
      높이는 항상 node 중앙축.
      좌우 중 orb가 있는 쪽으로 docking.
    */
    return{
      x:
        current.x<nodeCenter.x
          ?nodeRect.left-gap
          :nodeRect.right+gap,
      y:nodeCenter.y
    };
  }

  function reactMoveToNode(id){
    const node=nodeEl(id);

    if(!node||!nodeVisible(node))
      return false;

    const orbRect=
      orb.getBoundingClientRect();

    const target=
      nodeTarget(node);

    const current=
      center(orbRect);

    const distance=
      Math.hypot(
        target.x-current.x,
        target.y-current.y
      );

    /*
      이미 충분히 가까우면 계산/이동 끝.
      시선 반응만 유지.
    */
    /*
      가까운 action은 눈으로만 반응.
      orb 지름 6.5개 이상 떨어진 경우에만 몸을 움직임.
    */
    if(distance<=orbRect.width*8)
      return false;

    /*
      input / expand 같은 연속 event가 들어와도
      매번 움직이지 않도록 제한.
    */
    const now=performance.now();

    if(
      motion||
      now-lastIntentMove<1400
    ){
      return false;
    }

    lastIntentMove=now;

    return swooshToward(
      target.x,
      target.y,
      {
        duration:320
      }
    );
  }

  function focusNode(
    id,
    {
      approach=false,
      pop=false,
      mood="focus",
      duration=1050,
      priority=3
    }={}
  ){
    const node=nodeEl(id);

    if(!node)
      return;

    noteActivity();

    const now=
      performance.now();

    if(
      now<gazeUntil&&
      priority<gazePriority
    ){
      return;
    }

    focusId=String(id);

    gazePriority=priority;
    gazeUntil=now+duration;
    attentionUntil=gazeUntil;

    orb.classList.add("attention");

    setMood(
      mood,
      duration
    );

    if(nodeVisible(node)){
      const c=
        center(
          node.getBoundingClientRect()
        );

      lookAt(
        c.x,
        c.y,
        mood==="surprised"
          ?.21
          :.185
      );

      if(approach)
        reactMoveToNode(id);
    }

    if(pop)
      pulse("pop",300);

    setTimeout(()=>{
      if(
        focusId===String(id)&&
        performance.now()>=attentionUntil&&
        !motion
      ){
        focusId=null;
        gazePriority=0;

        orb.classList.remove(
          "attention"
        );

        restoreGaze();
      }
    },duration+30);
  }

  function overlaps(node){
    const a=
      orb.getBoundingClientRect();

    const b=
      node.getBoundingClientRect();

    return(
      a.right>b.left&&
      a.left<b.right&&
      a.bottom>b.top&&
      a.top<b.bottom
    );
  }

  function pushFromNode(node){
    if(
      !(node instanceof Element)||
      !overlaps(node)
    ){
      return false;
    }

    /*
      전부 screen 좌표 기준이라 Canvas zoom이 이미 반영됨.
      작은 화면에서는 viewport 크기 자체로 최대 이동량도 제한.
    */
    const orbRect=orb.getBoundingClientRect();
    const nodeRect=node.getBoundingClientRect();
    const view=viewport.getBoundingClientRect();

    const oc=center(orbRect);
    const nc=center(nodeRect);

    let dx=oc.x-nc.x;
    let dy=oc.y-nc.y;
    let distance=Math.hypot(dx,dy);

    if(distance<1){
      dx=1;
      dy=0;
      distance=1;
    }

    const ux=dx/distance;
    const uy=dy/distance;

    const margin=
      orbRect.width*.65+8;

    /*
      기본 push는 orb 2.6개 정도.
      단, 작은 viewport에서는 짧은 축의 16%를 넘지 않음.
    */
    const wanted=Math.min(
      orbRect.width*2.6,
      Math.min(
        view.width,
        view.height
      )*.16
    );

    /*
      이동 방향으로 실제 화면 안에 남아있는 거리 계산.
      edge를 뚫고 날아가는 걸 여기서 차단.
    */
    const roomX=
      ux>0
        ?view.right-margin-oc.x
        :ux<0
          ?oc.x-(view.left+margin)
          :Infinity;

    const roomY=
      uy>0
        ?view.bottom-margin-oc.y
        :uy<0
          ?oc.y-(view.top+margin)
          :Infinity;

    const maxX=
      Math.abs(ux)>.001
        ?Math.max(0,roomX/Math.abs(ux))
        :Infinity;

    const maxY=
      Math.abs(uy)>.001
        ?Math.max(0,roomY/Math.abs(uy))
        :Infinity;

    const travel=Math.max(
      0,
      Math.min(
        wanted,
        maxX,
        maxY
      )
    );

    if(travel<2)
      return false;

    /*
      swooshToward 자체 step 제한보다
      우리가 계산한 target까지 정확히 갈 수 있게 step 산출.
    */
    swooshToward(
      oc.x+ux*travel,
      oc.y+uy*travel,
      {
        step:travel/orbRect.width,
        duration:300
      }
    );

    setMood("bumped",360);
    pulse("bump",220);
    blink();

    return true;
  }

  function ensureVisible(){
    const view=
      viewport.getBoundingClientRect();

    const composer=
      composerElement?.getBoundingClientRect();

    const topbar=
      topbarElement?.getBoundingClientRect();

    const rect=
      orb.getBoundingClientRect();

    const c=center(rect);
    const margin=
      rect.width/2+14;

    const safeTop=
      Math.max(
        view.top,
        topbar?.bottom??view.top
      )+margin;

    const safeBottom=
      Math.min(
        view.bottom,
        composer?.top??view.bottom
      )-margin;

    const sx=Math.max(
      view.left+margin,
      Math.min(
        view.right-margin,
        c.x
      )
    );

    const sy=Math.max(
      safeTop,
      Math.min(
        Math.max(
          safeTop,
          safeBottom
        ),
        c.y
      )
    );

    if(
      Math.abs(sx-c.x)<1&&
      Math.abs(sy-c.y)<1
    ){
      return;
    }

    const distance=
      Math.hypot(
        sx-c.x,
        sy-c.y
      );

    swooshToward(
      sx,
      sy,
      {
        step:
          distance/
          Math.max(1,rect.width)+
          .2,
        duration:
          Math.min(
            520,
            300+distance*.16
          )
      }
    );
  }

  function centerInViewport(){
    stopMotion();

    const view=
      viewport.getBoundingClientRect();

    if(
      view.width<1||
      view.height<1
    ){
      return false;
    }

    const point=
      worldPoint(
        view.left+view.width/2,
        view.top+view.height/2
      );

    x=point.x;
    y=point.y;
    render();
    restoreGaze();

    return true;
  }

  function scheduleVisible(){
    clearTimeout(
      viewportTimer
    );

    viewportTimer=
      setTimeout(
        ensureVisible,
        100
      );
  }

  const MOODS=
    new Set([
      "idle",
      "thinking",
      "focus",
      "attention",
      "curious",
      "surprised",
      "annoyed",
      "success",
      "happy",
      "working",
      "bumped",
      "sleepy",
      "confused",
      "suspicious"
    ]);

  function setMood(name,duration=0){
    clearTimeout(moodTimer);

    const mood=
      MOODS.has(name)
        ?name
        :"idle";

    orb.dataset.mood=mood;

    if(duration){
      moodTimer=setTimeout(()=>{
        orb.dataset.mood="idle";
      },duration);
    }
  }

  const TASK_MOODS={
    research:"curious",
    organize:"focus",
    judge:"suspicious",
    write:"attention",
    file:"curious",
    createFile:"working"
  };

  const TASK_INTERVALS={
    research:520,
    organize:680,
    judge:760,
    write:620,
    file:980,
    createFile:820
  };

  function taskType(id){
    const node=
      canvas.getNode?.(
        String(id)
      );

    return String(
      node?.type||
      "generic"
    );
  }

  function clearTaskBehavior(){
    clearTimeout(taskTimer);
    taskTimer=null;
    activeTaskId=null;
    taskStep=0;
    delete orb.dataset.task;
  }

  function startTaskBehavior(
    id,
    type
  ){
    clearTaskBehavior();

    const key=
      String(id);

    activeTaskId=key;
    orb.dataset.task=type;
    taskStep=0;

    const tick=()=>{
      if(
        activeTaskId!==key||
        !orb.classList.contains(
          "working"
        )||
        drag
      ){
        return;
      }

      const node=
        nodeEl(key);

      if(
        !node||
        !nodeVisible(node)
      ){
        taskTimer=setTimeout(
          tick,
          720
        );
        return;
      }

      const rect=
        node.getBoundingClientRect();

      const c=center(rect);
      let targetX=c.x;
      let targetY=c.y;

      if(type==="research"){
        targetX+=
          (taskStep%2?1:-1)*
          Math.min(
            rect.width*.22,
            34
          );
        targetY-=
          rect.height*.08;
      }else if(type==="organize"){
        targetY+=
          (taskStep%2?1:-1)*
          Math.min(
            rect.height*.18,
            24
          );
      }else if(type==="judge"){
        targetX+=
          (taskStep%2?1:-1)*
          Math.min(
            rect.width*.16,
            26
          );
      }else if(type==="write"){
        targetY+=
          Math.min(
            rect.height*.2,
            28
          );
      }else if(type==="file"){
        targetY-=
          Math.min(
            rect.height*.16,
            22
          );
      }

      lookAt(
        targetX,
        targetY,
        type==="judge"
          ?.205
          :.185
      );

      if(type==="createFile"){
        setSatellite(
          "orbit"
        );
      }else{
        pointSatelliteAt(
          targetX,
          targetY
        );
      }

      taskStep++;
      taskTimer=setTimeout(
        tick,
        TASK_INTERVALS[type]||
        900
      );
    };

    tick();
  }

  function setSituation(
    name,
    detail={}
  ){
    const nodeId=
      detail?.nodeId;

    if(name==="nodeSuccess"){
      if(nodeId&&nodeEl(nodeId)){
        focusNode(
          nodeId,
          {
            mood:"success",
            duration:520,
            priority:13
          }
        );
      }else{
        setMood(
          "success",
          520
        );
      }

      setSatellite(
        "celebrate",
        {hold:480}
      );

      pulse(
        "pop",
        240
      );

      return;
    }

    if(name==="nodeError"){
      if(nodeId&&nodeEl(nodeId)){
        focusNode(
          nodeId,
          {
            mood:"confused",
            duration:760,
            priority:15
          }
        );
      }else{
        setMood(
          "confused",
          760
        );
      }

      setSatellite(
        "drop",
        {hold:580}
      );

      pulse(
        "bump",
        260
      );

      return;
    }

    if(name==="success"){
      if(nodeId&&nodeEl(nodeId)){
        focusNode(
          nodeId,
          {
            mood:"success",
            duration:760,
            priority:12
          }
        );
      }else{
        setMood(
          "success",
          760
        );
      }

      setSatellite(
        "celebrate",
        {hold:680}
      );

      pulse(
        "pop",
        320
      );

      return;
    }

    if(name==="error"){
      if(nodeId&&nodeEl(nodeId)){
        focusNode(
          nodeId,
          {
            mood:"confused",
            duration:820,
            priority:14
          }
        );
      }else{
        setMood(
          "confused",
          820
        );
      }

      setSatellite(
        "drop",
        {hold:620}
      );

      pulse(
        "bump",
        260
      );

      return;
    }

    if(name==="cancelled"){
      setMood(
        "bumped",
        480
      );

      setSatellite(
        "hidden"
      );

      return;
    }

    if(name==="notice"){
      setMood(
        "curious",
        720
      );

      setSatellite(
        "thought",
        {hold:620}
      );

      return;
    }

    if(name==="idle"){
      clearTaskBehavior();

      setMood(
        "idle"
      );

      setSatellite(
        "hidden"
      );
    }
  }

  function workAtNode(
    id,
    active=true
  ){
    setEffectMode(
      active
        ?"working"
        :"idle"
    );

    if(!active){
      clearTaskBehavior();
      setMood("idle");

      setSatellite(
        "hidden"
      );

      restoreGaze();
      scheduleIdleBehavior();
      return false;
    }

    const node=
      nodeEl(id);

    if(!node)
      return false;

    noteActivity();
    stopMotion();

    const type=
      taskType(id);

    focusId=
      String(id);
    gazePriority=14;
    gazeUntil=
      performance.now()+2200;
    attentionUntil=
      gazeUntil;

    setMood(
      TASK_MOODS[type]||
      "working"
    );

    startTaskBehavior(
      id,
      type
    );

    const target=
      nodeTarget(
        node,
        .72
      );

    const orbRect=
      orb.getBoundingClientRect();

    const current=
      center(orbRect);

    const nodeCenter=
      center(
        node.getBoundingClientRect()
      );

    const distance=
      Math.hypot(
        target.x-current.x,
        target.y-current.y
      );

    if(nodeVisible(node)){
      lookAt(
        nodeCenter.x,
        nodeCenter.y,
        .19
      );

      if(type==="createFile"){
        setSatellite(
          "orbit"
        );
      }else{
        pointSatelliteAt(
          nodeCenter.x,
          nodeCenter.y
        );
      }
    }

    if(
      distance >
        orbRect.width*1.15
    ){
      swooshToward(
        target.x,
        target.y,
        {
          step:
            Math.max(
              1.4,
              distance/
              Math.max(
                1,
                orbRect.width
              )
            ),
          duration:
            Math.min(
              620,
              300+
              distance*.2
            )
        }
      );
    }

    return true;
  }

  function setThinking(active=true){
    clearTimeout(moodTimer);

    setEffectMode(
      active
        ?"thinking"
        :"idle"
    );

    if(active){
      orb.dataset.mood="thinking";

      setSatellite(
        "orbit"
      );

      const target=
        (focusId&&nodeEl(focusId))||
        interestingNode();

      if(
        target&&
        nodeVisible(target)
      ){
        const c=
          center(
            target.getBoundingClientRect()
          );

        lastObservedId=
          target.dataset.nodeId||null;

        lookAt(
          c.x,
          c.y,
          .17
        );
      }else{
        eyes(
          -.045,
          -.02
        );
      }

      return;
    }

    orb.dataset.mood="idle";
    orb.style.setProperty(
      "--eye-tilt",
      "0deg"
    );

    setSatellite(
      "hidden"
    );

    restoreGaze();
  }

  function scheduleThinking(
    delay=12000+Math.random()*7000
  ){
    clearTimeout(thinkingTimer);

    thinkingTimer=setTimeout(()=>{
      const now=performance.now();

      if(
        drag||
        motion||
        connectionClose||
        App?.isBusy?.()||
        now<attentionUntil||
        now-lastActivity<9000
      ){
        scheduleThinking(2600);
        return;
      }

      setThinking(true);

      setTimeout(()=>{
        if(
          !App?.isBusy?.()&&
          !drag&&
          !motion&&
          !connectionClose
        ){
          setThinking(false);
        }

        scheduleThinking();
      },2660);
    },delay);
  }

  function noteActivity(){
    lastActivity=
      performance.now();

    if(
      orb.dataset.mood==="thinking"&&
      !App?.isBusy?.()
    ){
      setEffectMode(
        "idle"
      );
      setMood("idle");
      setSatellite(
        "hidden"
      );
      restoreGaze();
    }

    scheduleThinking();
    scheduleIdleBehavior();
  }

  function scheduleIdleBehavior(
    delay=7600+Math.random()*7200
  ){
    clearTimeout(
      idleBehaviorTimer
    );

    idleBehaviorTimer=
      setTimeout(
        ()=>{
          const now=
            performance.now();

          if(
            drag||
            motion||
            connectionClose||
            activeTaskId||
            App?.isBusy?.()||
            now<attentionUntil||
            now-lastActivity<4800
          ){
            scheduleIdleBehavior(
              2800+
              Math.random()*2400
            );
            return;
          }

          clearTimeout(
            gazeTimer
          );

          const observed=
            interestingNode();

          const roll=
            Math.random();

          gazePriority=2;
          gazeUntil=
            now+1050;
          attentionUntil=
            gazeUntil;

          if(
            observed&&
            roll<.58
          ){
            const rect=
              observed
                .getBoundingClientRect();

            const c=
              center(rect);

            setMood(
              roll<.3
                ?"curious"
                :"suspicious",
              980
            );

            lookAt(
              c.x+
                (roll<.3
                  ?Math.min(
                    rect.width*.12,
                    20
                  )
                  :0),
              c.y-
                Math.min(
                  rect.height*.08,
                  14
                ),
              .145
            );
          }else if(roll<.82){
            setMood(
              "sleepy",
              1100
            );

            eyes(
              0,
              .025
            );
          }else{
            setMood(
              "confused",
              900
            );

            eyes(
              Math.random()<.5
                ?-.09
                :.09,
              -.025
            );
          }

          setTimeout(
            ()=>{
              if(
                !drag&&
                !motion&&
                !activeTaskId&&
                !App?.isBusy?.()
              ){
                gazePriority=0;
                restoreGaze();
              }
            },
            1120
          );

          scheduleIdleBehavior();
        },
        delay
      );
  }

  function setReactColor(id){
    connectionColor=true;

    orb.style.setProperty(
      "--react-color",
      nodeColor(id)
    );
  }

  function resetReactColor(){
    connectionColor=false;

    orb.style.setProperty(
      "--react-color",
      agentColor
    );
  }

  function connectionMove(data){
    const c=
      center(
        orb.getBoundingClientRect()
      );

    const distance=
      Math.hypot(
        data.x-c.x,
        data.y-c.y
      );

    if(distance>145){
      connectionEnd(false,false);
      return;
    }

    orb.classList.add(
      "curious",
      "connecting"
    );

    gazePriority=9;
    gazeUntil=performance.now()+260;

    setMood("focus");

    lookAt(
      data.x,
      data.y,
      distance<62
        ?.22
        :.19
    );

    pointSatelliteAt(
      data.x,
      data.y
    );

    connectionClose=
      distance<62;

    orb.classList.toggle(
      "close",
      connectionClose
    );
  }

  function connectionEnd(
    boop,
    reset=true
  ){
    connectionClose=false;

    orb.classList.remove(
      "curious",
      "close",
      "connecting"
    );

    gazePriority=0;
    gazeUntil=0;

    setMood(
      boop
        ?"success"
        :"idle",
      boop
        ?520
        :0
    );

    if(boop){
      setSatellite(
        "celebrate",
        {hold:560}
      );

      pulse(
        "boop",
        360
      );

      blink();
    }else{
      setSatellite(
        "hidden"
      );
    }

    restoreGaze();

    if(reset){
      setTimeout(
        resetReactColor,
        boop
          ?360
          :160
      );
    }
  }

  function pointerDown(event){
    noteActivity();

    if(
      event.button!==undefined&&
      event.button!==0
    ){
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    stopMotion();

    const point=
      worldPoint(
        event.clientX,
        event.clientY
      );

    drag={
      id:event.pointerId,
      dx:x-point.x,
      dy:y-point.y,
      startClientX:event.clientX,
      startClientY:event.clientY,
      moved:false
    };

    setEffectMode(
      "idle"
    );

    orb.classList.add(
      "grabbed"
    );

    try{
      orb.setPointerCapture(
        event.pointerId
      );
    }catch{}
  }

  function pointerMove(event){
    if(
      !drag||
      drag.id!==event.pointerId
    ){
      return;
    }

    const point=
      worldPoint(
        event.clientX,
        event.clientY
      );

    if(
      Math.hypot(
        event.clientX-drag.startClientX,
        event.clientY-drag.startClientY
      )>5
    ){
      drag.moved=true;
    }

    x=point.x+drag.dx;
    y=point.y+drag.dy;

    render();
  }

  function pointerUp(event){
    if(
      !drag||
      drag.id!==event.pointerId
    ){
      return;
    }

    const wasClick=
      !drag.moved&&
      event.type==="pointerup";

    drag=null;

    orb.classList.remove(
      "grabbed"
    );

    try{
      orb.releasePointerCapture(
        event.pointerId
      );
    }catch{}

    if(wasClick){
      react();
    }

    scheduleVisible();
  }

  function listen(
    node,
    type,
    handler,
    options
  ){
    node.addEventListener(
      type,
      handler,
      options
    );

    cleanup.push(
      ()=>node.removeEventListener(
        type,
        handler,
        options
      )
    );
  }

  function bind(name,handler){
    const off=
      canvas.on(
        name,
        handler
      );

    if(typeof off==="function")
      cleanup.push(off);
  }

  listen(
    orb,
    "pointerdown",
    pointerDown
  );

  listen(
    orb,
    "pointermove",
    pointerMove
  );

  listen(
    orb,
    "pointerup",
    pointerUp
  );

  listen(
    orb,
    "pointercancel",
    pointerUp
  );

  listen(
    viewport,
    "pointerdown",
    event=>{
      if(
        event.button!==undefined&&
        event.button!==0
      ){
        return;
      }

      if(
        orb.contains(
          event.target
        )
      ){
        return;
      }

      const clientX=
        event.clientX;

      const clientY=
        event.clientY;

      noteActivity();

      gazePriority=20;
      gazeUntil=
        performance.now()+720;

      attentionUntil=
        gazeUntil;

      requestAnimationFrame(
        ()=>{
          if(
            performance.now()<
              gazeUntil
          ){
            lookAt(
              clientX,
              clientY,
              .205
            );
          }
        }
      );

      setTimeout(
        ()=>{
          if(
            !drag&&
            !motion&&
            performance.now()>=
              gazeUntil
          ){
            gazePriority=0;
            restoreGaze();
          }
        },
        760
      );
    },
    {
      capture:true,
      passive:true
    }
  );


  bind(
    "select",
    id=>{
      if(id){
        focusNode(
          id,
          {
            priority:1,
            duration:700
          }
        );
      }
    }
  );

  bind(
    "nodeAdd",
    node=>
      requestAnimationFrame(
        ()=>{
          focusNode(
            node.id,
            {
              approach:true,
              pop:true,
              mood:"surprised",
              duration:1250,
              priority:6
            }
          );

          setSatellite(
            "celebrate",
            {hold:620}
          );
        }
      )
  );

  bind(
    "nodeEdit",
    event=>{
      focusNode(
        event.id,
        {
          mood:"curious",
          duration:1250,
          priority:5
        }
      );

      setSatellite(
        "thought",
        {hold:620}
      );
    }
  );

  bind(
    "nodeExpand",
    event=>{
      focusNode(
        event.id,
        {
          mood:"focus",
          duration:900,
          priority:4
        }
      );

      const node=
        nodeEl(event.id);

      if(node)
        pushFromNode(node);
    }
  );

  bind(
    "nodeDragStart",
    event=>{
      stopMotion();

      focusNode(
        event.id,
        {
          mood:"focus",
          duration:1200,
          priority:7
        }
      );
    }
  );

  bind(
    "nodeDragMove",
    event=>{
      const node=
        nodeEl(event.id);

      if(!node)
        return;

      const c=
        center(
          node.getBoundingClientRect()
        );

      lastObservedId=
        String(event.id);

      gazePriority=8;
      gazeUntil=
        performance.now()+260;

      lookAt(
        c.x,
        c.y,
        .195
      );

      pushFromNode(node);
    }
  );

  bind(
    "nodeDragEnd",
    event=>{
      focusNode(
        event.id,
        {
          mood:"focus",
          duration:850,
          priority:6
        }
      );

      scheduleVisible();
    }
  );

  bind(
    "nodeRemove",
    node=>{
      if(
        focusId===
        String(node.id)
      ){
        focusId=null;
      }

      setMood(
        "annoyed",
        720
      );

      gazePriority=5;
      gazeUntil=
        performance.now()+720;

      eyes(
        0,
        -.07
      );

      setSatellite(
        "drop",
        {hold:660}
      );

      pulse(
        "bump",
        240
      );

      setTimeout(
        restoreGaze,
        740
      );
    }
  );

  bind(
    "connectionDragStart",
    event=>{
      noteActivity();

      setEffectMode(
        "idle"
      );

      setReactColor(
        event.anchor?.node
      );

      orb.classList.add(
        "connecting"
      );

      const anchorId=
        event.anchor?.node;

      if(anchorId!=null){
        focusNode(
          anchorId,
          {
            mood:"focus",
            duration:1300,
            priority:8
          }
        );
      }

      connectionClose=false;

      if(
        Number.isFinite(
          event.x
        )&&
        Number.isFinite(
          event.y
        )
      ){
        pointSatelliteAt(
          event.x,
          event.y
        );
      }
    }
  );

  bind(
    "connectionDragMove",
    connectionMove
  );

  bind(
    "connectionDragEnd",
    event=>{
      noteActivity();

      connectionEnd(
        !event.connected&&
        !event.cancelled&&
        connectionClose
      );
    }
  );

  bind(
    "connect",
    connection=>{
      focusNode(
        connection.to.node,
        {
          pop:true,
          mood:"success",
          duration:950,
          priority:9
        }
      );

      setSatellite(
        "celebrate",
        {hold:620}
      );
    }
  );

  bind(
    "layoutStart",
    ()=>{
      stopMotion();
      layoutAnchor=
        center(
          orb.getBoundingClientRect()
        );
    }
  );

  bind(
    "viewport",
    ()=>{
      if(
        layoutAnchor&&
        !drag
      ){
        const point=
          worldPoint(
            layoutAnchor.x,
            layoutAnchor.y
          );

        x=point.x;
        y=point.y;
        render();
      }

      scheduleVisible();
    }
  );

  bind(
    "layoutEnd",
    ()=>{
      layoutAnchor=null;

      for(
        const node
        of viewport.querySelectorAll(
          ".vc-node"
        )
      ){
        if(pushFromNode(node))
          break;
      }

      scheduleVisible();
    }
  );

  bind(
    "workflowApplied",
    ()=>{
      scheduleVisible();
    }
  );

  const offUiViewport=
    UI?.on?.(
      "viewport",
      scheduleVisible
    );

  if(typeof offUiViewport==="function")
    cleanup.push(offUiViewport);

  function scheduleBlink(){
    clearTimeout(
      blinkTimer
    );

    blinkTimer=
      setTimeout(()=>{
        if(
          !drag&&
          !connectionClose
        ){
          blink();
        }

        scheduleBlink();
      },2600+Math.random()*3600);
  }

  scheduleBlink();
  scheduleThinking();
  scheduleIdleBehavior();

  let wasBusy=
    !!App?.isBusy?.();

  function syncBusy(
    busy
  ){
    const next=
      !!busy;

    if(next===wasBusy){
      return;
    }

    wasBusy=next;
    lastActivity=
      performance.now();

    clearTimeout(
      thinkingTimer
    );

    setThinking(next);

    if(!next){
      scheduleThinking();
    }
  }

  listen(
    busyTarget,
    "ovll:busychange",
    event=>
      syncBusy(
        event.detail?.busy
      )
  );

  if(wasBusy){
    setThinking(true);
  }

  const view=
    viewport.getBoundingClientRect();

  function pickInitialClientPoint(){
    const orbSize=
      orb.getBoundingClientRect().width||
      36;

    const margin=
      orbSize*.8+12;

    return{
      x:Math.max(
        view.left+margin,
        Math.min(
          view.right-margin,
          view.left+view.width/2
        )
      ),
      y:Math.max(
        view.top+margin,
        Math.min(
          view.bottom-margin,
          view.top+view.height/2
        )
      )
    };
  }

  const initialClient=
    pickInitialClientPoint();

  const initial=
    worldPoint(
      initialClient.x,
      initialClient.y
    );

  x=initial.x;
  y=initial.y;
  render();

  requestAnimationFrame(
    scheduleVisible
  );

  return{
    element:orb,
    satellite,
    react,
    setThinking,
    setSituation,
    workAtNode,
    centerInViewport,

    destroy(){
      stopMotion();

      cancelAnimationFrame(
        motionFrame
      );

      clearTimeout(
        blinkTimer
      );

      clearTimeout(
        viewportTimer
      );

      clearTimeout(
        gazeTimer
      );

      clearTimeout(
        moodTimer
      );

      clearTimeout(
        thinkingTimer
      );

      clearTimeout(
        taskTimer
      );

      clearTimeout(
        idleBehaviorTimer
      );

      clearTimeout(
        satelliteTimer
      );

      cleanup
        .splice(0)
        .forEach(fn=>{
          try{
            fn();
          }catch{}
        });

      orb.remove();
      satellite.remove();
    }
  };
}

function bindMascotUI(
  mascot,
  UI
){
  if(!mascot||!UI){
    return ()=>{};
  }

  let shownOnCanvas=false;

  const revealFirstCanvas=()=>{
    if(shownOnCanvas)
      return;

    shownOnCanvas=true;

    requestAnimationFrame(()=>{
      mascot.centerInViewport?.();
      mascot.element.hidden=false;
      mascot.satellite.hidden=false;
    });
  };

  const sync=()=>{
    const isCanvas=
      UI?.getMode?.()==="canvas";

    if(!isCanvas){
      mascot.element.hidden=true;
      mascot.satellite.hidden=true;
      return;
    }

    const settled=
      (UI?.getProgress?.()??0)>=.999;

    if(!shownOnCanvas&&!settled){
      mascot.element.hidden=true;
      mascot.satellite.hidden=true;
      return;
    }

    if(!shownOnCanvas){
      revealFirstCanvas();
      return;
    }

    mascot.element.hidden=false;
    mascot.satellite.hidden=false;
  };

  const cleanups=[];

  const offMode=
    UI?.on?.(
      "modechange",
      sync
    );

  if(typeof offMode==="function"){
    cleanups.push(offMode);
  }

  const offSnap=
    UI?.on?.(
      "snap",
      event=>{
        if(event?.mode==="canvas"){
          revealFirstCanvas();
        }
      }
    );

  if(typeof offSnap==="function"){
    cleanups.push(offSnap);
  }

  sync();

  return ()=>{
    cleanups
      .splice(0)
      .forEach(fn=>{
        try{fn();}catch{}
      });
  };
}

global.mountOvllCanvasMascot=
  mount;

global.bindOvllCanvasMascotUI=
  bindMascotUI;


function init(){
  const viewport=
    document.querySelector(
      "#canvas-viewport"
    );

  const world=
    document.querySelector(
      "#canvas-world"
    );

  if(
    !viewport||
    !world||
    global.ovllCanvasMascot
  ){
    return;
  }

  let tries=0;

  function adoptWorkspaceMascot(){
    const workspace=
      global.OvllMainWorkspace;

    const owned=
      workspace
        ?.getMascot?.();

    if(!owned){
      return false;
    }

    global.ovllCanvasMascot=
      owned;

    global.createOvllCanvasMascot=
      options=>
        workspace
          .attachMascot?.(
            options||{}
          )||
        owned;

    return true;
  }

  function wait(){
    if(
      global.ovllCanvasMascot||
      adoptWorkspaceMascot()
    ){
      return;
    }

    const canvas=
      global.getMountedCanvasNode?.(
        viewport
      );

    if(!canvas){
      if(tries++<360)
        requestAnimationFrame(wait);

      return;
    }

    if(global.OvllMainWorkspace){
      if(tries++<360)
        requestAnimationFrame(wait);

      return;
    }

    global.createOvllCanvasMascot=
      options=>
        mount(
          world,
          canvas,
          options||{}
        );

    const mascot=
      global.ovllCanvasMascot=
        mount(
          world,
          canvas
        );

    global.OvllPresence?.attachCanvasMascot?.(
      mascot
    );

    bindMascotUI(
      mascot,
      global.AstraUI
    );
  }

  wait();
}

if(
  document.readyState==="loading"
){
  document.addEventListener(
    "DOMContentLoaded",
    init,
    {once:true}
  );
}else{
  init();
}

})(window);
