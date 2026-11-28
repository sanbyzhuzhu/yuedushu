/** Bounded, sequential backup. Each selected batch is an independently restorable ZIP. */
import { Zip, ZipDeflate, ZipPassThrough, unzipSync, strToU8, strFromU8 } from 'fflate';
import { platform } from './platform/web';
import type { BookMeta, Chapter } from './engine/types';

const MANIFEST = 'manifest.json';
export const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
export const MAX_BACKUP_ZIP_BYTES = MAX_BACKUP_BYTES + 4 * 1024 * 1024;
const MAX_BYTES = MAX_BACKUP_BYTES;
const bookKey = /^(file|progress|annotations|style):(.+)$/;
export interface BackupProgress { phase: 'collecting' | 'zipping' | 'downloading' | 'restoring' | 'done'; detail: string }
export interface BackupInfo { books: number; exportedAt: number; includeRaw: boolean; merge?: boolean; format?: number }

export function backupFileName(): string {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `阅读树_备份_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.zip`;
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function exportBackup(opts: { includeRaw: boolean; start?: number; count?: number; ids?: string[]; signal?: AbortSignal; onPhase?: (p: BackupProgress) => void }): Promise<{ books: number; bytes: number; name: string }> {
  const all = await platform.listBooks(), byId = new Map(all.map((m) => [m.id, m]));
  const order = opts.ids ?? all.map((m) => m.id), start = opts.start ?? 0, count = opts.count ?? 100;
  if (!Number.isInteger(start) || start < 0 || start > order.length || !Number.isInteger(count) || count < 1 || count > 200) throw new Error('请选择有效范围，每批最多 200 本');
  const ids = order.slice(start, start + count), selected = new Set(ids);
  if (ids.some((id) => !byId.has(id))) throw new Error('部分书籍已移出书库，请重新打开备份面板');
  const merge = ids.length !== all.length;
  const chunks: Uint8Array[] = []; let zipError: Error | undefined, finished = false, inputSize = 0, binaryId = 0;
  const zip = new Zip((error, data, final) => { if (error) zipError = error; else chunks.push(data); if (final) finished = true; });
  const add = (name: string, bytes: Uint8Array, binary = false) => {
    opts.signal?.throwIfAborted(); inputSize += bytes.byteLength;
    if (inputSize > MAX_BYTES) throw new Error('本批数据超过 256 MiB，请减少本数或选择轻量备份。单本原文件过大时请另行保存源文件。');
    const entry = binary ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 3 });
    zip.add(entry); entry.push(bytes, true); if (zipError) throw zipError;
  };
  const json = (name: string, value: unknown) => {
    const text = JSON.stringify(value, (_, v) => {
      if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
        const path = `binary/${binaryId++}.bin`;
        add(path, v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength), true);
        return { __readingTreeBinary: path };
      }
      return v;
    });
    add(name, strToU8(text));
  };
  try {
    json(MANIFEST, { app: 'reading-tree', format: 3, dbVer: 3, exportedAt: Date.now(), books: ids.length, includeRaw: opts.includeRaw, merge });
    const metas: BookMeta[] = [];
    for (let i = 0; i < ids.length; i++) {
      opts.onPhase?.({ phase: 'collecting', detail: `正在备份 ${i + 1} / ${ids.length} 本` });
      const meta = { ...byId.get(ids[i])! };
      if (meta.hasCover) json(`covers/${encodeURIComponent(meta.id)}.json`, await platform.getCover(meta.id) ?? null);
      metas.push(meta);
      const chapters = await platform.getChapters(meta.id);
      if (!chapters) throw new Error(`《${meta.title}》正文缺失，未导出本批备份`);
      json(`content/${encodeURIComponent(meta.id)}.json`, chapters);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    json('meta/books.json', metas);
    // Read keys before values: light backup never loads raw PDF/font buffers at all.
    for (const k of await platform.kvKeys()) {
      // Deleted originals must not inflate light or single-book backups.
      if (k.startsWith('trash:') || k.startsWith('trash-index:')) continue;
      if (k.startsWith('sync-') || k === 'device-id') continue;
      const match = bookKey.exec(k);
      if (match && !selected.has(match[2])) continue;
      if (!opts.includeRaw && (k.startsWith('file:') || k.startsWith('font:'))) continue;
      if (merge && (k.startsWith('sync-') || k === 'device-id' || k === 'tombstones')) continue;
      opts.signal?.throwIfAborted();
      let value = await platform.kvGet<unknown>(k);
      if (merge && k.startsWith('stats:') && value && typeof value === 'object' && 'byBook' in value) {
        const byBook = Object.fromEntries(Object.entries((value as { byBook: Record<string, number> }).byBook).filter(([id]) => selected.has(id)));
        if (!Object.keys(byBook).length) continue;
        value = { ...value, byBook, seconds: Object.values(byBook).reduce((a, b) => a + b, 0) };
      }
      json(`kv/${encodeURIComponent(k)}.json`, value);
    }
    zip.end(); if (zipError) throw zipError; if (!finished) throw new Error('备份压缩未完成');
    opts.signal?.throwIfAborted();
    const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' });
    const name = backupFileName().replace('.zip', merge ? `_第${start + 1}-${start + ids.length}本.zip` : '.zip');
    download(blob, name); return { books: ids.length, bytes: blob.size, name };
  } finally { zip.terminate(); }
}

