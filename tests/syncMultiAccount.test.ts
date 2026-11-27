/** 多账号 WebDAV 同步回归测试（V0.4.0）
 *  三个关键不变量：
 *  1. V0.3.x 单账号配置自动迁移（sync-config 旧形态 → accounts[0]，sync-state → sync-state:main）
 *  2. 各账号同步水位（sync-state:<id>）相互隔离：一个云端落后时仍能收到更新
 *     （若水位被共享，先同步的账号会让引擎误以为全部"已同步"而跳过另一云端）
 *  3. 一个账号失败（HTTP 401）不影响另一账号，聚合状态与分账号状态正确 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// ---- 打桩：内存版 platform（kv/书库）；vi.mock 工厂不能引用外部变量，全部自包含 ----
vi.mock('../src/platform/web', () => {
  const kv = new Map<string, unknown>();
  const metas = new Map<string, unknown>();
  const chapters = new Map<string, unknown>();
  const covers = new Map<string, unknown>();
  const clone = <T>(v: T): T =>
    typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
  const platform = {
    kvGet: async (k: string) => (kv.has(k) ? clone(kv.get(k)) : null),
    kvSet: async (k: string, v: unknown) => {
      kv.set(k, clone(v));
    },
    kvDel: async (k: string) => {
      kv.delete(k);
    },
    kvEntries: async (prefix: string) =>
      [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ k, v: clone(v) })),
    putMeta: async (m: { id: string; cover?: string; hasCover?: boolean }) => {
      metas.set(m.id, clone(m));
      if (m.cover) covers.set(m.id,m.cover);
      else if (m.hasCover === false) covers.delete(m.id);
    },
    deleteBook: async (id: string) => {
      metas.delete(id);
      chapters.delete(id);
    },
    getChapters: async (id: string) => (chapters.has(id) ? clone(chapters.get(id)) : null),
    putBook: async (meta: { id: string }, content: unknown) => {
      metas.set(meta.id, clone(meta));
      chapters.set(meta.id, clone(content));
    },
    getCover: async (id: string) => (covers.has(id) ? clone(covers.get(id)) : null),
  };
  const lightMeta = (m: Record<string, unknown> & { cover?: string }) => {
    const { cover, ...rest } = m;
    return { ...rest, hasCover: !!cover || m.hasCover === true };
  };
  return { platform, lightMeta, __kv: kv, __covers: covers };
});

vi.mock('../src/store/library', () => {
  const state = { books: [] as Array<Record<string, unknown>>, nodes: [] as Array<Record<string, unknown>>, ready: true, error: '' };
  const useLibrary = Object.assign(() => state, {
    getState: () => state,
    setState: (p: Partial<typeof state>) => Object.assign(state, p),
  });
  return { useLibrary };
});

vi.mock('../src/store/bookStyles', () => {
  const state = { map: {} as Record<string, unknown> };
  const useBookStyles = Object.assign(() => state, {
    getState: () => state,
    setState: (p: Partial<typeof state>) => Object.assign(state, p),
  });
  return { useBookStyles };
});

// 本地笔记写回对远端断言无影响；测试直接种 kv 模拟本地笔记
vi.mock('../src/store/annotations', () => ({ mergeSyncedAnnotations: async () => {} }));

import * as webPlatform from '../src/platform/web';
import { useLibrary } from '../src/store/library';
import { useSync } from '../src/sync/sync';

const kv = () => (webPlatform as unknown as { __kv: Map<string, unknown> }).__kv;

// ---- 内存版 WebDAV 服务器（拦截全局 fetch；行为对齐 scripts/test-webdav.ts 的规范模拟） ----
class FakeDav {
  dirs = new Set<string>(['']); // '' = 根
  files = new Map<string, string>();
  /** 模拟网盘转 WebDAV 代理不支持上传：files/ 下的 PUT 一律 500 */
  failFiles = false;
  onRequest?: (method:string,rel:string) => void;
  constructor(public base: string) {}
}

const remotes: FakeDav[] = [];

