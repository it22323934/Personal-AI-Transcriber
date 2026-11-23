// Minimal promise wrapper around IndexedDB. IndexedDB is shared by every
// extension context (side panel, library tab, offscreen recorder, service
// worker), which is why all app data lives here rather than chrome.storage.

const DB_NAME = 'toru';
const DB_VERSION = 1;

export type StoreName = 'projects' | 'notes' | 'segments' | 'chunks' | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' }).createIndex('projectId', 'projectId');
        }
        if (!db.objectStoreNames.contains('segments')) {
          db.createObjectStore('segments', { keyPath: ['noteId', 'index'] }).createIndex('noteId', 'noteId');
        }
        if (!db.objectStoreNames.contains('chunks')) {
          db.createObjectStore('chunks', { keyPath: ['noteId', 'index'] }).createIndex('noteId', 'noteId');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error);
      };
    });
  }
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  const db = await openDb();
  const tx = db.transaction(name, mode);
  return { tx, os: tx.objectStore(name) };
}

export async function get<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  const { os } = await store(name, 'readonly');
  return done(os.get(key)) as Promise<T | undefined>;
}

export async function getAll<T>(name: StoreName): Promise<T[]> {
  const { os } = await store(name, 'readonly');
  return done(os.getAll()) as Promise<T[]>;
}

export async function getAllByIndex<T>(name: StoreName, index: string, value: IDBValidKey): Promise<T[]> {
  const { os } = await store(name, 'readonly');
  return done(os.index(index).getAll(value)) as Promise<T[]>;
}

export async function countByIndex(name: StoreName, index: string, value: IDBValidKey): Promise<number> {
  const { os } = await store(name, 'readonly');
  return done(os.index(index).count(value));
}

export async function put<T>(name: StoreName, value: T): Promise<void> {
  const { tx, os } = await store(name, 'readwrite');
  os.put(value);
  await complete(tx);
}

export async function putMany<T>(name: StoreName, values: T[]): Promise<void> {
  if (!values.length) return;
  const { tx, os } = await store(name, 'readwrite');
  for (const v of values) os.put(v);
  await complete(tx);
}

export async function del(name: StoreName, key: IDBValidKey): Promise<void> {
  const { tx, os } = await store(name, 'readwrite');
  os.delete(key);
  await complete(tx);
}

export async function deleteByIndex(name: StoreName, index: string, value: IDBValidKey): Promise<void> {
  const { tx, os } = await store(name, 'readwrite');
  const req = os.index(index).openKeyCursor(IDBKeyRange.only(value));
  req.onsuccess = () => {
    const cursor = req.result;
    if (cursor) {
      os.delete(cursor.primaryKey);
      cursor.continue();
    }
  };
  await complete(tx);
}

/**
 * Read-modify-write inside a single readwrite transaction, so concurrent
 * writers in other extension contexts can't clobber each other.
 * Return undefined from `fn` to leave the record untouched.
 */
export async function mutate<T>(
  name: StoreName,
  key: IDBValidKey,
  fn: (current: T | undefined) => T | undefined,
): Promise<T | undefined> {
  const { tx, os } = await store(name, 'readwrite');
  let result: T | undefined;
  const req = os.get(key);
  req.onsuccess = () => {
    result = fn(req.result as T | undefined);
    if (result !== undefined) os.put(result);
  };
  await complete(tx);
  return result;
}
