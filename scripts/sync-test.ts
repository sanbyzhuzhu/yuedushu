/** 同步链路测试（Node）：merge 纯函数 + 模拟 WebDAV 服务器端到端
 *  构建：npx esbuild scripts/sync-test.ts --bundle --platform=node --format=esm --outfile=.tmp/sync-test.mjs
 *  运行：node .tmp/sync-test.mjs */
import http from 'node:http';
import assert from 'node:assert';
import { mergeManifest, mergeBook } from '../src/sync/merge';
import { WebDAVClient } from '../src/sync/webdav';
import type { RemoteManifest, RemoteBook } from '../src/sync/types';

let passed = 0;
function ok(cond: boolean, name: string) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  passed += 1;
  console.log('  ✓', name);
}

// ---------- 1. mergeManifest ----------
{
  const localNodes = [{ id: 'a', parentId: null, name: '经部' }];
  const localBooks = [
    { id: 'b1', title: '书一', author: '', format: 'txt' as const, size: 1, addedAt: 1, nodeId: null, cover: 'data:x' },
  ];
  const remote: RemoteManifest = {
    version: 1,
    updatedAt: 10,
    device: 'dev-r',
    nodes: [
      { id: 'a', parentId: null, name: '经部' },
      { id: 'b', parentId: null, name: '史部' },
    ],
    deletedNodeIds: ['x'],
    books: [
      { id: 'b1', title: '书一改', author: '', format: 'txt', size: 1, addedAt: 1, nodeId: null, updatedAt: 5, rev: 5 },
      { id: 'b2', title: '云端书', author: '', format: 'epub', size: 2, addedAt: 2, nodeId: null, rev: 2 },
    ],
    deletedBookIds: ['b0'],
  };
  const r = mergeManifest(localNodes, localBooks, { books: ['b0'], nodes: ['x'] }, remote);
  ok(r.nodes.length === 2 && r.nodes.some((n) => n.name === '史部'), 'manifest: 分类并集');
  ok(!r.nodes.some((n) => n.id === 'x'), 'manifest: 远端墓碑删除分类');
  ok(r.metas.get('b1')!.title === '书一改', 'manifest: 书 meta 新者胜');
  ok(r.metas.get('b1')!.cover === 'data:x', 'manifest: 本地 cover 保留');
  ok(r.metas.has('b2'), 'manifest: 云端书合入');
  ok(!r.metas.has('b0') && r.deletedBooks.includes('b0'), 'manifest: 墓碑删书');
  ok(r.changed, 'manifest: 标记需要应用');
}

// ---------- 2. mergeBook ----------
{
  const local: RemoteBook = {
    bookId: 'b1', updatedAt: 100, device: 'L',
    meta: { id: 'b1', title: '书一', author: '', format: 'txt', size: 1, addedAt: 1 },
    progress: { chapter: 3, page: 2, pages: 10, pct: 0.35, updatedAt: 100 },
    annotations: [
      { id: 'an1', bookId: 'b1', kind: 'highlight', chapter: 1, exact: 'abc', prefix: '', suffix: '', color: 'red', note: '', createdAt: 1 },
      { id: 'an2', bookId: 'b1', kind: 'highlight', chapter: 2, exact: 'def', prefix: '', suffix: '', color: 'blue', note: '本地批注', createdAt: 2 },
    ],
    deletedAnnotationIds: ['an9'],
    rev: 100,
  };
  const remote: RemoteBook = {
    bookId: 'b1', updatedAt: 90, device: 'R',
    meta: { id: 'b1', title: '书一', author: '作者', format: 'txt', size: 1, addedAt: 1, updatedAt: 90, cover: 'data:c' },
    progress: { chapter: 8, page: 1, pages: 10, pct: 0.8, updatedAt: 90 },
    annotations: [
      { id: 'an1', bookId: 'b1', kind: 'highlight', chapter: 1, exact: 'abc', prefix: '', suffix: '', color: 'red', note: '', createdAt: 1 },
      { id: 'an3', bookId: 'b1', kind: 'bookmark', chapter: 0, exact: '第 1 页', prefix: '', suffix: '', color: 'red', note: '', ratio: 0.5, createdAt: 3 },
    ],
    deletedAnnotationIds: ['an7'],
    rev: 90,
  };
  const { merged, changed } = mergeBook({ local, remote, deviceId: 'L' });
  ok(changed, 'book: 本地需写回');
  ok(merged!.progress!.chapter === 3 && merged!.progress!.updatedAt === 100, 'book: 进度新者胜（本地 100 > 远端 90）');
  ok(merged!.annotations.length === 3, 'book: 笔记并集（an1 去重 + an2 + an3）');
  ok(!merged!.annotations.some((a) => a.id === 'an9' || a.id === 'an7'), 'book: 墓碑过滤');
  ok(merged!.deletedAnnotationIds.includes('an7') && merged!.deletedAnnotationIds.includes('an9'), 'book: 墓碑并集');
  ok(merged!.meta.author === '作者' && merged!.meta.cover === 'data:c', 'book: meta 字段合并（远端较新 + cover 保留）');
  ok(merged!.rev === 100, 'book: rev 取最新');
}

