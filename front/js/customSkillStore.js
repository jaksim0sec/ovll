(function(global){
"use strict";

const STORAGE_KEY="ovll:custom-nodes:v1";
const SCHEMA_VERSION=2;
const listeners=new Set();

function clone(value){
  return value==null
    ?value
    :JSON.parse(JSON.stringify(value));
}

function now(){
  return Date.now();
}

function makeId(){
  const native=
    global.crypto?.randomUUID?.();

  if(native){
    return native
      .replace(/-/g,"")
      .slice(0,20);
  }

  return [
    now().toString(36),
    Math.random().toString(36).slice(2,12)
  ].join("");
}

function cleanId(value){
  const id=
    String(value||"")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g,"")
      .slice(0,64);

  return id||makeId();
}

function normalizeWorkflow(value){
  const source=
    value&&
    typeof value==="object"&&
    !Array.isArray(value)
      ?value
      :{};

  return {
    nodes:
      Array.isArray(source.nodes)
        ?source.nodes
          .filter(node=>
            node&&
            typeof node==="object"
          )
          .map(node=>({
            id:String(node.id||""),
            type:String(node.type||""),
            x:Number(node.x)||0,
            y:Number(node.y)||0,
            expanded:
              node.expanded===true,
            data:clone(node.data||{})
          }))
          .filter(node=>node.id&&node.type)
        :[],
    connections:
      Array.isArray(source.connections)
        ?source.connections
          .filter(connection=>
            connection&&
            typeof connection==="object"
          )
          .map(connection=>({
            id:String(connection.id||""),
            from:{
              node:String(connection.from?.node||""),
              port:String(connection.from?.port||"")
            },
            to:{
              node:String(connection.to?.node||""),
              port:String(connection.to?.port||"")
            },
            data:clone(connection.data||{})
          }))
          .filter(connection=>
            connection.from.node&&
            connection.from.port&&
            connection.to.node&&
            connection.to.port
          )
        :[]
  };
}

function normalizeBoundary(value){
  const source=
    value&&
    typeof value==="object"&&
    !Array.isArray(value)
      ?value
      :{};

  return {
    entryNodeIds:
      Array.isArray(source.entryNodeIds)
        ?[...new Set(
          source.entryNodeIds
            .map(String)
            .filter(Boolean)
        )]
        :[],
    exitNodeId:
      String(source.exitNodeId||"")
  };
}

function normalizeBuilder(value){
  const source=
    value&&
    typeof value==="object"&&
    !Array.isArray(value)
      ?value
      :{};

  const viewport=
    source.viewport&&
    typeof source.viewport==="object"&&
    !Array.isArray(source.viewport)
      ?source.viewport
      :{};

  return {
    messages:
      Array.isArray(source.messages)
        ?source.messages
          .filter(item=>
            item&&
            typeof item==="object"&&
            (
              item.role==="user"||
              item.role==="assistant"
            )
          )
          .slice(-48)
          .map(item=>({
            role:item.role,
            text:
              String(item.text||"")
                .trim()
                .slice(0,6000)
          }))
          .filter(item=>
            item.text
          )
        :[],
    viewport:{
      scale:
        Number(viewport.scale)||1,
      offset:{
        x:
          Number(
            viewport.offset?.x
          )||0,
        y:
          Number(
            viewport.offset?.y
          )||0
      }
    }
  };
}

function normalizeRecord(value){
  const source=
    value&&
    typeof value==="object"&&
    !Array.isArray(value)
      ?value
      :{};

  const createdAt=
    Number(source.createdAt)||
    now();

  return {
    id:cleanId(source.id),
    name:
      String(source.name||"새 커스텀 노드")
        .trim()
        .slice(0,50)||
      "새 커스텀 노드",
    description:
      String(source.description||"")
        .trim()
        .slice(0,220),
    llmdesc:
      String(
        source.llmdesc||
        source.description||
        ""
      )
        .trim()
        .slice(0,500),
    color:
      /^#[0-9a-f]{6}$/i.test(
        String(source.color||"")
      )
        ?String(source.color)
        :"#7c6cf2",
    iconKey:
      /^[a-z][a-z0-9_-]{0,63}$/i.test(
        String(source.iconKey||"")
      )
        ?String(source.iconKey)
        :"custom",
    workflow:
      normalizeWorkflow(
        source.workflow
      ),
    boundary:
      normalizeBoundary(
        source.boundary
      ),
    builder:
      normalizeBuilder(
        source.builder
      ),
    revision:
      Math.max(
        1,
        Number(source.revision)||1
      ),
    createdAt,
    updatedAt:
      Number(source.updatedAt)||
      createdAt
  };
}

