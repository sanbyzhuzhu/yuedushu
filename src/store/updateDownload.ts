import { create } from 'zustand';
import { APP_VERSION, compareVersions, updateTarget, updateUrl } from '../engine/appUpdate';
import type { UpdateManifest } from '../engine/appUpdate';

type DownloadStatus = 'idle' | 'downloading' | 'ready' | 'installing' | 'error';
type Transfer = {status:DownloadStatus; version:string; message:string; bytes:number; total:number};
type AndroidUpdater = {start(url:string,version:string,sha256:string):string; status():string; cancel():string; install():string};
const android = () => (window as Window & {ReadingTreeNativeUpdate?:AndroidUpdater}).ReadingTreeNativeUpdate;
const initial: Transfer = {status:'idle',version:'',message:'',bytes:0,total:0};
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
export function canDownloadInApp(release: UpdateManifest): boolean {
  return updateTarget() === 'android' ? !!android() && !!release.sha256?.android
    : updateTarget() === 'windows' && '__TAURI_INTERNALS__' in window && !!release.platforms?.['windows-x86_64']?.signature;
}
type DownloadState = Transfer & {
  refresh: () => void;
  start: (release:UpdateManifest,source:string) => Promise<void>;
  cancel: () => Promise<void>;
  install: () => Promise<void>;
};
export const useUpdateDownload = create<DownloadState>((set,get) => ({
  ...initial,
  refresh: () => {
    const native = android(); if (!native) return;
    try {
      const state = JSON.parse(native.status()) as Transfer;
      if (state.version && compareVersions(state.version, APP_VERSION) <= 0) { native.cancel(); set(initial); return; }
      set(state);
      if (state.status !== 'downloading' && timer) { clearInterval(timer); timer = undefined; }
      if (state.status === 'downloading' && !timer) timer = setInterval(() => get().refresh(), 1500);
    } catch (e) { set({status:'error',message:String(e)}); }
  },
  start: async (release,source) => {
    if (get().status === 'downloading' || get().status === 'installing') return;
    if (!canDownloadInApp(release) || compareVersions(release.version,APP_VERSION) <= 0) { set({status:'error',message:'此版本尚不支持应用内下载，可使用浏览器下载'}); return; }
    const current = ++generation;
    set({...initial,status:'downloading',version:release.version});
    try {
      const native = android();
      if (native) {
        set(JSON.parse(native.start(updateUrl(release.downloads.android!),release.version,release.sha256!.android!)) as Transfer);
        if (get().status === 'downloading' && !timer) timer = setInterval(() => get().refresh(),1500);
        return;
      }
      const {invoke,Channel} = await import('@tauri-apps/api/core');
      const onEvent = new Channel<Transfer>();
      onEvent.onmessage = value => { if (generation === current) set(value); };
      await invoke('download_app_update',{source:updateUrl(source),version:release.version,onEvent});
      if (generation === current) set({status:'ready',message:'安装包已下载并通过签名校验，可稍后安装'});
    } catch (e) { if (generation === current) set({status:'error',message:String(e)}); }
  },
  cancel: async () => {
    generation++;
    if (timer) { clearInterval(timer); timer = undefined; }
    try {
      if (android()) android()!.cancel();
      else { const {invoke} = await import('@tauri-apps/api/core'); await invoke('cancel_app_update'); }
      set({...initial,message:'已取消下载'});
    } catch(e) { set({status:'error',message:String(e)}); }
  },
  install: async () => {
    if (get().status !== 'ready') return;
    const version = get().version;
    set({status:'installing',message:''});
    try {
      if (android()) { set(JSON.parse(android()!.install()) as Transfer); return; }
      const {useSync} = await import('../sync/sync');
      if (useSync.getState().status === 'syncing') throw new Error('正在同步，请等待同步完成后再安装');
      const {platform} = await import('../platform/web');
      await platform.kvSet('last-update-install', {version,at:Date.now()});
      const {invoke} = await import('@tauri-apps/api/core');
      await invoke('install_app_update',{version});
    } catch(e) { set({status:'ready',message:String(e)}); }
  },
}));
