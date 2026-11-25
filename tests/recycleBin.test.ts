import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/platform/web', () => ({ platform: { kvGet: vi.fn(), kvEntries: vi.fn(), kvDel: vi.fn(), replaceAll: vi.fn() } }));
import { platform } from '../src/platform/web';
import { listDeletedBooks, restoreDeletedBook, RECYCLE_RETENTION } from '../src/engine/recycleBin';
const item = () => ({ meta: { id: 'old', nodeId: 'missing', title: '古文' }, chapters: [{ html: '<p>正文</p>' }], deletedAt: Date.now(), kv: [{ k: 'annotations:old', v: { list: [{ bookId: 'old', note: '批注' }], deleted: [] } }, { k: 'file:old', v: new Uint8Array([1, 2]).buffer }] });
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('crypto', { randomUUID: () => 'restored' }); });
it('恢复时重建标识并保留原文件与批注，丢失的分类回到未分类', async () => {
  vi.mocked(platform.kvGet).mockImplementation(async key => key === 'nodes' ? [] : item() as never);
  await restoreDeletedBook('trash:old');
  const [metas, contents, kv, merge] = vi.mocked(platform.replaceAll).mock.calls[0];
  expect(metas[0]).toMatchObject({ id: 'restored', nodeId: null });
  expect(contents[0].id).toBe('restored'); expect(merge).toBe(true);
  expect(kv[0]).toMatchObject({ k: 'annotations:restored', v: { list: [{ bookId: 'restored', note: '批注' }] } });
  expect(kv[1].v).toBeInstanceOf(ArrayBuffer);
  expect(vi.mocked(platform.replaceAll).mock.calls[0][4]).toEqual(['trash:old', 'trash-index:old']);
});
it('恢复写入失败时保留回收站数据', async () => {
  vi.mocked(platform.kvGet).mockImplementation(async key => key === 'nodes' ? [] : item() as never);
  vi.mocked(platform.replaceAll).mockRejectedValue(new Error('空间不足'));
  await expect(restoreDeletedBook('trash:old')).rejects.toThrow('空间不足');
  expect(platform.kvDel).not.toHaveBeenCalled();
});
it('只清理超过 30 天的记录', async () => {
  vi.mocked(platform.kvEntries).mockResolvedValue([{ k: 'trash-index:old', v: { ...item(), deletedAt: Date.now() - RECYCLE_RETENTION - 1 } }, { k: 'trash-index:new', v: item() }]);
  expect((await listDeletedBooks()).map(e => e.k)).toEqual(['trash-index:new']);
  expect(platform.replaceAll).toHaveBeenCalledWith([], [], [], true, ['trash-index:old', 'trash:old']);
});
