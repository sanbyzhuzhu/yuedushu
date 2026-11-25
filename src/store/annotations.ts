/** 划线/批注/书签状态（按书持久化；带删除墓碑以支持多端合并） */
import { create } from 'zustand';
import { platform } from '../platform/web';
import type { Annotation } from '../engine/types';

function uid(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `an-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface AnnData {
  list: Annotation[];
  deleted: string[];
  updatedAt?: number;
}

/** 兼容旧格式（纯数组）与缺省字段 */
export function parseAnnData(raw: unknown): AnnData {
  if (Array.isArray(raw)) return { list: raw, deleted: [] };
  const o = (raw ?? {}) as Partial<AnnData>;
  return { list: o.list ?? [], deleted: o.deleted ?? [], updatedAt: o.updatedAt };
}

interface AnnState {
  bookId: string | null;
  list: Annotation[];
  load: (bookId: string) => Promise<void>;
  add: (a: Omit<Annotation, 'id' | 'createdAt' | 'bookId'>) => Promise<Annotation>;
  update: (id: string, patch: Partial<Pick<Annotation, 'note' | 'color'>>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// 串行提交，避免快速连续划线/删除用旧快照覆盖已保存的笔记。
let writes: Promise<unknown> = Promise.resolve();
let loadVersion = 0;
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const next = writes.then(action);
  writes = next.catch(() => {});
  return next;
}

/** Modify one book without changing the reader's currently loaded book. */
export function changeAnnotation(bookId: string, id: string, note: string | null): Promise<void> {
  return enqueue(async () => {
    const data = parseAnnData(await platform.kvGet<unknown>(`annotations:${bookId}`));
    if (note !== null && !data.list.some((a) => a.id === id)) throw new Error('这条笔记已被删除，请刷新列表');
    const list = note === null ? data.list.filter((a) => a.id !== id)
      : data.list.map((a) => a.id === id ? { ...a, note, updatedAt: Date.now() } : a);
    const deleted = note === null ? [...new Set([...data.deleted, id])] : data.deleted;
    await platform.kvSet(`annotations:${bookId}`, { list, deleted, updatedAt: Date.now() });
    if (useAnnotations.getState().bookId === bookId) useAnnotations.setState({ list });
  });
}

export async function allBookAnnotations(): Promise<Array<{ k: string; v: AnnData }>> {
  await writes;
  return (await platform.kvEntries<unknown>('annotations:')).map(({ k, v }) => ({ k, v: parseAnnData(v) }));
}

/** 同步写回也走同一提交队列，保留下载期间新建或修改的笔记。 */
export function mergeSyncedAnnotations(bookId: string, remote: AnnData): Promise<void> {
  return enqueue(async () => {
    const local = parseAnnData(await platform.kvGet(`annotations:${bookId}`));
    const deleted = [...new Set([...local.deleted, ...remote.deleted])];
    const map = new Map<string, Annotation>();
    for (const a of [...local.list, ...remote.list]) {
      const old = map.get(a.id);
      if (!old || (a.updatedAt ?? a.createdAt) > (old.updatedAt ?? old.createdAt)) map.set(a.id, a);
    }
    deleted.forEach((id) => map.delete(id));
    const list = [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
    await platform.kvSet(`annotations:${bookId}`, { list, deleted, updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0) });
    if (useAnnotations.getState().bookId === bookId) useAnnotations.setState({ list });
  });
}

export const useAnnotations = create<AnnState>((set, get) => ({
  bookId: null,
  list: [],

  load: async (bookId) => {
    const version = ++loadVersion;
    set({ bookId: null, list: [] });
    await writes;
    const raw = await platform.kvGet<unknown>(`annotations:${bookId}`);
    const data = parseAnnData(raw);
    if (version === loadVersion) set({ bookId, list: data.list });
  },

  add: async (a) => {
    const bookId = get().bookId;
    if (!bookId) throw new Error('笔记尚未加载，请稍后重试');
    const ann: Annotation = { ...a, bookId, id: uid(), createdAt: Date.now() };
    return enqueue(async () => {
      const data = parseAnnData(await platform.kvGet<unknown>(`annotations:${bookId}`));
      const list = [...data.list, ann];
      await platform.kvSet(`annotations:${bookId}`, { list, deleted: data.deleted, updatedAt: Date.now() });
      if (get().bookId === bookId) set({ list });
      return ann;
    });
  },

  update: async (id, patch) => {
    const bookId = get().bookId;
    if (!bookId) throw new Error('笔记尚未加载');
    return enqueue(async () => {
      const data = parseAnnData(await platform.kvGet<unknown>(`annotations:${bookId}`));
      const list = data.list.map((a) => a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a);
      await platform.kvSet(`annotations:${bookId}`, { list, deleted: data.deleted, updatedAt: Date.now() });
      if (get().bookId === bookId) set({ list });
    });
  },

  remove: async (id) => {
    const bookId = get().bookId;
    if (!bookId) throw new Error('笔记尚未加载');
    return enqueue(async () => {
      const data = parseAnnData(await platform.kvGet<unknown>(`annotations:${bookId}`));
      const list = data.list.filter((a) => a.id !== id);
      if (!data.deleted.includes(id)) data.deleted.push(id);
      await platform.kvSet(`annotations:${bookId}`, { list, deleted: data.deleted, updatedAt: Date.now() });
      if (get().bookId === bookId) set({ list });
    });
  },
}));
