/**
 * WebDAV 客户端 409 回归测试（V0.2.8）
 * 模拟坚果云/WebDAV 规范行为：
 *  - MKCOL：父目录不存在 → 409；已存在 → 405；成功 → 201
 *  - GET/PUT：父目录不存在 → 409；GET 不存在 → 404；PUT 成功 → 201/204
 * 验证：ensureDir 路径不再被二次拼接 basePath（旧 bug 的根因），且建目录后读写正常。
 */
import { WebDAVClient } from '../src/sync/webdav';

let pass = 0;
let fail = 0;
const ok = (cond: boolean, name: string) => {
  if (cond) {
    pass++;
    console.log('✓', name);
  } else {
    fail++;
    console.log('✗', name);
  }
};

/** 极简内存 WebDAV：dirs 集合 + files 映射 */
const dirs = new Set<string>(['']); // '' 表示 /dav/ 根
const files = new Map<string, string>();
const seen: string[] = []; // 记录请求路径，用于断言无重复拼接

const parent = (p: string) => {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
};
const decode = (u: string) => {
  const i = u.indexOf('/dav/');
  return decodeURIComponent(i >= 0 ? u.slice(i + 5) : u);
};

const transport = {
  request: async (url: string, init: RequestInit) => {
    const p = decode(url).replace(/\/$/, '');
    seen.push(`${init.method} ${p}`);
    const method = (init.method || 'GET').toUpperCase();
    if (method === 'MKCOL') {
      if (!dirs.has(parent(p))) return new Response(null, { status: 409 });
      if (dirs.has(p)) return new Response(null, { status: 405 });
      dirs.add(p);
      return new Response(null, { status: 201 });
    }
    if (method === 'GET') {
      if (!dirs.has(parent(p))) return new Response(null, { status: 409 });
      const v = files.get(p);
      if (v === undefined) return new Response(null, { status: 404 });
      return new Response(v, { status: 200 });
    }
    if (method === 'PUT') {
      if (!dirs.has(parent(p))) return new Response(null, { status: 409 });
      files.set(p, String(init.body ?? ''));
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 405 });
  },
};

const client = new WebDAVClient({
  url: 'https://dav.jianguoyun.com/dav/',
  username: 'u',
  password: 'p',
  basePath: '阅读树',
  transport,
  minGapMs: 0,
});

(async () => {
  // 修复前：ensureDir('阅读树') → 请求 /dav/阅读树/阅读树（父不存在 → 409 被当成"已存在"放过）
  // 修复后：请求 /dav/阅读树 → 201
  await client.ensureDir('阅读树');
  ok(seen.some((s) => s === 'MKCOL 阅读树'), 'ensureDir 请求路径为「阅读树」（未被二次拼接）');
  ok(!seen.some((s) => s === 'MKCOL 阅读树/阅读树'), '不再出现「阅读树/阅读树」重复路径');
  ok(dirs.has('阅读树'), '云端目录「阅读树」确实建立');

  await client.ensureDir('阅读树/books');
  await client.ensureDir('阅读树/files');
  ok(dirs.has('阅读树/books') && dirs.has('阅读树/files'), 'books / files 子目录建立');

  // 目录就绪后：读取不存在的清单应返回 null（不再 409）
  const m = await client.getJSON('manifest.json');
  ok(m === null, '读取不存在的 manifest.json → null（此前会抛 409）');

  // 写入主清单与书文件
  await client.putJSON('manifest.json', { version: 1, books: [] });
  ok(files.has('阅读树/manifest.json'), 'manifest.json 写入成功（路径正确）');
  await client.putJSON('books/b1.json', { bookId: 'b1' });
  ok(files.has('阅读树/books/b1.json'), 'books/b1.json 写入成功');
  await client.putRaw('files/b1.epub', new ArrayBuffer(8));
  ok(files.has('阅读树/files/b1.epub'), 'files/b1.epub 上传成功（此前 files 目录未建→409）');

  const back = await client.getJSON<{ version: number }>('manifest.json');
  ok(back?.version === 1, '回读 manifest.json 内容正确');

  // 409 自愈：目录被删后 PUT 应先建目录再重试成功
  dirs.delete('阅读树/books');
  files.delete('阅读树/books/b1.json');
  await client.putJSON('books/b1.json', { bookId: 'b1', v: 2 });
  ok(files.has('阅读树/books/b1.json'), 'PUT 遇 409 自动建目录并重试成功');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
})();
