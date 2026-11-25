/** Shared IndexedDB storage for WebView and browser. Covers are loaded independently. */
import type { BookMeta, Chapter } from '../engine/types';
import type { PlatformAdapter } from './adapter';

const DB_NAME = 'reading-tree';
const DB_VER = 3;
let dbPromise: Promise<IDBDatabase> | null = null;

export function lightMeta(meta: BookMeta): BookMeta {
  const { cover, ...rest } = meta;
  return { ...rest, hasCover: !!cover || meta.hasCover === true };
}

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('content')) db.createObjectStore('content');
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
        else if (!req.transaction!.objectStore('kv').keyPath) {
          db.deleteObjectStore('kv'); db.createObjectStore('kv', { keyPath: 'k' });
        }
        if (!db.objectStoreNames.contains('covers')) {
          const covers = db.createObjectStore('covers');
          // The upgrade transaction keeps covers and metadata together, including on failure.
          const metaStore = req.transaction!.objectStore('meta');
          const migrate = (after?: string) => {
            const batch = metaStore.getAll(after === undefined ? undefined : IDBKeyRange.lowerBound(after, true), 128);
            batch.onsuccess = () => {
              const rows = batch.result as BookMeta[];
              for (const meta of rows) { if (meta.cover) covers.put(meta.cover, meta.id); metaStore.put(lightMeta(meta)); }
              if (rows.length === 128) migrate(rows[rows.length - 1].id);
            };
          };
          migrate();
        }
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
        resolve(req.result);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode), r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onabort = () => reject(t.error ?? new Error('数据未保存，事务已取消'));
    t.onerror = () => reject(t.error);
  }));
}

async function write(stores: string[], action: (t: IDBTransaction) => void): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, 'readwrite');
    t.oncomplete = () => resolve();
    t.onabort = () => reject(t.error ?? new Error('数据未保存，事务已取消'));
    t.onerror = () => reject(t.error);
    try { action(t); } catch (e) { t.abort(); reject(e); }
  });
}

function saveMeta(t: IDBTransaction, meta: BookMeta) {
  t.objectStore('meta').put(lightMeta(meta));
  if (meta.cover) t.objectStore('covers').put(meta.cover, meta.id);
  else if (!meta.hasCover) t.objectStore('covers').delete(meta.id);
}

export const webAdapter: PlatformAdapter = {
  id: 'web',
  async kvGet<T>(key: string): Promise<T | null> {
    const v = await tx<{ k: string; v: unknown } | undefined>('kv', 'readonly', (s) => s.get(key));
    return (v?.v as T) ?? null;
  },
  async kvSet(key, value) { await tx('kv', 'readwrite', (s) => s.put({ k: key, v: value })); },
  async kvDel(key) { await tx('kv', 'readwrite', (s) => s.delete(key)); },
  async kvEntries<T>(prefix: string): Promise<Array<{ k: string; v: T }>> {
    return tx('kv', 'readonly', (s) => s.getAll(IDBKeyRange.bound(prefix, prefix + '\uffff')));
  },
  async kvKeys() { return (await tx('kv', 'readonly', (s) => s.getAllKeys())).map(String); },
  async getCover(id) { return tx('covers', 'readonly', (s) => s.get(id)); },
  async putMeta(meta) { await webAdapter.putMetas([meta]); },
  async putMetas(metas, kv = []) {
    await write(['meta', 'covers', 'kv'], (t) => {
      for (const meta of metas) saveMeta(t, meta);
      for (const item of kv) t.objectStore('kv').put(item);
    });
  },
  async putBook(meta, chapters, raw) {
    await write(['meta', 'covers', 'content', 'kv'], (t) => {
      saveMeta(t, meta); t.objectStore('content').put(chapters, meta.id);
      if (raw) t.objectStore('kv').put({ k: `file:${meta.id}`, v: raw });
    });
  },
  async listBooks() {
    const all = await tx<BookMeta[]>('meta', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.addedAt - a.addedAt);
  },
  async getChapters(id) { return (await tx<Chapter[] | undefined>('content', 'readonly', (s) => s.get(id))) ?? null; },
  async deleteBook(id) {
    await write(['meta', 'covers', 'content', 'kv'], (t) => {
      t.objectStore('meta').delete(id); t.objectStore('covers').delete(id); t.objectStore('content').delete(id);
      for (const prefix of ['file:', 'progress:', 'annotations:', 'style:']) t.objectStore('kv').delete(prefix + id);
    });
  },
  async recycleBook(id) {
    await write(['meta', 'covers', 'content', 'kv'], (t) => {
      const meta = t.objectStore('meta'), content = t.objectStore('content'), kv = t.objectStore('kv'), covers = t.objectStore('covers');
      const requests = [meta.get(id), content.get(id), covers.get(id), ...['file:', 'progress:', 'annotations:', 'style:'].map(p => kv.get(p + id))];
      let remaining = requests.length;
      for (const request of requests) request.onsuccess = () => {
        if (--remaining) return;
        if (!requests[0].result) return;
        const book = { ...requests[0].result, cover: requests[2].result };
        const deletedAt = Date.now();
        kv.put({ k: `trash:${id}`, v: { meta: book, chapters: requests[1].result ?? [], deletedAt, kv: requests.slice(3).map(r => r.result).filter(Boolean) } });
        kv.put({ k: `trash-index:${id}`, v: { meta: lightMeta(book), deletedAt } });
        meta.delete(id); content.delete(id); covers.delete(id);
        for (const prefix of ['file:', 'progress:', 'annotations:', 'style:']) kv.delete(prefix + id);
        const tomb = kv.get('tombstones');
        tomb.onsuccess = () => {
          const value = tomb.result?.v ?? { books: [], nodes: [] };
          if (!value.books.includes(id)) value.books.push(id);
          kv.put({ k: 'tombstones', v: value });
        };
      };
    });
  },
  async dumpAll() {
    const metas = await this.listBooks();
    const contents: Array<{ id: string; chapters: Chapter[] }> = [];
    for (const m of metas) {
      if (m.hasCover) m.cover = await this.getCover(m.id);
      const chapters = await this.getChapters(m.id); if (chapters) contents.push({ id: m.id, chapters });
    }
    return { metas, contents, kv: await this.kvEntries('') };
  },
  async replaceAll(metas, contents, kv, merge = false, deleteKeys = []) {
    await write(['meta', 'covers', 'content', 'kv'], (t) => {
      if (!merge) for (const name of ['meta', 'covers', 'content', 'kv']) t.objectStore(name).clear();
      for (const meta of metas) saveMeta(t, meta);
      for (const c of contents) t.objectStore('content').put(c.chapters, c.id);
      for (const item of kv) t.objectStore('kv').put(item);
      for (const key of deleteKeys) t.objectStore('kv').delete(key);
    });
  },
};
export const platform: PlatformAdapter = webAdapter;
