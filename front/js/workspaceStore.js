(function(global){
"use strict";

const STORAGE_KEY = "ovll:workspace:v1";
const SCHEMA_VERSION = 9;
const events = new Map();

function clone(value){
  if(value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function now(){
  return Date.now();
}

function id(prefix){
  return [
    prefix,
    now().toString(36),
    Math.random().toString(36).slice(2,8)
  ].join("-");
}

function emptyMemory(){
  return {
    flow:"",
    recent:"",
    detail:""
  };
}

function emptyCanvas(){
  return {
    workflow:{
      nodes:[],
      connections:[]
    },
    viewport:{
      scale:1,
      offset:{
        x:0,
        y:0
      }
    }
  };
}

function normalizeCanvas(value){
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? clone(value)
      : emptyCanvas();

  const workflow =
    source.workflow &&
    typeof source.workflow === "object"
      ? source.workflow
      : source;

  if(
    Array.isArray(
      workflow?.nodes
    )
  ){
    workflow.nodes =
      workflow.nodes.map(
        node => {
          if(
            !node ||
            typeof node !== "object"
          ){
            return node;
          }

          const next =
            clone(node);

          if(
            next.type === "file" &&
            next.data &&
            typeof next.data === "object"
          ){
            const localFileId =
              String(
                next.data.localFileId ||
                ""
              );

            next.data.localFileId =
              localFileId;

            if(
              typeof next.data.textPreview ===
                "string"
            ){
              next.data.textPreview =
                next.data.textPreview.slice(
                  0,
                  12000
                );
            }

            if(
              typeof next.data.previewText ===
                "string"
            ){
              next.data.previewText =
                next.data.previewText.slice(
                  0,
                  6000
                );
            }

            if(localFileId){
              next.data.downloadUrl =
                "";
              next.data.previewUrl =
                "";
              delete next.data.imagePreview;
            }
          }

          return next;
        }
      );
  }

  return source;
}

function emptyConversationState(){
  return {
    mode:"chat",
    messages:[],
    canvas:emptyCanvas(),
    composerDraft:"",
    lastUserRequest:"",
    workflowUserRequest:"",
    pointerGraph:null,
    pointerRuns:[],
    pointerTask:null,
    pointerQuestion:null
  };
}

function normalizeMemory(value){
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {};

  const clip = (
    input,
    max
  ) => {
    const text =
      String(input || "")
        .replace(/\s+/g," ")
        .trim();

    if(text.length <= max){
      return text;
    }

    const tail =
      Math.max(
        100,
        Math.floor(
          max*.26
        )
      );

    return (
      text.slice(
        0,
        max-tail-3
      )+
      " … "+
      text.slice(-tail)
    ).slice(0,max);
  };

  return {
    flow:clip(source.flow,700),
    recent:clip(source.recent,1400),
    detail:clip(source.detail,1900)
  };
}

function normalizeMessage(value){
  if(!value || typeof value !== "object"){
    return null;
  }

  const kind =
    value.kind === "runtime"
      ? "runtime"
      : "message";

  const role =
    ["user","assistant","system"].includes(
      String(value.role || "")
    )
      ? String(value.role)
      : "assistant";

  const runtime =
    kind === "runtime" &&
    value.runtime &&
    typeof value.runtime === "object"
      ? {
          meta:
            String(
              value.runtime.meta || ""
            ).slice(0,80),
          collapsed:
            value.runtime.collapsed === true,
          steps:
            Array.isArray(
              value.runtime.steps
            )
              ? value.runtime.steps
                  .filter(step =>
                    step &&
                    typeof step === "object"
                  )
                  .map(step => ({
                    id:
                      String(
                        step.id || ""
                      ).slice(0,120),
                    nodeType:
                      String(
                        step.nodeType || ""
                      ).slice(0,80),
                    label:
                      String(
                        step.label || ""
                      ).slice(0,500),
                    detail:
                      String(
                        step.detail || ""
                      ).slice(0,500),
                    status:
                      [
                        "running",
                        "done",
                        "failed",
                        "skipped"
                      ].includes(
                        String(
                          step.status || ""
                        )
                      )
                        ? String(
                            step.status
                          )
                        : "done"
                  }))
                  .slice(0,64)
              : []
        }
      : null;

  const blocks =
    Array.isArray(value.blocks)
      ? value.blocks
          .map(block => {
            if(
              !block ||
              typeof block !== "object"
            ){
              return null;
            }

            const type =
              String(
                block.type || ""
              );

            if(
              ![
                "markup",
                "code",
                "live-html"
              ].includes(type)
            ){
              return null;
            }

            return {
              type,
              language:
                String(
                  block.language || ""
                )
                  .toLowerCase()
                  .replace(
                    /[^a-z0-9_-]/g,
                    ""
                  )
                  .slice(0,24),
              value:
                String(
                  block.value ?? ""
                )
                  .slice(
                    0,
                    180000
                  )
            };
          })
          .filter(Boolean)
          .slice(0,64)
      : [];

  return {
    id:String(
      value.id ||
      id("msg")
    ),
    kind,
    role,
    text:String(value.text || ""),
    runtime,
    blocks,
    question:String(value.question || ""),
    showCanvasView:
      value.showCanvasView === true,
    artifacts:
      Array.isArray(value.artifacts)
        ? value.artifacts
            .filter(item =>
              item &&
              typeof item === "object"
            )
            .map(item => {
              const localFileId =
                String(
                  item.localFileId ||
                  ""
                );

              return {
                id:String(item.id || ""),
                localFileId,
                name:String(item.name || "결과물"),
                format:String(item.format || ""),
                mime:String(item.mime || ""),
                size:Number(item.size || 0),
                downloadUrl:
                  localFileId
                    ? ""
                    : String(item.downloadUrl || ""),
                previewUrl:
                  localFileId
                    ? ""
                    : String(item.previewUrl || ""),
                previewText:
                  String(
                    item.previewText ||
                    ""
                  ).slice(0,6000)
              };
            })
        : [],
    createdAt:
      Number(value.createdAt) ||
      now()
  };
}

function normalizePointerGraph(value){
  if(value == null)return null;
  if(!value?.graph || typeof value.graph.graphId!=="string" ||
    !Number.isInteger(value.graph.revision) ||
    !Array.isArray(value.graph.nodes) ||
    !Array.isArray(value.graph.connections) ||
    !Array.isArray(value.definitions) ||
    JSON.stringify(value).length>600000)return null;
  return clone(value);
}

// Reusable Pointer definitions belong to the workspace, not to a chat instance.
function collectPointerDefinitions(...sources){
  const map=new Map();
  for(const source of sources){
    for(const def of Array.isArray(source)?source:[]){
      if(!def||typeof def.definitionId!=='string'||def.definitionId.startsWith('builtin:')||
        !Number.isInteger(def.version)||def.version<1||
        typeof def.purpose!=='string'||!Array.isArray(def.inputs)||
        !Array.isArray(def.outputs))continue;
      const key=def.definitionId+':'+def.version;
      if(!map.has(key))map.set(key,clone(def));
    }
  }
  return [...map.values()];
}

function normalizePointerRuns(value){
  if(!Array.isArray(value))return [];
  return value.slice(-12).filter(x=>x&&typeof x.runId==='string'&&
    typeof x.status==='string'&&Array.isArray(x.nodes)&&x.nodes.length<=64&&
    JSON.stringify(x).length<=2000000).map(clone);
}

function normalizePointerTask(value){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('INVALID_POINTER_TASK');
  for(const key of ['objective','requestText'])if(value[key]!==undefined&&
    (typeof value[key]!=='string'||value[key].length>12000))throw new Error('POINTER_TASK_BUDGET_EXCEEDED');
  for(const key of ['constraints','historyDigest','requestHistory'])if(value[key]!==undefined&&JSON.stringify(value[key]).length>12000)
    throw new Error('POINTER_TASK_BUDGET_EXCEEDED');
  if(JSON.stringify(value).length>48000)throw new Error('POINTER_TASK_BUDGET_EXCEEDED');
  return clone(value);
}
function normalizePointerQuestion(value){
  if(value==null)return null;
  if(typeof value!=='object'||Array.isArray(value)||JSON.stringify(value).length>64000)
    throw new Error('INVALID_POINTER_QUESTION');
  return clone(value);
}

function normalizeConversationState(value){
  const source =
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
      ? value
      : {};

  const canvas =
    normalizeCanvas(
      source.canvas
    );

  return {
    mode:
      source.mode === "canvas"
        ? "canvas"
        : "chat",
    messages:
      Array.isArray(source.messages)
        ? source.messages
            .map(normalizeMessage)
            .filter(Boolean)
        : [],
    canvas,
    composerDraft:
      String(
        source.composerDraft ||
        ""
      ).slice(0,24000),
    lastUserRequest:
      String(
        source.lastUserRequest ||
        ""
      ).slice(0,12000),
    workflowUserRequest:
      String(
        source.workflowUserRequest ||
        ""
      ).slice(0,12000),
    pointerGraph:normalizePointerGraph(source.pointerGraph ?? source.vnextGraph),
    pointerRuns:normalizePointerRuns(source.pointerRuns ?? source.vnextRuns),
    pointerTask:normalizePointerTask(source.pointerTask),
    pointerQuestion:normalizePointerQuestion(source.pointerQuestion)
  };
}

function makeContext(title="기본 맥락"){
  const time = now();

  return {
    id:id("ctx"),
    title:String(title || "기본 맥락").slice(0,80),
    memory:emptyMemory(),
    notes:[],
    createdAt:time,
    updatedAt:time
  };
}

function makeSection(title="대화",order=0){
  const time = now();

  return {
    id:id("section"),
    title:String(title || "대화").slice(0,60),
    order:Number(order) || 0,
    collapsed:false,
    createdAt:time,
    updatedAt:time
  };
}

function makeConversation(
  sectionId,
  contextBundleId,
  title="새 대화"
){
  const time = now();

  return {
    id:id("chat"),
    sectionId:String(sectionId || ""),
    contextBundleId:String(contextBundleId || ""),
    title:String(title || "새 대화").slice(0,100),
    pinned:false,
    state:emptyConversationState(),
    createdAt:time,
    updatedAt:time
  };
}

function createDefaultState(){
  const section =
    makeSection("대화",0);
  const context =
    makeContext("기본 맥락");
  const conversation =
    makeConversation(
      section.id,
      context.id,
      "새 대화"
    );
  const time = now();

  return {
    storageRevision:0,
    schemaVersion:
      SCHEMA_VERSION,
    workspace:{
      id:"local",
      title:"ovll",
      activeConversationId:
        conversation.id,
      createdAt:time,
      updatedAt:time
    },
    sections:[section],
    conversations:[conversation],
    contextBundles:[context],
    pointerDefinitions:[]
  };
}

function normalizeState(raw){
  const source =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw)
      ? raw
      : {};

  const base =
    createDefaultState();

  const sections =
    Array.isArray(source.sections)
      ? source.sections
          .filter(item =>
            item &&
            typeof item === "object"
          )
          .map((item,index) => ({
            id:String(item.id || id("section")),
            title:String(item.title || "섹션").slice(0,60),
            order:
              Number.isFinite(Number(item.order))
                ? Number(item.order)
                : index,
            collapsed:
              item.collapsed === true,
            createdAt:
              Number(item.createdAt) ||
              now(),
            updatedAt:
              Number(item.updatedAt) ||
              now()
          }))
      : [];

  if(!sections.length){
    sections.push(
      base.sections[0]
    );
  }

  const contextBundles =
    Array.isArray(source.contextBundles)
      ? source.contextBundles
          .filter(item =>
            item &&
            typeof item === "object"
          )
          .map(item => ({
            id:String(item.id || id("ctx")),
            title:String(item.title || "맥락").slice(0,80),
            memory:
              normalizeMemory(
                item.memory
              ),
            notes:
              Array.isArray(item.notes)
                ? item.notes
                    .map(value =>
                      String(value)
                        .slice(0,3000)
                    )
                    .slice(0,50)
                : [],
            createdAt:
              Number(item.createdAt) ||
              now(),
            updatedAt:
              Number(item.updatedAt) ||
              now()
          }))
      : [];

  if(!contextBundles.length){
    contextBundles.push(
      base.contextBundles[0]
    );
  }

  const sectionIds =
    new Set(
      sections.map(item => item.id)
    );

  const contextIds =
    new Set(
      contextBundles.map(item => item.id)
    );

  const conversations =
    Array.isArray(source.conversations)
      ? source.conversations
          .filter(item =>
            item &&
            typeof item === "object"
          )
          .map(item => ({
            id:String(item.id || id("chat")),
            sectionId:
              sectionIds.has(
                String(item.sectionId || "")
              )
                ? String(item.sectionId)
                : sections[0].id,
            contextBundleId:
              contextIds.has(
                String(
                  item.contextBundleId ||
                  ""
                )
              )
                ? String(item.contextBundleId)
                : contextBundles[0].id,
            title:
              String(item.title || "새 대화")
                .slice(0,100),
            pinned:
              item.pinned === true,
            state:
              normalizeConversationState(
                item.state
              ),
            createdAt:
              Number(item.createdAt) ||
              now(),
            updatedAt:
              Number(item.updatedAt) ||
              now()
          }))
      : [];

  if(!conversations.length){
    conversations.push(
      makeConversation(
        sections[0].id,
        contextBundles[0].id,
        "새 대화"
      )
    );
  }

  const conversationIds =
    new Set(
      conversations.map(item => item.id)
    );

  const requestedActive =
    String(
      source.workspace
        ?.activeConversationId ||
      ""
    );

  const activeConversationId =
    conversationIds.has(
      requestedActive
    )
      ? requestedActive
      : conversations[0].id;

  const time = now();

  return {
    storageRevision:Math.max(0,Number.isSafeInteger(source.storageRevision)?source.storageRevision:0),
    schemaVersion:
      SCHEMA_VERSION,
    workspace:{
      id:String(
        source.workspace?.id ||
        "local"
      ),
      title:String(
        source.workspace?.title ||
        "ovll"
      ).slice(0,80),
      activeConversationId,
      createdAt:
        Number(
          source.workspace
            ?.createdAt
        ) ||
        time,
      updatedAt:
        Number(
          source.workspace
            ?.updatedAt
        ) ||
        time
    },
    sections,
    conversations,
    contextBundles,
    pointerDefinitions:collectPointerDefinitions(
      source.pointerDefinitions,
      ...conversations.map(c=>c.state.pointerGraph?.definitions)
    )
  };
}

function readStorage(){
  try{
    const raw =
      localStorage.getItem(
        STORAGE_KEY
      );

    if(!raw){
      return createDefaultState();
    }

    return normalizeState(
      JSON.parse(raw)
    );
  }catch(error){
    console.warn(
      "ovll workspace storage load failed:",
      error
    );

    return createDefaultState();
  }
}

let state = readStorage();
let persistedRevision=state.storageRevision||0;
let committedState=clone(state);
let storageStatus={status:'ready',revision:persistedRevision};
function getStorageStatus(){return clone(storageStatus);}
function reloadStorage(){
  state=readStorage();persistedRevision=state.storageRevision||0;committedState=clone(state);
  storageStatus={status:'ready',revision:persistedRevision};emit('change',{reason:'workspace:reload',state:getSnapshot()});
  return getSnapshot();
}

function emit(name,payload){
  for(
    const handler
    of events.get(name) ||
    []
  ){
    try{
      handler(
        payload,
        api
      );
    }catch(error){
      console.error(error);
    }
  }
}

function on(name,handler){
  if(typeof handler !== "function"){
    return () => {};
  }

  if(!events.has(name)){
    events.set(
      name,
      new Set()
    );
  }

  events.get(name)
    .add(handler);

  return () =>
    events.get(name)
      ?.delete(handler);
}

function persist(reason="update"){
  state.workspace.updatedAt =
    now();

  try{
    // Detect stale sequential writes. localStorage has no atomic cross-tab CAS;
    // simultaneous racing writes remain a browser-storage limitation.
    const raw=localStorage.getItem(STORAGE_KEY);
    const remoteRevision=raw?(JSON.parse(raw).storageRevision||0):0;
    if(remoteRevision!==persistedRevision){
      const conflict=new Error('WORKSPACE_REVISION_CONFLICT');conflict.code='WORKSPACE_REVISION_CONFLICT';
      conflict.expectedRevision=persistedRevision;conflict.actualRevision=remoteRevision;throw conflict;
    }
    state.storageRevision=persistedRevision+1;
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    persistedRevision=state.storageRevision;committedState=clone(state);
    storageStatus={status:'ready',revision:persistedRevision};
  }catch(error){
    state=clone(committedState);
    storageStatus={status:error?.code==='WORKSPACE_REVISION_CONFLICT'?'conflict':'failed',
      revision:persistedRevision,error:error?.code||error?.name||'WORKSPACE_SAVE_FAILED'};
    console.error(
      "ovll workspace storage save failed:",
      error
    );

    emit(
      "error",
      {
        type:"save",
        error
      }
    );

    return false;
  }

  emit(
    "change",
    {
      reason,
      state:getSnapshot()
    }
  );

  return true;
}

function getSnapshot(){
  return clone(state);
}

function getSection(sectionId){
  return (
    state.sections.find(
      item =>
        item.id ===
        String(sectionId || "")
    ) ||
    null
  );
}

function getConversation(conversationId){
  return (
    state.conversations.find(
      item =>
        item.id ===
        String(
          conversationId ||
          ""
        )
    ) ||
    null
  );
}

function getContextBundle(contextId){
  return (
    state.contextBundles.find(
      item =>
        item.id ===
        String(contextId || "")
    ) ||
    null
  );
}

function getActiveConversation(){
  return getConversation(
    state.workspace
      .activeConversationId
  );
}

function getConversationMemory(
  conversationId
){
  const conversation =
    getConversation(
      conversationId
    );

  const bundle =
    getContextBundle(
      conversation
        ?.contextBundleId
    );

  return normalizeMemory(
    bundle?.memory
  );
}

function createSection(
  title="새 섹션"
){
  const order =
    state.sections.reduce(
      (max,item) =>
        Math.max(
          max,
          Number(item.order) || 0
        ),
      -1
    ) + 1;

  const section =
    makeSection(
      title,
      order
    );

  state.sections.push(
    section
  );

  persist(
    "section:create"
  );

  return clone(section);
}

function renameSection(
  sectionId,
  title
){
  const section =
    getSection(
      sectionId
    );

  const value =
    String(title || "")
      .trim()
      .slice(0,60);

  if(
    !section ||
    !value
  ){
    return null;
  }

  section.title =
    value;
  section.updatedAt =
    now();

  persist(
    "section:rename"
  );

  return clone(section);
}

function setSectionCollapsed(
  sectionId,
  collapsed
){
  const section =
    getSection(
      sectionId
    );

  if(!section){
    return null;
  }

  section.collapsed =
    !!collapsed;
  section.updatedAt =
    now();

  persist(
    "section:collapse"
  );

  return clone(section);
}

function createContextBundle(
  title="새 맥락"
){
  const bundle =
    makeContext(
      title
    );

  state.contextBundles.push(
    bundle
  );

  persist(
    "context:create"
  );

  return clone(bundle);
}

function renameContextBundle(
  contextId,
  title
){
  const bundle =
    getContextBundle(
      contextId
    );

  const value =
    String(title || "")
      .trim()
      .slice(0,80);

  if(
    !bundle ||
    !value
  ){
    return null;
  }

  bundle.title =
    value;
  bundle.updatedAt =
    now();

  persist(
    "context:rename"
  );

  return clone(bundle);
}

function createConversation(
  options={}
){
  const requestedSection =
    getSection(
      options.sectionId
    );

  const section =
    requestedSection ||
    state.sections
      .slice()
      .sort(
        (a,b) =>
          a.order - b.order
      )[0];

  let context =
    getContextBundle(
      options.contextBundleId
    );

  if(!context){
    context =
      makeContext(
        options.contextTitle ||
        "기본 맥락"
      );

    state.contextBundles.push(
      context
    );
  }

  const conversation =
    makeConversation(
      section.id,
      context.id,
      options.title ||
      "새 대화"
    );

  state.conversations.push(
    conversation
  );

  if(
    options.activate !== false
  ){
    state.workspace
      .activeConversationId =
      conversation.id;
  }

  persist(
    "conversation:create"
  );

  return clone(conversation);
}

function activateConversation(
  conversationId
){
  const conversation =
    getConversation(
      conversationId
    );

  if(!conversation){
    return null;
  }

  state.workspace
    .activeConversationId =
    conversation.id;

  conversation.updatedAt =
    now();

  persist(
    "conversation:activate"
  );

  return clone(
    conversation
  );
}

function updateConversationTitle(
  conversationId,
  title
){
  const conversation =
    getConversation(
      conversationId
    );

  const value =
    String(title || "")
      .trim()
      .replace(/\s+/g," ")
      .slice(0,100);

  if(
    !conversation ||
    !value
  ){
    return null;
  }

  conversation.title =
    value;
  conversation.updatedAt =
    now();

  persist(
    "conversation:title"
  );

  return clone(conversation);
}

function setConversationPinned(
  conversationId,
  pinned
){
  const conversation =
    getConversation(
      conversationId
    );

  if(!conversation){
    return null;
  }

  conversation.pinned =
    !!pinned;

  persist(
    "conversation:pin"
  );

  return clone(
    conversation
  );
}

function moveConversation(
  conversationId,
  sectionId
){
  const conversation =
    getConversation(
      conversationId
    );

  const section =
    getSection(
      sectionId
    );

  if(
    !conversation ||
    !section
  ){
    return null;
  }

  conversation.sectionId =
    section.id;
  conversation.updatedAt =
    now();

  persist(
    "conversation:move"
  );

  return clone(conversation);
}

function assignContextBundle(
  conversationId,
  contextId
){
  const conversation =
    getConversation(
      conversationId
    );

  const bundle =
    getContextBundle(
      contextId
    );

  if(
    !conversation ||
    !bundle
  ){
    return null;
  }

  conversation.contextBundleId =
    bundle.id;
  conversation.updatedAt =
    now();

  persist(
    "conversation:context"
  );

  return clone(conversation);
}

function updateConversationState(
  conversationId,
  nextState,
  memory
){
  const conversation =
    getConversation(
      conversationId
    );

  if(!conversation){
    return null;
  }

  const preservedGraph=conversation.state?.pointerGraph || null;
  const preservedRuns=conversation.state?.pointerRuns || [];
  const preservedTask=conversation.state?.pointerTask||null;
  const preservedQuestion=conversation.state?.pointerQuestion||null;
  conversation.state =
    normalizeConversationState(
      nextState
    );
  if(!Object.prototype.hasOwnProperty.call(nextState||{},"pointerGraph"))
    conversation.state.pointerGraph=preservedGraph;
  if(!Object.prototype.hasOwnProperty.call(nextState||{},"pointerRuns"))
    conversation.state.pointerRuns=preservedRuns;
  if(!Object.prototype.hasOwnProperty.call(nextState||{},"pointerTask"))conversation.state.pointerTask=preservedTask;
  if(!Object.prototype.hasOwnProperty.call(nextState||{},"pointerQuestion"))conversation.state.pointerQuestion=preservedQuestion;

  conversation.updatedAt =
    now();

  if(memory !== undefined){
    const bundle =
      getContextBundle(
        conversation
          .contextBundleId
      );

    if(bundle){
      bundle.memory =
        normalizeMemory(
          memory
        );

      bundle.updatedAt =
        now();
    }
  }

  persist(
    "conversation:state"
  );

  return clone(conversation);
}

function updateConversationPointerGraph(conversationId,snapshot,{deletedDefinitions=[]}={}){
  const conversation=getConversation(conversationId);
  if(!conversation)throw new Error("CONVERSATION_NOT_FOUND");
  const next=normalizePointerGraph(snapshot);
  if(snapshot!==null&&!next)throw new Error("INVALID_POINTER_GRAPH");
  if(!Array.isArray(deletedDefinitions))throw new Error("INVALID_DEFINITION_DELETION");
  const remove=new Set();
  for(const ref of deletedDefinitions){
    if(typeof ref?.definitionId!=='string'||!ref.definitionId||
      ref.definitionId.startsWith('builtin:')||
      !Number.isInteger(ref.version)||ref.version<1)
      throw new Error("INVALID_DEFINITION_DELETION");
    remove.add(ref.definitionId+':'+ref.version);
  }
  const key=ref=>ref?.definitionId+':'+ref?.version;
  for(const record of state.conversations){
    const graph=record===conversation?next?.graph:record.state.pointerGraph?.graph;
    if((graph?.nodes||[]).some(node=>remove.has(key(node.definitionRef))))
      throw new Error('DEFINITION_IN_USE_OTHER_CONVERSATION');
  }
  const previous=conversation.state.pointerGraph;
  const previousDefinitions=state.pointerDefinitions;
  const changed=new Map();
  try{
    conversation.state.pointerGraph=next;
    for(const record of state.conversations){
      const saved=record.state.pointerGraph;
      if(!saved||!remove.size||!saved.definitions.some(def=>remove.has(key(def))))continue;
      if(record!==conversation)changed.set(record,saved);
      record.state.pointerGraph={...saved,definitions:saved.definitions.filter(def=>!remove.has(key(def)))};
    }
    state.pointerDefinitions=collectPointerDefinitions(
      (previousDefinitions||[]).filter(def=>!remove.has(key(def))),next?.definitions
    );
    if(!persist("conversation:pointer-graph")){const error=new Error(storageStatus.error||"LOCAL_GRAPH_SAVE_FAILED");error.code=storageStatus.error||"LOCAL_GRAPH_SAVE_FAILED";throw error;}
  }catch(error){
    conversation.state.pointerGraph=previous;
    for(const [record,saved] of changed)record.state.pointerGraph=saved;
    state.pointerDefinitions=previousDefinitions;
    throw error;
  }
  return clone(conversation.state.pointerGraph);
}

function getPointerDefinitions(){
  return clone(state.pointerDefinitions||[]);
}

function updateConversationPointerRuns(conversationId,runs){
  const conversation=getConversation(conversationId);
  if(!conversation)throw new Error("CONVERSATION_NOT_FOUND");
  if(Array.isArray(runs)&&runs.slice(-12).some(run=>JSON.stringify(run).length>2000000))throw new Error("LOCAL_RUN_BUDGET_EXCEEDED");
  const next=normalizePointerRuns(runs);
  if(!Array.isArray(runs)||next.length!==Math.min(runs.length,12))
    throw new Error("INVALID_LOCAL_RUNS");
  const previous=conversation.state.pointerRuns;
  conversation.state.pointerRuns=next;
  if(!persist("conversation:pointer-runs")){
    conversation.state.pointerRuns=previous;
    const error=new Error(storageStatus.error||"LOCAL_RUN_SAVE_FAILED");error.code=storageStatus.error||"LOCAL_RUN_SAVE_FAILED";throw error;
  }
  return clone(next);
}

function updateConversationPointerTask(conversationId,task){
  const conversation=getConversation(conversationId);
  if(!conversation)throw new Error('CONVERSATION_NOT_FOUND');
  conversation.state.pointerTask=normalizePointerTask(task);
  if(!persist('conversation:pointer-task'))throw new Error(storageStatus.error||'LOCAL_TASK_SAVE_FAILED');
  return clone(conversation.state.pointerTask);
}
function updateConversationPointerQuestion(conversationId,checkpoint){
  const conversation=getConversation(conversationId);
  if(!conversation)throw new Error('CONVERSATION_NOT_FOUND');
  conversation.state.pointerQuestion=normalizePointerQuestion(checkpoint);
  if(!persist('conversation:pointer-question'))throw new Error(storageStatus.error||'LOCAL_QUESTION_SAVE_FAILED');
  return clone(conversation.state.pointerQuestion);
}

function getPointerRun(conversationId,runId){
  return clone((getConversation(conversationId)?.state?.pointerRuns||[]).find(run=>run.runId===runId)||null);
}
function getPointerNodeOutput(conversationId,runId,nodeId,port){
  const run=getPointerRun(conversationId,runId),node=run?.nodes.find(n=>n.nodeId===nodeId);
  if(!node)return null;
  return clone(port===undefined?node.outputs||null:node.outputs?.values?.[port]||null);
}

function updateConversationDraft(
  conversationId,
  draft
){
  const conversation =
    getConversation(
      conversationId
    );

  if(!conversation){
    return null;
  }

  const value =
    String(draft || "")
      .slice(0,24000);

  if(
    conversation.state
      ?.composerDraft === value
  ){
    return clone(conversation);
  }

  conversation.state = {
    ...conversation.state,
    composerDraft:value
  };
  conversation.updatedAt =
    now();

  persist(
    "conversation:draft"
  );

  return clone(conversation);
}

function deleteConversation(
  conversationId
){
  const idValue =
    String(
      conversationId ||
      ""
    );

  const index =
    state.conversations.findIndex(
      item =>
        item.id === idValue
    );

  if(index < 0){
    return false;
  }

  state.conversations.splice(
    index,
    1
  );

  if(!state.conversations.length){
    const section =
      state.sections[0] ||
      makeSection("대화",0);

    if(!state.sections.length){
      state.sections.push(
        section
      );
    }

    const context =
      makeContext(
        "기본 맥락"
      );

    state.contextBundles.push(
      context
    );

    state.conversations.push(
      makeConversation(
        section.id,
        context.id,
        "새 대화"
      )
    );
  }

  if(
    state.workspace
      .activeConversationId ===
      idValue
  ){
    state.workspace
      .activeConversationId =
      state.conversations
        .slice()
        .sort(
          (a,b) =>
            b.updatedAt -
            a.updatedAt
        )[0].id;
  }

  persist(
    "conversation:delete"
  );

  return true;
}

function search(
  query
){
  const value =
    String(query || "")
      .trim()
      .toLocaleLowerCase();

  const items =
    state.conversations
      .slice()
      .sort(
        (a,b) => {
          if(
            !!a.pinned !==
            !!b.pinned
          ){
            return a.pinned
              ? -1
              : 1;
          }

          return (
            Number(b.updatedAt) -
            Number(a.updatedAt)
          );
        }
      );

  if(!value){
    return clone(items);
  }

  return clone(
    items.filter(
      conversation => {
        const section =
          getSection(
            conversation.sectionId
          );

        const context =
          getContextBundle(
            conversation
              .contextBundleId
          );

        const messages =
          conversation
            .state
            ?.messages ||
          [];

        const haystack = [
          conversation.title,
          section?.title,
          context?.title,
          context?.memory?.flow,
          context?.memory?.recent,
          context?.memory?.detail,
          ...messages.map(
            item =>
              item.text
          )
        ]
          .join("\n")
          .toLocaleLowerCase();

        return haystack.includes(
          value
        );
      }
    )
  );
}

function exportJSON(){
  return JSON.stringify(
    getSnapshot(),
    null,
    2
  );
}

function importJSON(
  text
){
  const parsed =
    typeof text === "string"
      ? JSON.parse(text)
      : text;

  state =
    normalizeState(
      parsed
    );

  persist(
    "workspace:import"
  );

  return getSnapshot();
}

function reset(){
  state =
    createDefaultState();

  persist(
    "workspace:reset"
  );

  return getSnapshot();
}

const api = {
  schemaVersion:
    SCHEMA_VERSION,
  storageKey:
    STORAGE_KEY,
  getSnapshot,
  getSection,
  getConversation,
  getActiveConversation,
  getContextBundle,
  getConversationMemory,
  createSection,
  renameSection,
  setSectionCollapsed,
  createContextBundle,
  renameContextBundle,
  createConversation,
  activateConversation,
  updateConversationTitle,
  setConversationPinned,
  moveConversation,
  assignContextBundle,
  updateConversationState,
  updateConversationPointerGraph,
  getPointerDefinitions,
  updateConversationPointerRuns,
  updateConversationPointerTask,
  updateConversationPointerQuestion,
  getStorageStatus,
  getPointerRun,
  getPointerNodeOutput,
  reloadStorage,
  updateConversationDraft,
  deleteConversation,
  search,
  exportJSON,
  importJSON,
  reset,
  on
};

global.OvllWorkspaceStore =
  Object.freeze(api);

})(window);
