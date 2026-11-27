import { SUPPORTED_FORMATS } from '../engine/bookFormats';
/** 书库状态：书籍、树形分类（V0.0.7 完整版的基础数据模型） */
import { create } from 'zustand';
import { lightMeta, platform } from '../platform/web';
import { decodeText, splitTxtChapters, txtToHtml } from '../engine/txt';
import { parseFrontMatter, splitMdChapters, mdToHtml } from '../engine/md';
import { parseEpub } from '../engine/epub';
import { parseDocx } from '../engine/docx';
import { parseMobi } from '../engine/mobi';
import { parseFb2 } from '../engine/fb2';
import { parseCbz } from '../engine/cbz';
import { parseUpdb } from '../engine/updb';
import { reconcileLibrarySnapshot } from '../engine/librarySnapshot';
import { useSettings } from './settings';
import type { SyncTombstones } from '../sync/types';
import type { BookFormat, BookMeta, CatNode, Chapter } from '../engine/types';

function uid(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

interface LibraryState {
  books: BookMeta[];
  nodes: CatNode[];
  ready: boolean;
  error: string;
  importRevision: number;
  pendingImport: {revision:number;ids:string[]} | null;
  acknowledgeImport: (revision:number) => void;
  init: () => Promise<void>;
  importFile: (file: File, publish?: boolean) => Promise<BookMeta>;
  importFiles: (files: File[], progress: (done: number, total: number) => void, signal?: AbortSignal) => Promise<{ imported: number; failed: string[] }>;
  moveBooks: (ids: string[], nodeId: string | null) => Promise<void>;
  setBooksHidden: (ids: string[], hidden: boolean) => Promise<void>;
  importSample: () => Promise<void>;
  removeBook: (id: string) => Promise<void>;
  moveBook: (id: string, nodeId: string | null) => Promise<void>;
  /** 编辑书籍信息（V0.3.0）：书名/作者/封面/分类一次原子保存（避免并发写互相覆盖） */
  saveBookInfo: (id: string, patch: { title?: string; author?: string; cover?: string | null; nodeId?: string | null; completed?: boolean; hidden?: boolean }) => Promise<void>;
  addNode: (name: string, parentId?: string | null) => Promise<string>;
  renameNode: (id: string, name: string) => Promise<void>;
  removeNode: (id: string) => Promise<void>;
}

let loadGeneration = 0;
function publishImported(metas:BookMeta[], revealIds = metas.map(book => book.id)) {
  const incoming = metas.map(lightMeta), ids = new Set(incoming.map(book => book.id));
  useLibrary.setState(state => ({
    books:[...incoming,...state.books.filter(book => !ids.has(book.id))],
    importRevision:state.importRevision + 1,
    pendingImport:{revision:state.importRevision + 1,ids:revealIds.slice(0,60)},
  }));
}

export const useLibrary = create<LibraryState>((set, get) => ({
  books: [],
  nodes: [],
  ready: false,
  error: '',
  importRevision: 0,
  pendingImport: null,
  acknowledgeImport: revision => set(state => state.pendingImport?.revision === revision ? {pendingImport:null} : {}),

  init: async () => {
    const generation = ++loadGeneration;
    const before = get();
    set({ error: '' });
    try {
      const [books, nodes] = await Promise.all([platform.listBooks(), platform.kvGet<CatNode[]>('nodes')]);
      if (generation !== loadGeneration) return;
      set(current => ({
        books:reconcileLibrarySnapshot(books,before.books,current.books).sort((a,b) => b.addedAt-a.addedAt),
        nodes:reconcileLibrarySnapshot(nodes ?? [],before.nodes,current.nodes),ready:true,
      }));
    } catch (e) { if (generation === loadGeneration) set({ error: e instanceof Error ? e.message : '书库暂时无法读取' }); }
  },

  importFile: async (file: File, publish = true) => {
    const base = file.name.replace(/\.[^.]+$/, '');
    const lower = file.name.toLowerCase();
    const ext = lower.endsWith('.fb2.zip') ? 'fb2' : lower.split('.').pop() || '';
    let format: BookFormat;
    let title = base;
    let author = '';
    let cover: string | undefined;
    let epubRaw: ArrayBuffer | null = null;
    let chapters: Chapter[] = [];

    if (ext === 'txt') {
      format = 'txt';
      const text = decodeText(await file.arrayBuffer());
      chapters = splitTxtChapters(text, base).map((c) => ({
        title: c.title,
        html: txtToHtml(c.text),
        chars: c.text.length,
      }));
    } else if (ext === 'md' || ext === 'markdown') {
      format = 'md';
      epubRaw = await file.arrayBuffer();
      const raw = decodeText(epubRaw);
      const fm = parseFrontMatter(raw);
      const parsed = splitMdChapters(raw, base);
      title = parsed.title;
      author = fm.attrs.author || parsed.author;
      chapters = parsed.chapters.map((c) => ({
        title: c.title,
        html: mdToHtml(c.text),
        chars: c.text.length,
        level: c.level,
      }));
    } else if (ext === 'epub') {
      format = 'epub';
      epubRaw = await file.arrayBuffer();
      const keepCss = useSettings.getState().s.keepBookCss !== false;
      const parsed = await parseEpub(epubRaw, base, keepCss);
      title = parsed.title || base;
      author = parsed.author || '';
      cover = parsed.cover;
      chapters = parsed.chapters;
    } else if (ext === 'updb') {
      format = 'updb';
      const parsed = await parseUpdb(await file.arrayBuffer(), base);
      title = parsed.title || base;
      author = parsed.author || '';
      chapters = parsed.chapters;
    } else if (ext === 'docx') {
      format = 'docx';
      const parsed = await parseDocx(await file.arrayBuffer(), base);
      chapters = parsed.chapters;
    } else if (ext === 'mobi' || ext === 'azw3' || ext === 'azw' || ext === 'prc') {
      format = 'mobi';
      const raw = await file.arrayBuffer();
      const parsed = await parseMobi(raw, base);
      title = parsed.title || base;
      author = parsed.author || '';
      cover = parsed.cover;
      chapters = parsed.chapters;
      epubRaw = raw; // 同样存档原始文件
    } else if (ext === 'pdf') {
      format = 'pdf';
      epubRaw = await file.arrayBuffer();
      chapters = [{ title: base, html: '', chars: 0 }];
    } else if (ext === 'fb2') {
      format = 'fb2';
      const raw = await file.arrayBuffer();
      const parsed = await parseFb2(raw, base);
      title = parsed.title || base;
      author = parsed.author || '';
      cover = parsed.cover;
      chapters = parsed.chapters;
      epubRaw = raw;
    } else if (ext === 'cbz') {
      format = 'cbz';
      const raw = await file.arrayBuffer();
      const parsed = await parseCbz(raw, base);
      cover = parsed.cover;
      chapters = parsed.chapters;
      epubRaw = raw;
    } else if (['ofd', 'odt', 'html', 'htm', 'xhtml'].includes(ext)) {
      const { parseOfd, parseOdt, parseHtml } = await import('../engine/importExtra');
      format = ext === 'ofd' ? 'ofd' : ext === 'odt' ? 'odt' : 'html';
      epubRaw = await file.arrayBuffer();
      const parsed = format === 'ofd' ? parseOfd(epubRaw, base) : format === 'odt' ? parseOdt(epubRaw, base) : parseHtml(decodeText(epubRaw), base);
      title = parsed.title; author = parsed.author; chapters = parsed.chapters;
    } else {
      if (ext === 'zip') throw new Error('ZIP 仅支持以 .fb2.zip 结尾的 FB2 书籍；ZIP 漫画请确认只包含图片后改用 .cbz 导入');
      if (ext === 'cbr' || ext === '7z' || ext === 'rar') throw new Error('暂不支持 RAR/7z 漫画，请先转换为 CBZ（ZIP 图片包）');
      throw new Error('暂不支持此格式。支持 ' + SUPPORTED_FORMATS);
    }

    const meta: BookMeta = {
      id: uid(),
      title,
      author,
      format,
      size: file.size,
      addedAt: Date.now(),
      nodeId: null,
      updatedAt: Date.now(),
      ...(cover ? { cover } : {}),
    };
    // Metadata, content, cover and original file commit together: no phantom PDF on quota failure.
    await platform.putBook(meta, chapters, epubRaw ?? undefined);
    if (publish) publishImported([meta]);
    return meta;
  },

  importFiles: async (files, progress, signal) => {
    const pending: BookMeta[] = [], failed: string[] = []; let imported = 0;
    let revealed:string[] = [], lastPublished = performance.now();
    const flush = () => {
      if (!pending.length) return;
      const incoming = [...pending].reverse();
      revealed = [...incoming.map(book => book.id),...revealed].slice(0,60);
      publishImported(incoming,revealed);pending.length = 0;lastPublished = performance.now();
    };
    try {
      for (let i = 0; i < files.length; i++) {
        if (signal?.aborted) break;
        try { pending.push(lightMeta(await get().importFile(files[i], false))); imported++; }
        catch (e) { failed.push(files[i].name + '：' + (e instanceof Error ? e.message : '导入失败')); }
        if (imported === 1 || pending.length >= 20 || performance.now()-lastPublished >= 500 || i === files.length - 1) flush();
        progress(i + 1, files.length);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally { flush(); }
    return { imported, failed };
  },

  importSample: async () => {
    const { SAMPLE_MD } = await import('../engine/sample');
    const parsed = splitMdChapters(SAMPLE_MD, '古文三篇');
    const meta: BookMeta = {
      id: uid(),
      title: `示例 · ${parsed.title}`,
      author: parsed.author,
      format: 'md',
      size: SAMPLE_MD.length,
      addedAt: Date.now(),
      nodeId: null,
    };
    const chapters: Chapter[] = parsed.chapters.map((c) => ({
      title: c.title,
      html: mdToHtml(c.text),
      chars: c.text.length,
    }));
    await platform.putBook(meta, chapters);
    publishImported([meta]);
  },

  removeBook: async (id: string) => {
    await platform.recycleBook(id);
    set({ books: get().books.filter((b) => b.id !== id) });
  },

  moveBook: async (id, nodeId) => get().moveBooks([id], nodeId),
  moveBooks: async (ids, nodeId) => {
    if (nodeId && !get().nodes.some((n) => n.id === nodeId)) throw new Error('目标分类已不存在');
    const selected = new Set(ids), now = Date.now();
    const changed = get().books.filter((b) => selected.has(b.id) && (b.nodeId !== nodeId || b.hidden)).map((b) => ({ ...b, nodeId, hidden: false, updatedAt: Math.max(now, (b.updatedAt ?? 0) + 1) }));
    await platform.putMetas(changed);
    const updates = new Map(changed.map((b) => [b.id, b]));
    set({ books: get().books.map((b) => updates.get(b.id) ?? b) });
  },

  setBooksHidden: async (ids, hidden) => {
    const selected = new Set(ids), now = Date.now();
    const changed = get().books.filter(b => selected.has(b.id) && !!b.hidden !== hidden)
      .map(b => ({...b,hidden,updatedAt:Math.max(now,(b.updatedAt ?? 0)+1)}));
    await platform.putMetas(changed);
    const updates = new Map(changed.map(b => [b.id,b]));
    set({books:get().books.map(b => updates.get(b.id) ?? b)});
  },

  /** 编辑书籍信息（V0.3.0）：一次读取最新状态、合并全部字段、单次写回 */
  saveBookInfo: async (id, patch) => {
    const book = get().books.find((b) => b.id === id);
    if (!book) return;
    const meta: BookMeta = { ...book, updatedAt: Math.max(Date.now(), (book.updatedAt ?? 0) + 1) };
    if (patch.title !== undefined) meta.title = patch.title;
    if (patch.author !== undefined) meta.author = patch.author;
    if (patch.cover !== undefined) {
      meta.coverUpdatedAt = meta.updatedAt;
      if (patch.cover === null) { delete meta.cover; meta.hasCover = false; }
      else { meta.cover = patch.cover; meta.hasCover = true; }
    }
    if (patch.nodeId !== undefined) meta.nodeId = patch.nodeId;
    if (patch.completed !== undefined) meta.completed = patch.completed;
    if (patch.hidden !== undefined) meta.hidden = patch.hidden;
    await platform.putMeta(meta);
    set({ books: get().books.map((b) => (b.id === id ? lightMeta(meta) : b)) });
  },

  addNode: async (name: string, parentId: string | null = null) => {
    name = name.trim();
    if (!name) throw new Error('请填写分类名称');
    if (get().nodes.some((n) => n.parentId === parentId && n.name === name)) throw new Error('已有同名分类');
    const node: CatNode = { id: uid(), parentId, name, updatedAt: Date.now() };
    const nodes = [...get().nodes, node];
    await platform.kvSet('nodes', nodes);
    set({ nodes });
    return node.id;
  },

  removeNode: async (id: string) => {
    const removed = get().nodes.find((n) => n.id === id);
    if (!removed) return;
    // 删除当前分类后，子分类提升一级；书籍归入未分类，不删除书或后代分类。
    const nodes = get().nodes.filter((n) => n.id !== id).map((n) => n.parentId === id ? { ...n, parentId: removed.parentId, updatedAt: Date.now() } : n);
    const changed = get().books.filter((b) => b.nodeId === id).map((b) => ({ ...b, nodeId: null, updatedAt: Math.max(Date.now(), (b.updatedAt ?? 0)+1) }));
    const tomb = (await platform.kvGet<SyncTombstones>('tombstones')) ?? { books: [], nodes: [] };
    if (!tomb.nodes.includes(id)) tomb.nodes.push(id);
    await platform.putMetas(changed, [{ k: 'nodes', v: nodes }, { k: 'tombstones', v: tomb }]);
    const updates = new Map(changed.map((b) => [b.id, b]));
    set({ nodes, books: get().books.map((b) => updates.get(b.id) ?? b) });
  },
  renameNode: async (id, name) => {
    name = name.trim();
    const node = get().nodes.find((n) => n.id === id);
    if (!node) throw new Error('分类已不存在');
    if (!name) throw new Error('请填写分类名称');
    if (get().nodes.some((n) => n.id !== id && n.parentId === node.parentId && n.name === name)) throw new Error('已有同名分类');
    const nodes = get().nodes.map((n) => n.id === id ? { ...n, name, updatedAt: Date.now() } : n);
    await platform.kvSet('nodes', nodes);
    set({ nodes });
  },
}));

// 调试观测点（自动化测试用）
(window as unknown as Record<string, unknown>).__rtLib = useLibrary;
