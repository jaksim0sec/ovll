/**
 * Browser-only beta storage adapter.
 * Cached domains are FUTURE SERVER-OWNED; local-only domains are never server data.
 * No HTTP/SSE syncing or offline edit queue is implemented here.
 */
const CACHED = new Set(["roomInfo", "chatRecord", "chatDraft", "contextData", "canvasState"]);
const LOCAL = new Set(["chatScroll", "canvasViewport", "mascotPresentation"]);
const DB_VERSION = 1;
const STORE_CACHE = "serverCache";
const STORE_LOCAL = "localOnly";

function requireKey(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requireDomain(allowed, kind) {
  if (!allowed.has(kind)) throw new TypeError(`Unknown data domain: ${kind}`);
  return kind;
}

export function createLocalDataStore({ name = "ovll-beta-data", factory = globalThis.indexedDB } = {}) {
  let connection;
  let opening;
  let destroyed = false;

  function open() {
    if (destroyed) return Promise.reject(new Error("Local data store is destroyed"));
    if (!factory) return Promise.reject(new Error("IndexedDB is unavailable; persistent data was not saved"));
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = factory.open(name, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_CACHE)) {
          const cache = database.createObjectStore(STORE_CACHE, { keyPath: ["kind", "roomId", "itemId"] });
          cache.createIndex("byScope", ["kind", "roomId"]);
          cache.createIndex("byKind", "kind");
        }
        if (!database.objectStoreNames.contains(STORE_LOCAL)) {
          database.createObjectStore(STORE_LOCAL, { keyPath: ["kind", "roomId"] });
        }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB upgrade is blocked by another tab"));
      request.onsuccess = () => {
        const database = request.result;
        if (destroyed) {
          database.close();
          reject(new Error("Local data store is destroyed"));
          return;
        }
        database.onversionchange = () => {
          database.close();
          if (connection === database) connection = null;
        };
        connection = database;
        resolve(database);
      };
    }).finally(() => { opening = null; });
    return opening;
  }

  async function transaction(storeName, mode, execute) {
    const database = await open();
    if (destroyed) throw new Error("Local data store is destroyed");
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      let answer;
      tx.oncomplete = () => resolve(answer);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      try { execute(tx.objectStore(storeName), result => { answer = result; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }

  function cachedKey(kind, roomId, itemId) {
    return [requireDomain(CACHED, kind), requireKey(roomId, "roomId"), requireKey(itemId, "itemId")];
  }

  const cache = {
    read(kind, roomId, itemId = "state") {
      const key = cachedKey(kind, roomId, itemId);
      return transaction(STORE_CACHE, "readonly", (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => done(request.result ?? null);
      });
    },
    /** Source 'provisional' is pre-DB local data, NOT a synced/offline edit. */
    write(kind, roomId, itemId, value, { source = "provisional", revision = null } = {}) {
      const key = cachedKey(kind, roomId, itemId);
      if (!["provisional", "server"].includes(source)) throw new TypeError("Invalid cache source");
      if (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) {
        throw new TypeError("revision must be a non-negative safe integer or null");
      }
      return transaction(STORE_CACHE, "readwrite", (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => {
          const previous = request.result;
          // Provisional writes cannot silently override a confirmed server snapshot.
          if (previous?.source === "server" && source !== "server") {
            done({ written: false, reason: "server-owned" });
            return;
          }
          // Unknown versions cannot replace a known server revision. Equal/older are ignored.
          if (previous?.source === "server" && previous.revision !== null &&
              (revision === null || revision <= previous.revision)) {
            done({ written: false, reason: "stale-revision" });
            return;
          }
          store.put({ kind, roomId, itemId, value, source, revision, cachedAt: Date.now() });
          done({ written: true });
        };
      });
    },
    /** Index order is by key, not chronological chat order. No paging protocol is implied. */
    list(kind, roomId, { limit = 50 } = {}) {
      requireDomain(CACHED, kind);
      if (roomId !== null) requireKey(roomId, "roomId");
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new RangeError("limit must be 1..200");
      return transaction(STORE_CACHE, "readonly", (store, done) => {
        const index = store.index(roomId === null ? "byKind" : "byScope");
        const range = IDBKeyRange.only(roomId === null ? kind : [kind, roomId]);
        const entries = [];
        const request = index.openCursor(range);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || entries.length >= limit) { done(entries); return; }
          entries.push(cursor.value);
          cursor.continue();
        };
      });
    },
    remove(kind, roomId, itemId = "state") {
      const key = cachedKey(kind, roomId, itemId);
      return transaction(STORE_CACHE, "readwrite", store => { store.delete(key); });
    }
  };

  const local = {
    read(kind, roomId) {
      const key = [requireDomain(LOCAL, kind), requireKey(roomId, "roomId")];
      return transaction(STORE_LOCAL, "readonly", (store, done) => {
        const request = store.get(key);
        request.onsuccess = () => done(request.result?.value ?? null);
      });
    },
    write(kind, roomId, value) {
      requireDomain(LOCAL, kind);
      requireKey(roomId, "roomId");
      return transaction(STORE_LOCAL, "readwrite", store => {
        store.put({ kind, roomId, value });
      });
    },
    remove(kind, roomId) {
      const key = [requireDomain(LOCAL, kind), requireKey(roomId, "roomId")];
      return transaction(STORE_LOCAL, "readwrite", store => { store.delete(key); });
    }
  };

  return {
    cache,
    local,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      connection?.close();
      connection = null;
    }
  };
}
