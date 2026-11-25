/** 每本书独立的阅读方案（参考 Readest per-book settings）：
 *  kv `style:${bookId}` 存 Partial<ReaderSettings>，打开书时覆盖全局设置 */
import { create } from 'zustand';
import { platform } from '../platform/web';
import type { ReaderSettings } from '../engine/types';

interface BookStylesState {
  map: Record<string, Partial<ReaderSettings>>;
  load: (bookId: string) => Promise<void>;
  save: (bookId: string, patch: Partial<ReaderSettings>) => Promise<void>;
  clear: (bookId: string) => Promise<void>;
}

export const useBookStyles = create<BookStylesState>((set, get) => ({
  map: {},

  load: async (bookId) => {
    if (get().map[bookId]) return;
    const style = (await platform.kvGet<Partial<ReaderSettings>>(`style:${bookId}`)) ?? null;
    if (style) set({ map: { ...get().map, [bookId]: style } });
  },

  save: async (bookId, patch) => {
    const cur = get().map[bookId] ?? {};
    const next = { ...cur, ...patch };
    set({ map: { ...get().map, [bookId]: next } });
    await platform.kvSet(`style:${bookId}`, next);
  },

  clear: async (bookId) => {
    const map = { ...get().map };
    delete map[bookId];
    set({ map });
    await platform.kvDel(`style:${bookId}`);
  },
}));
