import { beforeEach, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
vi.mock('../src/platform/web', () => ({ platform: { kvGet: vi.fn(), replaceAll: vi.fn() } }));
import { platform } from '../src/platform/web';
import { restoreBackup } from '../src/backup';
const json = (value: unknown) => strToU8(JSON.stringify(value));
function oldBackup(includeContent = true) {
  const files: Record<string, Uint8Array> = {
    'manifest.json': json({ app: 'reading-tree', format: 3, books: 1, exportedAt: 1, includeRaw: false, merge: false }),
    'meta/books.json': json([{ id: 'b', title: '古文', format: 'txt' }]),
    'kv/sync-config.json': json({ username: 'old-user', password: 'old-secret' }),
    'kv/device-id.json': json('old-device'),
    'kv/sync-state.json': json({ bookRevs: { b: 999 } }),
  };
  if (includeContent) files['content/b.json'] = json([{ title: '卷一', html: '<p>正文</p>' }]);
  return zipSync(files).buffer as ArrayBuffer;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platform.kvGet).mockImplementation(async key => (key === 'sync-config' ? { username: 'local-user', password: 'local-secret' } : key === 'device-id' ? 'local-device' : null) as never);
});
it('旧完整备份不替换本机凭据和身份，也不导入旧同步状态', async () => {
  await restoreBackup(oldBackup());
  const kv = vi.mocked(platform.replaceAll).mock.calls[0][2];
  expect(kv).toContainEqual({ k: 'sync-config', v: { username: 'local-user', password: 'local-secret' } });
  expect(kv).toContainEqual({ k: 'device-id', v: 'local-device' });
  expect(kv.some(e => e.k === 'sync-state')).toBe(false);
  expect(JSON.stringify(kv)).not.toContain('old-secret');
});
it('备份正文缺失时不写入任何数据', async () => {
  await expect(restoreBackup(oldBackup(false))).rejects.toThrow('备份文件不完整');
  expect(platform.replaceAll).not.toHaveBeenCalled();
});
