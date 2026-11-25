import { markdownOutline } from '../engine/md';
import { BookmarkPanel } from './BookmarkPanel';
import { Panel } from './Panel';
import { ReaderClock } from './ReaderClock';
import { useWheelPaging } from './useWheelPaging';
/** 阅读器：分页展示 + 横竖排 + 翻页方向联动 + 进度记忆 + 划线批注书签（V0.0.8） */
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Paginator } from '../engine/paginator';
import { TextSelection } from '../engine/textSelection';
import { applyQuote, quoteFromRange, rangeForQuote } from '../engine/annotate';
import type { Quote } from '../engine/annotate';
import { buildNotesMarkdown, buildNotesTxt, buildNotesCsv, downloadNotes } from '../engine/notesExport';
import { downloadBlob } from '../engine/shareCard';
import { convertHtml, convertQuote, ensureConverter, hasConverter, inverseMode } from '../engine/convert';
import { prepareReadingHtml } from '../engine/readingHtml';
import { tts, useTts, chapterParas } from '../engine/tts';
import { platform } from '../platform/web';
import { registerBackHandler } from '../platform/backHandler';
import { useLibrary } from '../store/library';
import { useSettings, registerCustomFont } from '../store/settings';
import { useBookStyles } from '../store/bookStyles';
import { useAnnotations } from '../store/annotations';
import { addReadingTime } from '../store/stats';
import { copyText } from '../engine/clipboard';
import type { Annotation, Chapter, ConvMode, HighlightColor, Progress, ReaderSettings } from '../engine/types';

/**
 * 收掉 Android 系统长按自带的「复制 / 全选 / 共享 / 网页搜索」浮动菜单（V0.3.6）。
 *
 * 它由 MainActivity 的 ActionMode 提供，弹出后会正好压住我们自己的划线弹层。
 * 桌面 / Web 环境没有这个桥，静默跳过；内部节流避免 selectionchange 频繁跨界调用。
 */
let lastHideMenuAt = 0;
function hideNativeMenu(): void {
  const now = performance.now();
  if (now - lastHideMenuAt < 120) return;
  lastHideMenuAt = now;
  try {
    (window as unknown as { ReadingTreeNativeMenu?: { hideMenu?: () => void } })
      .ReadingTreeNativeMenu?.hideMenu?.();
  } catch {
    /* 桥不存在或已销毁，忽略 */
  }
}
import { searchBook } from '../engine/search';
import { SettingsPanel } from './SettingsPanel';
import { TtsPanel } from './TtsPanel';
import { PdfReader } from './PdfReader';
import { NoteCard } from './NoteCard';
import { HighlightActions } from './HighlightActions';

const FONT_MAP: Record<string, string> = {
  serif: '"Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif',
  kai: '"Kaiti SC","KaiTi","STKaiti","DFKai-SB","楷体",serif',
  sans: '"Noto Sans SC","Source Han Sans SC","PingFang SC","Microsoft YaHei",sans-serif',
  fang: '"FangSong","仿宋","STFangsong","FangSong_GB2312",serif',
};
const GAP_H = 48; // 横排栏间距
const GAP_V = 32; // 竖排栏间距
const HL_COLORS: HighlightColor[] = ['red', 'green', 'blue', 'amber'];

type ReaderProps = { bookId: string; onBack: () => void; onOpen: (id: string) => void };
export function Reader(props: ReaderProps) {
  const format = useLibrary(st => st.books.find(b => b.id === props.bookId)?.format);
  return format === 'pdf' ? <PdfReader key={props.bookId} {...props} /> : <TextReader key={props.bookId} {...props} />;
}

