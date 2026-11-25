import { BookmarkPanel } from './BookmarkPanel';
import { useWheelPaging } from './useWheelPaging';
import { PdfReflowPanel } from './PdfReflowPanel';
/** PDF 阅读器（V0.0.9 渲染通道；V0.2.1 文本层划线批注）
 *  canvas 渲染页面 + pdf.js TextLayer 提供可选中文本，划线复用引语锚定引擎 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { platform } from '../platform/web';
import { registerBackHandler } from '../platform/backHandler';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { useAnnotations } from '../store/annotations';
import { applyQuote, quoteFromRange } from '../engine/annotate';
import type { Quote } from '../engine/annotate';
import { buildNotesMarkdown, downloadNotes } from '../engine/notesExport';
import { addReadingTime } from '../store/stats';
import type { HighlightColor, Progress } from '../engine/types';
import { NoteCard } from './NoteCard';
import { HighlightActions } from './HighlightActions';
import { copyText } from '../engine/clipboard';

const HL_COLORS: HighlightColor[] = ['red', 'green', 'blue', 'amber'];

export function PdfReader({ bookId, onBack, onOpen }: { bookId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const book = useLibrary((st) => st.books.find((b) => b.id === bookId));
  const s = useSettings((st) => st.s);
  const annList = useAnnotations((st) => st.list);
  const annAdd = useAnnotations((st) => st.add);
  const annUpdate = useAnnotations((st) => st.update);
  const annRemove = useAnnotations((st) => st.remove);
  useEffect(() => { void useAnnotations.getState().load(bookId); }, [bookId]);

  const [error, setError] = useState('');
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [num, setNum] = useState(1);
  const [menu, setMenu] = useState(true);
  const [busy, setBusy] = useState(false);
  const [textReady, setTextReady] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [toast, setToast] = useState('');
  const [selPop, setSelPop] = useState<{ x: number; y: number; quote: Quote } | null>(null);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [reflowOpen, setReflowOpen] = useState(false);
  const [noteEdit, setNoteEdit] = useState<{ id: string; x: number; y: number; editor?: boolean } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const pdfjsRef = useRef<typeof import('pdfjs-dist') | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipeAt = useRef(0);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 1800);
  }, []);

  /** 返回键：编辑卡→划线弹层→菜单→回书架 */
  const backRef = useRef({ noteEdit, selPop, menu, onBack, bookmarksOpen });
  backRef.current = { noteEdit, selPop, menu, onBack, bookmarksOpen };
  useEffect(
    () =>
      registerBackHandler(() => {
        const st = backRef.current;
        if (st.bookmarksOpen) return false;
        if (st.noteEdit) {
          setNoteEdit(null);
          return true;
        }
        if (st.selPop) {
          setSelPop(null);
          window.getSelection()?.removeAllRanges();
          return true;
        }
        st.onBack();
        return true;
      }),
    [],
  );

  useEffect(() => {
    // 阅读时长统计：每分钟可见时计 1 分钟
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void addReadingTime(bookId, 60);
    }, 60000);
    return () => clearInterval(t);
  }, [bookId]);

  useEffect(() => {
    let alive = true;
    let loading: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    void (async () => {
      try {
        const data = await platform.kvGet<ArrayBuffer>(`file:${bookId}`);
        if (!data) throw new Error('PDF 文件缺失，请重新导入');
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        pdfjsRef.current = pdfjs;
        if (!alive) return;
        loading = pdfjs.getDocument({ data });
        const d = await loading.promise;
        if (!alive) { void d.destroy(); return; }
        setDoc(d);
        const pr = await platform.kvGet<Progress>(`progress:${bookId}`);
        if (pr) setNum(Math.min(Math.max(1, pr.chapter + 1), d.numPages));
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
      void loading?.destroy();
    };
  }, [bookId]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [doc]);

  // 页面渲染（canvas + 文本层 + 划线恢复）
  useEffect(() => {
    const pdfjs = pdfjsRef.current;
    if (!doc || !pdfjs) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    const layer = layerRef.current;
    if (!canvas || !wrap || !layer || size.w < 100) return;
    let alive = true;
    let textTask: { cancel: () => void } | null = null;
    let canvasTask: { cancel: () => void } | null = null;
    setBusy(true);
    setError('');
    void (async () => {
      try {
        const page = await doc.getPage(num);
        if (!alive) return;
        const base = page.getViewport({ scale: 1 });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = ((size.w - 24) / base.width) * dpr;
        const viewport = page.getViewport({ scale });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx || !alive) return;
        const task = page.render({ canvasContext: ctx, viewport });
        canvasTask = task;
        await task.promise;
        if (!alive) return;
        // 文本层（可选中、划线挂载点）
        layer.innerHTML = '';
        const textViewport = page.getViewport({ scale: scale / dpr });
        layer.style.setProperty('--scale-factor', String(scale / dpr));
        const tl = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: layer,
          viewport: textViewport,
        });
        textTask = tl;
        await tl.render();
        if (alive) setTextReady(v => v + 1);
      } catch (e) {
        if (alive && !(e instanceof Error && /cancel/i.test(e.name))) setError('此页渲染失败，请切换页面后重试');
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => {
      alive = false;
      canvasTask?.cancel();
      textTask?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, num, size]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || busy) return;
    layer.querySelectorAll('mark.hl').forEach(mark => mark.replaceWith(...mark.childNodes));
    layer.normalize();
    for (const a of annList) {
      if (a.kind === 'highlight' && a.chapter === num - 1) applyQuote(layer, a, { id: a.id, color: a.color, hasNote: !!a.note });
    }
  }, [annList, textReady, num, busy]);

  useEffect(() => {
    if (!doc) return;
    const t = setTimeout(() => {
      const pct = num / doc.numPages;
      void platform.kvSet(`progress:${bookId}`, {
        chapter: num - 1,
        page: 0,
        pages: 1,
        pct,
        updatedAt: Date.now(),
      } satisfies Progress);
    }, 400);
    return () => clearTimeout(t);
  }, [bookId, doc, num]);

  const goPage = useCallback(
    (p: number) => {
      if (!doc) return;
      setNum(Math.max(1, Math.min(doc.numPages, Math.round(p))));
      setSelPop(null);
    },
    [doc],
  );

  const getSelQuote = useCallback((): { quote: Quote; x: number; y: number } | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    const root = layerRef.current;
    if (!root || !root.contains(range.commonAncestorContainer)) return null;
    const quote = quoteFromRange(range);
    if (!quote) return null;
    const rect = range.getBoundingClientRect();
    return { quote, x: rect.left + rect.width / 2, y: rect.top };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') { setNoteEdit(null); setSelPop(null); setMenu(false); window.getSelection()?.removeAllRanges(); return; }
      if (noteEdit || selPop || reflowOpen || (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'PageDown' || (e.code === 'Space' && !e.shiftKey)) { e.preventDefault(); goPage(num + 1); }
      else if (e.key === 'PageUp' || (e.code === 'Space' && e.shiftKey)) { e.preventDefault(); goPage(num - 1); }
      else if (e.key === 'ArrowRight') goPage(num + 1);
      else if (e.key === 'ArrowLeft') goPage(num - 1);
      else if (e.key === 'Escape') {
        setMenu(false);
        setSelPop(null);
        setNoteEdit(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goPage, num, noteEdit, selPop, reflowOpen]);

  const onStageClick = (e: React.MouseEvent) => {
    if (Date.now() - swipeAt.current < 400 || window.getSelection()?.toString()) return;
    const mark = (e.target as HTMLElement).closest('mark.hl') as HTMLElement | null;
    if (mark) {
      const id = mark.dataset.aid;
      if (id) setNoteEdit({ id, x: e.clientX, y: e.clientY });
      return;
    }
    if (selPop) {
      setSelPop(null);
      window.getSelection()?.removeAllRanges();
      return;
    }
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const side = x < rect.width / 3 ? 'left' : x > (rect.width * 2) / 3 ? 'right' : 'center';
    if (side === 'center') setMenu((v) => !v);
    else goPage(side === 'right' ? num + 1 : num - 1);
  };

  const onStageMouseUp = () => {
    if (menu) return;
    const got = getSelQuote();
    if (got) setSelPop({ x: got.x, y: got.y, quote: got.quote });
  };

  const onHighlightContextMenu = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>('mark.hl[data-aid]');
    if (!mark?.dataset.aid) return;
    e.preventDefault();
    setSelPop(null);
    window.getSelection()?.removeAllRanges();
    setNoteEdit({ id: mark.dataset.aid, x: e.clientX, y: e.clientY });
  };

  const wheelAllowed = useCallback(() => !menu && !busy && !selPop && !noteEdit && !bookmarksOpen &&
    !reflowOpen && !window.getSelection()?.toString(), [menu, busy, selPop, noteEdit, bookmarksOpen, reflowOpen]);
  const wheelNext = useCallback(() => goPage(num + 1), [goPage, num]);
  const wheelPrevious = useCallback(() => goPage(num - 1), [goPage, num]);
  useWheelPaging(wrapRef, wheelAllowed, wheelNext, wheelPrevious);

  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t) return;
    touch.current = null;
    // 有选区（长按选中/拖选择手柄）→ 必然是划线操作，优先弹选区弹层，绝不翻页
    const got = getSelQuote();
    if (got) {
      swipeAt.current = Date.now();
      setSelPop({ x: got.x, y: got.y, quote: got.quote });
      return;
    }
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy)) {
      swipeAt.current = Date.now();
      goPage(dx < 0 ? num + 1 : num - 1);
    }
  };

  const doHighlight = async (color: HighlightColor, openEditor = false) => {
    if (!selPop) return;
    const ann = await annAdd({
      kind: 'highlight',
      chapter: num - 1,
      exact: selPop.quote.exact,
      prefix: selPop.quote.prefix,
      suffix: selPop.quote.suffix,
      color,
      note: '',
      conv: 'off',
    });
    window.getSelection()?.removeAllRanges();
    setSelPop(null);
    if (openEditor) setNoteEdit({ id: ann.id, x: selPop.x, y: selPop.y, editor: true });
    else showToast('已划线');
  };

  const addBookmark = async () => {
    if (!doc) return;
    if (annList.some((a) => a.kind === 'bookmark' && a.chapter === num - 1)) { showToast('当前位置已有书签'); return; }
    await annAdd({ kind: 'bookmark', chapter: num - 1, exact: `第 ${num} 页`, prefix: '', suffix: '', color: 'red', note: '' });
    showToast('已加书签');
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

  const editAnno = noteEdit ? annList.find((a) => a.id === noteEdit.id) : null;

  return (
    <div className="reader" data-menu={menu ? 'open' : 'closed'} data-theme={s.theme} data-hl={s.hlStyle} style={customVars}>
      <div className="reader-stage" style={{ '--menu-preview-scale': size.h > 0 ? Math.max(.25, (size.h - 180) / size.h) : .8 } as CSSProperties} ref={wrapRef} onContextMenu={onHighlightContextMenu} onClick={onStageClick} onMouseUp={onStageMouseUp} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="pdf-stage">
          <div className="pdf-page">
            <canvas ref={canvasRef} />
            <div className="textLayer" ref={layerRef} />
          </div>
          {!doc && !error ? <p className="pdf-hint">装订中…</p> : null}
          {error ? <p className="pdf-hint">{error}</p> : null}
          {busy && doc ? <p className="pdf-hint pdf-busy">渲染中…</p> : null}
        </div>
        {menu ? <button className="stage-close" onClick={e => { e.stopPropagation(); setMenu(false); }} aria-label="收起菜单" /> : null}
      </div>

      {selPop ? (
        <div className="sel-pop reader-selection" role="dialog" aria-label="划线与笔记" onPointerDown={(e) => e.preventDefault()} style={{ left: Math.max(12, Math.min(selPop.x - 164, window.innerWidth - 340)), top: Math.max(12, Math.min(selPop.y - 110, window.innerHeight - 140)) }}>
          <div className="selection-heading"><strong>留下一点思考</strong><span>已选 {selPop.quote.exact.length} 字</span></div>
          {HL_COLORS.map((c) => (
            <button key={c} className={`dot c-${c}`} aria-label={`${c}划线`} title="划线" onClick={() => void doHighlight(c)} />
          ))}
          <span className="sel-div" />
          <button className="sel-btn" onClick={() => void copyText(window.getSelection()?.toString() || selPop.quote.exact).then(() => showToast('已复制')).catch(e => showToast(e.message))}>复制</button>
          <button className="sel-btn" onClick={() => void doHighlight('red', true)}>
            写笔记
          </button>
          <button className="sel-btn" onClick={() => { setSelPop(null); window.getSelection()?.removeAllRanges(); }}>取消</button>
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
          book={book ? { title: book.title, author: book.author } : undefined}
          onSave={async (note) => {
            await annUpdate(editAnno.id, { note });
            setNoteEdit(null);
          }}
          onDelete={async () => {
            await annRemove(editAnno.id);
            setNoteEdit(null);
          }}
          onClose={() => setNoteEdit(null)}
        />
      ) : null}

      {bookmarksOpen ? <BookmarkPanel onClose={() => setBookmarksOpen(false)} onAdd={addBookmark} onJump={(a) => { goPage(a.chapter + 1); setBookmarksOpen(false); setMenu(false); }} /> : null}
      {reflowOpen && doc && book ? <PdfReflowPanel doc={doc} book={book} onClose={() => setReflowOpen(false)} onOpen={onOpen} /> : null}

      {menu && book ? (
        <>
          <header className="reader-head">
            <button onClick={onBack}>〈 书架</button>
            <div className="head-title">
              <strong>{book.title}</strong>
              <span>PDF · {doc ? `${doc.numPages} 页` : '加载中'}</span>
            </div>
            <button onClick={() => setBookmarksOpen(true)}>书签</button>
            <button disabled={!doc} onClick={() => setReflowOpen(true)}>文字重排</button>
          </header>
          <footer className="reader-foot">
            <span className="foot-ch">
              {num}/{doc?.numPages ?? '—'} 页
            </span>
            <input
              type="range"
              min={1}
              max={doc?.numPages ?? 1}
              value={num}
              onChange={(e) => goPage(Number(e.target.value))}
            />
            <span className="foot-pct">{doc ? `${Math.round((num / doc.numPages) * 100)}%` : ''}</span>
            <button
              onClick={async () => {
                const titles = Array.from({ length: doc?.numPages ?? 0 }, (_, i) => `第 ${i + 1} 页`);
                const md = buildNotesMarkdown(book, annList, titles);
                try { showToast(await downloadNotes(`${book.title} · 读书笔记.md`, md)); }
                catch (e) { showToast(e instanceof Error ? e.message : '导出失败'); }
              }}
            >
              导出
            </button>
          </footer>
        </>
      ) : null}

      {toast ? <div className="toast reader-toast" role="status">{toast}</div> : null}
    </div>
  );
}
