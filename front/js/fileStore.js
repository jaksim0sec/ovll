(function(global){
"use strict";

const DB_NAME = "ovll-files";
const DB_VERSION = 1;
const STORE_NAME = "files";
const urlCache = new Map();
let dbPromise = null;

function makeId(){
  if(global.crypto?.randomUUID){
    return "file-" + global.crypto.randomUUID();
  }

  return [
    "file",
    Date.now().toString(36),
    Math.random().toString(36).slice(2,10)
  ].join("-");
}

function openDatabase(){
  if(dbPromise){
    return dbPromise;
  }

  if(!global.indexedDB){
    return Promise.reject(
      new Error("IndexedDB를 사용할 수 없습니다.")
    );
  }

  dbPromise = new Promise(
    (resolve,reject)=>{
      const request =
        global.indexedDB.open(
          DB_NAME,
          DB_VERSION
        );

      request.onupgradeneeded = () => {
        const db = request.result;
        let store;

        if(
          !db.objectStoreNames.contains(
            STORE_NAME
          )
        ){
          store =
            db.createObjectStore(
              STORE_NAME,
              {
                keyPath:"id"
              }
            );
        }else{
          store =
            request.transaction
              .objectStore(
                STORE_NAME
              );
        }

        const indexes = [
          ["createdAt","createdAt"],
          ["source","source"],
          ["originId","originId"],
          ["conversationId","conversationId"],
          ["name","name"]
        ];

        for(const [name,key] of indexes){
          if(
            !store.indexNames.contains(
              name
            )
          ){
            store.createIndex(
              name,
              key,
              {
                unique:false
              }
            );
          }
        }
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };

        resolve(db);
      };

      request.onerror = () => {
        dbPromise = null;
        reject(
          request.error ||
          new Error("로컬 파일 저장소를 열지 못했습니다.")
        );
      };

      request.onblocked = () => {
        console.warn(
          "ovll file store upgrade blocked"
        );
      };
    }
  );

  return dbPromise;
}

async function runStore(
  mode,
  executor
){
  const db =
    await openDatabase();

  return new Promise(
    (resolve,reject)=>{
      const transaction =
        db.transaction(
          STORE_NAME,
          mode
        );

      const store =
        transaction.objectStore(
          STORE_NAME
        );

      let result;

      try{
        result =
          executor(
            store,
            transaction
          );
      }catch(error){
        reject(error);
        return;
      }

      transaction.oncomplete =
        () => resolve(result);

      transaction.onerror =
        () => reject(
          transaction.error ||
          new Error("로컬 파일 저장 작업이 실패했습니다.")
        );

      transaction.onabort =
        () => reject(
          transaction.error ||
          new Error("로컬 파일 저장 작업이 중단되었습니다.")
        );
    }
  );
}

function requestResult(
  request
){
  return new Promise(
    (resolve,reject)=>{
      request.onsuccess =
        () => resolve(
          request.result
        );

      request.onerror =
        () => reject(
          request.error
        );
    }
  );
}

function cleanText(
  value,
  max
){
  return String(
    value || ""
  ).slice(
    0,
    max
  );
}

function metadataFromRecord(
  record
){
  if(!record){
    return null;
  }

  return {
    id:String(record.id || ""),
    name:String(record.name || "파일"),
    mime:String(
      record.mime ||
      "application/octet-stream"
    ),
    size:Number(record.size || 0),
    source:String(record.source || "local"),
    originId:String(record.originId || ""),
    conversationId:String(
      record.conversationId ||
      ""
    ),
    format:String(
      record.format ||
      ""
    ),
    renderer:String(
      record.renderer ||
      ""
    ),
    previewKind:String(
      record.previewKind ||
      ""
    ),
    previewText:String(
      record.previewText ||
      ""
    ),
    createdAt:Number(record.createdAt || 0),
    updatedAt:Number(record.updatedAt || 0),
    tags:Array.isArray(record.tags)
      ? record.tags.map(String).slice(0,32)
      : []
  };
}

async function getRecord(
  fileId
){
  const id =
    String(fileId || "");

  if(!id){
    return null;
  }

  const db =
    await openDatabase();

  const transaction =
    db.transaction(
      STORE_NAME,
      "readonly"
    );

  const store =
    transaction.objectStore(
      STORE_NAME
    );

  return await requestResult(
    store.get(id)
  );
}

function emitChanged(
  action,
  file=null
){
  try{
    global.dispatchEvent(
      new CustomEvent(
        "ovll:files-changed",
        {
          detail:{
            action,
            file
          }
        }
      )
    );
  }catch{}
}

async function findRecordByOriginId(
  originId
){
  const value =
    String(originId || "");

  if(!value){
    return null;
  }

  const db =
    await openDatabase();

  const transaction =
    db.transaction(
      STORE_NAME,
      "readonly"
    );

  const store =
    transaction.objectStore(
      STORE_NAME
    );

  if(
    !store.indexNames.contains(
      "originId"
    )
  ){
    return null;
  }

  const records =
    await requestResult(
      store
        .index("originId")
        .getAll(value)
    );

  if(
    !Array.isArray(records) ||
    !records.length
  ){
    return null;
  }

  return records
    .slice()
    .sort(
      (a,b) =>
        Number(b.updatedAt || 0) -
        Number(a.updatedAt || 0)
    )[0] || null;
}

async function putBlob(
  blob,
  metadata={}
){
  if(!(blob instanceof Blob)){
    throw new TypeError(
      "저장할 파일 데이터가 Blob이 아닙니다."
    );
  }

  const id =
    String(
      metadata.id ||
      makeId()
    );

  const existing =
    metadata.id
      ? await getRecord(id)
      : null;

  const time =
    Date.now();

  const record = {
    id,
    blob,
    name:cleanText(
      metadata.name ||
      "파일",
      240
    ),
    mime:cleanText(
      metadata.mime ||
      blob.type ||
      "application/octet-stream",
      160
    ),
    size:Number(
      metadata.size ??
      blob.size ??
      0
    ) || 0,
    source:cleanText(
      metadata.source ||
      "local",
      40
    ),
    originId:cleanText(
      metadata.originId,
      240
    ),
    conversationId:cleanText(
      metadata.conversationId,
      160
    ),
    format:cleanText(
      metadata.format,
      40
    ),
    renderer:cleanText(
      metadata.renderer,
      80
    ),
    previewKind:cleanText(
      metadata.previewKind,
      40
    ),
    previewText:cleanText(
      metadata.previewText,
      12000
    ),
    tags:Array.isArray(
      metadata.tags
    )
      ? metadata.tags
          .map(value =>
            cleanText(
              value,
              80
            )
          )
          .slice(0,32)
      : [],
    createdAt:Number(
      existing?.createdAt ||
      metadata.createdAt ||
      time
    ),
    updatedAt:time
  };

  await runStore(
    "readwrite",
    store => {
      store.put(record);
    }
  );

  releaseUrl(id);

  emitChanged(
    existing
      ? "update"
      : "add",
    metadataFromRecord(
      record
    )
  );

  try{
    await global.navigator
      ?.storage
      ?.persist?.();
  }catch{}

  return metadataFromRecord(
    record
  );
}

async function putFile(
  file,
  metadata={}
){
  if(!(file instanceof Blob)){
    throw new TypeError(
      "저장할 파일이 올바르지 않습니다."
    );
  }

  return putBlob(
    file,
    {
      ...metadata,
      name:
        metadata.name ||
        file.name ||
        "파일",
      mime:
        metadata.mime ||
        file.type ||
        "application/octet-stream",
      size:
        metadata.size ??
        file.size ??
        0
    }
  );
}

async function putRemote(
  url,
  metadata={}
){
  const value =
    String(url || "");

  if(!value){
    throw new Error(
      "저장할 파일 URL이 없습니다."
    );
  }

  const response =
    await fetch(
      value,
      {
        cache:"no-store"
      }
    );

  if(!response.ok){
    throw new Error(
      "파일을 로컬에 저장하지 못했습니다: " +
      response.status
    );
  }

  const blob =
    await response.blob();

  return putBlob(
    blob,
    {
      ...metadata,
      mime:
        metadata.mime ||
        blob.type ||
        "application/octet-stream",
      size:
        metadata.size ??
        blob.size ??
        0
    }
  );
}

async function findByOriginId(
  originId
){
  const record =
    await findRecordByOriginId(
      originId
    );

  if(!record){
    return null;
  }

  return {
    ...metadataFromRecord(
      record
    ),
    localFileId:
      record.id
  };
}

async function getMetadata(
  fileId
){
  return metadataFromRecord(
    await getRecord(
      fileId
    )
  );
}

async function getBlob(
  fileId
){
  return (
    await getRecord(
      fileId
    )
  )?.blob || null;
}

async function getUrl(
  fileId
){
  const id =
    String(fileId || "");

  if(!id){
    return "";
  }

  const cached =
    urlCache.get(id);

  if(cached){
    return cached;
  }

  const blob =
    await getBlob(id);

  if(!blob){
    return "";
  }

  const url =
    URL.createObjectURL(
      blob
    );

  urlCache.set(
    id,
    url
  );

  return url;
}

async function hydrate(
  fileId
){
  const record =
    await getRecord(
      fileId
    );

  if(!record){
    return null;
  }

  const url =
    await getUrl(
      record.id
    );

  return {
    ...metadataFromRecord(
      record
    ),
    localFileId:
      record.id,
    downloadUrl:
      url,
    previewUrl:
      url,
    imagePreview:
      String(
        record.mime ||
        ""
      ).startsWith(
        "image/"
      )
        ? url
        : ""
  };
}

async function list(){
  const db =
    await openDatabase();

  const transaction =
    db.transaction(
      STORE_NAME,
      "readonly"
    );

  const store =
    transaction.objectStore(
      STORE_NAME
    );

  const records =
    await requestResult(
      store.getAll()
    );

  return records
    .map(
      metadataFromRecord
    )
    .filter(Boolean)
    .sort(
      (a,b) =>
        Number(b.createdAt) -
        Number(a.createdAt)
    );
}

async function remove(
  fileId
){
  const id =
    String(fileId || "");

  if(!id){
    return false;
  }

  await runStore(
    "readwrite",
    store => {
      store.delete(id);
    }
  );

  releaseUrl(id);

  emitChanged(
    "remove",
    {
      id
    }
  );

  return true;
}

async function clear(){
  await runStore(
    "readwrite",
    store => {
      store.clear();
    }
  );

  releaseAllUrls();

  emitChanged(
    "clear"
  );

  return true;
}

function releaseUrl(
  fileId
){
  const id =
    String(fileId || "");

  const url =
    urlCache.get(id);

  if(url){
    URL.revokeObjectURL(
      url
    );

    urlCache.delete(id);
  }
}

function releaseAllUrls(){
  for(const url of urlCache.values()){
    URL.revokeObjectURL(
      url
    );
  }

  urlCache.clear();
}

global.addEventListener(
  "pagehide",
  releaseAllUrls
);

global.OvllFileStore = {
  dbName:DB_NAME,
  schemaVersion:DB_VERSION,
  putBlob,
  putFile,
  putRemote,
  findByOriginId,
  getMetadata,
  getBlob,
  getUrl,
  hydrate,
  list,
  remove,
  clear,
  releaseUrl,
  releaseAllUrls
};

})(window);