function decodeBasic(auth: string): [string, string] {
  if (!auth.startsWith('Basic ')) return ['', ''];
  const raw = typeof atob === 'function' ? atob(auth.slice(6)) : Buffer.from(auth.slice(6), 'base64').toString();
  const i = raw.indexOf(':');
  return i < 0 ? [raw, ''] : [raw.slice(0, i), raw.slice(i + 1)];
}

function davFetch(url: string, init: RequestInit): Promise<Response> {
  const remote = remotes.find((r) => url.startsWith(r.base));
  if (!remote) return Promise.resolve(new Response('no such server', { status: 404 }));
  const headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers ?? undefined);
  const [user, pass] = decodeBasic(headers.get('Authorization') ?? '');
  const expect = remotes.indexOf(remote);
  const [eu, ep] = FAKE_CREDS[expect] ?? ['', ''];
  if (user !== eu || pass !== ep) return Promise.resolve(new Response('unauthorized', { status: 401 }));

  const rel = decodeURIComponent(url.slice(remote.base.length)).replace(/\/+$/, '');
  const method = init.method ?? 'GET';
  remote.onRequest?.(method,rel);
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  if (method === 'MKCOL') {
    if (remote.dirs.has(rel)) return Promise.resolve(new Response(null, { status: 405 }));
    if (!remote.dirs.has(parent)) return Promise.resolve(new Response(null, { status: 409 }));
    remote.dirs.add(rel);
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  if (method === 'GET') {
    const body = remote.files.get(rel);
    return Promise.resolve(body === undefined ? new Response(null, { status: 404 }) : new Response(body, { status: 200 }));
  }
  if (method === 'PUT') {
    if (remote.failFiles && rel.includes('/files/')) return Promise.resolve(new Response('upload unsupported', { status: 500 }));
    if (!remote.dirs.has(parent)) return Promise.resolve(new Response(null, { status: 409 }));
    const existed = remote.files.has(rel);
    remote.files.set(rel, typeof init.body === 'string' ? init.body : '');
    return Promise.resolve(new Response(null, { status: existed ? 204 : 201 }));
  }
  if (method === 'DELETE') {
    if (!remote.files.delete(rel)) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  return Promise.resolve(new Response('unsupported method', { status: 405 }));
}

/** 与账号配置对应的正确凭据（构造 401 场景时故意给账号配错密码） */
const FAKE_CREDS: Array<[string, string]> = [];

const book = { id: 'book1', title: '测试书', author: '佚名', format: 'txt', size: 12, addedAt: 1000, nodeId: null };
const ann = (updatedAt: number, note: string) => ({
  list: [
    { id: 'an1', bookId: 'book1', kind: 'highlight', chapter: 0, exact: '一句原文', prefix: '', suffix: '', color: 'amber', note, createdAt: updatedAt, updatedAt },
  ],
  deleted: [],
  updatedAt,
});

function reset() {
  kv().clear();
  remotes.length = 0;
  FAKE_CREDS.length = 0;
  useLibrary.setState({ books: [] as never, nodes: [] as never });
  useSync.setState({ status: 'off', lastSyncAt: 0, message: '', accountRuntime: {} });
}

function seedRemote(base: string, user: string, pass: string) {
  remotes.push(new FakeDav(base));
  FAKE_CREDS.push([user, pass]);
}

beforeAll(() => {
  vi.stubGlobal('fetch', davFetch);
});

describe('多账号 WebDAV 同步（V0.4.0）', () => {
  it('同步过程中刚保存的封面和隐藏状态不被旧快照覆盖，下次同步继续上传',async()=>{
    reset();seedRemote('https://a.example/dav/','ua','pa');
    const covers=(webPlatform as unknown as {__covers:Map<string,string>}).__covers;covers.clear();covers.set('book1','blue');
    const original={...book,updatedAt:100,coverUpdatedAt:100,hasCover:true};
    useLibrary.setState({books:[original] as never,nodes:[]});
    kv().set('sync-config',{enabled:true,intervalMinutes:3,accounts:[{id:'accA',enabled:true,url:'https://a.example/dav/',username:'ua',password:'pa',basePath:'阅读树',backupBooks:false,rememberPassword:true}]});
    let edited=false;
    remotes[0].onRequest=(method,rel)=>{
      if(!edited && method==='PUT' && rel.includes('/books/')) {
        edited=true;covers.set('book1','green');
        useLibrary.setState({books:[{...original,hidden:true,updatedAt:500,coverUpdatedAt:500}] as never});
      }
    };
    await useSync.getState().init();await useSync.getState().syncNow();
    expect(useSync.getState().status).toBe('ok');
    expect(useLibrary.getState().books[0]).toMatchObject({hidden:true,hasCover:true,coverUpdatedAt:500});
    expect(covers.get('book1')).toBe('green');
    await useSync.getState().syncNow();
    const remote=JSON.parse(remotes[0].files.get('阅读树/books/测试书__book1.json')!);
    expect(remote.meta).toMatchObject({cover:'green',hidden:true,hasCover:true,coverUpdatedAt:500});
    const manifest=JSON.parse(remotes[0].files.get('阅读树/manifest.json')!);
    expect(manifest.books[0]).toMatchObject({hasCover:true,coverUpdatedAt:500,hidden:true});
    expect(manifest.books[0].cover).toBeUndefined();
  },30000);
  it(
    'V0.3.x 单账号配置自动迁移为 accounts[0]，同步水位随键名迁移',
    async () => {
      reset();
      kv().set('sync-config', {
        enabled: true,
        url: 'https://dav.jianguoyun.com/dav/',
        username: 'u@x.com',
        password: 'app-pass',
        basePath: '阅读树',
        backupBooks: false,
        rememberPassword: true,
        intervalMinutes: 3,
      });
      kv().set('sync-state', { bookRevs: { old: 5 } });

      await useSync.getState().init();

      const cfg = useSync.getState().config;
      expect(cfg.accounts).toHaveLength(1);
      expect(cfg.accounts[0].id).toBe('main');
      expect(cfg.accounts[0].url).toBe('https://dav.jianguoyun.com/dav/');
      expect(cfg.accounts[0].username).toBe('u@x.com');
      expect(cfg.accounts[0].password).toBe('app-pass');
      expect(cfg.accounts[0].basePath).toBe('阅读树');
      expect(kv().get('sync-state:main')).toEqual({ bookRevs: { old: 5 } });
      expect((kv().get('sync-config') as { accounts: unknown[] }).accounts).toHaveLength(1);
    },
    30000,
  );

  it(
    '双账号同时同步，水位相互隔离：落后的云端仍能收到更新',
    async () => {
      reset();
      seedRemote('https://a.example/dav/', 'ua', 'pa');
      seedRemote('https://b.example/dav/', 'ub', 'pb');
      kv().set('sync-config', {
        enabled: true,
        intervalMinutes: 3,
        accounts: [
          { id: 'accA', enabled: true, url: 'https://a.example/dav/', username: 'ua', password: 'pa', basePath: '阅读树', backupBooks: false, rememberPassword: true },
          { id: 'accB', enabled: true, url: 'https://b.example/dav/', username: 'ub', password: 'pb', basePath: '阅读树', backupBooks: false, rememberPassword: true },
        ],
      });
      useLibrary.setState({ books: [book] as never, nodes: [] as never });
      kv().set('annotations:book1', ann(2000, '批注一'));

      await useSync.getState().init();
      await useSync.getState().syncNow();

      const [ra, rb] = remotes;
      expect(JSON.parse(ra.files.get('阅读树/manifest.json')!).books).toHaveLength(1);
      expect(JSON.parse(rb.files.get('阅读树/manifest.json')!).books).toHaveLength(1);
      expect(ra.files.has('阅读树/books/测试书__book1.json')).toBe(true);
      expect(rb.files.has('阅读树/books/测试书__book1.json')).toBe(true);
      expect(kv().get('sync-state:accA')).toBeTruthy();
      expect(kv().get('sync-state:accB')).toBeTruthy();
      expect(useSync.getState().status).toBe('ok');

      // B 水位丢失（换机/落后场景）+ 本地笔记更新 → B 仍应收到新版本
      // （若两账号共享水位，A 同步后引擎会误判"已同步"而跳过 B）
      kv().delete('sync-state:accB');
      kv().set('annotations:book1', ann(3000, '批注二'));
      await useSync.getState().syncNow();

      const bookA = JSON.parse(ra.files.get('阅读树/books/测试书__book1.json')!);
      const bookB = JSON.parse(rb.files.get('阅读树/books/测试书__book1.json')!);
      expect(bookA.annotations[0].note).toBe('批注二');
      expect(bookB.annotations[0].note).toBe('批注二');
      const stB = kv().get('sync-state:accB') as { bookRevs: Record<string, number>; lastSyncAt: number };
      expect(stB.bookRevs.book1).toBeGreaterThan(0);
      expect(stB.lastSyncAt).toBeGreaterThan(0);
    },
    60000,
  );

  it(
    '一个账号 401 不影响另一账号同步，聚合状态与分账号状态正确',
    async () => {
      reset();
      seedRemote('https://dav.jianguoyun.com/dav/', 'ua', 'pa');
      seedRemote('https://x.teracloud.jp/dav/', 'ub', 'CORRECT'); // 账号配置里给 pb → 401
      kv().set('sync-config', {
        enabled: true,
        intervalMinutes: 3,
        accounts: [
          { id: 'accA', enabled: true, url: 'https://dav.jianguoyun.com/dav/', username: 'ua', password: 'pa', basePath: '阅读树', backupBooks: false, rememberPassword: true },
          { id: 'accB', enabled: true, url: 'https://x.teracloud.jp/dav/', username: 'ub', password: 'pb', basePath: '阅读树', backupBooks: false, rememberPassword: true },
        ],
      });
      useLibrary.setState({ books: [book] as never, nodes: [] as never });

      await useSync.getState().init();
      await useSync.getState().syncNow();

      const rt = useSync.getState().accountRuntime;
      expect(rt.accA.status).toBe('ok');
      expect(rt.accB.status).toBe('error');
      expect(rt.accB.message).toContain('HTTP 401');
      expect(useSync.getState().status).toBe('error');
      expect(useSync.getState().message).toContain('InfiniCLOUD');
      expect(useSync.getState().message).toContain('其余 1 个账号已同步');
      // A 不受影响，正常完成同步
      expect(JSON.parse(remotes[0].files.get('阅读树/manifest.json')!).books).toHaveLength(1);
    },
    60000,
  );

  it(
    '原文件上传 5xx 时不中断同步：进度笔记照常上传，警告可见且不误报 fileInfo',
    async () => {
      reset();
      seedRemote('https://a.example/dav/', 'ua', 'pa');
      remotes[0].failFiles = true; // 模拟 115-WebDAV 等代理不支持/限制上传
      kv().set('sync-config', {
        enabled: true,
        intervalMinutes: 3,
        accounts: [
          { id: 'accA', enabled: true, url: 'https://a.example/dav/', username: 'ua', password: 'pa', basePath: '阅读树', backupBooks: true, rememberPassword: true },
        ],
      });
      useLibrary.setState({ books: [book] as never, nodes: [] as never });
      kv().set('annotations:book1', ann(2000, '批注一'));
      kv().set('file:book1', new ArrayBuffer(8));

      await useSync.getState().init();
      await useSync.getState().syncNow();

      const rt = useSync.getState().accountRuntime;
      expect(rt.accA.status).toBe('ok');
      expect(rt.accA.message).toContain('原文件上传失败');
      expect(rt.accA.message).toContain('HTTP 500');
      // 进度/笔记/书数据照常同步上去
      const ra = remotes[0];
      expect(JSON.parse(ra.files.get('阅读树/manifest.json')!).books).toHaveLength(1);
      const rb = JSON.parse(ra.files.get('阅读树/books/测试书__book1.json')!);
      expect(rb.annotations[0].note).toBe('批注一');
      expect(rb.fileInfo).toBeUndefined(); // 上传失败不得 advertise fileInfo
      expect(ra.files.has('阅读树/files/测试书__book1.txt')).toBe(false);
    },
    30000,
  );
});
