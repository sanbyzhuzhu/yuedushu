import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/platform/web', () => ({ platform: { kvSet: vi.fn(), kvDel: vi.fn() } }));
import { platform } from '../src/platform/web';
import { useSettings } from '../src/store/settings';
beforeEach(() => { vi.resetAllMocks(); });
it('删除全局使用的自定义字体后，回退值写入存储', async () => {
  useSettings.setState({ s: { ...useSettings.getState().s, fontFamily: 'custom:test-font' }, fonts: { 'test-font': '测试字体' } });
  await useSettings.getState().deleteFont('test-font');
  expect(useSettings.getState().s.fontFamily).toBe('serif');
  expect(platform.kvSet).toHaveBeenCalledWith('settings', expect.objectContaining({ fontFamily: 'serif' }));
});
it('设置写入失败可见且支持重试', async () => {
  vi.mocked(platform.kvSet).mockRejectedValueOnce(new Error('quota'));
  useSettings.getState().set({ fontSize: 25 });
  await vi.waitFor(() => expect(useSettings.getState().saveError).not.toBe(''));
  useSettings.getState().set({});
  await vi.waitFor(() => expect(useSettings.getState().saveError).toBe(''));
  expect(platform.kvSet).toHaveBeenLastCalledWith('settings', expect.objectContaining({ fontSize: 25 }));
});
