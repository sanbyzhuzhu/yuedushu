import { expect, it } from 'vitest';
import { WebDAVClient } from '../src/sync/webdav';

it('checks unique test content and cleans it without touching sync data', async () => {
  const files = new Map<string, string>();
  const calls: string[] = [];
  const client = new WebDAVClient({ url: 'http://localhost:11501/dav/', basePath: '阅读树', username: 'u', password: 'p', minGapMs: 0,
    transport: { request: async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (init.method === 'MKCOL') return new Response(null, { status: 405 });
      if (init.method === 'PUT') { files.set(url, init.body as string); return new Response(null, { status: 201 }); }
      if (init.method === 'DELETE') { files.delete(url); return new Response(null, { status: 204 }); }
      return new Response(files.get(url), { status: 200 });
    } },
  });
  await client.testConnection();
  expect(files.size).toBe(0);
  expect(calls.some(c => /manifest|\/books\//.test(c))).toBe(false);
  expect(calls.map(c => c.split(' ')[0])).toEqual(['MKCOL', 'PUT', 'GET', 'DELETE']);
});

it('reports readback failures and still removes the test file', async () => {
  let removed = false;
  const client = new WebDAVClient({ url: 'http://localhost:11501/dav/', basePath: 'test', username: 'u', password: 'p', minGapMs: 0,
    transport: { request: async (_url, init) => {
      if (init.method === 'DELETE') removed = true;
      return init.method === 'GET' ? new Response('{}') : new Response(null, { status: 201 });
    } },
  });
  await expect(client.testConnection()).rejects.toThrow('读回内容不一致');
  expect(removed).toBe(true);
});

it('explains upstream storage denial without leaking server response secrets', async () => {
  const client = new WebDAVClient({ url: 'http://localhost:11501/dav/', basePath: 'test', username: 'u', password: 'p', minGapMs: 0,
    transport: { request: async () => new Response('<html>OSS上传失败: HTTP 403, AccessDenied, Access denied by bucket policy. secret-signed-url</html>', { status: 500 }) },
  });
  await expect(client.putJSON('probe.json', {})).rejects.toThrow('上游存储拒绝上传');
  await expect(client.putRaw('probe.bin', new ArrayBuffer(0))).rejects.not.toThrow('secret-signed-url');
});
