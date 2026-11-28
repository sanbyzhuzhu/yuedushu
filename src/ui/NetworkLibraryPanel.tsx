import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import { platform } from '../platform/web';
import { useLibrary } from '../store/library';
import { downloadBook, downloadChapters, fetchCatalog, requestBytes, parseSourcesAsync, validateSourcesAsync, mergeSources, MAX_SOURCE_FILE_BYTES, searchSource, sourceHasSearchPages, secureUrl, webdavUrl, sourceChapters, GUTENBERG_POPULAR, GUTENBERG_CHINESE, gutenbergSearch, GXHJ_TEXT_SOURCE } from '../engine/networkLibrary';
import { BOOK_WEBSITES, openBookWebsite } from '../platform/bookWebsites';
import { CLASSICS_PRESETS, downloadPublicText } from '../engine/publicClassics';
import { decodeText } from '../engine/txt';
import { parseLibraryQr } from '../engine/libraryQr';
import { hasLibraryCamera, scanLibraryCamera, scanLibraryImage } from '../platform/libraryScanner';
import { APP_VERSION } from '../engine/appUpdate';
import { SourcePicker } from './SourcePicker';
import { SourceManager } from './SourceManager';
import curatedSources from '../engine/curatedSources.json';
import { PoetryPicker } from './PoetryPicker';
import { parsePoetryCollection, poetryBook } from '../engine/poetryCollection';
import type { PoetryCollection, Poem } from '../engine/poetryCollection';
import { saveExport } from '../engine/fileExport';
import type { BookSource, Catalog, CatalogEntry, Credentials, LibraryKind } from '../engine/networkLibrary';