function readZip(buf: ArrayBuffer, onlyManifest = false) {
  if (buf.byteLength > MAX_BYTES + 4 * 1024 * 1024) throw new Error('备份包过大，请使用分批备份文件（每批原始数据最多 256 MiB）');
  let total = 0;
  return unzipSync(new Uint8Array(buf), { filter: (entry) => {
    if (onlyManifest && entry.name !== MANIFEST) return false;
    total += entry.originalSize;
    if (total > MAX_BYTES || entry.originalSize > MAX_BYTES) throw new Error('备份解压后超过 256 MiB，请使用较小的分批备份');
    return true;
  } });
}
function manifest(z: Record<string, Uint8Array>): BackupInfo {
  if (!z[MANIFEST]) throw new Error('备份缺少说明文件');
  const m = JSON.parse(strFromU8(z[MANIFEST]));
  if (m.app !== 'reading-tree' || !Number.isInteger(m.books) || m.books < 0 || (m.format && m.format !== 3)) throw new Error('不是支持的阅读树备份文件');
  return m;
}
export function peekBackup(buf: ArrayBuffer): BackupInfo { return manifest(readZip(buf, true)); }

export async function restoreBackup(buf: ArrayBuffer, onPhase?: (p: BackupProgress) => void): Promise<{ books: number; kv: number }> {
  onPhase?.({ phase: 'restoring', detail: '解析备份包…' });
  const z = readZip(buf), man = manifest(z);
  const parse = (key: string) => {
    if (!z[key]) throw new Error('备份文件不完整：' + key);
    return JSON.parse(strFromU8(z[key]), (_, v) => {
      if (man.format === 3 && v && typeof v.__readingTreeBinary === 'string') {
        const bytes = z[v.__readingTreeBinary]; if (!bytes) throw new Error('备份中的原文件或字体缺失');
        return bytes.slice().buffer;
      }
      return v;
    });
  };
  const metas = parse('meta/books.json') as BookMeta[];
  if (!Array.isArray(metas) || metas.length !== man.books || metas.some((m) => !m || typeof m.id !== 'string' || typeof m.title !== 'string') || new Set(metas.map((m) => m.id)).size !== metas.length) throw new Error('备份书籍目录损坏');
  if (man.format === 3) for (const meta of metas) if (meta.hasCover) { meta.cover = parse(`covers/${encodeURIComponent(meta.id)}.json`) || undefined; meta.hasCover = !!meta.cover; }
  const contents: Array<{ id: string; chapters: Chapter[] }> = metas.map((m) => {
    const chapters = parse(`content/${encodeURIComponent(m.id)}.json`);
    if (!Array.isArray(chapters) || chapters.some((c) => !c || typeof c.html !== 'string' || typeof c.title !== 'string')) throw new Error('备份正文损坏');
    return { id: m.id, chapters };
  });
  const kv: Array<{ k: string; v: unknown }> = [];
  for (const key of Object.keys(z)) if (key.startsWith('kv/') && key.endsWith('.json')) {
    const k = decodeURIComponent(key.slice(3, -5)); let v = parse(key);
    if (k.startsWith('sync-') || k === 'device-id') continue;
    if (man.merge && (k === 'tombstones' || k.startsWith('sync-') || k === 'device-id')) continue;
    if (man.merge && k === 'fonts' && v && typeof v === 'object' && !Array.isArray(v)) v = { ...await platform.kvGet<Record<string, string>>(k), ...v };
    if (man.merge && k === 'nodes' && Array.isArray(v)) {
      const existing = await platform.kvGet<Array<{ id: string }>>(k) ?? [];
      v = [...new Map([...existing, ...v].map((n) => [n.id, n])).values()];
    }
    if (man.merge && k.startsWith('stats:') && v?.byBook) {
      const existing = await platform.kvGet<{ byBook: Record<string, number> }>(k);
      v.byBook = { ...existing?.byBook, ...v.byBook };
      v.seconds = Object.values(v.byBook as Record<string, number>).reduce((a, b) => a + b, 0);
    }
    kv.push({ k, v });
  }
  onPhase?.({ phase: 'restoring', detail: `写入 ${metas.length} 本书与 ${kv.length} 项数据…` });
  if (!man.merge) for (const k of ['sync-config', 'device-id']) {
    const v = await platform.kvGet(k);
    if (v !== null) kv.push({ k, v });
  }
  await platform.replaceAll(metas, contents, kv, !!man.merge);
  onPhase?.({ phase: 'done', detail: '完成' });
  return { books: metas.length, kv: kv.length };
}
