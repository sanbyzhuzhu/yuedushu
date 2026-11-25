import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
try {
  await page.goto('http://127.0.0.1:5199');
  const result = await page.evaluate(async () => {
    const { requestBytes } = await import('/src/engine/networkLibrary.ts');
    const { androidFetch } = await import('/src/platform/androidHttp.ts');
    const calls = [];
    window.__TAURI_INTERNALS__ = { invoke: async () => { throw 'error sending request for url'; } };
    window.ReadingTreeNativeHttp = {
      cancel() {},
      fetch(id, url, method, headers, body, limit) {
        calls.push({ url, headers: JSON.parse(headers), limit });
        queueMicrotask(() => {
          if (url.includes('origin.test')) window.readingTreeHttpEvent(id, 'headers', JSON.stringify({ status: 302, headers: { location: 'https://other.test/book.txt' } }));
          else {
            window.readingTreeHttpEvent(id, 'headers', JSON.stringify({ status: 200, headers: { 'content-type': 'text/plain' } }));
            for (const text of ['classic ', 'book']) window.readingTreeHttpEvent(id, 'chunk', btoa(text));
          }
          window.readingTreeHttpEvent(id, 'done', '');
        });
      },
    };
    const bytes = await requestBytes('https://origin.test/book', { credentials: { origin: 'https://origin.test', username: 'reader', password: 'test-password' }, limit: 1024 });
    let cancelCalled = false;
    window.ReadingTreeNativeHttp.fetch = () => {};
    window.ReadingTreeNativeHttp.cancel = () => { cancelCalled = true; };
    const controller = new AbortController();
    const pending = androidFetch('https://cancel.test/', { method: 'GET', headers: {}, signal: controller.signal }, 1024);
    controller.abort();
    let aborted = false; try { await pending; } catch (e) { aborted = e.message === '已取消'; }
    window.ReadingTreeNativeHttp.fetch = (id) => queueMicrotask(() => window.readingTreeHttpEvent(id, 'error', '系统网络错误'));
    let failed = false;
    try { await androidFetch('https://error.test/', { method: 'GET', headers: {}, signal: new AbortController().signal }, 1024); } catch (e) { failed = e.message === '系统网络错误'; }
    return { text: new TextDecoder().decode(bytes.data), url: bytes.url, calls, aborted, cancelCalled, failed };
  });
  assert.equal(result.text, 'classic book');
  assert.equal(result.url, 'https://other.test/book.txt');
  assert.ok(result.calls[0].headers.Authorization);
  assert.equal(result.calls[1].headers.Authorization, undefined);
  assert.deepEqual(result.calls.map((c) => c.limit), [1024, 1024]);
  assert.ok(result.aborted && result.cancelCalled && result.failed);
  console.log('PASS Android HTTPS fallback, streamed chunks, manual redirects, credential isolation, size limit forwarding, cancellation and actionable errors');
} finally { await browser.close(); await server.close(); }
