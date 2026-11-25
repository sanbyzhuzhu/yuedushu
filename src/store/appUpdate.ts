import { create } from 'zustand';
import { APP_VERSION, CHECK_INTERVAL, UPDATE_CACHE_KEY, compareVersions, fetchUpdateManifest, readUpdatePreferences, updateUrl } from '../engine/appUpdate';
import type { UpdatePreferences, UpdateTarget } from '../engine/appUpdate';

type UpdateState = UpdatePreferences & {
  checking: boolean;
  error: string;
  storageError: string;
  check: (manual?: boolean) => Promise<void>;
  configure: (address: string, autoCheck: boolean) => void;
  ignore: () => void;
  unignore: () => void;
};
let generation = 0;
let active: AbortController | null = null;
function persist(state: UpdatePreferences): string {
  try {
    const { source, autoCheck, ignored, checkedAt, manifest } = state;
    localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify({ source, autoCheck, ignored, checkedAt, manifest }));
    return '';
  } catch { return '更新偏好暂未保存，重启后可能需要重新设置'; }
}
export function hasAppUpdate(state: UpdatePreferences, target: UpdateTarget): boolean {
  return !!state.manifest && target !== 'unsupported' && !!state.manifest.downloads[target]
    && compareVersions(state.manifest.version, APP_VERSION) > 0 && state.ignored !== state.manifest.version;
}
export const useAppUpdate = create<UpdateState>((set, get) => ({
  ...readUpdatePreferences(), checking: false, error: '', storageError: '',
  check: async (manual = false) => {
    const state = get();
    if (state.checking || (!manual && (!state.autoCheck || Date.now() - state.checkedAt < CHECK_INTERVAL))) return;
    const current = ++generation;
    const controller = new AbortController(); active = controller;
    set({ checking: true, error: '' });
    try {
      const manifest = await fetchUpdateManifest(state.source, controller.signal);
      if (generation !== current) return;
      set({ manifest, checkedAt: Date.now() });
    } catch (e) {
      if (generation !== current) return;
      // Keep a known newer release visible when the network is temporarily unavailable.
      set({ checkedAt: Date.now(), error: e instanceof Error ? e.message : '暂时无法检查更新，请稍后重试' });
    } finally {
      if (generation === current) {
        active = null;
        set({ checking: false, storageError: persist(get()) });
      }
    }
  },
  configure: (address, autoCheck) => {
    const source = updateUrl(address);
    generation++; active?.abort(); active = null;
    const changed = source !== get().source;
    set({ source, autoCheck, checking: false, error: '', ...(changed ? { manifest: null, ignored: '', checkedAt: 0 } : {}) });
    set({ storageError: persist(get()) });
  },
  ignore: () => { set({ ignored: get().manifest?.version || '' }); set({ storageError: persist(get()) }); },
  unignore: () => { set({ ignored: '' }); set({ storageError: persist(get()) }); },
}));
