import { SUPPORTED_FORMATS } from '../engine/bookFormats';
/** 书架：树形分类侧栏 + 树架/网格/列表三视图 + 搜索 + 排序筛选 + 书籍信息编辑（古典宣纸风） */
import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { version as appVersion } from '../../package.json';
import { useLibrary } from '../store/library';
import { platform } from '../platform/web';
import { registerBackHandler } from '../platform/backHandler';
import type { BookMeta, Progress } from '../engine/types';
import { BookCover } from './BookCover';
import { BookPages, useBookPage } from './BookPages';
import { TreeView } from './TreeView';
import { SyncPanel } from './SyncPanel';
import { StatsPanel } from './StatsPanel';
import { BookEditPanel } from './BookEditPanel';
import { BackupPanel } from './BackupPanel';
import { LibrarySearchPanel } from './LibrarySearchPanel';
import { RecycleBinPanel } from './RecycleBinPanel';
import { Panel } from './Panel';
import { UpdatePanel } from './UpdatePanel';
import { hasAppUpdate, useAppUpdate } from '../store/appUpdate';
import { updateTarget } from '../engine/appUpdate';
import { CategoryPanel } from './CategoryPanel';
import { useSync } from '../sync/sync';
const NetworkLibraryPanel = lazy(() => import('./NetworkLibraryPanel').then((m) => ({ default: m.NetworkLibraryPanel })));
const NotesManagerPanel = lazy(() => import('./NotesManagerPanel').then((m) => ({ default: m.NotesManagerPanel })));

type SortKey = 'recent' | 'added' | 'title' | 'progress';
type FilterKey = 'all' | 'unread' | 'reading' | 'done';
const FILTER_LABEL: Record<FilterKey, string> = { all: '全部', unread: '未读', reading: '在读', done: '读完' };

const PALETTES: Array<[string, string]> = [
  ['#B03A2E', '#F7F2E7'],
  ['#2C5F7C', '#EAF1F5'],
  ['#5B6B3A', '#F1F4E6'],
  ['#7A5230', '#F6EFE4'],
];

function paletteOf(id: string): [string, string] {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function TreeLogo() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
      <path d="M13 24 V13 M13 13 L7 7 M13 13 L19 8 M13 13 V5" stroke="#7A5230" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <circle cx="7" cy="5.5" r="2.4" fill="#B03A2E" />
      <circle cx="19.5" cy="6.5" r="2.4" fill="#5B6B3A" />
      <circle cx="13" cy="3" r="2.4" fill="#2C5F7C" />
    </svg>
  );
}