interface SavedCatalog { name: string; url: string; kind: LibraryKind }
async function openCatalogWebsite(address: string) {
  const site = (Object.keys(BOOK_WEBSITES) as (keyof typeof BOOK_WEBSITES)[]).find(key => new URL(BOOK_WEBSITES[key]).origin === new URL(address).origin);
  if (!site) throw new Error('请从预置网站入口打开此书库');
  await openBookWebsite(site, address);
}
export function NetworkLibraryPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'catalog' | 'source' | 'link'>('catalog');
  const [kind, setKind] = useState<LibraryKind>('opds');
  const [address, setAddress] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [saved, setSaved] = useState<SavedCatalog[]>([]);
  const [sources, setSources] = useState<BookSource[]>([]);
  const [ready, setReady] = useState(false);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [sourcesReady, setSourcesReady] = useState(false);
  const [poetry, setPoetry] = useState<{ entry: CatalogEntry; collection: PoetryCollection; original: File } | null>(null);
  const [selectedJson, setSelectedJson] = useState<Set<string>>(new Set());
  const [mergeTitle, setMergeTitle] = useState('诗词合辑');
  const [query, setQuery] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [results, setResults] = useState<CatalogEntry[] | null>(null);
  const [selected, setSelected] = useState<CatalogEntry | null>(null);
  const [chapters, setChapters] = useState<CatalogEntry[]>([]);
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(20);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [filename, setFilename] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [filter, setFilter] = useState('');
  const [publicQuery, setPublicQuery] = useState('');
  const [chapterStart, setChapterStart] = useState(1);
  const [chapterCount, setChapterCount] = useState(20);
  const work = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const qrRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const poetryRef = useRef<HTMLDivElement>(null);
  const credentials = useRef<Credentials>();
  const importFile = useLibrary((s) => s.importFile);
  const source = sources[sourceIndex];
  useEffect(() => { if (busy || message || error) statusRef.current?.scrollIntoView({ block: 'nearest' }); }, [busy, message, error]);
  useEffect(() => { if (poetry) poetryRef.current?.scrollIntoView({ block: 'start' }); }, [poetry]);
  useEffect(() => {
    mounted.current = true;
    void platform.kvGet<SavedCatalog[]>('networkCatalogs').then(catalogs => {
      if (!mounted.current) return;
      setSaved(catalogs || []);
      setReady(true);
    }).catch(() => { if (mounted.current) { setReady(true); setError('未能读取已保存的书库'); } });
    return () => { mounted.current = false; work.current?.abort(); };
  }, []);
  useEffect(() => {
    if (tab === 'source' && ready && !sourcesReady) void run(loadStoredSources);
  }, [tab, ready, sourcesReady]);
  const close = () => { work.current?.abort(); onClose(); };
  async function run(action: (signal: AbortSignal) => Promise<void>) {
    if (work.current) return;
    const controller = new AbortController(); work.current = controller;
    setBusy(true); setMessage(''); setError(''); setProgress('正在连接…');
    try { await action(controller.signal); }
    catch (e) { if (mounted.current) setError(controller.signal.aborted ? '已取消' : e instanceof Error ? e.message : String(e)); }
    finally { work.current = null; if (mounted.current) { setBusy(false); setProgress(''); } }
  }
  async function browse(url: string, nextHistory: string[], signal: AbortSignal, auth = credentials.current, browseKind = kind) {
    const data = await fetchCatalog(url, browseKind, signal, auth);
    const records = await platform.kvGet<Record<string,string>>('networkChapterDownloads') || {};
    const books = new Set(useLibrary.getState().books.map(b=>b.id));
    const firstUnread = data.chapterBook?.chapters.findIndex(c=>!books.has(records[c.url]));
    signal.throwIfAborted(); setCatalog(data); setPoetry(null); setSelectedJson(new Set()); setMergeTitle(data.title + ' · 合辑'); setHistory([...nextHistory, data.url]); setFilter(''); setChapterStart(firstUnread !== undefined && firstUnread >= 0 ? firstUnread + 1 : 1);
  }
  async function importChapters(book: CatalogEntry, chapters: CatalogEntry[], signal: AbortSignal, sourceOverride?: BookSource) {
    const records = await platform.kvGet<Record<string,string>>('networkChapterDownloads') || {};
    const books = new Set(useLibrary.getState().books.map(b=>b.id));
    const remaining = chapters.filter(c=>!books.has(records[c.url]));
    signal.throwIfAborted();
    if (!remaining.length) {setMessage('所选章节已在书架中，无需重复下载');return;}
    const file = sourceOverride || remaining[0].textPage === 'gxhj'
      ? await downloadChapters(sourceOverride || GXHJ_TEXT_SOURCE, book, remaining, signal, setProgress)
      : await downloadPublicText(book, remaining, signal, setProgress);
    signal.throwIfAborted();setProgress('正在整理入架…');const imported = await importFile(file);
    for (const chapter of remaining) records[chapter.url] = imported.id;
    // Book import is complete before its receipt is saved; deleted books become downloadable again.
    try { await platform.kvSet('networkChapterDownloads', records); }
    catch {setMessage('《'+imported.title+'》已加入书架，但下载记录未保存，下次可能重复下载');return;}
    if (mounted.current) setMessage('《'+imported.title+'》已加入书架'+(remaining.length<chapters.length?'，跳过 '+(chapters.length-remaining.length)+' 个已下载章节':''));
  }
  function openGutenberg(url: string) {
    openPreset('古腾堡', url, 'opds');
  }
  function openPreset(title: string, url: string, type: LibraryKind) {
    setKind(type); setAddress(url); setName(title); setUsername(''); setPassword(''); credentials.current = undefined;
    setCatalog(null); setHistory([]);
    void run((signal) => browse(url, [], signal, undefined, type));
  }
  async function acquire(entry: CatalogEntry, signal: AbortSignal) {
    if (entry.textPage === 'poetry') {
      setPoetry(null);
      setProgress('正在读取 JSON 诗词…');
      const original = await fetchJsonFile(entry, signal);
      const collection = parsePoetryCollection(decodeText(await original.arrayBuffer()));
      signal.throwIfAborted(); setPoetry({ entry, collection, original }); return;
    }
    if (entry.textPage) { await importChapters({...entry,title:catalog?.chapterBook ? `${catalog.chapterBook.title} · ${entry.title}` : entry.title},[entry],signal);return; }
    const file = await downloadBook(entry.url, entry.filename || '', signal, credentials.current, (bytes) => setProgress(`已下载 ${(bytes / 1024 / 1024).toFixed(1)} MB`), tab === 'catalog' && kind === 'webdav');
    signal.throwIfAborted(); setProgress('正在整理入架…'); const book = await importFile(file);
    if (mounted.current) setMessage(`《${book.title}》已加入书架`);
  }
  async function fetchJsonFile(entry: CatalogEntry, signal: AbortSignal) {
    const response = await requestBytes(entry.url, { signal, limit: 50 * 1024 * 1024, progress: bytes => setProgress(`已读取 JSON ${(bytes / 1024 / 1024).toFixed(1)} MB`) });
    signal.throwIfAborted();
    const name = (entry.filename || entry.title || '公开数据.json').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
    return new File([response.data], /\.json$/i.test(name) ? name : name + '.json', { type: 'application/json' });
  }
  async function saveRawJson(entry: CatalogEntry, signal: AbortSignal) {
    const file = poetry?.entry.url === entry.url ? poetry.original : await fetchJsonFile(entry, signal);
    signal.throwIfAborted(); setProgress('正在保存原始 JSON…');
    const path = await saveExport(file, file.name); setMessage('原始 JSON 已保存：' + path);
  }
  async function importPoems(title: string, poems: Poem[], signal: AbortSignal) {
    if (!poetry) return;
    setProgress('正在合并诗词…');
    const file = await poetryBook(title, poems, poetry.entry.url, signal);
    signal.throwIfAborted(); setProgress('正在整理入架…');
    const book = await importFile(file); setMessage(`《${book.title}》已加入书架（${poems.length} 篇）`);
  }
  async function saveCatalog() {
    const url = (kind === 'webdav' ? webdavUrl : secureUrl)(address.trim());
    const item = { name: name.trim() || new URL(url).hostname, url, kind };
    const next = [...saved.filter((c) => c.url !== url || c.kind !== kind), item];
    await platform.kvSet('networkCatalogs', next); setSaved(next); setMessage('书库地址已收藏，账号密码仅在本次面板中使用');
  }
  async function loadStoredSources(signal: AbortSignal) {
    setProgress('正在读取已保存的书源…');
    const stored = await platform.kvGet<BookSource[]>('networkSources');
    const parsed = await validateSourcesAsync(stored || [], signal, setProgress);
    signal.throwIfAborted(); setSources(parsed.sources); setSourcesReady(true);
  }
  async function loadSources(file: File, signal: AbortSignal) {
    if (file.size > MAX_SOURCE_FILE_BYTES) throw new Error('书源文件超过 50 MB，请拆分后导入');
    setProgress('正在读取书源文件…');
    const parsed = await parseSourcesAsync(decodeText(await file.arrayBuffer()), signal, setProgress);
    setProgress('正在合并书源…');
    const next = await mergeSources(sources, parsed.sources, signal);
    signal.throwIfAborted(); setProgress('正在保存书源…');
    await platform.kvSet('networkSources', next); setSources(next); setResults(null); setSelected(null); setSourceIndex(0);
    setMessage(`已导入 ${parsed.sources.length} 个兼容书源${parsed.rejected.length ? `，跳过 ${parsed.rejected.length} 个` : ''}`);
    if (parsed.rejected.length) setError(parsed.rejected.slice(0, 8).join('\n') + (parsed.rejected.length > 8 ? '\n其余不兼容书源已跳过' : ''));
  }
  function applyScan(text: string, signal: AbortSignal) {
    const result = parseLibraryQr(text); signal.throwIfAborted();
    setKind(result.kind); setAddress(result.url); setName(result.name);
    setUsername(''); setPassword(''); credentials.current = undefined;
    setCatalog(null); setHistory([]);
    setMessage('已识别书库地址，请确认类型和地址，再打开书库选择书籍，或收藏地址。');
  }
  return <Panel label="网络书库" onClose={close}>
    <div className="drawer-head"><h3>网络书库 · v{APP_VERSION}</h3><button onClick={close}>关闭</button></div>
    <div className="network-actions"><button className="primary" disabled={busy} onClick={() => setTab('source')}>书源管理 · 检测/清理</button></div>
    <p className="panel-intro">远方藏书，取一卷入架。只下载你选择的书。<small> v{APP_VERSION} · 扫码与诗词选集</small></p>
    <div className="network-tabs" role="tablist" aria-label="书库方式">
      {(['catalog', 'source', 'link'] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} disabled={busy} onClick={() => { setTab(value); setPoetry(null); setSelectedJson(new Set()); setError(''); setMessage(''); }}>{value === 'catalog' ? '我的书库' : value === 'source' ? '阅读书源' : '链接导入'}</button>)}
    </div>
    <div className="network-content">
      {tab === 'catalog' ? <>
        <div className="network-actions"><button disabled={busy} onClick={() => hasLibraryCamera() ? void run(async signal => applyScan(await scanLibraryCamera(signal), signal)) : qrRef.current?.click()}>扫码添加书库</button><button disabled={busy} onClick={() => qrRef.current?.click()}>识别二维码图片</button></div>
        <input ref={qrRef} type="file" accept="image/*" aria-label="书库二维码图片" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async signal => applyScan(await scanLibraryImage(file), signal)); }} />
        <section className="network-public"><strong>古腾堡 · 经典藏书</strong><p className="network-hint">直接连接 Project Gutenberg 官方目录，按需下载 EPUB，无需配置书源。</p><div className="network-actions"><button disabled={busy} onClick={() => openGutenberg(GUTENBERG_POPULAR)}>热门藏书</button><button disabled={busy} onClick={() => openGutenberg(GUTENBERG_CHINESE)}>中文藏书</button></div><form className="network-public-search" onSubmit={(e) => { e.preventDefault(); if (publicQuery.trim() && !busy) openGutenberg(gutenbergSearch(publicQuery)); }}><input className="field" aria-label="搜索古腾堡" placeholder="书名 / 作者" value={publicQuery} disabled={busy} onChange={(e) => setPublicQuery(e.target.value)} /><button disabled={busy || !publicQuery.trim()}>搜索</button></form></section>
        <details className="network-discover"><summary>更多书库 · 古籍与公共藏书</summary>
          <div className="network-presets">
            <button disabled={busy} onClick={() => openPreset('国学汉籍', 'https://www.gxhj.com/', 'web')}><strong>国学汉籍</strong><small>浏览古籍目录，选择文字章节入架</small></button>
            {CLASSICS_PRESETS.filter(p => new URL(p.url).hostname !== 'ctext.org').map(p => <button key={p.title} disabled={busy} onClick={() => openPreset(p.title, p.url, 'public')}><strong>{p.title}</strong><small>{p.detail}</small></button>)}
          </div>
          <p className="network-hint">好读可浏览目录与下载页面。影印资源在原站选择文件，下载后从本地导入。</p>
          <div className="network-presets">
            <button disabled={busy} onClick={() => openPreset('好读 · haodoo.net', 'https://haodoo.net/', 'web')}><strong>好读 · haodoo.net</strong><small>分类浏览 · EPUB 直接下载入架</small></button>
            <button disabled={busy} onClick={() => void run(() => openBookWebsite('haodoo-org'))}><strong>好读 · haodoo.org ↗</strong><small>通过浏览器打开，在原站浏览与下载</small></button>
            <button disabled={busy} onClick={() => void run(() => openBookWebsite('ctext'))}><strong>中国哲学书电子化计划 ↗</strong><small>通过浏览器打开，在原站阅读典籍</small></button>
            <button disabled={busy} onClick={() => void run(() => openBookWebsite('national-library'))}><strong>中国国家图书馆 ↗</strong><small>官方入口 · 部分数字资源需要读者登录</small></button>
            {(['shuge','gutenberg-australia','faded-page','gutenberg-canada','internet-archive'] as const).map(site => <button key={site} disabled={busy} onClick={() => void run(() => openBookWebsite(site))}><strong>{{shuge:'书格', 'gutenberg-australia':'古腾堡澳大利亚', 'faded-page':'Faded Page', 'gutenberg-canada':'古腾堡加拿大', 'internet-archive':'Internet Archive'}[site]} ↗</strong><small>在原站浏览与下载</small></button>)}
          </div>
        </details>
        <p className="network-hint">也可连接 OPDS、WebDAV 或公开网页书单。OPDS、WebDAV 和网页书单均支持 HTTP 和 HTTPS。</p>
        {saved.length ? <div className="network-saved">{saved.map((c) => <div key={c.kind + c.url}><button disabled={busy} onClick={() => { setKind(c.kind); setAddress(c.url); setName(c.name); setCatalog(null); setHistory([]); setUsername(''); setPassword(''); credentials.current = undefined; }}>{c.name}<small>{c.kind.toUpperCase()}</small></button><button disabled={busy || !ready} aria-label={`移除书库 ${c.name}`} onClick={() => void run(async () => { const next = saved.filter((x) => x !== c); await platform.kvSet('networkCatalogs', next); setSaved(next); })}>移除</button></div>)}</div> : null}
        <label className="network-label">书库类型<select className="field" value={kind} disabled={busy} onChange={(e) => { setKind(e.target.value as LibraryKind); setCatalog(null); setHistory([]); }}><option value="opds">OPDS 书库</option><option value="webdav">WebDAV 文件夹</option><option value="web">网页书单</option><option value="github">GitHub 公开仓库</option><option value="public">公版经典书库</option></select></label>
        <label className="network-label">书库地址<input className="field" type="url" placeholder={kind === 'webdav' ? 'http://云盘地址:端口/dav/' : kind === 'github' ? 'https://github.com/作者/仓库名' : kind === 'web' ? 'https://公开网页书单' : 'https://你的书库/opds'} value={address} disabled={busy} onChange={(e) => { setAddress(e.target.value); setCatalog(null); setHistory([]); }} /></label>
        {kind === 'webdav' ? <p className="network-hint">填写 WebDAV 文件夹地址，即可浏览子目录，选择书籍下载入架。HTTP 不加密账号与内容，请仅在可信网络使用。手机连接电脑上的服务时，请填电脑的局域网 IP；127.0.0.1 指向手机自身。</p> : null}
        {kind === 'github' ? <p className="network-hint">填写仓库主页，可逐层浏览电子书和 JSON 数据。诗词 JSON 可预览、勾选合并入架，也可保存整个原始 JSON；其他数据结构可下载保存。账号密码不会发送给 GitHub。</p> : null}
        <details><summary>名称与访问账号（可选）</summary><label className="network-label">收藏名称<input className="field" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label><label className="network-label">账号<input className="field" autoComplete="off" value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} /></label><label className="network-label">密码 / 应用密码<input className="field" type="password" autoComplete="off" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></label><p className="network-hint">密码不保存，关闭面板后清除。跨站下载不会携带书库密码。</p></details>
        <div className="network-actions"><button className="primary" disabled={busy || !address.trim()} onClick={() => void run(async (signal) => { const url = (kind === 'webdav' ? webdavUrl : secureUrl)(address.trim()); credentials.current = username ? { origin: new URL(url).origin, username, password } : undefined; await browse(url, [], signal); })}>打开书库</button><button disabled={busy || !ready || !address.trim()} onClick={() => void run(saveCatalog)}>收藏地址</button></div>
        {kind === 'public' && address.startsWith('https://ctext.org/') ? <button disabled={busy} onClick={() => void run(() => openCatalogWebsite(address))}>在中国哲学书原站打开 ↗</button> : null}
        {poetry && catalog ? <div ref={poetryRef}><PoetryPicker key={poetry.entry.url} collection={poetry.collection} title={poetry.entry.title.replace(/\.json$/i, '')} disabled={busy} onClose={() => setPoetry(null)} onImport={(title, poems) => void run(signal => importPoems(title, poems, signal))} onSaveRaw={() => void run(signal => saveRawJson(poetry.entry, signal))} /></div> : null}
        {catalog ? <section className="network-results"><div className="network-result-head"><h4>{catalog.title}</h4>{history.length > 1 ? <button disabled={busy} onClick={() => void run((signal) => browse(history[history.length - 2], history.slice(0, -2), signal))}>返回上层</button> : null}</div>{catalog.notice ? <p className="network-hint">{catalog.notice}</p> : null}{catalog.website ? <button disabled={busy} onClick={() => void run(() => openCatalogWebsite(catalog.website!))}>在原站打开本页 ↗</button> : null}
          {catalog.chapterBook ? <section className="network-note"><h4>{catalog.chapterBook.title}</h4><p>共 {catalog.chapterBook.chapters.length} 章，可选取一段合成一本书。</p><div className="network-range"><label className="network-label">起始章节<input className="field" type="number" min={1} max={catalog.chapterBook.chapters.length} value={chapterStart} disabled={busy} onChange={(e) => setChapterStart(Number(e.target.value))} /></label><label className="network-label">下载章数<input className="field" type="number" min={1} max={10000} value={chapterCount} disabled={busy} onChange={(e) => setChapterCount(Number(e.target.value))} /></label></div><p className="network-hint">{catalog.chapterBook.chapters[chapterStart - 1]?.title || '请选择有效的起始章节'} · 每次最多 10000 章 · 总正文最多 256 MiB</p><button className="primary" disabled={busy || !Number.isInteger(chapterStart) || !Number.isInteger(chapterCount) || chapterStart < 1 || chapterStart > catalog.chapterBook.chapters.length || chapterCount < 1 || chapterCount > 10000} onClick={() => void run(async (signal) => {
            const selectedBook = catalog.chapterBook!;
            const end = Math.min(selectedBook.chapters.length, chapterStart - 1 + chapterCount);
            const title = selectedBook.title + ' · ' + chapterStart + '–' + end + '章';
            const selectedChapters = selectedBook.chapters.slice(chapterStart - 1, end);
            await importChapters({title, url:history[history.length - 1],download:false}, selectedChapters, signal);
            if (mounted.current && end < selectedBook.chapters.length) setChapterStart(end + 1);
          })}>下载所选章节</button></section> : null}<label className="network-label">筛选本页<input className="field" type="search" value={filter} disabled={busy} onChange={(e) => setFilter(e.target.value)} placeholder="书名 / 作者" /></label>
          {catalog.entries.some(e => e.textPage === 'poetry') ? <section className="network-note" aria-label="JSON 文件合并">
            <label className="network-label">合并书名<input className="field" value={mergeTitle} disabled={busy} onChange={e => setMergeTitle(e.target.value)} /></label>
            <p className="network-hint">已选 {selectedJson.size} 个 JSON 文件。可合并所选诗词数据入架，单个 JSON 最大 50 MB。</p>
            <div className="network-actions"><button disabled={busy} onClick={() => setSelectedJson(new Set(catalog.entries.filter(e => e.textPage === 'poetry' && `${e.title} ${e.author || ''}`.toLowerCase().includes(filter.toLowerCase())).map(e => e.url)))}>选择本页 JSON</button><button disabled={busy || !selectedJson.size} onClick={() => setSelectedJson(new Set())}>清空文件选择</button><button className="primary" disabled={busy || !selectedJson.size} onClick={() => void run(signal => importChapters({ title: mergeTitle.trim() || '诗词合辑', url: history[history.length - 1], download: false }, catalog.entries.filter(e => e.textPage === 'poetry' && selectedJson.has(e.url)), signal))}>合并所选 JSON 入架</button></div>
          </section> : null}
          {catalog.entries.filter((e) => `${e.title} ${e.author || ''}`.toLowerCase().includes(filter.toLowerCase())).map((entry, i) => entry.textPage === 'poetry' ? <div className="network-json-row" key={entry.url}>
            <label className="network-file-check"><input type="checkbox" aria-label={`选择 JSON 文件 ${entry.title}`} checked={selectedJson.has(entry.url)} disabled={busy} onChange={e => setSelectedJson(prev => { const next = new Set(prev); e.target.checked ? next.add(entry.url) : next.delete(entry.url); return next; })} /></label>
            <button className="network-entry" disabled={busy} onClick={() => void run(signal => acquire(entry, signal))}><span>{entry.title}</span><em>预览 JSON</em></button>
            <button disabled={busy} aria-label={`下载原始 JSON ${entry.title}`} onClick={() => void run(signal => saveRawJson(entry, signal))}>保存 JSON</button>
          </div> : <button className="network-entry" key={i} disabled={busy} onClick={() => void run((signal) => entry.download ? acquire(entry, signal) : browse(entry.url, history, signal))}><span>{entry.title}{entry.author ? <small>{entry.author}</small> : null}</span><em>{entry.download ? '入架' : '进入 ›'}</em></button>)}{!catalog.entries.length ? <p className="panel-empty">此目录没有可读取的书籍或子目录</p> : null}{catalog.next ? <button disabled={busy} onClick={() => void run((signal) => browse(catalog.next!, history, signal))}>下一页目录</button> : null}</section> : null}
      </> : tab === 'link' ? <>
        <p className="network-hint">粘贴电子书的 HTTP 或 HTTPS 文件直链，单次最多 256 MiB。下载后可离线阅读。</p>
        <label className="network-label">文件下载链接<input className="field" type="url" value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} placeholder="https://…/书名.epub" /></label>
        <label className="network-label">文件名（可选，含扩展名）<input className="field" value={filename} disabled={busy} onChange={(e) => setFilename(e.target.value)} placeholder="书名.epub" /></label>
        <button className="primary" disabled={busy || !address.trim()} onClick={() => void run((signal) => acquire({ title: filename, url: address.trim(), filename, download: true }, signal))}>下载并加入书架</button>
        <div className="network-note"><strong>飞书与网盘怎么用？</strong><p>飞书文档可先导出为 DOCX、PDF 或 HTML，再从书架导入。网盘可使用真实文件下载链接；提供 WebDAV 的网盘也可在“我的书库”中连接。</p><p>文档里放了书籍下载链接时，可在“我的书库”选择“网页书单”尝试提取。飞书登录附件、动态页面或验证码暂不自动解析。</p><p>新增 OFD 为文字与 PNG/JPEG 图片重排，不保留原版式、签章及矢量图；版式文档请转 PDF 阅读。</p></div>
      </> : <>
        <p className="network-hint">可导入新旧版“阅读 / Legado” JSON 或 TXT 书源。</p>
        <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void run((signal) => loadSources(file, signal)); e.target.value = ''; }} />
        <button disabled={busy || !sourcesReady} onClick={() => fileRef.current?.click()}>导入书源 JSON / TXT</button>
        <section className="network-note"><strong>一键导入精选书源</strong>
          <button className="primary" disabled={busy || !sourcesReady} onClick={() => void run(async signal => {
            const parsed = await validateSourcesAsync(curatedSources, signal);
            if (parsed.rejected.length) throw new Error(parsed.rejected.join('\n'));
            const next = await mergeSources(sources, parsed.sources, signal);
            signal.throwIfAborted(); await platform.kvSet('networkSources', next);
            setSources(next); setSourceIndex(next.findIndex(item => item.bookSourceName === parsed.sources[0].bookSourceName && item.bookSourceUrl === parsed.sources[0].bookSourceUrl));
            setResults(null); setSelected(null); setChapters([]); setSearchPage(1); setQuery('西游记');
            setMessage('已添加 3 个精选书源，已选中 5000言；可直接点击“搜索书源”试读西游记');
          })}>一键添加 3 个精选书源</button>
        </section>
        <section className="network-note"><strong>精选公共书库</strong><div className="network-actions">
          {CLASSICS_PRESETS.filter(preset => ['中华诗词', 'Kanripo 汉籍'].includes(preset.title)).map(preset => <button key={preset.title} disabled={busy} onClick={() => { setTab('catalog'); openPreset(preset.title, preset.url, 'public'); }}>{preset.title}</button>)}
        </div></section>
        <SourceManager sources={sources} busy={busy} run={run} progress={setProgress} save={async next => {
          await platform.kvSet('networkSources', next); setSources(next); setSourceIndex(0); setResults(null); setSelected(null); setChapters([]); setSearchPage(1);
          setMessage(`已移除 ${sources.length - next.length} 个书源，保留 ${next.length} 个`);
        }} />
        {!sourcesReady && !busy ? <button onClick={() => void run(loadStoredSources)}>重新读取已保存的书源</button> : null}
        {sources.length ? <><SourcePicker sources={sources} value={sourceIndex} disabled={busy} onChange={index => { setSourceIndex(index); setResults(null); setSelected(null); setChapters([]); setSearchPage(1); }} /><div className="network-actions"><button disabled={busy} onClick={() => void run(async () => { const next = sources.filter((_, i) => i !== sourceIndex); await platform.kvSet('networkSources', next); setSources(next); setSourceIndex(0); setResults(null); setSelected(null); setChapters([]); })}>移除此书源</button></div>
          <label className="network-label">搜索书名 / 作者<input className="field" type="search" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setResults(null); setSelected(null); setSearchPage(1); }} /></label><button className="primary" disabled={busy || !query.trim()} onClick={() => void run(async (signal) => { setResults(await searchSource(source, query, 1, signal)); setSearchPage(1); setSelected(null); })}>搜索书源</button>
          {selected ? <section className="network-note"><h4>{selected.title}</h4><p>目录共 {chapters.length} 章。每次最多下载 10000 章，总正文最多 256 MiB，可分批收藏。</p><div className="network-range"><label className="network-label">起始章节<input className="field" type="number" min={1} max={chapters.length} value={start} disabled={busy} onChange={(e) => setStart(Number(e.target.value))} /></label><label className="network-label">下载章数<input className="field" type="number" min={1} max={10000} value={count} disabled={busy} onChange={(e) => setCount(Number(e.target.value))} /></label></div><p className="network-hint">{chapters[start - 1]?.title || '请选择有效的起始章节'}</p><button className="primary" disabled={busy || !Number.isInteger(start) || !Number.isInteger(count) || start < 1 || start > chapters.length || count < 1 || count > 10000} onClick={() => void run(async (signal) => { const end = Math.min(chapters.length, start - 1 + count); const title = `${selected.title} · ${start}–${end}章`; await importChapters({ ...selected, title }, chapters.slice(start - 1, end), signal, source); if (end < chapters.length) setStart(end + 1); })}>下载所选章节</button></section> : null}
          {results ? <section className="network-results">{results.map((entry, i) => <button className="network-entry" disabled={busy} key={i} onClick={() => void run(async (signal) => { const list = await sourceChapters(source, entry, signal); setChapters(list); setSelected(entry); setStart(1); })}><span>{entry.title}<small>{entry.author}</small></span><em>看目录</em></button>)}{results.length === 0 ? <p className="panel-empty">没有提取到结果。请换关键词；也可能是书源规则失效或需要验证。</p> : sourceHasSearchPages(source) ? <button disabled={busy} onClick={() => void run(async (signal) => { setResults(await searchSource(source, query, searchPage + 1, signal)); setSearchPage(searchPage + 1); setSelected(null); })}>搜索下一页（当前 {searchPage}）</button> : null}</section> : null}
        </> : <p className="panel-empty">还没有书源，可导入你已有的 JSON 或 TXT 文件</p>}
      </>}
      <div ref={statusRef}>
      {busy ? <div className="network-status" role="status"><span>{progress}</span><button onClick={() => work.current?.abort()}>取消</button></div> : null}
      {message ? <p className="network-message" role="status">{message}</p> : null}
      {error ? <p className="network-error" role="alert">{error}</p> : null}
      </div>
    </div>
  </Panel>;
}