function TextReader({ bookId, onBack, onOpen }: ReaderProps) {
  const book = useLibrary((st) => st.books.find((b) => b.id === bookId));
  const globalS = useSettings((st) => st.s);
  const override = useBookStyles((st) => st.map[bookId] ?? null);
  // 生效设置 = 全局 + 本书覆盖（V0.1.1 每本书独立阅读方案）
  const s: ReaderSettings = useMemo(() => ({ ...globalS, ...(override ?? {}) }), [globalS, override]);
  const scope: 'global' | 'book' = override ? 'book' : 'global';
  const setStyle = useCallback(
    (patch: Partial<ReaderSettings>) => {
      if (override) void useBookStyles.getState().save(bookId, patch);
      else useSettings.getState().set(patch);
    },
    [override, bookId],
  );

  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [converted, setConverted] = useState<{ chapter: number; mode: ConvMode; html: string } | null>(null);
  const convHtml = converted?.chapter === idx && converted.mode === s.conv ? converted.html : null;
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [menu, setMenu] = useState(false);
  const [catalog, setCatalog] = useState(false);
  const [catTab, setCatTab] = useState<'toc' | 'notes' | 'search'>('toc');
  const [query, setQuery] = useState('');
  const [tocQuery, setTocQuery] = useState('');
  const tocRef = useRef<HTMLDivElement>(null);
  const [headingTarget, setHeadingTarget] = useState<{ index: number; heading: number } | null>(null);
  const searchQuery = useDeferredValue(query);
  const [searchTarget, setSearchTarget] = useState<{ chapter: number; quote: Quote } | null>(null);
  useEffect(() => {
    if (!chapters) return;
    let alive = true;
    void platform.kvGet<{ bookId: string; chapter: number; quote: Quote }>('pending-search').then(async target => {
      if (!alive || target?.bookId !== bookId || !chapters[target.chapter]) return;
      restore.current = { page: 0, last: false };
      setIdx(target.chapter); setSearchTarget(target);
      await platform.kvDel('pending-search');
    });
    return () => { alive = false; };
  }, [bookId, chapters]);
  const [noteQuery, setNoteQuery] = useState('');
  const [noteFilter, setNoteFilter] = useState('全部');
  const [showSet, setShowSet] = useState(false);
  const [showTts, setShowTts] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [selPop, setSelPop] = useState<{ x: number; y: number; menuTop: number; quote: Quote; undoIds: string[]; chapter: number } | null>(null);
  const selectionInProgress = useRef(false);
  const selectionController = useRef<TextSelection | null>(null);
  const savingHighlight = useRef(false);
  const [saving, setSaving] = useState(false);
  const [anchorTick, setAnchorTick] = useState(0);
  const pendingNote = useRef<string | null>(null);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ id: string; x: number; y: number; editor?: boolean } | null>(null);
  const [toast, setToast] = useState('');

  // 简繁档位（多处使用，提前声明）
  const mode = s.conv ?? 'off';

  // 滚动阅读模式（V0.3.0，仅横排）：全书顺序上下滚动，进度按整体比例记忆
  const scrollMode = s.readMode === 'scroll' && s.flow === 'horizontal';
  const scrollRef = useRef<HTMLDivElement>(null);
  const chRefs = useRef<Array<HTMLElement | null>>([]);
  const [scrollHtmls, setScrollHtmls] = useState<string[] | null>(null);
  const [scrollPct, setScrollPct] = useState(0);
  const restoreScroll = useRef<number | null>(null);
  const prevMode = useRef<'paged' | 'scroll' | null>(null);
  // 页眉页脚时钟

  const wrapRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const pagRef = useRef<Paginator | null>(null);
  const restore = useRef<{ page: number; last: boolean; ratio?: number } | null>(null);
  const lastIdx = useRef(-1);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipeAt = useRef(0);
  // 挂载时刻：书架点开书的 click 会"穿透"落到刚挂载的阅读器上，400ms 内的点击忽略
  const mountAt = useRef(Date.now());
  // 划线手势守卫（V0.3.5）：手机划线由长按启动，而选区要到 touchend 之后才 finalize，
  // 旧逻辑在 touchend 时 getSelQuote() 仍为 null → 位移够大就判定滑动 → 跳页。
  // lpGuard：本次触摸序列已判定为长按；selActive：本次序列期间出现过非空选区。
  const lpGuard = useRef(false);
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selActive = useRef(false);
  const annList = useAnnotations((st) => st.list);
  const annAdd = useAnnotations((st) => st.add);
  const annUpdate = useAnnotations((st) => st.update);
  const annRemove = useAnnotations((st) => st.remove);
  const ttsCurrent = useTts((st) => (st.playing ? (st.paras[st.paraIdx] ?? '') : ''));
  const ttsSentenceIndex = useTts((st) => st.paraIdx);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  // ---------- TTS 朗读（V0.3.1） ----------
  const chaptersRef = useRef(chapters);
  chaptersRef.current = chapters;
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const autoNextPending = useRef(false);

  const ttsStart = useCallback(async () => {
    const ch = chaptersRef.current?.[idxRef.current];
    if (!ch) return;
    try {
      const html = mode === 'off' ? ch.html : await convertHtml(ch.html, mode);
      const paras = chapterParas(html, undefined, true);
      if (!paras.length) {
        showToast('本章没有可朗读的文字');
        return;
      }
      tts.start(paras, () => {
        // 本章队列读完：按设置自动连播下一章
        if (!useTts.getState().config.autoNext) return;
        const list = chaptersRef.current;
        if (!list || idxRef.current >= list.length - 1) {
          showToast('已到全书末尾');
          return;
        }
        autoNextPending.current = true;
        restore.current = { page: 0, last: false };
        setIdx(idxRef.current + 1);
      });
    } catch {
      showToast('朗读启动失败');
    }
  }, [mode, showToast]);

  // 自动连播：翻到下一章后续播
  useEffect(() => {
    if (!autoNextPending.current) return;
    autoNextPending.current = false;
    if (!chapters?.[idx]) return;
    const t = setTimeout(() => void ttsStart(), 400);
    return () => clearTimeout(t);
  }, [idx, chapters, ttsStart]);

  /** 返回键：插图放大→编辑卡→划线弹层→朗读→设置→目录→菜单→回书架 */
  const backRef = useRef({ zoomImg, noteEdit, selPop, showTts, showSet, catalog, menu, onBack, bookmarksOpen, isPdf: book?.format === 'pdf' });
  backRef.current = { zoomImg, noteEdit, selPop, showTts, showSet, catalog, menu, onBack, bookmarksOpen, isPdf: book?.format === 'pdf' };
  useEffect(
    () =>
      registerBackHandler(() => {
        const st = backRef.current;
        if (st.bookmarksOpen || st.isPdf) return false;
        if (st.zoomImg) {
          setZoomImg(null);
          return true;
        }
        if (st.noteEdit) {
          setNoteEdit(null);
          return true;
        }
        if (st.selPop || selectionInProgress.current) {
          selectionController.current?.clear();
          return true;
        }
        if (st.showTts) {
          tts.stop();
          setShowTts(false);
          return true;
        }
        if (st.showSet) {
          setShowSet(false);
          return true;
        }
        if (st.catalog) {
          setCatalog(false);
          return true;
        }
        st.onBack();
        return true;
      }),
    [],
  );

  // 离开阅读页自动停止朗读
  useEffect(
    () => () => {
      tts.stop();
    },
    [],
  );

  useLayoutEffect(() => {
    if (scrollMode) {
      pagRef.current = null;
      return;
    }
    if (outerRef.current && clipRef.current && innerRef.current) {
      const pag = new Paginator(outerRef.current, clipRef.current, innerRef.current);
      pag.setOnChange((p, t) => {
        setPage(p);
        setPages(t);
      });
      pagRef.current = pag;
      lastIdx.current = -1; // 重建后强制按新章重排
      // 调试观测点（自动化测试用）
      (window as unknown as Record<string, unknown>).__rtPag = pag;
    }
  }, [scrollMode]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    void platform.getChapters(bookId).then(async (chs) => {
      if (!alive || !chs) return;
      setChapters(chs);
      const pr = await platform.kvGet<Progress>(`progress:${bookId}`);
      if (pr && alive) {
        restore.current = { page: pr.page, last: false };
        restoreScroll.current = pr.pct; // 滚动模式按整体比例恢复
        setIdx(Math.max(0, Math.min(pr.chapter, chs.length - 1)));
      }
    });
    return () => {
      alive = false;
    };
  }, [bookId]);

  useEffect(() => {
    void useAnnotations.getState().load(bookId);
    void useBookStyles.getState().load(bookId);
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    const modes = new Set<Exclude<ConvMode, 'off'>>();
    if (mode !== 'off') modes.add(mode);
    for (const a of annList) if (a.conv && a.conv !== 'off') modes.add(inverseMode(a.conv));
    const missing = [...modes].filter((m) => !hasConverter(m));
    if (missing.length) void Promise.all(missing.map(ensureConverter)).then(() => {
      if (alive) setAnchorTick((v) => v + 1);
    });
    return () => { alive = false; };
  }, [annList, mode]);

  // 阅读时长统计：每分钟可见时计 1 分钟
  useEffect(() => {
    if (book?.format === 'pdf') return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void addReadingTime(bookId, 60);
    }, 60000);
    return () => clearInterval(t);
  }, [bookId, book?.format]);

  // 自定义字体：确保注册完成后重排（字体加载晚于首排会导致测量失效）
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    if (!s.fontFamily.startsWith('custom:')) return;
    const id = s.fontFamily.slice(7);
    let alive = true;
    void (async () => {
      try {
        const f = await platform.kvGet<{ buf: ArrayBuffer }>(`font:${id}`);
        if (!f) return;
        await registerCustomFont(id, f.buf);
        await document.fonts.load(`16px rt-${id}`, '阅读树字体');
        if (alive) setFontTick((t) => t + 1);
      } catch {
        /* 字体损坏则回退默认 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [s.fontFamily]);

  // 简繁转换：转换当前章（缓存于引擎层），转换器预加载后引语重挂可用同步接口
  useEffect(() => {
    let alive = true;
    const ch = chapters?.[idx];
    if (!ch || scrollMode) return;
    if (mode === 'off') {
      setConverted(null);
      return;
    }
    void (async () => {
      const html = await convertHtml(ch.html, mode);
      if (alive) setConverted({ chapter: idx, mode, html });
    })();
    return () => {
      alive = false;
    };
  }, [chapters, idx, mode, scrollMode]);

  // 滚动模式：全书章节一次性转换（引擎层有缓存，切档只增量转换一次）
  useEffect(() => {
    if (!scrollMode || !chapters) {
      setScrollHtmls(null);
      return;
    }
    if (mode === 'off') {
      setScrollHtmls(chapters.map((c) => prepareReadingHtml(c.html, s.keepBookCss !== false)));
      return;
    }
    let alive = true;
    setScrollHtmls(null);
    void (async () => {
      const out: string[] = [];
      for (const ch of chapters) out.push(prepareReadingHtml(await convertHtml(ch.html, mode), s.keepBookCss !== false));
      if (alive) setScrollHtmls(out);
    })();
    return () => {
      alive = false;
    };
  }, [scrollMode, chapters, mode, s.keepBookCss]);

  // 阅读模式切换时衔接进度：分页→滚动按整体比例；滚动→分页回本章首
  useEffect(() => {
    const cur: 'paged' | 'scroll' = scrollMode ? 'scroll' : 'paged';
    if (prevMode.current === null) {
      prevMode.current = cur;
      return;
    }
    if (prevMode.current === cur) return;
    prevMode.current = cur;
    if (scrollMode) {
      const total = chapters?.reduce((a, c) => a + c.chars, 0) || 1;
      const before = chapters?.slice(0, idx).reduce((a, c) => a + c.chars, 0) || 0;
      restoreScroll.current = Math.min(1, (before + ((page + 1) / Math.max(1, pages)) * (chapters?.[idx]?.chars ?? 0)) / total);
    } else {
      restore.current = { page: 0, last: false };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollMode]);

  const readingHtml = useMemo(() => {
    const html = mode === 'off' ? chapters?.[idx]?.html : convHtml;
    return html && !scrollMode ? prepareReadingHtml(html, s.keepBookCss !== false) : null;
  }, [chapters, idx, mode, convHtml, scrollMode, s.keepBookCss]);
  const marginX = Math.max(16, Math.min(s.pageMarginX, (size.w - 120) / 2));
  const marginY = Math.max(s.showHeader || s.showFooter ? 32 : 20, Math.min(s.pageMarginY, (size.h - 160) / 2));
  const innerStyle: CSSProperties = {
    fontFamily: s.fontFamily.startsWith('custom:')
      ? `'rt-${s.fontFamily.slice(7)}', ${FONT_MAP.serif}`
      : FONT_MAP[s.fontFamily] ?? FONT_MAP.serif,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    // 竖排用整数 px 行高：保证"一行=一栏"的节距全章均匀，翻页步长才能严格对齐
    lineHeight: s.flow === 'vertical' ? `${Math.round(s.fontSize * s.lineHeight)}px` : s.lineHeight,
    letterSpacing: `${s.letterSpacing}em`,
    ['--reader-font-size' as string]: `${s.fontSize}px`,
    ['--para-gap' as string]: `${s.paraSpacing}em`,
    ['--reader-image-height' as string]: `${Math.max(120, size.h - marginY * 2 - s.fontSize * 2)}px`,
  };

  /** 按当前显示档位重挂划线；独立于正文分页，保存笔记不会改变阅读位置。 */
  const applyAnnos = useCallback(() => {
    const root = innerRef.current;
    if (!root) return;
    const wanted = new Map(annList.filter((a) => a.chapter === idx && a.kind === 'highlight').map((a) => [a.id, a]));
    const mounted = new Set<string>();
    root.querySelectorAll<HTMLElement>('mark.hl').forEach((m) => {
      const a = wanted.get(m.dataset.aid ?? '');
      if (!a) m.replaceWith(...m.childNodes);
      else {
        m.className = `hl c-${a.color}${a.note ? ' has-note' : ''}`;
        mounted.add(a.id);
      }
    });
    for (const a of annList) {
      if (a.chapter !== idx || a.kind !== 'highlight') continue;
      if (mounted.has(a.id)) continue;
      let q: Quote = { exact: a.exact, prefix: a.prefix, suffix: a.suffix };
      const aConv = (a.conv ?? 'off') as ConvMode;
      if (aConv !== mode) {
        if (aConv !== 'off') q = convertQuote(q, inverseMode(aConv));
        if (mode !== 'off') q = convertQuote(q, mode as Exclude<ConvMode, 'off'>);
      }
      applyQuote(root, q, {
        id: a.id,
        color: a.color,
        hasNote: !!a.note,
      });
    }
  }, [annList, idx, mode]);

  useLayoutEffect(() => {
    if (scrollMode) return; // 滚动模式不走分页器
    const pag = pagRef.current;
    const ch = chapters?.[idx];
    if (!pag || !ch || size.w < 60 || size.h < 80) return;
    const html = readingHtml;
    if (!html) return; // 等待转换完成
    const mX = marginX;
    const mY = marginY;
    pag.setGeometry({
      pageW: Math.max(120, size.w - 2 * mX),
      pageH: Math.max(160, size.h - 2 * mY),
      gap: s.flow === 'vertical' ? GAP_V : GAP_H,
      flow: s.flow,
      colsPerPage: s.colsPerPage === 2 ? 2 : 1,
      insetX: mX,
      insetY: mY,
      framePadding: s.decorFrame ? Math.max(10, Math.round(s.fontSize * 0.6)) : 0,
      // 竖排：一栏 = 一行文字，栏宽 = 行距节距
      colW: s.flow === 'vertical' ? Math.max(14, Math.round(s.fontSize * s.lineHeight)) : undefined,
    });
    Object.assign(innerRef.current!.style, innerStyle);
    innerRef.current!.style.setProperty('--para-gap', `${s.paraSpacing}em`);
    const chapterChanged = lastIdx.current !== idx;
    lastIdx.current = idx;
    const prevRatio = pag.pages > 1 ? pag.page / (pag.pages - 1) : 0;
    pag.setHtml(html);
    const total = pag.relayout();
    if (restore.current) {
      const target = restore.current.ratio != null
        ? Math.round(restore.current.ratio * (total - 1))
        : restore.current.last
          ? total - 1
          : Math.min(restore.current.page, total - 1);
      pag.goTo(target);
      restore.current = null;
    } else if (!chapterChanged && total > 1) {
      pag.goTo(Math.round(prevRatio * (total - 1)));
    }
    // Images may decode after the first measurement; settle once without resetting the page.
    let alive = true;
    const pending = Array.from(innerRef.current!.querySelectorAll('img')).filter((img) => !img.complete);
    if (pending.length) void Promise.allSettled(pending.map((img) => img.decode())).then(() => {
      if (!alive) return;
      const current = pag.page;
      pag.relayout(); pag.goTo(current);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, idx, s.flow, s.fontSize, s.lineHeight, s.letterSpacing, s.paraSpacing, marginX, marginY, s.colsPerPage, s.fontFamily, size, readingHtml, fontTick, scrollMode, s.fontWeight, s.indent, s.align, s.decorFrame]);

  useLayoutEffect(() => {
    if (!scrollMode) applyAnnos();
  }, [applyAnnos, scrollMode, chapters, convHtml, size, s, fontTick, anchorTick]);

  // 朗读时把当前段落挂回正文，方便跟读；只包裹当前可见 DOM，不改变分页内容。
  useLayoutEffect(() => {
    const roots: HTMLElement[] = [];
    if (scrollMode) {
      chRefs.current.forEach((el) => {
        const root = el?.querySelector<HTMLElement>('.scroll-ch-body');
        if (root) roots.push(root);
      });
    } else if (innerRef.current) roots.push(innerRef.current);
    roots.forEach((root) => {
      root.querySelectorAll('mark.tts-current').forEach((m) => m.replaceWith(...m.childNodes));
      root.normalize();
    });
    const text = ttsCurrent.trim();
    if (!text) return;
    const state = useTts.getState();
    const quote = {
      exact: text.replace(/\s+/g, ''),
      prefix: state.paras.slice(0, state.paraIdx).join('').replace(/\s+/g, '').slice(-24),
      suffix: state.paras.slice(state.paraIdx + 1).join('').replace(/\s+/g, '').slice(0, 24),
    };
    for (const root of roots) {
      if (!applyQuote(root, quote, { id: 'tts-current', color: 'amber', hasNote: false })) continue;
      const marks = root.querySelectorAll<HTMLElement>('mark[data-aid="tts-current"]');
      marks.forEach((mark) => { mark.className = 'tts-current'; mark.removeAttribute('data-aid'); });
      const first = marks[0];
      if (first && scrollMode) first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      else if (first) {
        const rect = first.getClientRects()[0];
        if (rect) pagRef.current?.revealRect(rect);
      }
      return;
    }
  }, [ttsCurrent, ttsSentenceIndex, scrollMode, scrollHtmls, idx, page, pages, fontTick]);

  // 进度持久化（防抖）
  useEffect(() => {
    if (scrollMode) return;
    if (!chapters?.[idx]) return;
    const t = setTimeout(() => {
      const totalChars = chapters.reduce((a, c) => a + c.chars, 0) || 1;
      const before = chapters.slice(0, idx).reduce((a, c) => a + c.chars, 0);
      const pct = Math.min(
        1,
        (before + ((page + 1) / Math.max(1, pages)) * chapters[idx].chars) / totalChars,
      );
      const pr: Progress = { chapter: idx, page, pages, pct, updatedAt: Date.now() };
      void platform.kvSet(`progress:${bookId}`, pr);
    }, 400);
    return () => clearTimeout(t);
  }, [bookId, chapters, idx, page, pages, scrollMode]);

  // 滚动模式进度持久化
  useEffect(() => {
    if (!scrollMode || !chapters) return;
    const t = setTimeout(() => {
      const pr: Progress = { chapter: idx, page: 0, pages: 1, pct: scrollPct, updatedAt: Date.now() };
      void platform.kvSet(`progress:${bookId}`, pr);
    }, 400);
    return () => clearTimeout(t);
  }, [scrollMode, bookId, chapters, idx, scrollPct]);

  // 滚动模式：划线挂载（先摘除旧 mark 再全章重挂，保证撤销/新增后即时反映）
  const applyAnnosScroll = useCallback(() => {
    if (!chRefs.current.length) return;
    for (let i = 0; i < chRefs.current.length; i++) {
      const root = chRefs.current[i]?.querySelector<HTMLElement>('.scroll-ch-body');
      if (!root) continue;
      const wanted = new Map(annList.filter((a) => a.chapter === i && a.kind === 'highlight').map((a) => [a.id, a]));
      const mounted = new Set<string>();
      root.querySelectorAll<HTMLElement>('mark.hl').forEach((m) => {
        const a = wanted.get(m.dataset.aid ?? '');
        if (!a) m.replaceWith(...m.childNodes);
        else {
          m.className = `hl c-${a.color}${a.note ? ' has-note' : ''}`;
          mounted.add(a.id);
        }
      });
      for (const a of annList) {
        if (a.chapter !== i || a.kind !== 'highlight') continue;
        if (mounted.has(a.id)) continue;
        let q: Quote = { exact: a.exact, prefix: a.prefix, suffix: a.suffix };
        const aConv = (a.conv ?? 'off') as ConvMode;
        if (aConv !== mode) {
          if (aConv !== 'off') q = convertQuote(q, inverseMode(aConv));
          if (mode !== 'off') q = convertQuote(q, mode as Exclude<ConvMode, 'off'>);
        }
        applyQuote(root, q, { id: a.id, color: a.color, hasNote: !!a.note });
      }
    }
  }, [annList, mode]);
  useLayoutEffect(() => {
    if (scrollMode) applyAnnosScroll();
  }, [scrollMode, applyAnnosScroll, scrollHtmls, fontTick, anchorTick]);

  // 滚动：进度比例 + 当前章跟踪
  const scrollFrame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);
  const onScrollScroll = useCallback(() => {
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
    scrollFrame.current = 0;
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setScrollPct(max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0);
    const threshold = el.scrollTop + el.clientHeight * 0.35;
    let cur = 0;
    for (let i = 0; i < chRefs.current.length; i++) {
      const c = chRefs.current[i];
      if (c && c.offsetTop <= threshold) cur = i;
      else if (c) break;
    }
    setIdx((old) => (old !== cur ? cur : old));
    });
  }, []);

  // 滚动容器就绪/尺寸变化后：恢复进度
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!scrollMode || !el || !scrollHtmls) return;
    if (restoreScroll.current != null) {
      const ratio = restoreScroll.current;
      restoreScroll.current = null;
      requestAnimationFrame(() => {
        el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
        onScrollScroll();
      });
    }
  }, [scrollMode, scrollHtmls, fontTick, size, onScrollScroll]);

  const gotoNext = useCallback(() => {
    const pag = pagRef.current;
    if (!pag) return;
    if (pag.next()) return;
    if (chapters && idx < chapters.length - 1) {
      restore.current = { page: 0, last: false };
      setIdx(idx + 1);
    }
  }, [chapters, idx]);

  const gotoPrev = useCallback(() => {
    const pag = pagRef.current;
    if (!pag) return;
    if (pag.prev()) return;
    if (chapters && idx > 0) {
      restore.current = { page: 0, last: true };
      setIdx(idx - 1);
    }
  }, [chapters, idx]);

  // 翻页方向与排版联动（方案 5.1 规则表）
  const nextOnRight = s.tapDir === 'ltr' ? true : s.flow === 'horizontal';

  const getSelQuote = useCallback(() => {
    const sel = window.getSelection();
    const range = selectionController.current?.range ??
      (sel && !sel.isCollapsed && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null);
    if (!range || range.collapsed) return null;
    const element = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element : range.startContainer.parentElement;
    const root = scrollMode ? element?.closest<HTMLElement>('.scroll-ch-body') : innerRef.current;
    if (!root || !root.contains(range.startContainer)) return null;
    // 每条批注归属一个章节，避免跨章引语无法重挂；跨页仍可连续选取。
    if (!root.contains(range.endContainer)) {
      range.setEnd(root, root.childNodes.length);
      showToast('跨章请分段记录，已选至本章末尾');
    }
    const quote = quoteFromRange(range, root);
    if (!quote) return null;
    const chapter = scrollMode ? Number(root.closest('[data-ch]')?.getAttribute('data-ch')) : idx;
    const viewport = wrapRef.current!.getBoundingClientRect();
    const rect = Array.from(range.getClientRects()).find((r) =>
      r.bottom > viewport.top && r.top < viewport.bottom && r.right > viewport.left && r.left < viewport.right);
    const undoIds = [...new Set(Array.from(root.querySelectorAll<HTMLElement>('mark.hl'))
      .filter((mark) => range.intersectsNode(mark)).map((mark) => mark.dataset.aid!).filter(Boolean))];
    // Off-page endpoints have handles pinned to the paper edge. Avoid those
    // displayed hit areas too, otherwise the toolbar can hide the starting handle.
    const ends = Array.from(wrapRef.current!.querySelectorAll<HTMLElement>('.text-selection-handle'))
      .map((handle) => handle.getBoundingClientRect()).filter((r) => r.width && r.height);
    const clampTop = (y: number) => Math.max(12, Math.min(y, window.innerHeight - 190));
    const candidates = [clampTop(Math.min(...ends.map((r) => r.top)) - 190),
      clampTop(Math.max(...ends.map((r) => r.bottom)) + 12), 12, window.innerHeight - 190];
    const menuTop = candidates.find((top) => ends.every((r) => top + 170 < r.top - 4 || top > r.bottom + 4)) ?? candidates[0];
    return { quote, chapter, undoIds, x: rect ? rect.left + rect.width / 2 : viewport.left + viewport.width / 2,
      y: rect?.top ?? viewport.top + 60, menuTop };
  }, [scrollMode, idx, showToast]);

  // 原生长按只负责建立初始选区，之后由应用手柄精确控制选区和跨页。
  useEffect(() => {
    const stage = wrapRef.current;
    if (!stage) return;
    const controller = new TextSelection({
      stage, vertical: s.flow === 'vertical',
      rootFor: (node) => {
        const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
        return scrollMode ? element?.closest<HTMLElement>('.scroll-ch-body') ?? null : innerRef.current;
      },
      paginator: () => pagRef.current, scrollContainer: () => scrollRef.current,
      onChange: (dragging) => {
        selectionInProgress.current = !!controller.range;
        swipeAt.current = Date.now();
        if (dragging || savingHighlight.current) setSelPop(null);
        else setSelPop(getSelQuote());
      },
    });
    selectionController.current = controller;
    return () => {
      controller.destroy();
      selectionController.current = null;
    };
  }, [getSelQuote, scrollMode, s.flow]);

  /** 划线弹层露头的瞬间再收一次，确保不被原生工具条遮住 */
  useEffect(() => {
    if (selPop) hideNativeMenu();
  }, [selPop]);

  const closeSelPop = useCallback(() => {
    selectionController.current?.clear();
    selectionInProgress.current = false;
    swipeAt.current = Date.now();
    setSelPop(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  /** 撤销选区范围内的已划线条目 */
  const undoHighlight = useCallback(async () => {
    if (!selPop || savingHighlight.current) return;
    savingHighlight.current = true;
    setSaving(true);
    const ids = selPop.undoIds;
    try {
      for (const id of ids) await annRemove(id);
      closeSelPop();
      showToast(ids.length > 1 ? `已撤销 ${ids.length} 条划线` : '已撤销划线');
    } catch { showToast('撤销失败，请重试'); }
    finally { savingHighlight.current = false; setSaving(false); }
  }, [selPop, annRemove, showToast, closeSelPop]);

  const onZone = (side: 'left' | 'center' | 'right') => {
    if (side === 'center') {
      setMenu((v) => !v);
      return;
    }
    if (scrollMode) {
      const el = scrollRef.current;
      if (!el) return;
      const dir = side === 'right' ? 1 : -1; // 横排滚动：右=向下，左=向上
      el.scrollBy({ top: dir * el.clientHeight * 0.85, behavior: 'smooth' });
      return;
    }
    const isNext = side === 'right' ? nextOnRight : !nextOnRight;
    if (isNext) gotoNext();
    else gotoPrev();
  };

  const onStageClick = (e: React.MouseEvent) => {
    if (Date.now() - mountAt.current < 400) return; // 书架点击穿透守卫
    if (Date.now() - swipeAt.current < 350) return;
    if (selPop) { closeSelPop(); return; }
    if (selectionInProgress.current || window.getSelection()?.toString() || selActive.current || lpGuard.current) return;
    // 插图点击放大（V0.3.1）
    const img = (e.target as HTMLElement).closest('img');
    if (img) {
      const src = img.getAttribute('src');
      if (src) {
        setZoomImg(src);
        return;
      }
    }
    const mark = (e.target as HTMLElement).closest('mark.hl') as HTMLElement | null;
    if (mark) {
      const id = mark.dataset.aid;
      if (id) setNoteEdit({ id, x: e.clientX, y: e.clientY });
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const side = x < rect.width / 3 ? 'left' : x > (rect.width * 2) / 3 ? 'right' : 'center';
    onZone(side);
  };

  const onHighlightContextMenu = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>('mark.hl[data-aid]');
    if (!mark?.dataset.aid) return;
    e.preventDefault();
    closeSelPop();
    setNoteEdit({ id: mark.dataset.aid, x: e.clientX, y: e.clientY });
  };

  const wheelAllowed = useCallback(() => !scrollMode && !menu && !catalog && !showSet && !showTts &&
    !zoomImg && !noteEdit && !bookmarksOpen && !selPop && !selectionInProgress.current &&
    !window.getSelection()?.toString(), [scrollMode, menu, catalog, showSet, showTts, zoomImg, noteEdit, bookmarksOpen, selPop]);
  useWheelPaging(wrapRef, wheelAllowed, gotoNext, gotoPrev);

  const hasSelection = () => selectionInProgress.current || !!window.getSelection()?.toString();

  const cancelTouch = () => {
    if (lpTimer.current) clearTimeout(lpTimer.current);
    touch.current = null;
    lpGuard.current = false;
    selActive.current = false;
    swipeAt.current = Date.now();
  };
  useEffect(() => () => { if (lpTimer.current) clearTimeout(lpTimer.current); }, []);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) { cancelTouch(); return; }
    const t0 = e.touches[0];
    touch.current = { x: t0.clientX, y: t0.clientY };
    lpGuard.current = false;
    selActive.current = hasSelection() || !!selPop;
    // 长按守卫：450ms 内没有明显位移就认定本次是"选择"操作（手机划线的起点）
    if (lpTimer.current) clearTimeout(lpTimer.current);
    lpTimer.current = setTimeout(() => {
      lpGuard.current = true;
    }, 450);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t) return;
    const p = e.touches[0];
    if (!p || e.touches.length !== 1) { cancelTouch(); return; }
    // 位移明显 → 不是长按（滑动或已在拖选择手柄），撤销长按计时
    if (Math.abs(p.clientX - t.x) > 12 || Math.abs(p.clientY - t.y) > 12) {
      if (lpTimer.current) {
        clearTimeout(lpTimer.current);
        lpTimer.current = null;
      }
    }
    if (!hasSelection()) return;
    // 选区已建立 → 本次序列锁为划线操作，绝不翻页，并持续拦下补发的 click
    selActive.current = true;
    swipeAt.current = Date.now();

  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (lpTimer.current) {
      clearTimeout(lpTimer.current);
      lpTimer.current = null;
    }
    const t = touch.current;
    if (!t) return;
    touch.current = null;
    const p = e.changedTouches[0];
    // 有选区（长按选中/拖选择手柄）→ 划线操作，绝不按滑动翻页处理
    const got = getSelQuote();
    if (got) {
      swipeAt.current = Date.now();
      setSelPop(got);
      selActive.current = false;
      lpGuard.current = false;
      return;
    }
    // 本次序列是长按/出现过选区，但松手时选区尚未 finalize → 依然不是翻页意图。
    // （这正是旧实现"划着划着就跳页"的直接原因：此时 getSelQuote() 还是 null）
    if (selActive.current || lpGuard.current) {
      selActive.current = false;
      lpGuard.current = false;
      swipeAt.current = Date.now();
      selectionInProgress.current = !!selectionController.current?.range;
      pagRef.current?.lockViewport();
      return;
    }
    if (!p) return;
    const dx = p.clientX - t.x;
    const dy = p.clientY - t.y;
    if (scrollMode) return; // 滚动模式：手势交给原生滚动
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
      swipeAt.current = Date.now();
      const swipeNext = dx < 0 ? nextOnRight : !nextOnRight;
      if (swipeNext) gotoNext();
      else gotoPrev();
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.defaultPrevented || e.isComposing || target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        if (noteEdit) { setNoteEdit(null); return; }
        setCatalog(false); setShowSet(false); setShowTts(false); setZoomImg(null);
        closeSelPop(); setMenu(false);
        return;
      }
      if (noteEdit || catalog || showSet || showTts || zoomImg || selPop || window.getSelection()?.toString()) return;
      if (scrollMode) {
        const el = scrollRef.current;
        if (!el) return;
        if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowRight') {
          el.scrollBy({ top: el.clientHeight * 0.85 });
          e.preventDefault();
        } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ArrowLeft') {
          el.scrollBy({ top: -el.clientHeight * 0.85 });
          e.preventDefault();
        }
      } else {
        if (e.key === 'PageDown' || (e.code === 'Space' && !e.shiftKey)) { e.preventDefault(); gotoNext(); }
        else if (e.key === 'PageUp' || (e.code === 'Space' && e.shiftKey)) { e.preventDefault(); gotoPrev(); }
        else if (e.key === 'ArrowRight') nextOnRight ? gotoNext() : gotoPrev();
        else if (e.key === 'ArrowLeft') nextOnRight ? gotoPrev() : gotoNext();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [nextOnRight, gotoNext, gotoPrev, scrollMode, noteEdit, catalog, showSet, showTts, zoomImg, selPop, closeSelPop]);

  const doHighlight = async (color: HighlightColor, openEditor = false) => {
    if (!selPop || savingHighlight.current) return;
    const selected = getSelQuote();
    if (!selected) { closeSelPop(); return; }
    savingHighlight.current = true;
    setSaving(true);
    try {
      // 保存显示文字及其转换档位，避免不可逆的简繁往返转换损坏引语。
      const ann = await annAdd({
        kind: 'highlight', chapter: selected.chapter, ...selected.quote,
        color, note: '', conv: mode,
      });
      closeSelPop();
      if (openEditor) setNoteEdit({ id: ann.id, x: selPop.x, y: selPop.y, editor: true });
      else showToast('已保存划线');
    } catch {
      showToast('保存失败，请重试');
    } finally {
      savingHighlight.current = false;
      setSaving(false);
    }
  };

  const addBookmark = async () => {
    const ratio = scrollMode ? scrollPct : pages > 1 ? page / (pages - 1) : 0;
    if (annList.some((a) => a.kind === 'bookmark' && a.chapter === idx && Math.abs((a.ratio ?? 0) - ratio) < 0.00001)) { showToast('当前位置已有书签'); return; }
    try {
    await annAdd({
      kind: 'bookmark',
      chapter: idx,
      exact: chapters?.[idx]?.title ?? '',
      prefix: '',
      suffix: '',
      color: 'red',
      note: '',
      ratio: scrollMode ? scrollPct : pages > 1 ? page / (pages - 1) : 0,
    });
    showToast('已加书签');
    } catch (e) { showToast('书签保存失败，请重试'); throw e; }
  };

  const exportNotes = async () => {
    if (!book || !chapters) return;
    const md = buildNotesMarkdown(book, annList, chapters.map((c) => c.title));
    try { showToast(await downloadNotes(`${book.title} · 读书笔记.md`, md)); }
    catch (e) { showToast(e instanceof Error ? e.message : '导出失败'); }
  };

  const exportTxt = async () => {
    if (!book || !chapters) return;
    const txt = buildNotesTxt(book, annList, chapters.map((c) => c.title));
    try { showToast(await downloadBlob(new Blob([txt], { type: 'text/plain;charset=utf-8' }), `${book.title} · 读书笔记.txt`)); }
    catch (e) { showToast(e instanceof Error ? e.message : '导出失败'); }
  };

  const exportCsv = async () => {
    if (!book || !chapters) return;
    const csv = buildNotesCsv(book, annList, chapters.map((c) => c.title));
    try { showToast(await downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${book.title} · 读书笔记.csv`)); }
    catch (e) { showToast(e instanceof Error ? e.message : '导出失败'); }
  };

  const searchResults = useMemo(
    () => (catTab === 'search' && searchQuery.trim() ? searchBook(chapters ?? [], searchQuery) : []),
    [catTab, searchQuery, chapters],
  );

  const visibleChapters = useMemo(() => (book?.format === 'md' ? markdownOutline(chapters ?? []) : (chapters ?? []).map((chapter, index) => ({
    index, title: chapter.title || `第 ${index + 1} 节`, level: chapter.level || 1, heading: -1,
  }))).map((chapter, order) => ({ ...chapter, order })).filter((chapter) => chapter.title.toLocaleLowerCase().includes(tocQuery.trim().toLocaleLowerCase())), [book?.format, chapters, tocQuery]);

  useLayoutEffect(() => {
    if (!catalog || catTab !== 'toc') return;
    const current = tocRef.current?.querySelector<HTMLElement>('[aria-current="location"]');
    const drawer = tocRef.current?.closest<HTMLElement>('.drawer');
    if (!current || !drawer) return;
    // Scroll only the directory panel; opening it must not move the reading page.
    drawer.scrollTop += current.getBoundingClientRect().top - drawer.getBoundingClientRect().top
      - (drawer.clientHeight - current.offsetHeight) / 2;
  }, [catalog, catTab, idx, visibleChapters]);

  const visibleNotes = useMemo(() => annList.filter((a) => {
    const kind = a.kind === 'bookmark' ? '书签' : a.note ? '批注' : '划线';
    return (noteFilter === '全部' || noteFilter === kind)
      && `${a.exact} ${a.note}`.toLowerCase().includes(noteQuery.trim().toLowerCase());
  }).sort((a, b) => a.chapter - b.chapter || a.createdAt - b.createdAt), [annList, noteFilter, noteQuery]);

  const pctLabel = useMemo(() => {
    if (!chapters) return '';
    const total = chapters.reduce((a, c) => a + c.chars, 0) || 1;
    const before = chapters.slice(0, idx).reduce((a, c) => a + c.chars, 0);
    const p = Math.min(1, (before + ((page + 1) / Math.max(1, pages)) * (chapters[idx]?.chars ?? 0)) / total);
    return `${Math.round(p * 100)}%`;
  }, [chapters, idx, page, pages]);

  const revealNote = useCallback((id: string) => {
    // 简繁转换尚未完成时，DOM 可能仍是上一章；等新章布局完成后再定位。
    if (!scrollMode && lastIdx.current !== idx) return false;
    const mark = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('mark.hl') ?? [])
      .find((m) => m.dataset.aid === id);
    if (!mark) return false;
    if (scrollMode) {
      const el = scrollRef.current!;
      el.scrollTop += mark.getBoundingClientRect().top - el.getBoundingClientRect().top - 80;
    } else pagRef.current?.revealRect(mark.getClientRects()[0]);
    return true;
  }, [scrollMode, idx]);

  useEffect(() => {
    if (pendingNote.current && revealNote(pendingNote.current)) pendingNote.current = null;
  }, [idx, convHtml, anchorTick, annList, revealNote]);

  useEffect(() => {
    if (!searchTarget || (!scrollMode && (idx !== searchTarget.chapter || lastIdx.current !== idx || (mode !== 'off' && !convHtml)))) return;
    const root = scrollMode ? chRefs.current[searchTarget.chapter]?.querySelector<HTMLElement>('.scroll-ch-body') : innerRef.current;
    if (!root) return;
    root.querySelectorAll('mark.search-match').forEach((m) => m.replaceWith(...m.childNodes));
    const quote = mode === 'off' ? searchTarget.quote : convertQuote(searchTarget.quote, mode);
    const range = rangeForQuote(root, quote);
    const rect = range?.getClientRects()[0];
    if (rect) {
      if (scrollMode) scrollRef.current!.scrollTop += rect.top - scrollRef.current!.getBoundingClientRect().top - 80;
      else pagRef.current?.revealRect(rect);
      applyQuote(root, quote, { id: 'reader-search', color: 'amber', hasNote: false });
      const marks = Array.from(root.querySelectorAll<HTMLElement>('[data-aid="reader-search"]'));
      marks.forEach((m) => { m.className = 'search-match'; delete m.dataset.aid; });
      window.setTimeout(() => marks.forEach((m) => { if (m.isConnected) m.replaceWith(...m.childNodes); }), 2400);
    } else showToast('未能定位这段文字，已打开所在章节');
    setSearchTarget(null);
  }, [searchTarget, idx, convHtml, scrollMode, mode, showToast]);

  useEffect(() => {
    if (!headingTarget || (!scrollMode && (idx !== headingTarget.index || lastIdx.current !== idx || (mode !== 'off' && !convHtml)))) return;
    const root = scrollMode ? chRefs.current[headingTarget.index]?.querySelector('.scroll-ch-body') : innerRef.current;
    const heading = root?.querySelectorAll('h1,h2')[headingTarget.heading];
    if (!heading) return;
    const rect = heading.getClientRects()[0];
    if (rect) {
      if (scrollMode && scrollRef.current) scrollRef.current.scrollTop += rect.top - scrollRef.current.getBoundingClientRect().top - 24;
      else pagRef.current?.revealRect(rect);
      setHeadingTarget(null);
    }
  }, [headingTarget, idx, convHtml, scrollMode, scrollHtmls, mode, anchorTick]);

  if (!book) {
    return (
      <div className="reader-splash">
        <p>未找到该书</p>
        <button onClick={onBack}>返回书架</button>
      </div>
    );
  }

  const jumpTo = (a: Annotation) => {
    if (a.kind === 'highlight') {
      if (!revealNote(a.id)) { pendingNote.current = a.id; goToChapter(a.chapter); }
    } else goToChapter(a.chapter, a.ratio);
    setCatalog(false);
    setMenu(false);
  };

  /** 统一跳章：分页走 restore；滚动直接定位到章首 */
  const goToChapter = (i: number, ratio?: number) => {
    if (scrollMode) {
      const el = chRefs.current[i];
      if (el && scrollRef.current) {
        scrollRef.current.scrollTo({ top: ratio != null
          ? ratio * (scrollRef.current.scrollHeight - scrollRef.current.clientHeight)
          : Math.max(0, el.offsetTop - 12) });
      } else {
        restoreScroll.current = null;
      }
      setIdx(i);
    } else {
      if (i === idx) {
        pagRef.current?.goTo(ratio != null ? ratio * (pages - 1) : 0);
        return;
      }
      restore.current = {
        page: 0,
        last: false,
        ratio,
      };
      setIdx(i);
    }
  };

  const customVars: CSSProperties | undefined =
    s.theme === 'custom'
      ? ({
          '--bg': s.customTheme.bg,
          '--ink': s.customTheme.fg,
          '--accent': s.customTheme.accent,
          '--panel': s.customTheme.panel,
          '--hair': `${s.customTheme.fg}26`,
        } as CSSProperties)
      : undefined;

  const rootStyle: CSSProperties = {
    ...customVars,
    '--warm': s.warmth,
    ...(s.brightness < 100 ? { filter: `brightness(${s.brightness}%)` } : {}),
  } as CSSProperties;

  const editAnno = noteEdit ? annList.find((a) => a.id === noteEdit.id) : null;

  return (
    <div
      className={`reader ${s.texture ? 'texture' : ''}`}
      data-theme={s.theme}
      data-hl={s.hlStyle}
      data-flow={s.flow}
      data-readmode={scrollMode ? 'scroll' : 'paged'}
      data-menu={menu ? 'open' : 'closed'}
      data-decor-lines={s.decorLines ? '1' : '0'}
      data-decor-frame={s.decorFrame ? '1' : '0'}
      data-line={s.lineColor === 'auto' ? undefined : s.lineColor}
      style={rootStyle}
    >
      <div
        className="reader-stage"
        style={{ '--menu-preview-scale': size.h > 0 ? Math.max(.25, (size.h - 180) / size.h) : .8 } as CSSProperties}
        ref={wrapRef}
        onClick={onStageClick}
        onContextMenu={onHighlightContextMenu}

        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={cancelTouch}
      >
        {scrollMode ? (
          <div
            key="scroll"
            className="scroll-outer"
            ref={scrollRef}
            onScroll={onScrollScroll}
            style={{ padding: `${marginY}px ${marginX}px` }}
          >
            {scrollHtmls === null ? (
              <p className="scroll-loading">正在准备全书…</p>
            ) : (
              scrollHtmls.map((html, i) => (
                <article
                  key={i}
                  data-ch={i}
                  className={`scroll-ch ${s.indent ? '' : 'no-indent'} ${s.align === 'start' ? 'align-start' : ''}`}
                  ref={(el) => {
                    chRefs.current[i] = el;
                  }}
                >
                  {chapters?.[i]?.title ? <h4 className="scroll-ch-title">{chapters[i].title}</h4> : null}
                  <div className="scroll-ch-body" style={innerStyle} dangerouslySetInnerHTML={{ __html: html }} />
                </article>
              ))
            )}
          </div>
        ) : (
          <div key="paged" className="page-outer" ref={outerRef}
            onScroll={() => pagRef.current?.lockViewport()}>
            <div className="page-clip" ref={clipRef} onScroll={() => pagRef.current?.lockViewport()}>
              <div
                className={`page-inner ${s.flow === 'vertical' ? 'v' : ''} ${s.indent ? '' : 'no-indent'} ${s.align === 'start' ? 'align-start' : ''}`}
                ref={innerRef}
                style={innerStyle}
              />
            </div>
          </div>
        )}
        {s.warmth > 0 ? <div className="warm-layer" aria-hidden="true" /> : null}
        {menu ? <button className="stage-close" onClick={(e) => { e.stopPropagation(); setMenu(false); }} aria-label="收起菜单" /> : null}
      </div>

      {/* 插图放大查看（V0.3.1） */}
      {zoomImg ? (
        <div className="img-lightbox" onClick={() => setZoomImg(null)}>
          <img src={zoomImg} alt="" />
          <p className="lb-hint">点击任意处关闭</p>
        </div>
      ) : null}

      {/* 页眉页脚（常显，呼出菜单时让位） */}
      {s.showHeader && !menu ? (
        <div className="page-info head" aria-hidden="true">
          {chapters?.[idx]?.title ?? ''}
        </div>
      ) : null}
      {s.showFooter && !menu ? (
        <div className="page-info foot" aria-hidden="true">
          <span><ReaderClock /></span>
          <span>
            {scrollMode
              ? `${Math.round(scrollPct * 100)}%`
              : `${page + 1}/${pages} · ${pctLabel}`}
          </span>
        </div>
      ) : null}

      {selPop ? (
        <div
          className="sel-pop reader-selection"
          role="dialog" aria-label="划线与笔记"
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onMouseDown={(e) => e.preventDefault()}
          style={{ left: Math.max(12, Math.min(selPop.x - 164, window.innerWidth - 340)),
            top: selPop.menuTop }}
        >
          <div className="selection-heading"><strong>留下一点思考</strong><span>已选 {selPop.quote.exact.length} 字</span></div>
          <p className="selection-help">拖动圆点选字 · {s.flow === 'vertical' ? '末列末尾再继续拖' : '末行再向下拖'}翻一页</p>
          {HL_COLORS.map((c) => (
            <button key={c} className={`dot c-${c}`} disabled={saving} aria-label={`${({ red: '朱砂', green: '松绿', blue: '靛蓝', amber: '琥珀' })[c]}划线`} title={`${({ red: '朱砂', green: '松绿', blue: '靛蓝', amber: '琥珀' })[c]}划线`} onClick={() => void doHighlight(c)} />
          ))}
          <span className="sel-div" />
          <button disabled={saving} className="sel-btn" onClick={() => void copyText(selectionController.current?.range?.toString() || window.getSelection()?.toString() || selPop.quote.exact).then(() => showToast('已复制')).catch(e => showToast(e.message))}>复制</button>
          <button disabled={saving} className="sel-btn" onClick={() => void doHighlight('red', true)}>
            写笔记
          </button>
          {selPop.undoIds.length ? (
            <button className="sel-btn danger" onClick={() => void undoHighlight()}>
              撤销划线
            </button>
          ) : null}
          <span className="sel-div" />
          <button className="sel-btn" onClick={closeSelPop}>
            取消
          </button>
        </div>
      ) : null}

      {noteEdit && editAnno && !noteEdit.editor ? <HighlightActions
        key={editAnno.id} anno={editAnno}
        onEdit={() => setNoteEdit({ ...noteEdit, editor: true })}
        onRemove={async () => { await annRemove(editAnno.id); setNoteEdit(null); showToast('已撤销划线'); }}
        onClose={() => setNoteEdit(null)}
      /> : null}
      {noteEdit?.editor && editAnno ? (
        <NoteCard
          key={editAnno.id}
          anno={editAnno}
          x={noteEdit.x}
          y={noteEdit.y}
          book={{ title: book.title, author: book.author }}
          onSave={async (note) => {
            await annUpdate(editAnno.id, { note });
            setNoteEdit(null);
            showToast('笔记已保存');
          }}
          onDelete={async () => {
            await annRemove(editAnno.id);
            setNoteEdit(null);
            showToast('已删除划线');
          }}
          onClose={() => setNoteEdit(null)}
        />
      ) : null}

      {menu ? (
        <>
          <header className="reader-head">
            <button onClick={onBack}>〈 书架</button>
            <div className="head-title">
              <strong>{book.title}</strong>
              <span>{chapters?.[idx]?.title ?? ''}</span>
            </div>
            <button onClick={() => { setTocQuery(''); setCatTab('toc'); setCatalog(true); }}>目录</button>
          </header>
          <footer className="reader-foot">
            <span className="foot-ch">
              {chapters?.length ? idx + 1 : 0}/{chapters?.length ?? 0} 章
            </span>
            {scrollMode ? (
              <span className="foot-pct">{Math.round(scrollPct * 100)}%</span>
            ) : (
              <>
                <input
                  type="range"
                  aria-label="本章阅读进度"
                  min={0}
                  max={Math.max(0, pages - 1)}
                  value={page}
                  onChange={(e) => pagRef.current?.goTo(Number(e.target.value))}
                />
                <span className="foot-pct">{pctLabel}</span>
              </>
            )}
            <button onClick={() => setBookmarksOpen(true)}>书签</button>
            <button onClick={() => setShowTts(true)}>朗读</button>
            <button onClick={() => { setCatTab('notes'); setCatalog(true); }}>笔记</button>
            <button onClick={() => setShowSet(true)}>排版</button>
          </footer>
        </>
      ) : null}

      {bookmarksOpen ? <BookmarkPanel onClose={() => setBookmarksOpen(false)} onAdd={addBookmark} onJump={(a) => { jumpTo(a); setBookmarksOpen(false); }} /> : null}

      {catalog ? (
        <Panel side="left" label="目录与笔记" onClose={() => setCatalog(false)}>
            <div className="drawer-head">
            <div className="tabs">
              <button className={catTab === 'toc' ? 'active' : ''} onClick={() => { setTocQuery(''); setCatTab('toc'); }}>
                目录
              </button>
              <button className={catTab === 'notes' ? 'active' : ''} onClick={() => setCatTab('notes')}>
                笔记（{annList.length}）
              </button>
              <button className={catTab === 'search' ? 'active' : ''} onClick={() => setCatTab('search')}>
                搜索
              </button>
            </div>
              <button onClick={() => setCatalog(false)}>收起</button>
            </div>

            {catTab === 'toc' ? (
              <div className="toc" ref={tocRef}>
                <input className="field" type="search" aria-label="查找章节" placeholder="按章节名查找…" value={tocQuery} onChange={(e) => setTocQuery(e.target.value)} />
                {tocQuery.trim() && visibleChapters.length === 0 ? <p className="panel-empty">没有找到对应章节</p> : null}
                {visibleChapters.map(({ title, index: i, level, heading, order }) => (
                  <button
                    key={`${i}-${heading}`}
                    style={level === 2 ? { paddingLeft: 28, fontSize: '0.9em' } : undefined}
                    className={i === idx ? 'active' : ''}
                    aria-current={i === idx ? 'location' : undefined}
                    onClick={() => {
                      goToChapter(i);
                      setHeadingTarget(heading >= 0 ? { index: i, heading } : null);
                      setCatalog(false);
                    }}
                  >
                    <span className="toc-index">{String(order + 1).padStart(2, '0')}</span><span>{title}</span>
                  </button>
                ))}
              </div>
            ) : catTab === 'search' ? (
              <div className="search-pane">
                <input
                  className="field search-box"
                  aria-label="搜索全书内容"
                  placeholder="搜索全书内容…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query.trim() ? (
                  <p className="set-hint">
                    {searchResults.length > 0 ? `${searchResults.length} 处匹配（最多 200）` : '无匹配'}
                  </p>
                ) : (
                  <p className="set-hint">输入关键词，在本书全部章节中查找</p>
                )}
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    className="search-hit"
                    onClick={() => {
                      goToChapter(r.chapter);
                      setSearchTarget({ chapter: r.chapter, quote: r.quote });
                      setCatalog(false);
                      setMenu(false);
                    }}
                  >
                    <span className="search-hit-ch">{r.title || `第 ${r.chapter + 1} 节`}</span>
                    <span className="search-hit-snippet">{r.snippet}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="ann-list">
                <div className="ann-head">
                  <span>划线 · 批注 · 书签</span>
                    <details className="export-menu"><summary>导出</summary><div>
                      <button onClick={exportNotes}>Markdown</button>
                      <button onClick={exportTxt}>纯文本</button>
                      <button onClick={exportCsv}>表格 CSV</button>
                    </div></details>
                </div>
                <input className="field" aria-label="检索笔记" placeholder="查找摘录或自己的想法…" value={noteQuery} onChange={(e) => setNoteQuery(e.target.value)} />
                <div className="panel-tabs note-filters" aria-label="笔记筛选">
                  {['全部', '划线', '批注', '书签'].map((f) => <button key={f} aria-pressed={noteFilter === f} onClick={() => setNoteFilter(f)}>{f}</button>)}
                </div>
                {annList.length === 0 ? (
                  <p className="set-hint">暂无内容 · 选中正文即可划线批注</p>
                ) : visibleNotes.length === 0 ? <p className="panel-empty">没有符合条件的笔记</p> : (
                  visibleNotes.map((a) => (
                      <button key={a.id} className="ann-item" onClick={() => jumpTo(a)}>
                        <span className="ann-chapter">{chapters?.[a.chapter]?.title || `第 ${a.chapter + 1} 节`}</span>
                        <span className={`ann-tag c-${a.color}`}>
                          {a.kind === 'bookmark' ? '书签' : a.note ? '批注' : '划线'}
                        </span>
                        <span className="ann-text">
                          {a.kind === 'bookmark' ? a.exact || `第 ${a.chapter + 1} 节` : a.exact}
                        </span>
                        {a.note ? <span className="ann-note">{a.note}</span> : null}
                      </button>
                    ))
                )}
              </div>
            )}
        </Panel>
      ) : null}

      {showSet ? (
        <SettingsPanel
          s={s}
          onChange={setStyle}
          scope={scope}
          onScopeChange={(sc) => {
            if (sc === 'book') void useBookStyles.getState().save(bookId, s);
            else void useBookStyles.getState().clear(bookId);
          }}
          hasOverride={!!override}
          onClearOverride={() => void useBookStyles.getState().clear(bookId)}
          onClose={() => setShowSet(false)}
        />
      ) : null}

      {showTts ? <TtsPanel onStart={() => void ttsStart()} onClose={() => setShowTts(false)} /> : null}

      {toast ? <div className="toast reader-toast" role="status">{toast}</div> : null}
    </div>
  );
}
