import { expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
vi.mock('../src/platform/web', () => ({ platform: { kvGet: vi.fn(), replaceAll: vi.fn() } }));
import { platform } from '../src/platform/web';
import { MAX_BACKUP_BYTES, MAX_BACKUP_ZIP_BYTES, peekBackup, restoreBackup } from '../src/backup';

it('restores raw book data larger than the previous 64 MiB limit', async () => {
  const json = (v: unknown) => strToU8(JSON.stringify(v));
  const raw = new Uint8Array(65 * 1024 * 1024);
  raw[raw.length - 1] = 123;
  const zipped = zipSync({
    'manifest.json': json({ app: 'reading-tree', format: 3, books: 1, includeRaw: true }),
    'meta/books.json': json([{ id: 'large', title: 'Large book' }]),
    'content/large.json': json([{ title: '正文', html: '<p>正文</p>' }]),
    'kv/file%3Alarge.json': json({ __readingTreeBinary: 'binary/0.bin' }),
    'binary/0.bin': raw,
  });
  await restoreBackup(zipped.buffer as ArrayBuffer);
  const data = vi.mocked(platform.replaceAll).mock.calls[0][2].find(v => v.k === 'file:large')!.v as ArrayBuffer;
  expect(data.byteLength).toBe(raw.length);
  expect(new Uint8Array(data)[raw.length - 1]).toBe(123);
});

it('rejects oversized ZIPs before reading their contents', () => {
  expect(MAX_BACKUP_BYTES).toBe(256 * 1024 * 1024);
  expect(() => peekBackup({ byteLength: MAX_BACKUP_ZIP_BYTES + 1 } as ArrayBuffer)).toThrow('备份包过大');
});
