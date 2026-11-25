import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/platform/web', () => ({ platform: { getChapters: vi.fn() } }));
vi.mock('../src/engine/search', () => ({ searchBook: vi.fn() }));
import { platform } from '../src/platform/web';
import { searchBook } from '../src/engine/search';
import { searchLibrary } from '../src/engine/librarySearch';
import type { BookMeta } from '../src/engine/types';
const books: BookMeta[] = ['甲', '乙'].map(id => ({ id, title: id, author: '', format: 'txt', size: 1, addedAt: 1, nodeId: null }));
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platform.getChapters).mockResolvedValue([{ title: '卷一', html: '正文', chars: 2 }, { title: '卷二', html: '正文', chars: 2 }]);
  vi.mocked(searchBook).mockReturnValue([{ chapter: 0, title: '卷', quote: '字', snippet: '字', prefix: '', suffix: '' }]);
});
it('结果保留真实章节索引和书籍标识', async () => {
  const publish = vi.fn();
  await searchLibrary(books, '字', new AbortController().signal, publish);
  expect(publish.mock.calls[1][0].map((hit: { bookId: string; chapter: number }) => [hit.bookId, hit.chapter])).toEqual([['甲', 0], ['甲', 1], ['乙', 0], ['乙', 1]]);
});
it('达到结果上限后不读取下一本书', async () => {
  const publish = vi.fn();
  await searchLibrary(books, '字', new AbortController().signal, publish, 1);
  expect(platform.getChapters).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toHaveLength(1);
});
it('读取章节期间取消，不发布过时结果', async () => {
  const controller = new AbortController(); const publish = vi.fn();
  vi.mocked(platform.getChapters).mockImplementation(async () => { controller.abort(); return [{ title: '卷', html: '字', chars: 1 }]; });
  await expect(searchLibrary(books, '字', controller.signal, publish)).rejects.toThrow();
  expect(publish).not.toHaveBeenCalled();
  expect(searchBook).not.toHaveBeenCalled();
});
it('空查询不读取正文', async () => {
  await searchLibrary(books, '  ', new AbortController().signal, vi.fn());
  expect(platform.getChapters).not.toHaveBeenCalled();
});
