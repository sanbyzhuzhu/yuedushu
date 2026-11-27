import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/engine/networkLibrary', () => ({ requestBytes: vi.fn() }));
import { requestBytes } from '../src/engine/networkLibrary';
import { APP_VERSION, UPDATE_CACHE_KEY, compareVersions, parseUpdateManifest, readUpdatePreferences, updateUrl } from '../src/engine/appUpdate';
import { hasAppUpdate, useAppUpdate } from '../src/store/appUpdate';

const release = { version: '9.0.0', notes: '测试更新', downloads: { windows: 'https://gitee.com/sanbyzhu/yuedushu/releases/download/v9.0.0/app.exe', android: 'https://gitee.com/sanbyzhu/yuedushu/releases/download/v9.0.0/app.apk' } };
const reply = (input = release) => ({ data: new TextEncoder().encode(JSON.stringify(input)), url: 'https://gitee.com/update.json', headers: new Headers() });
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
  vi.mocked(requestBytes).mockReset();
  useAppUpdate.getState().configure('https://gitee.com/sanbyzhu/yuedushu/raw/master/update.json', true);
  useAppUpdate.setState({ manifest: null, ignored: '', checkedAt: 0 });
});

it('compares numeric versions and rejects malformed release versions', () => {
  expect(compareVersions('0.4.10', '0.4.9')).toBe(1);
  expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
  expect(compareVersions(APP_VERSION, APP_VERSION)).toBe(0);
  expect(() => compareVersions('9.0.0-beta', APP_VERSION)).toThrow();
});
it('accepts signed in-app metadata while keeping legacy download feeds compatible',()=>{
  expect(parseUpdateManifest(release).downloads.windows).toBe(release.downloads.windows);
  const hash='a'.repeat(64);
  const parsed=parseUpdateManifest({...release,sha256:{android:hash},platforms:{'windows-x86_64':{url:release.downloads.windows,signature:'signed'}}});
  expect(parsed.sha256?.android).toBe(hash);expect(parsed.platforms?.['windows-x86_64'].signature).toBe('signed');
  expect(()=>parseUpdateManifest({...release,sha256:{android:'bad'}})).toThrow();
  expect(()=>parseUpdateManifest({...release,platforms:{'windows-x86_64':{url:'http://bad.test/app.exe',signature:'signed'}}})).toThrow();
});
it('rejects unsafe source and download links', () => {
  for (const address of ['javascript:alert(1)', 'file:///app.exe', 'http://gitee.com/app.exe', 'https://user:pass@gitee.com/app.exe']) {
    expect(() => updateUrl(address)).toThrow();
    expect(() => parseUpdateManifest({ ...release, downloads: { windows: address } })).toThrow();
  }
  expect(() => parseUpdateManifest({ version: '9.0.0', downloads: {} })).toThrow();
});
it('ignores only this release and preserves preference across restarts', async () => {
  vi.mocked(requestBytes).mockResolvedValue(reply());
  await useAppUpdate.getState().check(true);
  expect(hasAppUpdate(useAppUpdate.getState(), 'windows')).toBe(true);
  useAppUpdate.getState().ignore();
  expect(hasAppUpdate(useAppUpdate.getState(), 'windows')).toBe(false);
  expect(readUpdatePreferences().ignored).toBe('9.0.0');
  vi.mocked(requestBytes).mockResolvedValue(reply({ ...release, version: '9.0.1' }));
  await useAppUpdate.getState().check(true);
  expect(hasAppUpdate(useAppUpdate.getState(), 'windows')).toBe(true);
});
it('background checks run at most once a day while manual checks can retry', async () => {
  vi.mocked(requestBytes).mockResolvedValue(reply());
  await useAppUpdate.getState().check();
  await useAppUpdate.getState().check();
  expect(requestBytes).toHaveBeenCalledTimes(1);
  await useAppUpdate.getState().check(true);
  expect(requestBytes).toHaveBeenCalledTimes(2);
  useAppUpdate.getState().configure(useAppUpdate.getState().source, false);
  useAppUpdate.setState({ checkedAt: 0 });
  await useAppUpdate.getState().check();
  expect(requestBytes).toHaveBeenCalledTimes(2);
});
it('failed checks keep a cached release and do not throw into the application', async () => {
  vi.mocked(requestBytes).mockResolvedValueOnce(reply()).mockRejectedValueOnce(new Error('offline'));
  await useAppUpdate.getState().check(true);
  await expect(useAppUpdate.getState().check(true)).resolves.toBeUndefined();
  expect(useAppUpdate.getState().error).toBe('offline');
  expect(hasAppUpdate(useAppUpdate.getState(), 'android')).toBe(true);
  expect(useAppUpdate.getState().checking).toBe(false);
});
it('source changes discard old cached releases and reject late results', async () => {
  let finish!: (value: ReturnType<typeof reply>) => void;
  vi.mocked(requestBytes).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const checking = useAppUpdate.getState().check(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  useAppUpdate.getState().configure('https://example.com/new-source.json', true);
  finish(reply()); await checking;
  expect(useAppUpdate.getState().manifest).toBeNull();
  expect(useAppUpdate.getState().source).toBe('https://example.com/new-source.json');
});
it('does not advertise current versions or packages unavailable for this device', async () => {
  vi.mocked(requestBytes).mockResolvedValue(reply({ ...release, version: APP_VERSION }));
  await useAppUpdate.getState().check(true);
  expect(hasAppUpdate(useAppUpdate.getState(), 'windows')).toBe(false);
  useAppUpdate.setState({ manifest: parseUpdateManifest({ ...release, downloads: { android: release.downloads.android } }) });
  expect(hasAppUpdate(useAppUpdate.getState(), 'windows')).toBe(false);
  expect(hasAppUpdate(useAppUpdate.getState(), 'unsupported')).toBe(false);
});
it('treats corrupt local cache as untrusted input', () => {
  localStorage.setItem(UPDATE_CACHE_KEY, '{broken');
  expect(readUpdatePreferences().manifest).toBeNull();
  localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify({ manifest: { version: 'invalid' } }));
  expect(readUpdatePreferences().manifest).toBeNull();
});
