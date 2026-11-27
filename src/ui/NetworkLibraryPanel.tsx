import { useEffect, useRef, useState } from 'react';
import { Panel } from './Panel';
import { platform } from '../platform/web';
import { useLibrary } from '../store/library';
import { downloadBook, downloadChapters, fetchCatalog, parseSources, searchSource, secureUrl, webdavUrl, sourceChapters, GUTENBERG_POPULAR, GUTENBERG_CHINESE, gutenbergSearch, GXHJ_TEXT_SOURCE } from '../engine/networkLibrary';
import { BOOK_WEBSITES, openBookWebsite } from '../platform/bookWebsites';
import { CLASSICS_PRESETS, downloadPublicText } from '../engine/publicClassics';
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
  const statusRef = useRef<HTMLDivElement>(null);
  const credentials = useRef<Credentials>();
  const importFile = useLibrary((s) => s.importFile);
  const source = sources[sourceIndex];
  useEffect(() => { if (busy || message || error) statusRef.current?.scrollIntoView({ block: 'nearest' }); }, [busy, message, error]);
  useEffect(() => {
    mounted.current = true;
    void Promise.all([platform.kvGet<SavedCatalog[]>('networkCatalogs'), platform.kvGet<BookSource[]>('networkSources')]).then(([catalogs, stored]) => {
      if (!mounted.current) return;
      setSaved(catalogs || []);
      setSources(stored ? parseSources(JSON.stringify(stored)).sources : []);
      setReady(true);
    }).catch(() => { if (mounted.current) { setReady(true); setError('未能读取已保存的书库'); } });
    return () => { mounted.current = false; work.current?.abort(); };
  }, []);
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
    signal.throwIfAborted(); setCatalog(data); setHistory([...nextHistory, data.url]); setFilter(''); setChapterStart(firstUnread !== undefined && firstUnread >= 0 ? firstUnread + 1 : 1);
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
    if (entry.textPage) { await importChapters({...entry,title:catalog?.chapterBook ? `${catalog.chapterBook.title} · ${entry.title}` : entry.title},[entry],signal);return; }
    const file = await downloadBook(entry.url, entry.filename || '', signal, credentials.current, (bytes) => setProgress(`已下载 ${(bytes / 1024 / 1024).toFixed(1)} MB`), tab === 'catalog' && kind === 'webdav');
    signal.throwIfAborted(); setProgress('正在整理入架…'); const book = await importFile(file);
    if (mounted.current) setMessage(`《${book.title}》已加入书架`);
  }
  async function saveCatalog() {
    const url = (kind === 'webdav' ? webdavUrl : secureUrl)(address.trim());
    const item = { name: name.trim() || new URL(url).hostname, url, kind };
    const next = [...saved.filter((c) => c.url !== url || c.kind !== kind), item];
    await platform.kvSet('networkCatalogs', next); setSaved(next); setMessage('书库地址已收藏，账号密码仅在本次面板中使用');
  }
  async function loadSources(file: File, signal: AbortSignal) {
    if (file.size > 2 * 1024 * 1024) throw new Error('书源文件超过 2 MB，请拆分后导入');
    const parsed = parseSources(await file.text()); signal.throwIfAborted();
    const next = [...sources];
    for (const item of parsed.sources) {
      const i = next.findIndex((s) => s.bookSourceUrl === item.bookSourceUrl && s.bookSourceName === item.bookSourceName);
      if (i >= 0) next[i] = item; else next.push(item);
    }
    if (next.length > 500) throw new Error('最多保存 500 个书源，请先移除不用的书源');
    await platform.kvSet('networkSources', next); setSources(next); setResults(null); setSelected(null); setSourceIndex(0);
    setMessage(`已导入 ${parsed.sources.length} 个兼容书源${parsed.rejected.length ? `，跳过 ${parsed.rejected.length} 个` : ''}`);
    if (parsed.rejected.length) setError(parsed.rejected.slice(0, 8).join('\n') + (parsed.rejected.length > 8 ? '\n其余不兼容书源已跳过' : ''));
  }
  return <Panel label="网络书库" onClose={close}>
    <div className="drawer-head"><h3>网络书库</h3><button onClick={close}>关闭</button></div>
    <p className="panel-intro">远方藏书，取一卷入架。只下载你选择的书。</p>
    <div className="network-tabs" role="tablist" aria-label="书库方式">
      {(['catalog', 'source', 'link'] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} disabled={busy} onClick={() => { setTab(value); setError(''); setMessage(''); }}>{value === 'catalog' ? '我的书库' : value === 'source' ? '阅读书源' : '链接导入'}</button>)}
    </div>
    <div className="network-content">
      {tab === 'catalog' ? <>
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
        <p className="network-hint">也可连接 OPDS、WebDAV 或公开网页书单。WebDAV 支持 HTTP 和 HTTPS，其他书库需使用 HTTPS。</p>
        {saved.length ? <div className="network-saved">{saved.map((c) => <div key={c.kind + c.url}><button disabled={busy} onClick={() => { setKind(c.kind); setAddress(c.url); setName(c.name); setCatalog(null); setHistory([]); setUsername(''); setPassword(''); credentials.current = undefined; }}>{c.name}<small>{c.kind.toUpperCase()}</small></button><button disabled={busy || !ready} aria-label={`移除书库 ${c.name}`} onClick={() => void run(async () => { const next = saved.filter((x) => x !== c); await platform.kvSet('networkCatalogs', next); setSaved(next); })}>移除</button></div>)}</div> : null}
        <label className="network-label">书库类型<select className="field" value={kind} disabled={busy} onChange={(e) => { setKind(e.target.value as LibraryKind); setCatalog(null); setHistory([]); }}><option value="opds">OPDS 书库</option><option value="webdav">WebDAV 文件夹</option><option value="web">网页书单</option><option value="github">GitHub 公开仓库</option><option value="public">公版经典书库</option></select></label>
        <label className="network-label">书库地址<input className="field" type="url" placeholder={kind === 'webdav' ? 'http://云盘地址:端口/dav/' : kind === 'github' ? 'https://github.com/作者/仓库名' : kind === 'web' ? 'https://公开网页书单' : 'https://你的书库/opds'} value={address} disabled={busy} onChange={(e) => { setAddress(e.target.value); setCatalog(null); setHistory([]); }} /></label>
        {kind === 'webdav' ? <p className="network-hint">填写 WebDAV 文件夹地址，即可浏览子目录，选择书籍下载入架。HTTP 不加密账号与内容，请仅在可信网络使用。手机连接电脑上的服务时，请填电脑的局域网 IP；127.0.0.1 指向手机自身。</p> : null}
        {kind === 'github' ? <p className="network-hint">填写仓库主页，可逐层浏览 EPUB、PDF、TXT、Markdown 等文件；私有仓库、Git LFS 指针及仅含数据的 JSON 书库暂不支持。无需 Git 客户端，账号密码不会发送给 GitHub。</p> : null}
        <details><summary>名称与访问账号（可选）</summary><label className="network-label">收藏名称<input className="field" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label><label className="network-label">账号<input className="field" autoComplete="off" value={username} disabled={busy} onChange={(e) => setUsername(e.target.value)} /></label><label className="network-label">密码 / 应用密码<input className="field" type="password" autoComplete="off" value={password} disabled={busy} onChange={(e) => setPassword(e.target.value)} /></label><p className="network-hint">密码不保存，关闭面板后清除。跨站下载不会携带书库密码。</p></details>
        <div className="network-actions"><button className="primary" disabled={busy || !address.trim()} onClick={() => void run(async (signal) => { const url = (kind === 'webdav' ? webdavUrl : secureUrl)(address.trim()); credentials.current = username ? { origin: new URL(url).origin, username, password } : undefined; await browse(url, [], signal); })}>打开书库</button><button disabled={busy || !ready || !address.trim()} onClick={() => void run(saveCatalog)}>收藏地址</button></div>
        {kind === 'public' && address.startsWith('https://ctext.org/') ? <button disabled={busy} onClick={() => void run(() => openCatalogWebsite(address))}>在中国哲学书原站打开 ↗</button> : null}
        {catalog ? <section className="network-results"><div className="network-result-head"><h4>{catalog.title}</h4>{history.length > 1 ? <button disabled={busy} onClick={() => void run((signal) => browse(history[history.length - 2], history.slice(0, -2), signal))}>返回上层</button> : null}</div>{catalog.notice ? <p className="network-hint">{catalog.notice}</p> : null}{catalog.website ? <button disabled={busy} onClick={() => void run(() => openCatalogWebsite(catalog.website!))}>在原站打开本页 ↗</button> : null}
          {catalog.chapterBook ? <section className="network-note"><h4>{catalog.chapterBook.title}</h4><p>共 {catalog.chapterBook.chapters.length} 章，可选取一段合成一本书。</p><div className="network-range"><label className="network-label">起始章节<input className="field" type="number" min={1} max={catalog.chapterBook.chapters.length} value={chapterStart} disabled={busy} onChange={(e) => setChapterStart(Number(e.target.value))} /></label><label className="network-label">下载章数<input className="field" type="number" min={1} max={10000} value={chapterCount} disabled={busy} onChange={(e) => setChapterCount(Number(e.target.value))} /></label></div><p className="network-hint">{catalog.chapterBook.chapters[chapterStart - 1]?.title || '请选择有效的起始章节'} · 每次最多 10000 章 · 总正文最多 256 MiB</p><button className="primary" disabled={busy || !Number.isInteger(chapterStart) || !Number.isInteger(chapterCount) || chapterStart < 1 || chapterStart > catalog.chapterBook.chapters.length || chapterCount < 1 || chapterCount > 10000} onClick={() => void run(async (signal) => {
            const selectedBook = catalog.chapterBook!;
            const end = Math.min(selectedBook.chapters.length, chapterStart - 1 + chapterCount);
            const title = selectedBook.title + ' · ' + chapterStart + '–' + end + '章';
            const selectedChapters = selectedBook.chapters.slice(chapterStart - 1, end);
            await importChapters({title, url:history[history.length - 1],download:false}, selectedChapters, signal);
            if (mounted.current && end < selectedBook.chapters.length) setChapterStart(end + 1);
          })}>下载所选章节</button></section> : null}<label className="network-label">筛选本页<input className="field" type="search" value={filter} disabled={busy} onChange={(e) => setFilter(e.target.value)} placeholder="书名 / 作者" /></label>{catalog.entries.filter((e) => `${e.title} ${e.author || ''}`.toLowerCase().includes(filter.toLowerCase())).map((entry, i) => <button className="network-entry" key={i} disabled={busy} onClick={() => void run((signal) => entry.download ? acquire(entry, signal) : browse(entry.url, history, signal))}><span>{entry.title}{entry.author ? <small>{entry.author}</small> : null}</span><em>{entry.download ? '入架' : '进入 ›'}</em></button>)}{!catalog.entries.length ? <p className="panel-empty">此目录没有可读取的书籍或子目录</p> : null}{catalog.next ? <button disabled={busy} onClick={() => void run((signal) => browse(catalog.next!, history, signal))}>下一页目录</button> : null}</section> : null}
      </> : tab === 'link' ? <>
        <p className="network-hint">粘贴电子书的 HTTPS 文件直链，单次最多 256 MiB。下载后可离线阅读。</p>
        <label className="network-label">文件下载链接<input className="field" type="url" value={address} disabled={busy} onChange={(e) => setAddress(e.target.value)} placeholder="https://…/书名.epub" /></label>
        <label className="network-label">文件名（可选，含扩展名）<input className="field" value={filename} disabled={busy} onChange={(e) => setFilename(e.target.value)} placeholder="书名.epub" /></label>
        <button className="primary" disabled={busy || !address.trim()} onClick={() => void run((signal) => acquire({ title: filename, url: address.trim(), filename, download: true }, signal))}>下载并加入书架</button>
        <div className="network-note"><strong>飞书与网盘怎么用？</strong><p>飞书文档可先导出为 DOCX、PDF 或 HTML，再从书架导入。网盘可使用真实文件下载链接；提供 WebDAV 的网盘也可在“我的书库”中连接。</p><p>文档里放了书籍下载链接时，可在“我的书库”选择“网页书单”尝试提取。飞书登录附件、动态页面或验证码暂不自动解析。</p><p>新增 OFD 为文字与 PNG/JPEG 图片重排，不保留原版式、签章及矢量图；版式文档请转 PDF 阅读。</p></div>
      </> : <>
        <p className="network-hint">导入“阅读 / Legado”JSON 书源。轻量版支持纯 CSS 规则；脚本、验证码、特殊分页及登录书源暂不兼容。不预装第三方书源。</p>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void run((signal) => loadSources(file, signal)); e.target.value = ''; }} />
        <button disabled={busy || !ready} onClick={() => fileRef.current?.click()}>导入书源 JSON</button>
        {sources.length ? <><label className="network-label">选择书源<select className="field" disabled={busy} value={sourceIndex} onChange={(e) => { setSourceIndex(Number(e.target.value)); setResults(null); setSelected(null); setChapters([]); setSearchPage(1); }}>{sources.map((s, i) => <option key={i} value={i}>{s.bookSourceName}</option>)}</select></label><div className="network-actions"><button disabled={busy} onClick={() => void run(async () => { const next = sources.filter((_, i) => i !== sourceIndex); await platform.kvSet('networkSources', next); setSources(next); setSourceIndex(0); setResults(null); setSelected(null); setChapters([]); })}>移除此书源</button></div>
          <label className="network-label">搜索书名 / 作者<input className="field" type="search" value={query} disabled={busy} onChange={(e) => { setQuery(e.target.value); setResults(null); setSelected(null); setSearchPage(1); }} /></label><button className="primary" disabled={busy || !query.trim()} onClick={() => void run(async (signal) => { setResults(await searchSource(source, query, 1, signal)); setSearchPage(1); setSelected(null); })}>搜索书源</button>
          {selected ? <section className="network-note"><h4>{selected.title}</h4><p>目录共 {chapters.length} 章。每次最多下载 10000 章，总正文最多 256 MiB，可分批收藏。</p><div className="network-range"><label className="network-label">起始章节<input className="field" type="number" min={1} max={chapters.length} value={start} disabled={busy} onChange={(e) => setStart(Number(e.target.value))} /></label><label className="network-label">下载章数<input className="field" type="number" min={1} max={10000} value={count} disabled={busy} onChange={(e) => setCount(Number(e.target.value))} /></label></div><p className="network-hint">{chapters[start - 1]?.title || '请选择有效的起始章节'}</p><button className="primary" disabled={busy || !Number.isInteger(start) || !Number.isInteger(count) || start < 1 || start > chapters.length || count < 1 || count > 10000} onClick={() => void run(async (signal) => { const end = Math.min(chapters.length, start - 1 + count); const title = `${selected.title} · ${start}–${end}章`; await importChapters({ ...selected, title }, chapters.slice(start - 1, end), signal, source); if (end < chapters.length) setStart(end + 1); })}>下载所选章节</button></section> : null}
          {results ? <section className="network-results">{results.map((entry, i) => <button className="network-entry" disabled={busy} key={i} onClick={() => void run(async (signal) => { const list = await sourceChapters(source, entry, signal); setChapters(list); setSelected(entry); setStart(1); })}><span>{entry.title}<small>{entry.author}</small></span><em>看目录</em></button>)}{results.length === 0 ? <p className="panel-empty">没有提取到结果。请换关键词；也可能是书源规则失效或需要验证。</p> : source.searchUrl.includes('page') ? <button disabled={busy} onClick={() => void run(async (signal) => { setResults(await searchSource(source, query, searchPage + 1, signal)); setSearchPage(searchPage + 1); setSelected(null); })}>搜索下一页（当前 {searchPage}）</button> : null}</section> : null}
        </> : <p className="panel-empty">还没有书源，可导入你已有的 JSON 文件</p>}
      </>}
      <div ref={statusRef}>
      {busy ? <div className="network-status" role="status"><span>{progress}</span><button onClick={() => work.current?.abort()}>取消</button></div> : null}
      {message ? <p className="network-message" role="status">{message}</p> : null}
      {error ? <p className="network-error" role="alert">{error}</p> : null}
      </div>
    </div>
  </Panel>;
}
