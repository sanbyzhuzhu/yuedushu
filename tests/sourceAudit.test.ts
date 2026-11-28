import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../src/engine/networkLibrary', () => ({ searchSource: vi.fn(), sourceChapters: vi.fn(), downloadChapters: vi.fn() }));
import { searchSource, sourceChapters, downloadChapters } from '../src/engine/networkLibrary';
import type { BookSource } from '../src/engine/networkLibrary';
import { auditSources } from '../src/engine/sourceAudit';
import type { SourceAuditResult } from '../src/engine/sourceAudit';
const sources = Array.from({ length: 4 }, (_, i) => ({ bookSourceName: String(i) } as BookSource));
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
it('分别报告正文可读、搜索无结果和目录失败，且只取首章验证', async () => {
  vi.mocked(searchSource).mockImplementation(async source => source.bookSourceName === '1' ? [] : [{ title: '样本', url: source.bookSourceName, download: false }]);
  vi.mocked(sourceChapters).mockImplementation(async (_, book) => {
    if (book.url === '2') throw new Error('目录改版');
    return [{ title: '一', url: '/1', download: false }, { title: '二', url: '/2', download: false }];
  });
  vi.mocked(downloadChapters).mockResolvedValue({} as File);
  const results: SourceAuditResult[] = [];
  await auditSources(sources, '西游记', new AbortController().signal, r => results.push(r));
  expect(results.sort((a, b) => a.index - b.index).map(r => r.status)).toEqual(['readable', 'empty', 'failed', 'readable']);
  expect(results.find(r => r.index === 2)?.detail).toContain('目录改版');
  expect(vi.mocked(downloadChapters).mock.calls.every(call => call[2].length === 1)).toBe(true);
});
it('单源超时只标记失败，不中断整个批次', async () => {
  vi.useFakeTimers();
  vi.mocked(searchSource).mockImplementation((_, __, ___, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  const results: SourceAuditResult[] = [];
  const work = auditSources(sources, '书', new AbortController().signal, r => results.push(r), 50);
  await vi.runAllTimersAsync(); await work;
  expect(results).toHaveLength(4);
  expect(results.every(r => r.status === 'failed' && r.detail.includes('超时'))).toBe(true);
});
it('取消时不把正在请求的书源标成失效，也不启动剩余请求', async () => {
  const controller = new AbortController();
  vi.mocked(searchSource).mockImplementation((_, __, ___, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })));
  const report = vi.fn();
  const work = auditSources(sources, '书', controller.signal, report);
  controller.abort();
  await expect(work).rejects.toThrow();
  expect(report).not.toHaveBeenCalled(); expect(searchSource).toHaveBeenCalledTimes(3);
});
