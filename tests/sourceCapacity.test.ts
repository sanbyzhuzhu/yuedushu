import { afterEach, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { MAX_SOURCE_FILE_BYTES, MAX_SOURCE_COUNT, parseSources, parseSourcesAsync, mergeSources } from '../src/engine/networkLibrary';
import type { BookSource } from '../src/engine/networkLibrary';

afterEach(() => vi.unstubAllGlobals());
const source: BookSource = { bookSourceName: '书源', bookSourceUrl: 'http://library.test', searchUrl: '/?q={{key}}', ruleSearch: { bookList: '.book', name: 'a@text', bookUrl: 'a@href' }, ruleToc: { chapterList: '.toc a', chapterName: '@text', chapterUrl: '@href' }, ruleContent: { content: '#body@html' } };

it('完整解析 10 万个书源且期间能处理其他事件，合并重复项不丢失满额书源', async () => {
  vi.stubGlobal('document', parseHTML('<html></html>').document);
  const text = JSON.stringify(Array.from({ length: 100000 }, (_, i) => ({ ...source, bookSourceName: `书源${i}` })));
  expect(new TextEncoder().encode(text).length).toBeGreaterThan(2 * 1024 * 1024);
  expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_SOURCE_FILE_BYTES);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    const parsed = await parseSourcesAsync(text, new AbortController().signal);
    expect(parsed.sources).toHaveLength(MAX_SOURCE_COUNT);
    expect(parsed.rejected).toHaveLength(0);
    expect(ticks).toBeGreaterThan(1);
    const updated = { ...parsed.sources[99999], searchUrl: '/new?q={{key}}' };
    const merged = await mergeSources(parsed.sources, [updated, updated], new AbortController().signal);
    expect(merged).toHaveLength(100000);
    expect(merged[99999].searchUrl).toBe('/new?q={{key}}');
    expect(parsed.sources[99999].searchUrl).toBe(source.searchUrl);
    await expect(mergeSources(parsed.sources, [{ ...source, bookSourceName: '额外书源' }], new AbortController().signal)).rejects.toThrow('100000');
  } finally { clearInterval(timer); }
}, 30000);

it('超出 10 万条输入时明确拒绝，不截断', () => {
  expect(() => parseSources(JSON.stringify(Array(100001).fill(null)))).toThrow('100000');
});

it('分批校验和合并可以中途取消，不修改原书源', async () => {
  vi.stubGlobal('document', parseHTML('<html></html>').document);
  const controller = new AbortController();
  await expect(parseSourcesAsync(JSON.stringify(Array(1000).fill(source)), controller.signal, () => controller.abort())).rejects.toThrow();
  const existing = Array.from({ length: 2000 }, (_, i) => ({ ...source, bookSourceName: String(i) }));
  const merging = new AbortController();
  const work = mergeSources(existing, [], merging.signal);
  merging.abort();
  await expect(work).rejects.toThrow();
  expect(existing).toHaveLength(2000);
});
