import { platform } from '../platform/web';
import type { BookMeta, Chapter } from './types';

export interface DeletedBook {
  meta: BookMeta;
  chapters: Chapter[];
  deletedAt: number;
  kv: Array<{ k: string; v: unknown }>;
}
export const RECYCLE_RETENTION = 30 * 24 * 60 * 60 * 1000;
export type DeletedBookSummary = Pick<DeletedBook, 'meta' | 'deletedAt'>;
export async function purgeDeletedBook(indexKey: string) {
  await platform.replaceAll([], [], [], true, [indexKey, indexKey.replace('trash-index:', 'trash:')]);
}
export async function listDeletedBooks() {
  // Never load all deleted raw PDFs/EPUBs merely to show their titles.
  const entries = await platform.kvEntries<DeletedBookSummary>('trash-index:');
  const cutoff = Date.now() - RECYCLE_RETENTION;
  for (const entry of entries) if (entry.v.deletedAt <= cutoff) await purgeDeletedBook(entry.k);
  return entries.filter(e => e.v.deletedAt > cutoff).sort((a, b) => b.v.deletedAt - a.v.deletedAt);
}
export async function restoreDeletedBook(key: string) {
  const indexKey = key.replace('trash:', 'trash-index:');
  key = key.replace('trash-index:', 'trash:');
  const item = await platform.kvGet<DeletedBook>(key);
  if (!item) throw new Error('此书已不在回收站');
  if (item.deletedAt <= Date.now() - RECYCLE_RETENTION) throw new Error('此书已超过保留期限');
  const id = crypto.randomUUID();
  const nodes = await platform.kvGet<Array<{ id: string }>>('nodes');
  const meta = { ...item.meta, id, updatedAt: Date.now(), nodeId: nodes?.some(n => n.id === item.meta.nodeId) ? item.meta.nodeId : null };
  const kv = item.kv.map(entry => {
    let value = entry.v;
    if (entry.k.startsWith('annotations:')) {
      const remap = (list: Array<Record<string, unknown>>) => list.map(a => ({ ...a, bookId: id }));
      if (Array.isArray(value)) value = remap(value);
      else if (value && typeof value === 'object' && 'list' in value && Array.isArray(value.list)) value = { ...value, list: remap(value.list) };
    }
    return { k: entry.k.slice(0, entry.k.indexOf(':') + 1) + id, v: value };
  });
  await platform.replaceAll([meta], [{ id, chapters: item.chapters }], kv, true, [key, indexKey]);
  return id;
}
