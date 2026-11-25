import { expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { unzipBook, ArchiveLimitError } from '../src/engine/archive';
it('正常书籍保留压缩包内的文件', () => {
  const files = unzipBook(zipSync({ 'a.txt': new Uint8Array([1, 2]) }));
  expect([...files['a.txt']]).toEqual([1, 2]);
});
it('压缩率高的小包也受展开体积限制', () => {
  const bytes = zipSync({ 'a.txt': new Uint8Array(4096) });
  expect(() => unzipBook(bytes, { entry: 1024, total: 8192, count: 10 })).toThrow(ArchiveLimitError);
});
it('多个小文件总量和数量分别受到限制', () => {
  const bytes = zipSync({ a: new Uint8Array(20), b: new Uint8Array(20) });
  expect(() => unzipBook(bytes, { entry: 25, total: 30, count: 10 })).toThrow(ArchiveLimitError);
  expect(() => unzipBook(bytes, { entry: 25, total: 50, count: 1 })).toThrow(ArchiveLimitError);
});
