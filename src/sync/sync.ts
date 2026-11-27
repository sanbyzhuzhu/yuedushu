/** 同步引擎（V0.1.0 L1 + V0.2.0 资产备份 + V0.3.2 书名命名 + V0.4.0 多账号）：标准 WebDAV
 *  （任意服务商：坚果云 / InfiniCLOUD / Nextcloud / 自建等；多账号同时同步、互为备份）
 *  目录：/dav/<basePath>/manifest.json + books/<书名__id6>.json + files/<书名__id6>.<ext>
 *  （V0.3.2 前为 books/<id>.json / files/<id>.<ext>——用户反馈 UUID 文件名在网盘里分不清哪本书，
 *   改为书名命名；nameVer 迁移：强制整书重传一次新命名 + 清理旧命名文件；下载端双名兼容）
 *  策略（方案 5.6）：进度新者胜；笔记 id 并集 + 墓碑；分类/书架并集 + 墓碑；
 *  rev 跳过已同步书；正文/原文件/本书方案作为资产透传（上传耗流量需开关，下载恢复始终进行）
 *  多账号（V0.4.0）：同步水位按账号独立存于 sync-state:<id>，逐账号串行整跑合并；
 *  本机即中继——任一云端的数据经本机同步传导到其余云端 */
import { create } from 'zustand';
import { lightMeta, platform } from '../platform/web';
import { useLibrary } from '../store/library';
import { useBookStyles } from '../store/bookStyles';
import { mergeSyncedAnnotations } from '../store/annotations';
import { mergeManifest, mergeBook, newerMeta, union } from './merge';
import { WebDAVClient } from './webdav';
import { detectPreset, WEBDAV_PRESETS } from './providers';
import type { LegacySyncConfig, RemoteBook, RemoteManifest, SyncAccount, SyncConfig, SyncTombstones } from './types';
import type { BookMeta, CatNode, ReaderSettings } from '../engine/types';

interface SyncStateKv {
  bookRevs: Record<string, number>;
  assetDone?: Record<string, boolean>;
  dirsOk?: boolean;
  /** 目录缓存版本：v2 = 修正 ensureDir 路径二次拼接并重补 files 目录，
   *  老用户（dirsOk=true 但目录实际未建成）升级后会强制重建一次 */
  dirsOkV?: number;
  /** 云端命名版本：v2 = books/files 改用「书名__id6」命名；升级后整书重传新命名并清理旧命名 */
  nameVer?: number;
  /** 本账号上次成功同步时间（V0.4.0 多账号后按账号记录） */
  lastSyncAt?: number;
}

const DIRS_VER = 2;
const NAME_VER = 2;

/** 每个账号独立的同步水位键；sync- 前缀天然被本地备份排除、整库恢复时保留 */
const stateKey = (id: string) => `sync-state:${id}`;