function emptyEnvelope(){
  return {
    schemaVersion:
      SCHEMA_VERSION,
    records:[]
  };
}

function readEnvelope(){
  try{
    const raw=
      global.localStorage
        ?.getItem(
          STORAGE_KEY
        );

    if(!raw){
      return emptyEnvelope();
    }

    const parsed=
      JSON.parse(raw);

    return {
      schemaVersion:
        SCHEMA_VERSION,
      records:
        Array.isArray(parsed?.records)
          ?parsed.records
            .map(normalizeRecord)
          :[]
    };
  }catch(error){
    console.warn(
      "ovll custom node storage read failed:",
      error
    );

    return emptyEnvelope();
  }
}

function writeEnvelope(envelope){
  global.localStorage
    ?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        schemaVersion:
          SCHEMA_VERSION,
        records:
          envelope.records
      })
    );
}

function emit(detail={}){
  const payload={
    ...detail,
    records:list()
  };

  for(const listener of listeners){
    try{
      listener(payload);
    }catch(error){
      console.warn(
        "ovll custom node listener failed:",
        error
      );
    }
  }

  try{
    global.dispatchEvent(
      new CustomEvent(
        "ovll:custom-nodes-changed",
        {
          detail:payload
        }
      )
    );
  }catch{}
}

function list(){
  return readEnvelope()
    .records
    .slice()
    .sort(
      (a,b)=>
        Number(b.updatedAt)-
        Number(a.updatedAt)
    )
    .map(clone);
}

function get(recordId){
  const id=
    String(recordId||"");

  if(!id){
    return null;
  }

  const record=
    readEnvelope()
      .records
      .find(item=>
        item.id===id
      );

  return record
    ?clone(record)
    :null;
}

function save(input){
  const envelope=
    readEnvelope();

  const requestedId=
    String(input?.id||"")
      .trim();

  const existing=
    requestedId
      ?envelope.records
        .find(item=>
          item.id===requestedId
        )
      :null;

  const time=now();

  const record=
    normalizeRecord({
      ...existing,
      ...input,
      id:
        existing?.id||
        cleanId(requestedId),
      revision:
        existing
          ?Number(existing.revision||1)+1
          :1,
      createdAt:
        existing?.createdAt||
        time,
      updatedAt:time
    });

  const next=
    envelope.records
      .filter(item=>
        item.id!==record.id
      );

  next.push(record);

  writeEnvelope({
    schemaVersion:
      SCHEMA_VERSION,
    records:next
  });

  emit({
    type:
      existing
        ?"update"
        :"create",
    id:record.id
  });

  return clone(record);
}

function remove(recordId){
  const id=
    String(recordId||"");

  if(!id){
    return false;
  }

  const envelope=
    readEnvelope();

  const next=
    envelope.records
      .filter(item=>
        item.id!==id
      );

  if(
    next.length===
    envelope.records.length
  ){
    return false;
  }

  writeEnvelope({
    schemaVersion:
      SCHEMA_VERSION,
    records:next
  });

  emit({
    type:"remove",
    id
  });

  return true;
}

function onChange(listener){
  if(
    typeof listener!=="function"
  ){
    return ()=>{};
  }

  listeners.add(listener);

  return ()=>{
    listeners.delete(listener);
  };
}

function exportJSON(){
  return JSON.stringify(
    readEnvelope(),
    null,
    2
  );
}

function importJSON(value){
  const parsed=
    typeof value==="string"
      ?JSON.parse(value)
      :value;

  const records=
    Array.isArray(parsed?.records)
      ?parsed.records
        .map(normalizeRecord)
      :[];

  writeEnvelope({
    schemaVersion:
      SCHEMA_VERSION,
    records
  });

  emit({
    type:"import"
  });

  return list();
}

global.OvllCustomNodeStore=
  Object.freeze({
    schemaVersion:
      SCHEMA_VERSION,
    storageKey:
      STORAGE_KEY,
    list,
    get,
    save,
    remove,
    onChange,
    exportJSON,
    importJSON
  });

})(window);
