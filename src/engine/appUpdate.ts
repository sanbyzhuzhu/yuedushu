import { version } from '../../package.json';
import source from '../update-source.json';

export const APP_VERSION = version;
export const DEFAULT_UPDATE_SOURCE = source.manifestUrl;
export const UPDATE_CACHE_KEY = 'reading-tree:update-state';
export const CHECK_INTERVAL = 24 * 60 * 60 * 1000;
export type UpdateTarget = 'windows' | 'android' | 'unsupported';
export type UpdateManifest = {
  version: string;
  notes: string;
  publishedAt: string;
  downloads: Partial<Record<'windows' | 'android', string>>;
};
export type UpdatePreferences = {
  source: string;
  autoCheck: boolean;
  ignored: string;
  checkedAt: number;
  manifest: UpdateManifest | null;
};

export function updateUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('更新地址必须是公开的 HTTPS 链接');
  return url.href;
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) throw new Error('版本号应为数字格式，例如 0.4.5');
    return value.split('.').map(Number);
  };
  const left = parse(a), right = parse(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}

export function parseUpdateManifest(raw: unknown): UpdateManifest {
  if (!raw || typeof raw !== 'object') throw new Error('更新说明格式不正确');
  const input = raw as Record<string, unknown>;
  if (typeof input.version !== 'string') throw new Error('更新说明缺少版本号');
  compareVersions(input.version, APP_VERSION);
  const downloads: UpdateManifest['downloads'] = {};
  if (!input.downloads || typeof input.downloads !== 'object') throw new Error('更新说明缺少下载地址');
  for (const target of ['windows', 'android'] as const) {
    const url = (input.downloads as Record<string, unknown>)[target];
    if (url !== undefined) {
      if (typeof url !== 'string') throw new Error('安装包下载地址不正确');
      downloads[target] = updateUrl(url);
    }
  }
  if (!downloads.windows && !downloads.android) throw new Error('更新说明没有可用的安装包');
  return { version: input.version, notes: typeof input.notes === 'string' ? input.notes.slice(0, 20000) : '',
    publishedAt: typeof input.publishedAt === 'string' ? input.publishedAt.slice(0, 80) : '', downloads };
}

export function updateTarget(): UpdateTarget {
  if (/Android/i.test(navigator.userAgent)) return 'android';
  if (/Windows/i.test(navigator.userAgent)) return 'windows';
  return 'unsupported';
}

export function readUpdatePreferences(): UpdatePreferences {
  const fallback: UpdatePreferences = { source: DEFAULT_UPDATE_SOURCE, autoCheck: true, ignored: '', checkedAt: 0, manifest: null };
  try {
    const raw = JSON.parse(localStorage.getItem(UPDATE_CACHE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return fallback;
    let manifest: UpdateManifest | null = null;
    try { if (raw.manifest) manifest = parseUpdateManifest(raw.manifest); } catch { /* Invalid cache is never actionable. */ }
    return { source: typeof raw.source === 'string' ? updateUrl(raw.source) : fallback.source,
      autoCheck: raw.autoCheck !== false, ignored: typeof raw.ignored === 'string' ? raw.ignored : '',
      checkedAt: Number.isFinite(raw.checkedAt) && raw.checkedAt > 0 ? raw.checkedAt : 0, manifest };
  } catch { return fallback; }
}

export async function fetchUpdateManifest(address: string, signal?: AbortSignal): Promise<UpdateManifest> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 8000);
  try {
    const url = new URL(updateUrl(address));
    url.searchParams.set('_rt', String(Math.floor(Date.now() / 60000)));
    const { requestBytes } = await import('./networkLibrary');
    const response = await requestBytes(url.href, { signal: controller.signal, limit: 128 * 1024 });
    return parseUpdateManifest(JSON.parse(new TextDecoder().decode(response.data)));
  } catch (e) {
    if (controller.signal.aborted) throw new Error('更新检查超时，可稍后重试；不影响正常阅读');
    if (e instanceof SyntaxError) throw new Error('更新地址没有返回有效的 JSON，请检查仓库是否公开及 update.json 是否已发布');
    if (e instanceof Error && e.message.includes('书库')) throw new Error(e.message.replace(/书库/g, '更新源'));
    throw e;
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
}

/** Called only after an explicit confirmation in the update panel. */
export async function openUpdateDownload(address: string): Promise<void> {
  const url = updateUrl(address);
  const native = (window as Window & { ReadingTreeNativeMenu?: { openUpdateUrl?: (url: string) => boolean } }).ReadingTreeNativeMenu;
  if (native?.openUpdateUrl) {
    if (!native.openUpdateUrl(url)) throw new Error('无法打开更新下载地址');
  } else if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_update_url', { address: url });
  } else window.open(url, '_blank', 'noopener,noreferrer');
}