/** 云端书名：清理文件系统非法字符，附 id 前 6 位保证唯一且文件名可读 */
function bookCloudName(title: string, id: string): string {
  const base =
    (title || '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '未命名';
  return `${base}__${id.slice(0, 6)}`;
}

/** 各账号运行期状态（本会话内有效；上次同步时间从各账号 sync-state 恢复） */
export interface AccountRuntime {
  status: 'syncing' | 'ok' | 'error';
  message: string;
  at: number;
}

interface SyncStore {
  config: SyncConfig;
  status: 'off' | 'syncing' | 'ok' | 'error'; // 聚合：任一账号出错即 error
  lastSyncAt: number; // 任一账号最近一次成功同步
  message: string; // 聚合消息（失败账号优先展示）
  accountRuntime: Record<string, AccountRuntime>;
  init: () => Promise<void>;
  save: (patch: Partial<SyncConfig>) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  syncNow: () => Promise<void>;
  startLoop: () => void;
}

/** 新账号默认按坚果云预设填写（存量用户最常用），可再换服务商 */
export function newAccount(): SyncAccount {
  return {
    id: uid(),
    enabled: true,
    url: WEBDAV_PRESETS[0].url ?? 'https://dav.jianguoyun.com/dav/',
    username: '',
    password: '',
    basePath: '阅读树',
    backupBooks: false,
    rememberPassword: true,
  };
}

const DEFAULT_CONFIG: SyncConfig = {
  enabled: false,
  accounts: [newAccount()],
  intervalMinutes: 3,
};

function uid(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `dv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

let loopTimer: ReturnType<typeof setInterval> | null = null;

function stripCover(m: BookMeta): Omit<BookMeta, 'cover'> {
  const { cover: _c, ...rest } = m;
  return rest;
}

function normalizeAnns(raw: unknown): { list: RemoteBook['annotations']; deleted: string[]; updatedAt?: number } {
  if (Array.isArray(raw)) return { list: raw, deleted: [] }; // 旧格式迁移
  const o = (raw ?? {}) as Partial<{ list: RemoteBook['annotations']; deleted: string[]; updatedAt: number }>;
  return { list: o.list ?? [], deleted: o.deleted ?? [], updatedAt: o.updatedAt };
}

/** 持久化时剥离"不记住密码"账号的密码 */
function persistedConfig(config: SyncConfig): SyncConfig {
  return {
    ...config,
    accounts: config.accounts.map((a) => ({ ...a, password: a.rememberPassword === false ? '' : a.password })),
  };
}

export const useSync = create<SyncStore>((set, get) => ({
  config: DEFAULT_CONFIG,
  status: 'off',
  lastSyncAt: 0,
  message: '',
  accountRuntime: {},

  init: async () => {
    const saved = await platform.kvGet<Partial<SyncConfig> & Partial<LegacySyncConfig>>('sync-config');
    if (saved) {
      let config: SyncConfig;
      if (Array.isArray(saved.accounts)) {
        config = { ...DEFAULT_CONFIG, ...saved, accounts: saved.accounts.map((a) => ({ ...newAccount(), ...a, id: a.id || uid() })) };
      } else {
        // V0.3.x 及以前的单账号配置 → 迁移为首个账号（id 固定 main），同步水位随键名迁移
        const legacy = saved as Partial<LegacySyncConfig>;
        config = {
          enabled: legacy.enabled ?? false,
          intervalMinutes: legacy.intervalMinutes ?? 3,
          accounts: [{
            id: 'main',
            enabled: true,
            url: legacy.url || WEBDAV_PRESETS[0].url || '',
            username: legacy.username || '',
            password: legacy.rememberPassword === false ? '' : legacy.password || '',
            basePath: legacy.basePath || '阅读树',
            backupBooks: legacy.backupBooks ?? false,
            rememberPassword: legacy.rememberPassword ?? true,
          }],
        };
        const oldState = await platform.kvGet<SyncStateKv>('sync-state');
        if (oldState && (await platform.kvGet<SyncStateKv>(stateKey('main'))) === null) {
          await platform.kvSet(stateKey('main'), oldState);
        }
      }
      set({ config });
      await platform.kvSet('sync-config', persistedConfig(config));
    }
    // 恢复各账号上次同步时间（并聚合出全局最近成功同步）
    const runtime: Record<string, AccountRuntime> = {};
    let last = 0;
    for (const a of get().config.accounts) {
      const st = await platform.kvGet<SyncStateKv>(stateKey(a.id));
      if (st?.lastSyncAt) {
        runtime[a.id] = { status: 'ok', message: '', at: st.lastSyncAt };
        last = Math.max(last, st.lastSyncAt);
      }
    }
    set({ accountRuntime: runtime, lastSyncAt: last, status: get().config.enabled ? 'ok' : 'off' });
  },

  save: async (patch) => {
    const config = { ...get().config, ...patch };
    set({ config });
    await platform.kvSet('sync-config', persistedConfig(config));
    if (!config.enabled) set({ status: 'off' });
    else if (get().status === 'off') set({ status: 'ok' });
  },

  removeAccount: async (id) => {
    const accounts = get().config.accounts.filter((a) => a.id !== id);
    if (!accounts.length) return; // 至少保留一个账号
    const runtime = { ...get().accountRuntime };
    delete runtime[id];
    const config = { ...get().config, accounts };
    set({ config, accountRuntime: runtime });
    await platform.kvDel(stateKey(id));
    await platform.kvSet('sync-config', persistedConfig(config));
  },

  syncNow: async () => {
    const cfg = get().config;
    if (!cfg.enabled) return;
    const targets = cfg.accounts.filter((a) => a.enabled && a.url.trim() && a.username.trim() && a.password);
    if (!targets.length) return;
    if (get().status === 'syncing') return;
    set({
      status: 'syncing',
      message: '',
      accountRuntime: {
        ...get().accountRuntime,
        ...Object.fromEntries(targets.map((a) => [a.id, { status: 'syncing', message: '', at: Date.now() } as AccountRuntime])),
      },
    });

    // 逐账号串行同步（各账号独立限频；一个失败不影响其余）
    const runtime = { ...get().accountRuntime };
    for (const acc of targets) {
      try {
        const { reqCount, fileFails } = await syncAccount(acc);
        const warn = fileFails.length ? `；${fileFails.length} 个原文件上传失败（如 ${fileFails[0]}）` : '';
        runtime[acc.id] = { status: 'ok', message: `已同步 · ${reqCount} 个请求${warn}`, at: Date.now() };
      } catch (e) {
        runtime[acc.id] = { status: 'error', message: syncErrorMessage(acc, e), at: Date.now() };
      }
      set({ accountRuntime: { ...runtime } });
    }
    const failed = targets.filter((a) => runtime[a.id].status === 'error');
    const okCount = targets.length - failed.length;
    set({
      status: failed.length ? 'error' : 'ok',
      lastSyncAt: okCount ? Date.now() : get().lastSyncAt,
      message: failed.length
        ? `${failed.map((a) => `${detectPreset(a.url).label}：${runtime[a.id].message}`).join('；')}${okCount ? `（其余 ${okCount} 个账号已同步）` : ''}`
        : targets.length > 1
          ? `已同步 ${targets.length} 个账号`
          : runtime[targets[0].id].message,
    });
  },

  startLoop: () => {
    if (loopTimer) return;
    loopTimer = setInterval(() => {
      if (!document.hidden && get().config.enabled && Date.now() - get().lastSyncAt >= (get().config.intervalMinutes ?? 3) * 60000) void get().syncNow();
    }, 60000);
    if (get().config.enabled) void get().syncNow();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && get().config.enabled) void get().syncNow();
    });
    window.addEventListener('online', () => { if (get().config.enabled) void get().syncNow(); });
  },
}));

/** 单账号同步核心（V0.4.0 自 syncNow 抽出）：建目录 → 与远端合并 → 逐书处理 → manifest 上传。
 *  返回请求计数与「原文件上传失败」清单（可选资产失败不中断同步，只降级为警告） */
async function syncAccount(acc: SyncAccount): Promise<{ reqCount: number; fileFails: string[] }> {
  const fileFails: string[] = [];
  const client = new WebDAVClient({
    url: acc.url,
    username: acc.username,
    password: acc.password,
    basePath: acc.basePath,
  });
  const state = (await platform.kvGet<SyncStateKv>(stateKey(acc.id))) ?? { bookRevs: {} };
  // 建目录：basePath / books / files（传相对 WebDAV 根的绝对路径，不重复拼 basePath）
  if (!state.dirsOk || state.dirsOkV !== DIRS_VER) {
    await client.ensureDir(acc.basePath);
    await client.ensureDir(`${acc.basePath}/books`);
    await client.ensureDir(`${acc.basePath}/files`);
    state.dirsOk = true;
    state.dirsOkV = DIRS_VER;
  }

  let deviceId = await platform.kvGet<string>('device-id');
  if (!deviceId) {
    deviceId = uid();
    await platform.kvSet('device-id', deviceId);
  }
  const device = `设备 ${deviceId.slice(0, 4)}`;

  const lib = useLibrary.getState();
  const tomb = (await platform.kvGet<SyncTombstones>('tombstones')) ?? { books: [], nodes: [] };
  const remoteManifest = await client.getJSON<RemoteManifest>('manifest.json');

  const mm = mergeManifest(lib.nodes, lib.books, tomb, remoteManifest);

  // 远端已删的书：本地彻底清理
  for (const id of mm.deletedBooks) {
    if (lib.books.some((b) => b.id === id)) {
      await platform.deleteBook(id);
      await platform.kvDel(`progress:${id}`);
      await platform.kvDel(`annotations:${id}`);
    }
  }

  // 逐本书合并
  const revs: Record<string, number> = { ...state.bookRevs };
  const remoteById = new Map((remoteManifest?.books ?? []).map((b) => [b.id, b]));
  const allIds = union(
    [...mm.metas.keys()],
    (remoteManifest?.books ?? []).map((b) => b.id),
  );
  const pushBooks: Array<BookMeta & { rev: number }> = [];
  // Three range reads rather than three transactions per book (30,000 at 10k books).
  const [progressEntries, annotationEntries, styleEntries] = await Promise.all([
    platform.kvEntries<RemoteBook['progress']>('progress:'),
    platform.kvEntries<unknown>('annotations:'),
    platform.kvEntries<Partial<ReaderSettings>>('style:'),
  ]);
  const progresses = new Map(progressEntries.map(e => [e.k.slice('progress:'.length), e.v]));
  const annotations = new Map(annotationEntries.map(e => [e.k.slice('annotations:'.length), e.v]));
  const styles = new Map(styleEntries.map(e => [e.k.slice('style:'.length), e.v]));

  for (const id of allIds) {
    const meta = mm.metas.get(id);
    if (!meta) continue;
    const progress = progresses.get(id) ?? null;
    const annData = normalizeAnns(annotations.get(id));
    const localStyle = styles.get(id) ?? null;
    const localRev = Math.max(
      annData.updatedAt ?? 0,
      meta.updatedAt ?? meta.addedAt ?? 0,
      progress?.updatedAt ?? 0,
      ...annData.list.map((a) => a.updatedAt ?? a.createdAt),
    );
    const remoteRev = remoteById.get(id)?.rev;

    // 已完全同步（rev 一致 + 本地无新增 + 资产已处理 + 云端命名已是书名版）→ 跳过，控制请求数
    const migrate = state.nameVer !== NAME_VER; // 旧命名迁移：本次强制逐书重传新命名
    const inSync =
      !migrate &&
      remoteRev !== undefined &&
      state.bookRevs[id] === remoteRev &&
      localRev <= remoteRev &&
      state.assetDone?.[id];
    if (inSync) {
      revs[id] = remoteRev;
      pushBooks.push({ ...stripCover(meta), rev: remoteRev });
      continue;
    }

    // Unchanged books never need their potentially large text/original assets read.
    const [localContent, localFile] = await Promise.all([
      acc.backupBooks ? platform.getChapters(id) : Promise.resolve(null),
      acc.backupBooks ? platform.kvGet<ArrayBuffer>(`file:${id}`) : Promise.resolve(null),
    ]);

    let remote =
      remoteRev !== undefined
        ? await client.getJSON<RemoteBook>(`books/${bookCloudName(remoteById.get(id)?.title ?? meta.title, id)}.json`)
        : null;
    // 迁移期：合并云端旧命名文件，避免覆盖其他设备尚未同步的数据
    if (migrate && remoteRev !== undefined) {
      const legacy = await client.getJSON<RemoteBook>(`books/${id}.json`);
      if (legacy) {
        remote = remote ? mergeBook({ local: legacy, remote, deviceId: device }).merged : legacy;
      }
    }
    const currentMeta = useLibrary.getState().books.find(b => b.id === id);
    const ownMeta = currentMeta ?? meta;
    const local: RemoteBook = {
      bookId: id,
      updatedAt: Math.max(localRev, ownMeta.updatedAt ?? 0),
      device,
      meta: ownMeta.hasCover && !ownMeta.cover ? { ...ownMeta, cover: await platform.getCover(id) } : ownMeta,
      progress,
      annotations: annData.list,
      deletedAnnotationIds: annData.deleted,
      rev: Math.max(localRev, ownMeta.updatedAt ?? 0),
      ...(localContent ? { content: localContent } : {}),
      ...(localFile ? { fileInfo: { ext: meta.format, size: localFile.byteLength } } : {}),
      ...(localStyle ? { style: localStyle } : {}),
    };
    const r = mergeBook({ local, remote, deviceId: device });
    const merged = r.merged!;

    // 本地写回（核心字段：进度/笔记/meta）
    if (r.changed || !remote) {
      await platform.putMeta(merged.meta);
      await platform.kvSet(`progress:${id}`, merged.progress);
      await mergeSyncedAnnotations(id, {
        list: merged.annotations,
        deleted: merged.deletedAnnotationIds,
        updatedAt: merged.updatedAt,
      });
    }

    // 上传原始文件存档（一次；耗上行，受开关控制；迁移期强制重传到新命名）
    if (acc.backupBooks && localFile && (!remote?.fileInfo || migrate)) {
      try {
        await client.putRaw(`files/${bookCloudName(meta.title, id)}.${meta.format}`, localFile);
      } catch (e) {
        // 原文件是可选资产：单个失败（如网盘转 WebDAV 的代理不支持/限制上传）不拖垮整个账号，
        // 收集为警告继续同步进度/笔记；并从本次上传中去除 fileInfo，远端不会误以为文件存在
        fileFails.push(e instanceof Error ? e.message : String(e));
        merged.fileInfo = undefined;
      }
    }
    // 资产新增需 bump rev，否则其他设备不会拉取
    let assetBump = migrate && !!localFile;
    if (!remote?.content && merged.content) assetBump = true;
    if (!remote?.fileInfo && localFile) assetBump = true;
    if (assetBump) {
      merged.rev = Date.now();
      merged.updatedAt = Math.max(merged.updatedAt, merged.rev);
    }

    // 书文件上传（与远端整体不同即传：核心变化或资产变化）
    if (JSON.stringify(merged) !== JSON.stringify(remote)) {
      await client.putJSON(`books/${bookCloudName(meta.title, id)}.json`, merged);
      state.assetDone = { ...(state.assetDone ?? {}), [id]: true };
    }
    // 迁移期：清理云端旧命名文件（404 容忍）
    if (migrate && remoteRev !== undefined) {
      await client.del(`books/${id}.json`);
      if (acc.backupBooks) await client.del(`files/${id}.${meta.format}`);
    }

    // 下载恢复（不耗上行，始终进行）：正文 / 原文件 / 本书独立方案
    if (remote?.content && !(await platform.getChapters(id))) {
      await platform.putBook(merged.meta, remote.content);
    }
    if (remote?.fileInfo && !(await platform.kvGet<ArrayBuffer>(`file:${id}`))) {
      const nm = bookCloudName(remote.meta.title, id);
      const raw =
        (await client.getRaw(`files/${nm}.${remote.fileInfo.ext}`)) ??
        (await client.getRaw(`files/${id}.${remote.fileInfo.ext}`)); // 旧命名兼容
      if (raw) await platform.kvSet(`file:${id}`, raw);
    }
    if (remote?.style && !localStyle) {
      await platform.kvSet(`style:${id}`, remote.style);
      useBookStyles.setState({
        map: { ...useBookStyles.getState().map, [id]: remote.style },
      });
    }

    // Keep only small metadata between iterations, even when syncing thousands of covers.
    mm.metas.set(id, lightMeta(merged.meta));
    revs[id] = merged.rev;
    pushBooks.push({ ...stripCover(merged.meta), rev: merged.rev });
  }

  // 应用合并结果到本地书架
  const current = useLibrary.getState();
  const currentById = new Map(current.books.map((b) => [b.id, b]));
  const changedMeta = [...mm.metas.values()].filter((m) => {
    const cur = currentById.get(m.id);
    if (!cur && lib.books.some(b => b.id === m.id)) return false;
    return !cur || JSON.stringify(cur) !== JSON.stringify(newerMeta(cur, m));
  });
  for (const m of changedMeta) {
    const cur = useLibrary.getState().books.find(b => b.id === m.id);
    await platform.putMeta(cur ? newerMeta(cur, m) : m);
  }
  if (JSON.stringify(current.nodes) !== JSON.stringify(mm.nodes)) {
    await platform.kvSet('nodes', mm.nodes);
  }
  await platform.kvSet('tombstones', { books: mm.deletedBooks, nodes: mm.deletedNodes });
  const latest = useLibrary.getState();
  const finalBooks = new Map([...mm.metas.values()].map(m => [m.id, lightMeta(m)]));
  for (const old of lib.books) if (!latest.books.some(b => b.id === old.id)) finalBooks.delete(old.id);
  for (const b of latest.books) {
    if (mm.deletedBooks.includes(b.id)) continue;
    const merged = finalBooks.get(b.id);
    finalBooks.set(b.id, merged ? lightMeta(newerMeta(b, merged)) : b);
  }
  useLibrary.setState({
    nodes: mm.nodes,
    books: [...finalBooks.values()].sort((a, b) => b.addedAt - a.addedAt),
  });

  const manifest: RemoteManifest = {
    version: 1,
    updatedAt: Date.now(),
    device,
    nodes: mm.nodes,
    deletedNodeIds: mm.deletedNodes,
    books: pushBooks,
    deletedBookIds: mm.deletedBooks,
  };
  await client.putJSON('manifest.json', manifest);

  state.bookRevs = revs;
  state.dirsOk = true;
  state.nameVer = NAME_VER;
  state.lastSyncAt = Date.now();
  await platform.kvSet(stateKey(acc.id), state);
  return { reqCount: client.reqCount, fileFails };
}

/** 账号级同步失败提示（V0.4.0：按账号给出，不绑定单一服务商） */
function syncErrorMessage(acc: SyncAccount, e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  let hint = '';
  if (raw.includes('Failed to fetch') || raw.includes('NetworkError')) {
    hint = '（无法连接服务器：请检查地址与网络。浏览器网页环境受跨域限制，多数 WebDAV 不允许网页直连，打包应用内可用；自建服务需允许跨域）';
  } else if (raw.includes('HTTP 409')) {
    hint = `（HTTP 409：云端目录不存在或无法创建。请确认该账号能在网盘根目录创建「${acc.basePath || '阅读树'}」文件夹）`;
  } else if (raw.includes('HTTP 401') || raw.includes('HTTP 403')) {
    hint = '（账号或密码有误：坚果云、InfiniCLOUD、Nextcloud 等均需使用应用密码/专用密码，而非登录密码）';
  } else if (/HTTP 5\d\d/.test(raw)) {
    hint = '（服务器内部错误：多为网盘转 WebDAV 的代理工具上传实现不完整或凭证/风控问题，请检查该工具的日志与账号状态）';
  }
  return raw + hint;
}