// ---------- 2.5 资产透传（V0.2.0：正文/文件/本书方案） ----------
{
  const meta = { id: 'b', title: '书', author: '', format: 'epub' as const, size: 1, addedAt: 1 };
  const local: RemoteBook = {
    bookId: 'b', updatedAt: 50, device: 'L', meta,
    progress: null, annotations: [], deletedAnnotationIds: [], rev: 50,
  };
  const remote: RemoteBook = {
    ...local, updatedAt: 60, device: 'R', rev: 60,
    content: [{ title: '一章', html: '<p>正文</p>', chars: 2 }],
    fileInfo: { ext: 'epub', size: 9 },
    style: { fontSize: 22 },
  };
  const r1 = mergeBook({ local, remote, deviceId: 'L' });
  ok(r1.merged!.content?.length === 1 && r1.merged!.fileInfo?.ext === 'epub' && r1.merged!.style?.fontSize === 22, '资产: 本地缺失时从远端恢复');
  // 远端核心更新（rev 60 > 50）→ 需要本地写回（时间戳前进属预期）
  ok(r1.changed === true, '资产: 远端核心更新触发写回');
  // 核心完全一致、仅多资产 → 透传不触发写回
  const remoteSameCore: RemoteBook = { ...remote, updatedAt: 50, rev: 50 };
  const r1b = mergeBook({ local, remote: remoteSameCore, deviceId: 'L' });
  ok(r1b.changed === false, '资产: 仅资产差异不触发本地写回');
  const local2 = { ...local, style: { fontSize: 19 } };
  const r2 = mergeBook({ local: local2, remote, deviceId: 'L' });
  ok(r2.merged!.style?.fontSize === 19, '资产: 本地方案优先');
}

// ---------- 3. 端到端：模拟 WebDAV 服务器 ----------
await new Promise<void>((resolve, reject) => {
  const store = new Map<string, { body: string; mime: string }>();
  const dirs = new Set<string>(['dav', 'dav/阅读树', 'dav/阅读树/books']);
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url || '');
    const key = url.replace(/^\/+/, '');
    if (req.method === 'MKCOL') {
      if (dirs.has(key)) { res.writeHead(405); res.end(); return; }
      dirs.add(key); res.writeHead(201); res.end(); return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        store.set(key, { body, mime: req.headers['content-type'] || '' });
        res.writeHead(201, { ETag: `"${body.length}"` });
        res.end();
      });
      return;
    }
    if (req.method === 'GET') {
      const hit = store.get(key);
      if (!hit) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': hit.mime || 'application/json', ETag: `"${hit.body.length}"` });
      res.end(hit.body);
      return;
    }
    if (req.method === 'DELETE') {
      store.delete(key);
      res.writeHead(204); res.end();
      return;
    }
    res.writeHead(405); res.end();
  });
  server.listen(0, '127.0.0.1', async () => {
    const port = (server.address() as { port: number }).port;
    try {
      const client = new WebDAVClient({
        url: `http://127.0.0.1:${port}/dav/`,
        username: 'u@example.com',
        password: 'pwd中文',
        basePath: '阅读树',
        minGapMs: 1,
      });
      await client.ensureDir('阅读树');
      await client.ensureDir('阅读树/books');
      ok(true, 'e2e: 建目录（幂等）');

      const manifest: RemoteManifest = {
        version: 1, updatedAt: 1, device: 'dev',
        nodes: [{ id: 'a', parentId: null, name: '小说' }],
        deletedNodeIds: [], books: [], deletedBookIds: [],
      };
      await client.putJSON('manifest.json', manifest);
      const back = await client.getJSON<RemoteManifest>('manifest.json');
      ok(back!.nodes[0].name === '小说', 'e2e: manifest 写读往返');

      const book: RemoteBook = {
        bookId: 'b1', updatedAt: 5, device: 'dev',
        meta: { id: 'b1', title: '测试书', author: '', format: 'txt', size: 1, addedAt: 1, cover: 'data:abc' },
        progress: { chapter: 0, page: 0, pages: 1, pct: 0.5, updatedAt: 5 },
        annotations: [], deletedAnnotationIds: [], rev: 5,
      };
      await client.putJSON('books/b1.json', book);
      const got = await client.getJSON<RemoteBook>('books/b1.json');
      ok(got!.meta.cover === 'data:abc', 'e2e: 书文件往返（含封面）');
      ok((await client.getJSON('books/nope.json')) === null, 'e2e: 404 → null');
      await client.putJSON('books/tmp.json', { x: 1 });
      await client.del('books/tmp.json');
      ok((await client.getJSON('books/tmp.json')) === null, 'e2e: DELETE 删除资源（旧命名清理用）');
      console.log(`  ✓ e2e: 共 ${client.reqCount} 个请求（限频队列）`);
      server.close();
      resolve();
    } catch (e) {
      server.close();
      reject(e);
    }
  });
});

console.log(`\n全部通过：${passed} 项断言`);
