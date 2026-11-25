import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { requestBytes } from '../src/engine/networkLibrary';
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', {}); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function responseStream(interval: number, count: number) {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    let remaining = count;
    return { ok: true, status: 200, headers: new Headers(), body: { getReader: () => ({
      read: () => remaining-- <= 0 ? Promise.resolve({ done: true }) : new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new Error('aborted')); };
        const timer = setTimeout(() => { init.signal.removeEventListener('abort', abort); resolve({ done: false, value: new Uint8Array([1]) }); }, interval);
        init.signal.addEventListener('abort', abort, { once: true });
      }), cancel: async () => {}, releaseLock() {},
    }) } };
  }));
}
it('持续有进度的慢下载可超过一分钟', async () => {
  responseStream(45000, 3);
  const work = requestBytes('https://example.com/book.txt');
  await vi.advanceTimersByTimeAsync(135001);
  expect((await work).data).toHaveLength(3);
});
it('连续一分钟没有数据时停止', async () => {
  responseStream(70000, 1);
  const work = expect(requestBytes('https://example.com/book.txt')).rejects.toThrow('请求超时');
  await vi.advanceTimersByTimeAsync(60001); await work;
});
it('取消下载不等待超时', async () => {
  responseStream(45000, 1); const controller = new AbortController();
  const work = expect(requestBytes('https://example.com/book.txt', { signal: controller.signal })).rejects.toThrow('已取消');
  await vi.advanceTimersByTimeAsync(1); controller.abort(); await work;
});