function fmtSize(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function Bookshelf({ onOpen }: { onOpen: (id: string) => void }) {
  const books = useLibrary((st) => st.books);
  const libraryReady = useLibrary((st) => st.ready);
  const libraryError = useLibrary((st) => st.error);
  const nodes = useLibrary((st) => st.nodes);
  const importFiles = useLibrary((st) => st.importFiles);
  const importSample = useLibrary((st) => st.importSample);
  const removeBook = useLibrary((st) => st.removeBook);

  const [selNode, setSelNode] = useState<string | 'all'>('all');
  const [view, setView] = useState<'tree' | 'grid' | 'list'>('grid');
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const collator = useMemo(() => new Intl.Collator('zh-Hans-CN'), []);
  const nodeCounts = useMemo(() => { const counts = new Map<string | null, number>(); for (const b of books) counts.set(b.nodeId, (counts.get(b.nodeId) ?? 0) + 1); return counts; }, [books]);
  const [progMap, setProgMap] = useState<Record<string, Progress>>({});
  const [sort, setSort] = useState<SortKey>('recent');
  const [viewReady, setViewReady] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [editBook, setEditBook] = useState<BookMeta | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [err, setErr] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const importWork = useRef<AbortController | null>(null);
  useEffect(() => () => importWork.current?.abort(), []);
  const [categories, setCategories] = useState<{ ids?: string[] } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [librarySearchOpen, setLibrarySearchOpen] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [shelfPanel, setShelfPanel] = useState<'more' | 'manage' | 'categories' | 'layout' | 'about' | 'updates' | null>(null);
  const updateAvailable = useAppUpdate(st => hasAppUpdate(st, updateTarget()));
  const [categoryQuery, setCategoryQuery] = useState('');
  const mainRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const strip = mainRef.current?.querySelector<HTMLElement>('.m-chips');
    const active = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (strip && active) {
      const box = active.getBoundingClientRect(), viewport = strip.getBoundingClientRect();
      if (box.left < viewport.left || box.right > viewport.right) strip.scrollLeft += box.left - viewport.left;
    }
  }, [selNode, nodes]);
  const syncStatus = useSync((st) => st.status);
  const lastSyncAt = useSync((st) => st.lastSyncAt);
  const isDesktopApp = '__TAURI_INTERNALS__' in window && !/Android|iPhone|iPad/i.test(navigator.userAgent);

  /** 返回键：先关打开的面板/菜单，裸态交给 App 的退出确认 */
  const bsState = useRef({ statsOpen, syncOpen, menuId, editBook, backupOpen, categories });
  bsState.current = { statsOpen, syncOpen, menuId, editBook, backupOpen, categories };
  useEffect(
    () =>
      registerBackHandler(() => {
        const st = bsState.current;
        if (st.categories) return true; // CategoryPanel owns closing and protects pending writes.
        if (st.editBook) {
          setEditBook(null);
          return true;
        }
        if (st.backupOpen) {
          setBackupOpen(false);
          return true;
        }
        if (st.statsOpen) {
          setStatsOpen(false);
          return true;
        }
        if (st.syncOpen) {
          setSyncOpen(false);
          return true;
        }
        if (st.menuId) {
          setMenuId(null);
          return true;
        }
        return false;
      }),
    [],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const m: Record<string, Progress> = {};
      const entries = await platform.kvEntries<Progress>('progress:');
      for (const { k, v } of entries) if (v) m[k.slice('progress:'.length)] = v;
      if (alive) setProgMap(m);
    })();
    return () => {
      alive = false;
    };
  }, [books]);

  // 排序/筛选偏好持久化
  useEffect(() => {
    void platform.kvGet<{ sort?: SortKey; filter?: FilterKey; view?: 'tree' | 'grid' | 'list' }>('shelfView').then((v) => {
      if (v?.sort) setSort(v.sort);
      if (v?.filter) setFilter(v.filter);
      if (v?.view) setView(v.view);
      setViewReady(true);
    });
  }, []);
  useEffect(() => {
    if (viewReady) void platform.kvSet('shelfView', { sort, filter, view });
  }, [sort, filter, view, viewReady]);

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    let list = selNode === 'all' ? [...books] : books.filter((b) => selNode === '__unfiled' ? !b.nodeId : b.nodeId === selNode);
    if (kw) {
      list = list.filter(
        (b) => b.title.toLowerCase().includes(kw) || b.author.toLowerCase().includes(kw),
      );
    }
    if (filter !== 'all') {
      list = list.filter((b) => {
        const pct = progMap[b.id]?.pct ?? 0;
        const done = b.completed ?? pct >= 0.99;
        if (filter === 'unread') return !done && pct <= 0.01;
        if (filter === 'reading') return !done && pct > 0.01;
        return done;
      });
    }
    const lastRead = (b: BookMeta) => progMap[b.id]?.updatedAt ?? 0;
    if (sort === 'recent') list.sort((a, b) => lastRead(b) - lastRead(a) || b.addedAt - a.addedAt);
    else if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === 'title') list.sort((a, b) => collator.compare(a.title, b.title));
    else list.sort((a, b) => (progMap[b.id]?.pct ?? 0) - (progMap[a.id]?.pct ?? 0));
    return list;
  }, [books, selNode, query, filter, sort, progMap, collator]);
  const bookPage = useBookPage(filtered, JSON.stringify([selNode, query, filter, sort, view]), 60, true);

  const recent = useMemo(() => books.filter((b) => progMap[b.id]?.pct > 0 && !(b.completed ?? progMap[b.id]?.pct >= .99)).sort((a, b) => progMap[b.id].updatedAt - progMap[a.id].updatedAt)[0], [books, progMap]);

  const pctMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [id, p] of Object.entries(progMap)) m[id] = p.pct;
    for (const book of books) if (book.completed !== undefined) m[book.id] = book.completed ? 1 : Math.min(m[book.id] ?? 0, 0.98);
    return m;
  }, [progMap, books]);

  const doImport = async (files: FileList | null) => {
    if (!files?.length || importing) return;
    setImporting(true);
    try {
      const controller = new AbortController(); importWork.current = controller;
      const result = await importFiles(Array.from(files), (done, total) => setImportProgress('已处理 ' + done + ' / ' + total + ' 本'), controller.signal);
      setImportProgress((controller.signal.aborted ? '已停止，' : '') + '已导入 ' + result.imported + ' 本' + (result.failed.length ? '，失败 ' + result.failed.length + ' 本' : ''));
      if (result.failed.length) throw new Error(result.failed.slice(0, 5).join('；') + (result.failed.length > 5 ? '；其余失败文件请分批重试' : ''));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTimeout(() => setErr(''), 6000);
    }
    if (fileRef.current) fileRef.current.value = '';
    importWork.current = null; setImporting(false);
  };

  const onAddNode = () => setCategories({});
  const chooseCategory = (id: string) => { setSelNode(id); setShelfPanel(null); setCategoryQuery(''); };
  const changePage = (n: number) => { bookPage.go(n); mainRef.current?.scrollTo({ top: 0 }); };
  const panelTitle = { more: '更多', manage: '书架管理', categories: '全部分类', layout: '排列书架', about: '关于阅读树', updates: '检查更新' };
  const panelAction = (action: () => void) => { setShelfPanel(null); action(); };

  const nodeDepth = (n: { parentId: string | null }): number => {
    let d = 0;
    let p = n.parentId;
    const seen = new Set<string>();
    while (p && !seen.has(p)) {
      seen.add(p);
      d += 1;
      p = nodes.find((x) => x.id === p)?.parentId ?? null;
    }
    return d;
  };

  useEffect(() => {
    if (selNode !== 'all' && selNode !== '__unfiled' && !nodes.some((n) => n.id === selNode)) setSelNode('all');
  }, [nodes, selNode]);

  const renderBookActions = (b: BookMeta) => (
    <div className="book-menu">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setEditBook(b);
          setMenuId(null);
        }}
      >
        编辑信息
      </button>
      <button onClick={() => { setMenuId(null); setCategories({ ids: [b.id] }); }}>移入分类</button>
      <button onClick={() => void useLibrary.getState().saveBookInfo(b.id, { completed: !(b.completed ?? (progMap[b.id]?.pct ?? 0) >= .99) }).then(() => setMenuId(null)).catch(() => setErr('阅读状态保存失败，请重试'))}>{(b.completed ?? (progMap[b.id]?.pct ?? 0) >= .99) ? '标记未读完' : '标记已读完'}</button>
      <button
        className="danger"
        onClick={(e) => {
          e.stopPropagation();
          if (window.confirm(`删除《${b.title}》？仅移出书架，不删源文件。`)) void removeBook(b.id).then(() => setMenuId(null)).catch(() => setErr('删除失败，请重试'));
        }}
      >
        删除
      </button>
    </div>
  );

  return (
    <div className="shelf">
      <input
        ref={fileRef}
        type="file"
        accept=".ofd,.odt,.html,.htm,.xhtml,.txt,.md,.markdown,.epub,.docx,.mobi,.azw3,.azw,.prc,.pdf,.fb2,.fb2.zip,.cbz,.zip,.updb,application/epub+zip,application/x-mobipocket-ebook,application/pdf,text/plain,text/markdown,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream"
        multiple
        hidden
        onChange={(e) => void doImport(e.target.files)}
      />
      <aside className="shelf-side">
        <div className="side-brand">
          <TreeLogo />
          <span>分类树</span>
        </div>
        <div className="side-categories">
          <button
            className={`side-item ${selNode === 'all' ? 'active' : ''}`}
            onClick={() => setSelNode('all')}
          >
            全部藏书<span className="count">{books.length}</span>
          </button>
          <button className={`side-item ${selNode === '__unfiled' ? 'active' : ''}`} onClick={() => setSelNode('__unfiled')}>未分类<span className="count">{nodeCounts.get(null) ?? 0}</span></button>
          {nodes.map((n) => (
            <div key={n.id} className={`side-row ${selNode === n.id ? 'active' : ''}`}>
              <button className="side-item" style={{ paddingLeft: 14 + nodeDepth(n) * 14 }} onClick={() => setSelNode(n.id)}>
                {n.name}
                <span className="count">{nodeCounts.get(n.id) ?? 0}</span>
              </button>
            </div>
          ))}
        </div>
        <button className="side-add" onClick={onAddNode}>
          分类管理
        </button>
        <button className="side-foot side-foot-btn" onClick={() => setNetworkOpen(true)}>网络书库</button>
      </aside>

      <main className="shelf-main" ref={mainRef}>
        {notesOpen ? <Suspense fallback={<Panel label="笔记管理" onClose={() => setNotesOpen(false)}><p className="panel-intro">正在打开笔记…</p></Panel>}><NotesManagerPanel onClose={() => setNotesOpen(false)} /></Suspense> : null}
        {networkOpen ? <Suspense fallback={<Panel label="网络书库" onClose={() => setNetworkOpen(false)}><p className="panel-intro">正在打开书库…</p></Panel>}><NetworkLibraryPanel onClose={() => setNetworkOpen(false)} /></Suspense> : null}
        <header className="shelf-head">
          <div className="brand"><TreeLogo /><div><h1>阅读树</h1><p>一卷在手，静读有时</p></div></div>
          <div className="head-actions">
            <button className="shelf-import" aria-label="导入书籍" disabled={importing || !libraryReady} onClick={() => fileRef.current?.click()}><span aria-hidden="true">＋</span>{importing ? '导入中' : '加书'}</button>
            <button className="shelf-more" aria-label="更多" onClick={() => setShelfPanel('more')}>⋯</button>
          </div>
          {books.length > 0 ? <div className="shelf-search"><span aria-hidden="true">⌕</span><input className="search-input" aria-label="搜索书名或作者" placeholder="搜书名 / 作者" value={q} onChange={(e) => setQ(e.target.value)} />{q ? <button aria-label="清空搜索" onClick={() => setQ('')}>×</button> : null}</div> : null}
        </header>

        {recent && !q.trim() && filter === 'all' && selNode === 'all' ? (
          <button className="continue-reading" onClick={() => onOpen(recent.id)} aria-label={'继续阅读《' + recent.title + '》'}>
            <span className="continue-seal">续读</span><span className="continue-title">{recent.title}<small>{recent.author || '佚名'}</small></span>
            <span className="continue-progress">已读 {Math.round(progMap[recent.id].pct * 100)}%<span aria-hidden="true"> 〉</span></span>
          </button>
        ) : null}

        {books.length > 0 ? <>
          <div className="m-bar">
            <div className="m-chips" aria-label="书籍分类">
              <button className={'m-chip ' + (selNode === 'all' ? 'active' : '')} aria-pressed={selNode === 'all'} onClick={() => setSelNode('all')}>全部 {books.length}</button>
              <button className={'m-chip ' + (selNode === '__unfiled' ? 'active' : '')} aria-pressed={selNode === '__unfiled'} onClick={() => setSelNode('__unfiled')}>未分类 {nodeCounts.get(null) ?? 0}</button>
              {nodes.map((n) => <button key={n.id} className={'m-chip ' + (selNode === n.id ? 'active' : '')} aria-pressed={selNode === n.id} onClick={() => setSelNode(n.id)}>{n.name} {nodeCounts.get(n.id) ?? 0}</button>)}
            </div>
            <button className="all-categories" onClick={() => { setCategoryQuery(''); setShelfPanel('categories'); }}>全部分类 <span aria-hidden="true">⌄</span></button>
          </div>
          <div className="shelf-toolbar">
            <div className="f-chips">{(['all', 'unread', 'reading', 'done'] as FilterKey[]).map((f) => <button key={f} className={'f-chip ' + (filter === f ? 'active' : '')} aria-pressed={filter === f} onClick={() => setFilter(f)}>{FILTER_LABEL[f]}</button>)}</div>
            <div className="shelf-controls"><button onClick={() => setShelfPanel('layout')}>排列</button><button onClick={() => setShelfPanel('manage')}>管理</button></div>
          </div>
          <div className="shelf-summary"><span className="shelf-location">{selNode === 'all' ? '全部藏书' : selNode === '__unfiled' ? '未分类' : nodes.find((n) => n.id === selNode)?.name} · {filtered.length} 本</span>{view !== 'tree' ? <BookPages {...bookPage} go={changePage} compact /> : null}</div>
        </> : null}
        {importProgress ? <div className="import-progress" role="status"><span>{importProgress}</span>{importing ? <button onClick={() => importWork.current?.abort()}>停止后续导入</button> : <button onClick={() => setImportProgress('')}>收起</button>}</div> : null}
        {!libraryReady ? <div className="empty"><p className="empty-line">{libraryError ? '书库暂时无法打开' : '正在打开书库…'}</p><p className="empty-hint">{libraryError || '首次整理大量封面可能需要一些时间，请保持应用打开。'}</p>{libraryError ? <button onClick={() => void useLibrary.getState().init()}>重新读取</button> : null}</div> : filtered.length === 0 && books.length > 0 ? (
          <div className="empty">
            <p className="empty-line">没有找到符合条件的书</p>
            <p className="empty-hint">换个关键词，或看看其他分类</p>
            <button className="primary" onClick={() => { setQ(''); setFilter('all'); setSelNode('all'); }}>查看全部藏书</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <div className="empty-book" aria-hidden="true"><span>藏书</span></div><p className="empty-line">为书架添一卷书</p>
            <div className="empty-actions">
              <button className="primary" disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? '正在导入…' : '导入第一本书'}
              </button>
              <button onClick={() => setNetworkOpen(true)}>网络找书</button>
            </div>
            <p className="empty-hint">导入本地好书，或从网络书库开始。</p><button className="empty-sample" onClick={() => void importSample()}>先读一本示例古籍 →</button>
          </div>
        ) : view === 'tree' ? (
          <div className="tree-view">
            <TreeView books={filtered} nodes={nodes} pct={pctMap} onOpen={onOpen} />
          </div>
        ) : view === 'grid' ? (
          <div className="grid">
            {bookPage.items.map((b) => {
              const [bg, fg] = paletteOf(b.id);
              return (
                <div key={b.id} className="cell">
                  <button className="book-open" onClick={() => onOpen(b.id)} aria-label={`阅读《${b.title}》`}>
                    <BookCover book={b} background={bg} color={fg} />
                    <div className="cell-meta">
                      <span className="cell-title">{b.title}</span>
                      <span className="cell-sub">
                        {(b.completed ?? (progMap[b.id]?.pct ?? 0) >= .99) ? '已读完' : progMap[b.id] ? `已读 ${Math.round(progMap[b.id].pct * 100)}%` : b.author || b.format.toUpperCase()}
                      </span>
                    </div>
                  </button>
                  <button
                    aria-label={`管理《${b.title}》`}
                    className="cell-more"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuId(menuId === b.id ? null : b.id);
                    }}
                  >
                    ⋯
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="list">
            {bookPage.items.map((b) => (
              <div key={b.id} className="row">
                <button className="row-open" onClick={() => onOpen(b.id)} aria-label={`阅读《${b.title}》`}>
                  <span className="row-title">{b.title}</span>
                  <span className="row-author">{b.author || '佚名'}</span>
                  <span className="row-sub">
                    {(b.completed ?? (progMap[b.id]?.pct ?? 0) >= .99) ? '已读完 · ' : ''}{b.format.toUpperCase()} · {fmtSize(b.size)}
                  </span>
                </button>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="row-more" aria-label={`管理《${b.title}》`} onClick={() => setMenuId(menuId === b.id ? null : b.id)}>···</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {libraryReady && view !== 'tree' && filtered.length > 0 ? <BookPages {...bookPage} go={changePage} /> : null}
        {shelfPanel ? <Panel label={panelTitle[shelfPanel]} onClose={() => setShelfPanel(null)}>
          <div className="drawer-head"><h3>{panelTitle[shelfPanel]}</h3><button onClick={() => setShelfPanel(null)}>关闭</button></div>
          {shelfPanel === 'more' ? <div className="shelf-menu-list">
            <button onClick={() => panelAction(() => setNetworkOpen(true))}>网络书库<span>发现与下载好书</span></button>
            <button onClick={() => panelAction(() => setNotesOpen(true))}>笔记管理<span>集中阅读划线与批注</span></button>
            <button onClick={() => panelAction(() => setLibrarySearchOpen(true))}>跨书全文检索<span>在本地藏书中查找字句</span></button>
            <button onClick={() => panelAction(() => setStatsOpen(true))}>阅读统计<span>看看读过的时光</span></button>
            <button onClick={() => panelAction(() => setBackupOpen(true))}>备份 / 恢复<span>保存藏书与笔记</span></button>
            <button onClick={() => panelAction(() => setRecycleOpen(true))}>回收站<span>恢复 30 天内删除的书籍</span></button>
            <button onClick={() => panelAction(() => setSyncOpen(true))}><span className={'sync-dot d-' + syncStatus} />WebDAV 同步<span>{syncStatus === 'syncing' ? '正在同步' : lastSyncAt ? '上次同步 ' + new Date(lastSyncAt).toLocaleString('zh-CN') : '尚未同步'}</span></button>
            {!books.length ? <button onClick={() => panelAction(onAddNode)}>分类管理<span>提前整理你的书架</span></button> : null}
            <button onClick={() => setShelfPanel('about')}>关于阅读树<span>版本与使用说明</span></button>
            <button aria-label={updateAvailable ? '检查更新，有新版本' : '检查更新'} onClick={() => setShelfPanel('updates')}>检查更新{updateAvailable ? <i className="update-dot" aria-hidden="true" /> : null}<span>{updateAvailable ? '发现新版本，点此查看' : '版本检查与更新偏好'}</span></button>
            {isDesktopApp ? <button onClick={() => void import('@tauri-apps/api/core').then(({ invoke }) => invoke('exit_desktop')).catch(() => setErr('退出失败，请从托盘菜单重试'))}>退出阅读树<span>结束程序；关闭窗口则收至托盘</span></button> : null}
          </div> : null}
          {shelfPanel === 'manage' ? <div className="shelf-menu-list"><button onClick={() => panelAction(onAddNode)}>分类管理<span>新建、改名与整理分类</span></button><button onClick={() => panelAction(() => setCategories({ ids: [] }))}>批量整理<span>选择多本书，移入分类</span></button></div> : null}
          {shelfPanel === 'updates' ? <UpdatePanel /> : null}
          {shelfPanel === 'layout' ? <>
            <div className="set-group"><label htmlFor="shelf-sort">排序方式</label><select id="shelf-sort" className="field shelf-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}><option value="recent">最近阅读</option><option value="added">添加时间</option><option value="title">书名</option><option value="progress">阅读进度</option></select></div>
            <div className="set-group"><label>书架视图</label><div className="seg shelf-view">{(['grid', 'list', 'tree'] as const).map((v) => <button key={v} className={view === v ? 'active' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{{ grid: '网格', list: '列表', tree: '树架' }[v]}</button>)}</div></div>
            <button className="primary" onClick={() => setShelfPanel(null)}>完成</button>
          </> : null}
          {shelfPanel === 'categories' ? <>
            <input className="field category-find" aria-label="查找分类" placeholder="查找分类" value={categoryQuery} onChange={(e) => setCategoryQuery(e.target.value)} />
            <div className="category-browser">
              {!categoryQuery.trim() ? <><button aria-pressed={selNode === 'all'} onClick={() => chooseCategory('all')}>全部藏书<span>{books.length}</span></button><button aria-pressed={selNode === '__unfiled'} onClick={() => chooseCategory('__unfiled')}>未分类<span>{nodeCounts.get(null) ?? 0}</span></button></> : null}
              {nodes.filter((n) => n.name.toLowerCase().includes(categoryQuery.trim().toLowerCase())).map((n) => <button key={n.id} aria-pressed={selNode === n.id} onClick={() => chooseCategory(n.id)}><span className="category-browser-name">{n.name}<small>{nodes.find((p) => p.id === n.parentId)?.name}</small></span><span>{nodeCounts.get(n.id) ?? 0}</span></button>)}
              {categoryQuery.trim() && !nodes.some((n) => n.name.toLowerCase().includes(categoryQuery.trim().toLowerCase())) ? <p className="panel-empty">没有找到这个分类</p> : null}
            </div><button className="category-manage-link" onClick={() => panelAction(onAddNode)}>分类管理 →</button>
          </> : null}
          {shelfPanel === 'about' ? <div className="shelf-about"><TreeLogo /><h2>阅读树</h2><p>一卷在手，静读有时</p><p aria-label={'版本 ' + appVersion}>v{appVersion} · 清简书架版</p><p>阅读树是一款清简、古典的个人阅读与藏书软件。将书留在本地，离线也能静心阅读；横排与竖排自由切换，繁简转换随心选择，让古籍与新书各得其宜。</p><p>每本书都可独立设置阅读版式，自定义字体、字号、行距与留白。划线、批注与书签留住所思所感，让阅读更贴近自己的习惯。</p><p>支持上万本书籍的书架管理，以分类与搜索整理个人藏书；接入网络书库，发现经典与公版好书。可通过坚果云、InfiniCLOUD、Nextcloud 等任意标准 WebDAV 服务同步书籍、笔记与阅读进度，支持多个云盘同时同步、互为备份，在电脑与安卓设备间接续阅读。</p><p>长按正文选择文字，拖动选区端点划线；到本页末行后继续拖动，才会翻到下一页。</p><p>开发者：朱振坚（公号小二菜园）</p><p>支持 {SUPPORTED_FORMATS}。</p><p>支持未加密电子书。Word 请使用 DOCX（不支持旧 DOC）；ZIP 仅支持 FB2.ZIP。PDF 可原版阅读，文字版可重排；OFD 支持文字及 PNG/JPEG 图片重排，暂不含 OCR、签章与矢量图。</p><button onClick={() => setShelfPanel('more')}>返回更多</button></div> : null}
        </Panel> : null}

        {menuId && books.find((b) => b.id === menuId) ? <Panel label="书籍管理" onClose={() => setMenuId(null)}><div className="drawer-head"><h3>书籍管理</h3><button onClick={() => setMenuId(null)}>关闭</button></div><p className="panel-intro">{books.find((b) => b.id === menuId)!.title}</p>{renderBookActions(books.find((b) => b.id === menuId)!)}</Panel> : null}
        {categories ? <CategoryPanel initialIds={categories.ids} onClose={() => setCategories(null)} /> : null}
        {err ? <div className="toast">{err}</div> : null}
        {syncOpen ? <SyncPanel onClose={() => setSyncOpen(false)} /> : null}
        {statsOpen ? <StatsPanel onClose={() => setStatsOpen(false)} /> : null}
        {backupOpen ? <BackupPanel onClose={() => setBackupOpen(false)} /> : null}
        {recycleOpen ? <RecycleBinPanel onClose={() => setRecycleOpen(false)} /> : null}
        {librarySearchOpen ? <LibrarySearchPanel onClose={() => setLibrarySearchOpen(false)} onOpen={onOpen} /> : null}
        {editBook ? <BookEditPanel book={editBook} nodes={nodes} onClose={() => setEditBook(null)} /> : null}
      </main>
    </div>
  );
}
