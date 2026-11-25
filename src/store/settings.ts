/** 全局设置 + 自定义字体管理（字体持久化到本地库，FontFace 注册） */
import { create } from 'zustand';
import { platform } from '../platform/web';
import type { ReaderSettings } from '../engine/types';

const DEFAULTS: ReaderSettings = {
  flow: 'horizontal',
  fontFamily: 'serif',
  fontSize: 19,
  lineHeight: 1.9,
  letterSpacing: 0,
  paraSpacing: 0.55,
  pageMarginX: 36,
  pageMarginY: 36,
  colsPerPage: 1,
  theme: 'paper',
  customTheme: { bg: '#F3EEE0', fg: '#2A2723', accent: '#B03A2E', panel: '#EBE4D0' },
  tapDir: 'auto',
  conv: 'off',
  indent: true,
  align: 'justify',
  fontWeight: 400,
  brightness: 100,
  warmth: 0,
  texture: false,
  hlStyle: 'bg',
  decorLines: false,
  decorFrame: false,
  lineColor: 'auto',
  keepBookCss: true,
  readMode: 'paged',
  showHeader: true,
  showFooter: true,
};

const registered = new Set<string>();
let settingsWrite: Promise<void> = Promise.resolve();

/** 注册自定义字体（幂等） */
export async function registerCustomFont(id: string, buf: ArrayBuffer): Promise<string> {
  const family = `rt-${id}`;
  if (registered.has(id)) return family;
  const ff = new FontFace(family, buf);
  await ff.load();
  document.fonts.add(ff);
  registered.add(id);
  return family;
}

interface SettingsState {
  s: ReaderSettings;
  saveError: string;
  fonts: Record<string, string>; // fontId → 显示名
  set: (patch: Partial<ReaderSettings>) => void;
  init: () => Promise<void>;
  importFont: (file: File) => Promise<string>;
  deleteFont: (id: string) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  s: DEFAULTS,
  saveError: '',
  fonts: {},

  set: (patch) => {
    const s = { ...get().s, ...patch };
    set({ s });
    settingsWrite = settingsWrite.then(() => platform.kvSet('settings', s)).then(
      () => { set({ saveError: '' }); },
      () => { set({ saveError: '排版设置未能保存，请检查存储空间后重试' }); },
    );
  },

  init: async () => {
    const saved = await platform.kvGet<Partial<ReaderSettings>>('settings');
    if (saved) {
      const s0 = { ...DEFAULTS, ...saved } as ReaderSettings;
      // 旧版迁移：pageMargin（单值）→ pageMarginX/Y；pageDecor（三选一）→ 两个独立开关
      if (s0.pageMarginX === undefined && typeof (saved as Record<string, unknown>).pageMargin === 'number') {
        const m = (saved as unknown as { pageMargin: number }).pageMargin;
        s0.pageMarginX = m;
        s0.pageMarginY = m;
      }
      const decor = (saved as unknown as { pageDecor?: string }).pageDecor;
      if (decor === 'lines') s0.decorLines = true;
      if (decor === 'frame') s0.decorFrame = true;
      delete (s0 as unknown as Record<string, unknown>).pageMargin;
      delete (s0 as unknown as Record<string, unknown>).pageDecor;
      set({ s: s0 });
    }
    const fonts = (await platform.kvGet<Record<string, string>>('fonts')) ?? {};
    set({ fonts });
    // 预注册全部已导入字体（后台，不阻塞）
    void (async () => {
      for (const id of Object.keys(fonts)) {
        try {
          const f = await platform.kvGet<{ name: string; buf: ArrayBuffer }>(`font:${id}`);
          if (f) await registerCustomFont(id, f.buf);
        } catch {
          /* 字体损坏则忽略 */
        }
      }
    })();
  },

  importFont: async (file) => {
    const id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `f-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const buf = await file.arrayBuffer();
    const name = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '');
    await platform.kvSet(`font:${id}`, { name, buf });
    const fonts = { ...get().fonts, [id]: name };
    await platform.kvSet('fonts', fonts);
    set({ fonts });
    await registerCustomFont(id, buf);
    return id;
  },

  deleteFont: async (id) => {
    await platform.kvDel(`font:${id}`);
    const fonts = { ...get().fonts };
    delete fonts[id];
    await platform.kvSet('fonts', fonts);
    set({ fonts });
    if (get().s.fontFamily === `custom:${id}`) {
      const s = { ...get().s, fontFamily: 'serif' };
      await platform.kvSet('settings', s);
      set({ s });
    }
  },
}));
