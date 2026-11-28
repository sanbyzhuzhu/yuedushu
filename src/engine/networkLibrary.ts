/** Small, on-demand catalog client. Source rules are data; they are never evaluated as code. */
import { decodeText } from './txt';
import { escapeHtml, parseHtml } from './importExtra';
import { androidFetch, hasAndroidHttp } from '../platform/androidHttp';
import { normalizeLegacySource, validateLegacySource, legacySearchRequest, legacyElements, legacyExtract, legacyContentIsHtml } from './legacySource';
import { sourceHeaders, sourceSearchRequest, sourceRuleItems, sourceRuleValue, sourceRuleIsHtml, validateDeclarativeSource } from './sourceRules';
import type { SourceData } from './sourceRules';
import { assertPublicSource } from './sourcePolicy';
import { decodeSourceResponse } from './sourceResponse';
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

export type LibraryKind = 'opds' | 'webdav' | 'web' | 'github' | 'public';
export const GUTENBERG_POPULAR = 'https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads';
export const GUTENBERG_CHINESE = 'https://www.gutenberg.org/ebooks/search.opds/?query=l.zh';
export function gutenbergSearch(query: string): string { return 'https://www.gutenberg.org/ebooks/search.opds/?query=' + encodeURIComponent(query.trim()); }
export interface CatalogEntry { title: string; author?: string; url: string; download: boolean; filename?: string; textPage?: 'gxhj' | 'wikisource' | 'ctext' | 'poetry' | 'kanripo' }
export interface Catalog { title: string; entries: CatalogEntry[]; next?: string; notice?: string; website?: string; chapterBook?: { title: string; chapters: CatalogEntry[] } }
export interface Credentials { origin: string; username: string; password: string }
const BOOK_EXT = /\.(epub|txt|md|markdown|pdf|docx|mobi|azw3?|prc|fb2(?:\.zip)?|cbz|ofd|odt|html?|xhtml|updb)(?:$|[?#])/i;
const MIME_EXT: Record<string, string> = { 'application/epub+zip': 'epub', 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/html': 'html', 'application/xhtml+xml': 'html', 'text/markdown': 'md', 'application/x-mobipocket-ebook': 'mobi', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.oasis.opendocument.text': 'odt', 'application/ofd': 'ofd' };
export function secureUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('请使用 HTTP 或 HTTPS 地址，账号密码请填在独立输入框。');
  url.hash = '';
  return url.href;
}
const local = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));
/** WebDAV uses the same supported protocols as other catalogs. */
export function webdavUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('WebDAV 请使用 HTTP 或 HTTPS 地址，账号密码请填在独立输入框。');
  url.hash = '';
  return url.href;
}
function xml(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('目录包含不支持的 XML 实体');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('书库返回的 XML 无效');
  return doc;
}
const label = (node: Document | Element, tag: string) => local(node, tag)[0]?.textContent?.trim() || '';
function maybeUrl(href: unknown, base: string): string | undefined {
  try { return typeof href === 'string' && href ? secureUrl(href, base) : undefined; } catch { return undefined; }
}
export function parseOpds(text: string, base: string): Catalog {
  const result: Catalog = { title: '网络书库', entries: [] };
  const add = (title: string, author: string, links: { href?: string; rel?: string | string[]; type?: string; title?: string }[]) => {
    for (const link of links) {
      const rel = Array.isArray(link.rel) ? link.rel.join(' ') : link.rel || '';
      const url = maybeUrl(link.href, base); if (!url) continue;
      const download = /opds-spec.org\/acquisition(?:\s|$|\/open-access)/.test(rel) || !!MIME_EXT[link.type || ''] && BOOK_EXT.test(url);
      const navigation = /opds|atom\+xml/.test(link.type || '') && !/image|cover|thumbnail/.test(rel);
      if (!download && !navigation) continue;
      const ext = MIME_EXT[link.type || ''];
      result.entries.push({ title: !download && link.title ? link.title : title + (download && ext ? ` · ${ext.toUpperCase()}` : ''), author, url, download, filename: download && ext ? `${title}.${ext}` : undefined });
    }
  };
  if (text.trimStart().startsWith('{')) {
    const feed = JSON.parse(text);
    if (!feed.metadata && !feed.publications && !feed.navigation && !feed.groups) throw new Error('不是 OPDS 2 目录');
    result.title = String(feed.metadata?.title || result.title);
    const publications = [...(feed.publications || []), ...(feed.groups || []).flatMap((g: any) => g.publications || [])];
    for (const p of publications) add(String(p.metadata?.title || '未命名'), [].concat(p.metadata?.author || []).map((a: any) => typeof a === 'string' ? a : a.name).join('、'), p.links || []);
    for (const nav of [...(feed.navigation || []), ...(feed.groups || []).flatMap((g: any) => g.navigation || [])]) {
      const url = maybeUrl(nav.href, base); if (url) result.entries.push({ title: String(nav.title || '目录'), url, download: false });
    }
    result.next = maybeUrl(feed.links?.find((l: any) => (Array.isArray(l.rel) ? l.rel : [l.rel]).includes('next'))?.href, base);
  } else {
    const doc = xml(text);
    if (doc.documentElement.localName !== 'feed') throw new Error('不是 OPDS 目录，请填写书库的 OPDS 入口');
    result.title = label(doc.documentElement, 'title') || result.title;
    const hrefOf = (el: Element) => {
      let url = base;
      const ancestors: Element[] = [];
      for (let parent: Element | null = el; parent; parent = parent.parentElement) ancestors.unshift(parent);
      for (const parent of ancestors) if (parent.hasAttribute('xml:base')) url = secureUrl(parent.getAttribute('xml:base')!, url);
      return maybeUrl(el.getAttribute('href'), url);
    };
    for (const entry of local(doc, 'entry')) add(label(entry, 'title') || '未命名', local(entry, 'author').map((a) => label(a, 'name')).join('、'), local(entry, 'link').map((l) => ({ href: hrefOf(l), rel: l.getAttribute('rel') || '', type: l.getAttribute('type') || '', title: l.getAttribute('title') || undefined })));
    const next = Array.from(doc.documentElement.children).find((el) => el.localName === 'link' && el.getAttribute('rel') === 'next');
    if (next) result.next = hrefOf(next);
  }
  if (result.entries.length > 5000) throw new Error('单页书库条目过多，请在服务器开启分页');
  return result;
}
export function parseWebdav(text: string, base: string): Catalog {
  const doc = xml(text), entries: CatalogEntry[] = [];
  if (doc.documentElement.localName !== 'multistatus') throw new Error('不是 WebDAV 目录，请检查地址');
  const root = new URL(base);
  for (const response of local(doc, 'response')) {
    const props = local(response, 'propstat').filter((p) => /\s2\d\d\s/.test(label(p, 'status'))).flatMap((p) => local(p, 'prop'));
    if (!props.length) continue;
    let url: string;
    try { const href = label(response, 'href'); if (!href) continue; url = webdavUrl(href, base); } catch { continue; }
    const target = new URL(url);
    if (target.origin !== root.origin || target.pathname.replace(/\/$/, '') === root.pathname.replace(/\/$/, '')) continue;
    const folder = props.some((p) => local(p, 'collection').length);
    let filename = target.pathname.split('/').filter(Boolean).pop() || '目录';
    try { filename = decodeURIComponent(filename); } catch { /* preserve malformed server names */ }
    if (!folder && !BOOK_EXT.test(filename)) continue;
    entries.push({ title: props.map((p) => label(p, 'displayname')).find(Boolean) || filename, url, download: !folder, filename });
  }
  if (entries.length > 5000) throw new Error('目录过大，请按分类拆分文件夹');
  entries.sort((a, b) => Number(a.download) - Number(b.download) || a.title.localeCompare(b.title, 'zh-CN'));
  return { title: 'WebDAV 书库', entries };
}

function parseHaodoo(doc: Document, base: string): Catalog {
  const root = new URL(base), classic = root.hostname.endsWith('.net');
  const title = doc.querySelector('h1')?.textContent?.trim() || '好读 · ' + root.hostname;
  const entries: CatalogEntry[] = [], seen = new Set<string>();
  let next: string | undefined;
  const add = (entry: CatalogEntry) => { if (!seen.has(entry.url) && entry.url !== base && entries.length < 500) { seen.add(entry.url); entries.push(entry); } };
  if (classic) {
    for (const button of Array.from(doc.querySelectorAll('[onclick]'))) {
      // Match the complete known call, not arbitrary JavaScript or an embedded expression.
      const match = /^\s*(DownloadV?Epub|gotoEpubPage)\(['"]([A-Za-z0-9_-]{2,64})['"]\)\s*;?\s*$/i.exec(button.getAttribute('onclick') || '');
      if (!match) continue;
      const id = match[2], label = button.getAttribute('value') || '下载 EPUB';
      const name = button.parentElement?.textContent?.match(/[《【]([^》】]+)[》】]/)?.[1] || `好读 ${id}`;
      add({ title: `${name} · ${label}`, url: secureUrl(`/PDB/${id[0]}/${id.slice(1)}.epub`, base), download: true, filename: `${name}.epub` });
    }
  }
  const categories = /^(100|wisdom|history|martial|mystery|romance|scifi|fiction)$/;
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    const raw = a.getAttribute('href') || '';
    const url = maybeUrl(raw.replace(/^http:\/\/(?:www\.)?haodoo\.(net|org)(?=\/)/i, 'https://haodoo.$1'), base);
    if (!url) continue;
    const target = new URL(url);
    if (target.origin !== root.origin) continue;
    const name = a.textContent?.replace(/\s+/g, ' ').trim() || a.querySelector('img')?.getAttribute('alt') || '';
    if (!name) continue;
    if (a.matches('.wp-block-query-pagination-next,[rel="next"]')) { next = url; continue; }
    const direct = /\.(epub|txt|mobi|prc|updb|pdf)$/i.test(target.pathname);
    const navigation = classic
      ? target.searchParams.get('M') === 'hd' && categories.test(target.searchParams.get('P') || '') || target.searchParams.get('M') === 'book' && !/^A[BD]/i.test(target.searchParams.get('P') || '')
      : (target.searchParams.has('p') && !!a.closest('.wp-block-post-title,.wp-block-post-featured-image,.wp-block-post-content,article')) || target.searchParams.has('product') || target.searchParams.has('tag') || target.searchParams.has('cat') || /^\/(?:product|tag|category)\//.test(target.pathname);
    if (target.searchParams.has('add-to-cart') || target.searchParams.has('remove_item')) continue;
    if (direct || navigation) add({ title: name, url, download: direct });
  }
  entries.sort((a, b) => Number(b.download) - Number(a.download));
  return { title, entries, next, website: base, notice: classic ? '选择分类与书籍，再点“入架”下载 EPUB。连接受限时请开启系统代理；也可在原站查看本页。' : '可浏览公开书目与下载页面。需要登录或购物车的下载，请点“在原站打开本页”完成后，从本地导入。连接受限时请开启系统代理。' };
}

/** Read public HTML links without executing the remote page or sending a login session. */
export function parseWebList(text: string, base: string): Catalog {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  if (/^(www\.)?haodoo\.(net|org)$/.test(new URL(base).hostname)) return parseHaodoo(doc, base);
  const origin = new URL(base).origin;
  const effectiveBase = maybeUrl(doc.querySelector('base[href]')?.getAttribute('href'), base) || base;
  const entries: CatalogEntry[] = [], seen = new Set<string>();
  for (const anchor of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (anchor.closest('nav,header,footer,[hidden],[aria-hidden="true"]')) continue;
    let hidden = false;
    for (let el: Element | null = anchor; el; el = el.parentElement) {
      if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '')) { hidden = true; break; }
    }
    if (hidden) continue;
    const href = anchor.getAttribute('href')?.trim(); if (!href || href.startsWith('#')) continue;
    const url = maybeUrl(href, effectiveBase); if (!url || seen.has(url) || url === base) continue;
    const title = anchor.textContent?.replace(/\s+/g, ' ').trim() || anchor.getAttribute('title') || '';
    const suggested = anchor.getAttribute('download')?.trim() || '';
    const ext = MIME_EXT[anchor.getAttribute('type') || ''];
    let pathName = new URL(url).pathname.split('/').pop() || '';
    try { pathName = decodeURIComponent(pathName); } catch { /* keep server name */ }
    const target = new URL(url);
    const gxhj = /^(www\.)?gxhj\.com$/.test(target.hostname) && target.origin === origin && /^\/txt\/[\w-]+\/\d+\.html$/.test(target.pathname);
    const download = gxhj || BOOK_EXT.test(pathName) && !/\.html?$/i.test(pathName) || BOOK_EXT.test(suggested) || !!ext;
    const filename = BOOK_EXT.test(suggested) ? suggested : ext ? `${title || '网络藏书'}.${ext}` : undefined;
    const navigation = new URL(url).origin === origin && !/\.(?:png|jpe?g|gif|svg|css|js|mp[34]|exe|apk|zip)$/i.test(pathName);
    if (!download && !navigation || !title && !download) continue;
    seen.add(url); entries.push({ title: title || suggested || pathName || '下载文件', url, download, filename, ...(gxhj ? { textPage: 'gxhj' as const } : {}) });
    if (entries.length >= 500) break;
  }
  if (!entries.length) throw new Error('没有找到公开的书籍链接。飞书等页面可能需要登录或动态加载附件；请复制真实下载链接，或下载到本地后导入。');
  entries.sort((a, b) => Number(b.download) - Number(a.download));
  const textChapters = entries.filter((e) => e.textPage === 'gxhj');
  const bookTitle = doc.querySelector('h3')?.textContent?.trim() || doc.title;
  return { title: doc.title.trim() || '网页书单', entries, ...(textChapters.length && /^\/txt\/[\w-]+\/$/.test(new URL(base).pathname) ? { chapterBook: { title: bookTitle, chapters: textChapters } } : {}), notice: (entries.length >= 500 ? '本页仅展示前 500 个链接。' : '') + (textChapters.length ? '文字章节可分批下载入架；影印资料、需登录或动态加载的资源请在原网站查看。' : entries.some((e) => e.download) ? '点“入架”下载文件；点“进入”查看同站页面。' : '本页未发现直接下载文件，可进入书籍详情页继续查看。需登录或动态生成的附件暂不支持。') };
}

export function githubCatalogUrl(address: string): string {
  const url = new URL(secureUrl(address));
  if (url.hostname === 'api.github.com' && /^\/repos\/[^/]+\/[^/]+\/contents(?:\/|$)/.test(url.pathname)) return url.href;
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname !== 'github.com' || parts.length !== 2) throw new Error('请填写 GitHub 公开仓库主页地址，例如 https://github.com/作者/仓库名');
  return `https://api.github.com/repos/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1].replace(/\.git$/, ''))}/contents`;
}
export function parseGithub(text: string, base: string): Catalog {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('不是可浏览的公开仓库目录');
  const entries: CatalogEntry[] = [];
  for (const item of data) {
    if (item.type === 'dir') { const url = maybeUrl(item.url, base); if (url && new URL(url).hostname === 'api.github.com') entries.push({ title: String(item.name), url, download: false }); }
    else if (item.type === 'file' && typeof item.name === 'string' && (BOOK_EXT.test(item.name) || /\.json$/i.test(item.name))) { const url = maybeUrl(item.download_url, base); if (url && item.size <= MAX_DOWNLOAD_BYTES) entries.push({ title: item.name, url, download: true, filename: item.name, ...(/\.json$/i.test(item.name) ? { textPage: 'poetry' as const } : {}) }); }
  }
  entries.sort((a, b) => Number(a.download) - Number(b.download) || a.title.localeCompare(b.title));
  return { title: 'GitHub · ' + decodeURIComponent(new URL(base).pathname.replace(/^\/repos\//, '').replace('/contents', '')), entries, notice: 'JSON 可预览诗词、勾选合并入架或保存原始文件；其他 JSON 结构可下载保存。单文件最多 256 MiB，GitHub 接口有访问频率限制，单目录最多返回 1000 项。' };
}

/** Manual redirects keep credentials on their original origin, including native HTTP. */
export async function requestBytes(address: string, options: { signal?: AbortSignal; credentials?: Credentials; method?: string; body?: string; headers?: Record<string, string>; anonymous?: boolean; limit?: number; progress?: (bytes: number) => void; webdav?: boolean } = {}) {
  const validateUrl = options.webdav ? webdavUrl : secureUrl;
  let url = validateUrl(address);
  const initialOrigin = new URL(url).origin;
  let method = options.method || 'GET', body = options.body;
  let redirectedPost = false;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let timeout = setTimeout(cancel, 60000);
  const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(cancel, 60000); };
  try {
    const native = '__TAURI_INTERNALS__' in window ? await import('@tauri-apps/plugin-http') : null;
    for (let hop = 0; hop < 6; hop++) {
      const headers: Record<string, string> = new URL(url).origin === initialOrigin ? { ...options.headers } : {};
      if (redirectedPost) for (const key of Object.keys(headers)) if (/^content-type$/i.test(key)) delete headers[key];
      if (!options.anonymous && options.credentials?.username && new URL(url).origin === options.credentials.origin) {
        const bytes = new TextEncoder().encode(`${options.credentials.username}:${options.credentials.password}`);
        headers.Authorization = 'Basic ' + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''));
      }
      if (method === 'PROPFIND') { headers.Depth = '1'; headers['Content-Type'] = 'application/xml'; }
      const init = { method, headers, signal: controller.signal, redirect: 'manual' as const, ...(options.anonymous ? { credentials: 'omit' as const } : {}), ...(body !== undefined ? { body } : method === 'PROPFIND' ? { body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>' } : {}) };
      let response: Response;
      try {
        response = native ? await native.fetch(url, { ...init, maxRedirections: 0, connectTimeout: 15000 }) : await fetch(url, init);
      } catch (error) {
        if (!hasAndroidHttp() || controller.signal.aborted) throw error;
        // Some Android WebViews/system proxies work with Android TLS but fail in Rust HTTP.
        response = await androidFetch(url, init, options.limit || 8 * 1024 * 1024, options.webdav);
      }
      if (response.type === 'opaqueredirect') throw new Error('浏览器无法读取此跳转，请使用安装版或填写跳转后的地址');
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location'); if (!location) throw new Error('下载跳转缺少地址');
        await response.body?.cancel();
        const nextUrl = validateUrl(location, url);
        if (new URL(url).protocol === 'https:' && new URL(nextUrl).protocol === 'http:') throw new Error('书库跳转从 HTTPS 降为 HTTP，已停止连接，请检查服务器地址。');
        if (method === 'POST') {
          if ([301, 302, 303].includes(response.status)) { method = 'GET'; body = undefined; redirectedPost = true; }
          else if (new URL(nextUrl).origin !== new URL(url).origin) throw new Error('搜索表单跳转到其他网站，已停止发送表单');
        }
        url = nextUrl; continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error(new URL(url).hostname === 'api.github.com' && (response.status === 403 || response.status === 429) ? 'GitHub 暂时限制了访问频率，请稍后重试，或使用仓库文件的 Raw 下载直链' : response.status === 401 || response.status === 403 ? options.anonymous ? '该公开书源要求验证、登录或限制访问，本版不处理登录' : '书库拒绝访问，请检查账号、应用密码或链接权限' : `请求失败（HTTP ${response.status}）`); }
      resetTimeout();
      const limit = options.limit || 8 * 1024 * 1024;
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error(`文件超过 ${limit / 1024 / 1024} MB 限制，请下载后从本地导入`); }
      const chunks: Uint8Array[] = []; let size = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('服务器没有返回内容');
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read(); if (done) break;
          resetTimeout();
          size += value.byteLength;
          if (size > limit) throw new Error(`下载内容超过 ${limit / 1024 / 1024} MB 限制`);
          chunks.push(value); options.progress?.(size);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const data = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      return { data, url, headers: response.headers };
    }
    throw new Error('链接跳转次数过多');
  } catch (e) {
    if (controller.signal.aborted) throw new Error(options.signal?.aborted ? '已取消' : '请求超时，请重试');
    if (e instanceof TypeError) throw new Error('__TAURI_INTERNALS__' in window
      ? '书库请求失败，请检查此设备的网络、系统时间与 Android System WebView 是否为最新版本。'
      : options.webdav ? '无法连接 WebDAV。请检查地址、端口与网络；手机连接电脑服务需使用电脑的局域网 IP，网页版还受跨域设置限制。' : '无法连接书库。请检查网络和 HTTPS 地址；网页版还受服务器跨域设置限制。');
    if (typeof e === 'string' && /error sending request|dns|connect|certificate/i.test(e)) throw new Error('无法连接书库，请检查此设备的网络、代理与系统时间；国外书库可能需要可访问该站点的网络。');
    throw e;
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel); }
}
export async function fetchCatalog(url: string, kind: LibraryKind, signal: AbortSignal, credentials?: Credentials) {
  if (kind === 'public') {
    const {publicRoot, normalizePublicUrl, parsePublicCatalog} = await import('./publicClassics');
    url = normalizePublicUrl(url);
    const root = publicRoot(url); if (root) { signal.throwIfAborted(); return {...root, url}; }
    const requestUrl = new URL(url);
    if (requestUrl.hostname === 'zh.wikisource.org') { requestUrl.searchParams.delete('rtsection'); requestUrl.searchParams.delete('rtoffset'); }
    const r = await requestBytes(requestUrl.href, {signal});
    const catalogUrl = requestUrl.hostname === 'zh.wikisource.org' ? url : r.url;
    return {...parsePublicCatalog(decodeText(r.data.buffer as ArrayBuffer), catalogUrl), url:catalogUrl};
  }
  const r = await requestBytes(kind === 'github' ? githubCatalogUrl(url) : url, { signal, credentials: kind === 'github' ? undefined : credentials, method: kind === 'webdav' ? 'PROPFIND' : 'GET', webdav: kind === 'webdav' });
  const text = decodeText(r.data.buffer as ArrayBuffer);
  return { ... (kind === 'opds' ? parseOpds(text, r.url) : kind === 'web' ? parseWebList(text, r.url) : kind === 'github' ? parseGithub(text, r.url) : parseWebdav(text, r.url)), url: r.url };
}
export async function downloadBook(url: string, name: string, signal: AbortSignal, credentials?: Credentials, progress?: (bytes: number) => void, webdav = false): Promise<File> {
  const r = await requestBytes(url, { signal, credentials, limit: MAX_DOWNLOAD_BYTES, progress, webdav });
  const disposition = r.headers.get('content-disposition') || '';
  let serverName = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1] || /filename="([^"]+)"|filename=([^;]+)/i.exec(disposition)?.slice(1).find(Boolean) || '';
  try { serverName = decodeURIComponent(serverName); } catch { /* keep original */ }
  let pathName = new URL(r.url).pathname.split('/').pop() || '';
  try { pathName = decodeURIComponent(pathName); } catch { /* keep original */ }
  let filename = name.trim() || serverName || pathName;
  const type = (r.headers.get('content-type') || '').split(';')[0].trim();
  if (new TextDecoder().decode(r.data.subarray(0, 200)).startsWith('version https://git-lfs.github.com/spec/v1')) throw new Error('这是 Git LFS 文件指针，请在原仓库下载实际书籍后导入');
  const looksHtml = /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(new TextDecoder().decode(r.data.subarray(0, 512)));
  if ((type === 'text/html' || looksHtml) && !(BOOK_EXT.test(filename) && /\.(html?|xhtml)$/i.test(filename))) throw new Error('这是网页或登录/分享页面，不是电子书文件。请先导出文档，或提供真实文件下载链接。');
  if (!BOOK_EXT.test(filename) && MIME_EXT[type]) filename = (filename || '网络藏书') + '.' + MIME_EXT[type];
  if (!BOOK_EXT.test(filename)) throw new Error('无法识别文件格式，请填写包含扩展名的文件名（如 书名.epub）');
  filename = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-180);
  if (!r.data.length) throw new Error('文件为空');
  return new File([r.data], filename, { type });
}

export interface BookSource { bookSourceName: string; bookSourceUrl: string; searchUrl: string; ruleSearch: Record<string, string>; ruleBookInfo?: Record<string, string>; ruleToc: Record<string, string>; ruleContent: Record<string, string>; format?: 'legacy' | 'declarative'; httpUserAgent?: string; requestHeaders?: Record<string, string> }
export const GXHJ_TEXT_SOURCE: BookSource = { bookSourceName: '国学汉籍', bookSourceUrl: 'https://www.gxhj.com/', searchUrl: '/', ruleSearch: {}, ruleToc: {}, ruleContent: { content: '.panel.content .mcon@html' } };
function ruleParts(rule: string): { css: string; attr: string } {
  if (/[@<]js|javascript:|\{\{|\$\.|^\/|##|&&|\|\||@(?:webview|json|xpath)|\$\d/i.test(rule)) throw new Error('含脚本、替换或组合规则，本版仅支持 CSS 规则');
  const parts = rule.replace(/^@css:/i, '').split('@');
  let attr = 'text';
  if (parts.length > 1) attr = parts.pop()!;
  if (parts.length !== 1 || !/^(text|html|href|src|title|content|all)$/.test(attr)) throw new Error('不支持此提取规则，仅支持 CSS@text/html/href/src/title/content');
  const css = parts[0].replace(/^(class|id|tag)\.([\w-]+)$/, (_, kind, value) => (kind === 'class' ? '.' : kind === 'id' ? '#' : '') + value);
  if (css) { try { document.createElement('div').querySelector(css); } catch { throw new Error(`不支持的 CSS 选择器：${css}`); } }
  return { css, attr };
}
function elements(root: ParentNode, rule: string): Element[] {
  const { css } = ruleParts(rule);
  return css ? Array.from(root.querySelectorAll(css)) : root instanceof Element ? [root] : [];
}
function extract(root: ParentNode, rule: string): string {
  if (!rule) return '';
  const { attr } = ruleParts(rule);
  return elements(root, rule).map((el) => attr === 'html' ? el.innerHTML : attr === 'text' || attr === 'all' ? el.textContent || '' : el.getAttribute(attr) || '').join(attr === 'html' ? '' : '\n').trim();
}
export const MAX_SOURCE_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_SOURCE_COUNT = 100000;
function sourceList(text: string): unknown[] {
  let json: unknown;
  try { json = JSON.parse(text.replace(/^\uFEFF/, '').trim()); }
  catch { throw new Error('书源文件需包含 JSON 格式的阅读 / Legado 规则；支持 .json 或 .txt 文件，纯网址列表不是书源规则。'); }
  const list = Array.isArray(json) ? json : [json];
  if (list.length > MAX_SOURCE_COUNT) throw new Error('每次最多导入 100000 个书源');
  return list;
}
function parseSourceItems(list: any[], validatedRules = new Set<string>()): { sources: BookSource[]; rejected: string[] } {
  const sources: BookSource[] = [], rejected: string[] = [];
  for (const source of list) {
    const name = String(source?.bookSourceName || '未命名书源');
    try {
      if (!source || typeof source !== 'object') throw new Error('格式错误');
      secureUrl(source.bookSourceUrl);
      assertPublicSource(source);
      const headers = sourceHeaders(source.header || source.requestHeaders, source.bookSourceUrl);
      if (typeof source.ruleSearchUrl === 'string' && !source.searchUrl) { const item = normalizeLegacySource(source); item.requestHeaders = headers; sources.push(item); continue; }
      if (source.format === 'legacy') {
        validateLegacySource(source);
        sources.push({ bookSourceName: name, bookSourceUrl: source.bookSourceUrl, searchUrl: source.searchUrl, ruleSearch: source.ruleSearch, ruleBookInfo: source.ruleBookInfo, ruleToc: source.ruleToc, ruleContent: source.ruleContent, format: 'legacy', httpUserAgent: source.httpUserAgent, requestHeaders: headers }); continue;
      }
      if (typeof source.searchUrl !== 'string') throw new Error('缺少搜索地址');
      const item: BookSource = { bookSourceName: name, bookSourceUrl: source.bookSourceUrl, searchUrl: source.searchUrl, ruleSearch: source.ruleSearch, ruleBookInfo: source.ruleBookInfo, ruleToc: source.ruleToc, ruleContent: source.ruleContent, format: 'declarative', requestHeaders: headers };
      validateDeclarativeSource(item, validatedRules);
      sources.push(item);
    } catch (e) { rejected.push(`${name}：${e instanceof Error ? e.message : '规则不兼容'}`); }
  }
  return { sources, rejected };
}
export function parseSources(text: string): { sources: BookSource[]; rejected: string[] } {
  return parseSourceItems(sourceList(text));
}
export async function validateSourcesAsync(list: unknown[], signal: AbortSignal, progress?: (text: string) => void) {
  if (!Array.isArray(list) || list.length > MAX_SOURCE_COUNT) throw new Error('最多保存 100000 个书源');
  const sources: BookSource[] = [], rejected: string[] = [], validatedRules = new Set<string>();
  for (let start = 0; start < list.length; start += 250) {
    signal.throwIfAborted();
    const batch = parseSourceItems(list.slice(start, start + 250), validatedRules);
    for (const item of batch.sources) sources.push(item);
    for (const item of batch.rejected) rejected.push(item);
    progress?.(`正在检查书源 ${Math.min(start + 250, list.length)} / ${list.length}`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted(); return { sources, rejected };
}
export async function parseSourcesAsync(text: string, signal: AbortSignal, progress?: (text: string) => void) {
  signal.throwIfAborted();
  return validateSourcesAsync(sourceList(text), signal, progress);
}
export async function mergeSources(existing: BookSource[], incoming: BookSource[], signal: AbortSignal): Promise<BookSource[]> {
  const next: BookSource[] = [], positions = new Map<string, number>();
  for (const list of [existing, incoming]) for (let i = 0; i < list.length; i++) {
    signal.throwIfAborted();
    const source = list[i], key = JSON.stringify([source.bookSourceUrl, source.bookSourceName]);
    const position = positions.get(key);
    if (position !== undefined) next[position] = source;
    else {
      if (next.length >= MAX_SOURCE_COUNT) throw new Error('最多保存 100000 个书源，请先移除不用的书源');
      positions.set(key, next.length); next.push(source);
    }
    if (i % 1000 === 999) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted(); return next;
}
async function sourcePage(url: string, signal: AbortSignal, source?: BookSource, request?: ReturnType<typeof legacySearchRequest> & { headers?: Record<string, string> }) {
  const headers: Record<string, string> = { ...(request?.headers || source?.requestHeaders) };
  if (source?.httpUserAgent) { for (const key of Object.keys(headers)) if (/^user-agent$/i.test(key)) delete headers[key]; headers['User-Agent'] = source.httpUserAgent; }
  if (request?.method === 'POST' && !Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=' + request.charset;
  const r = await requestBytes(url, { signal, anonymous: true, limit: 4 * 1024 * 1024, headers, method: request?.method, body: request?.body });
  const text = decodeSourceResponse(r.data, r.headers.get('content-type') || '');
  const doc = new DOMParser().parseFromString(text, 'text/html');
  let data: SourceData = doc;
  if (/^\s*[\[{]/.test(text)) { try { const json = JSON.parse(text); if (json && typeof json === 'object') data = json; } catch { /* HTML response with a JSON-like prefix */ } }
  return { doc, data, url: r.url };
}
function sourceItems(source: BookSource, data: SourceData, rule: string): SourceData[] {
  return source.format === 'legacy' ? legacyElements(data as ParentNode, rule) : sourceRuleItems(data, rule);
}
function sourceValue(source: BookSource, data: SourceData, rule: string | undefined, signal: AbortSignal) {
  return source.format === 'legacy' ? legacyExtract(data as ParentNode, rule, signal) : sourceRuleValue(data, rule, signal);
}
let cachedChapterBook: { key: string; urls: Set<string> } | undefined;
function chapterBookKey(source: BookSource, book: CatalogEntry) { return JSON.stringify([source.bookSourceUrl, book.url]); }
function rememberChapters(source: BookSource, book: CatalogEntry, chapters: CatalogEntry[]) {
  cachedChapterBook = { key: chapterBookKey(source, book), urls: new Set(chapters.map(c => c.url)) };
  return chapters;
}
function sameChapterPage(first: string, next: string): boolean {
  const a = new URL(first), b = new URL(next);
  if (a.origin !== b.origin) return false;
  const stem = (path: string) => path.replace(/[_-]\d+(?=\.[a-z]+$)/i, '');
  if (a.pathname !== b.pathname && stem(a.pathname) === stem(b.pathname)) return true;
  if (a.pathname !== b.pathname) return false;
  const params = new Set([...a.searchParams.keys(), ...b.searchParams.keys()]);
  let changedPage = false;
  for (const key of params) {
    if (a.searchParams.get(key) === b.searchParams.get(key)) continue;
    if (!/^(page|p|pageno|pageindex|part|offset)$/i.test(key)) return false;
    changedPage = true;
  }
  return changedPage;
}
export async function searchSource(source: BookSource, query: string, page: number, signal: AbortSignal): Promise<CatalogEntry[]> {
  if (!query.trim()) throw new Error('请输入书名或作者');
  if (source.format) {
    const request = source.format === 'legacy' ? legacySearchRequest(source.searchUrl, source.bookSourceUrl, query.trim(), page) : sourceSearchRequest(source.searchUrl, source.bookSourceUrl, query.trim(), page, source.requestHeaders);
    const r = await sourcePage(request.url, signal, source, request), entries: CatalogEntry[] = [];
    const filterTitle = source.ruleSearch.filter === 'title';
    for (const el of sourceItems(source, source.format === 'legacy' ? r.doc : r.data, source.ruleSearch.bookList).slice(0, filterTitle ? 10000 : 200)) {
      signal.throwIfAborted();
      const title = await sourceValue(source, el, source.ruleSearch.name, signal);
      if (filterTitle && !title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue;
      const url = maybeUrl(await sourceValue(source, el, source.ruleSearch.bookUrl, signal), r.url);
      const author = await sourceValue(source, el, source.ruleSearch.author, signal);
      if (title && url) entries.push({ title, author, url, download: false });
      if (entries.length >= 200) break;
    }
    return entries;
  }
  const url = secureUrl(source.searchUrl.replace(/\{\{\s*key\s*\}\}/g, encodeURIComponent(query.trim())).replace(/\{\{\s*page\s*\}\}/g, String(page)), source.bookSourceUrl);
  const r = await sourcePage(url, signal), rules = source.ruleSearch;
  return elements(r.doc, rules.bookList).slice(0, 200).flatMap((el) => {
    const title = extract(el, rules.name), url = maybeUrl(extract(el, rules.bookUrl), r.url);
    return title && url ? [{ title, author: extract(el, rules.author), url, download: false }] : [];
  });
}
export function sourceHasSearchPages(source: BookSource): boolean { return /searchPage|\{\{\s*page(?:\s*[+-]\s*\d+)?\s*\}\}/.test(source.searchUrl); }
export async function sourceChapters(source: BookSource, book: CatalogEntry, signal: AbortSignal): Promise<CatalogEntry[]> {
  let r = await sourcePage(book.url, signal, source);
  if (source.format) {
    let detailData = source.format === 'legacy' ? r.doc : r.data;
    if (source.format === 'declarative' && source.ruleBookInfo?.init) {
      const roots = sourceItems(source, r.data, source.ruleBookInfo.init);
      if (roots.length) detailData = roots[0];
    }
    if (source.ruleBookInfo?.tocUrl) {
      const toc = await sourceValue(source, detailData, source.ruleBookInfo.tocUrl, signal);
      if (toc) {
        const url = secureUrl(toc.split('\n')[0], r.url);
        if (url !== r.url) r = await sourcePage(url, signal, source);
      } else if (!sourceItems(source, source.format === 'legacy' ? r.doc : r.data, source.ruleToc.chapterList).length) throw new Error('书源未能提取目录链接');
    }
    const visited = new Set<string>(), seen = new Set<string>(), entries: CatalogEntry[] = [];
    for (let page = 0; page < 100; page++) {
      signal.throwIfAborted(); visited.add(r.url);
      const items = sourceItems(source, source.format === 'legacy' ? r.doc : r.data, source.ruleToc.chapterList);
      if (!items.length) throw new Error('没有提取到章节，网站可能已改版或此旧书源已失效');
      for (const el of items) {
        const title = await sourceValue(source, el, source.ruleToc.chapterName, signal);
        const url = maybeUrl(await sourceValue(source, el, source.ruleToc.chapterUrl, signal), r.url);
        if (title && url && !seen.has(url)) { seen.add(url); entries.push({ title, url, download: false }); }
        if (entries.length > 20000) throw new Error('章节数超过限制');
      }
      const nextLinks = await sourceValue(source, source.format === 'legacy' ? r.doc : r.data, source.ruleToc.nextTocUrl, signal);
      const next = nextLinks.split('\n').map(v => maybeUrl(v.trim(), r.url)).find(v => v && !visited.has(v) && !seen.has(v));
      if (!next) return rememberChapters(source, book, String(source.ruleToc.isReverse) === 'true' ? entries.reverse() : entries);
      if (page === 99) throw new Error('目录超过 100 页，请检查书源分页规则');
      visited.add(next); r = await sourcePage(next, signal, source);
    }
    return rememberChapters(source, book, entries);
  }
  if (source.ruleBookInfo?.tocUrl) {
    const toc = extract(r.doc, source.ruleBookInfo.tocUrl);
    if (!toc) throw new Error('书源未能提取目录链接');
    const url = secureUrl(toc, r.url); if (url !== r.url) r = await sourcePage(url, signal);
  }
  const rules = source.ruleToc, seen = new Set<string>();
  const entries = elements(r.doc, rules.chapterList).flatMap((el) => {
    const title = extract(el, rules.chapterName), url = maybeUrl(extract(el, rules.chapterUrl), r.url);
    if (!title || !url || seen.has(url)) return []; seen.add(url);
    return [{ title, url, download: false }];
  });
  if (!entries.length) throw new Error('没有提取到章节，书源规则可能已失效');
  if (entries.length > 20000) throw new Error('章节数超过限制');
  return rememberChapters(source, book, entries);
}
export async function downloadChapters(source: BookSource, book: CatalogEntry, chapters: CatalogEntry[], signal: AbortSignal, progress: (text: string) => void): Promise<File> {
  if (!chapters.length || chapters.length > 10000) throw new Error('每次请选择 1–10000 章');
  const parts: string[] = []; let size = 0;
  const knownChapters = cachedChapterBook?.key === chapterBookKey(source, book) ? cachedChapterBook.urls : new Set(chapters.map(c => c.url));
  for (let i = 0; i < chapters.length; i++) {
    signal.throwIfAborted(); progress(`正在下载 ${i + 1} / ${chapters.length} 章`);
    const chapter = chapters[i];
    let r = await sourcePage(chapter.url, signal, source);
    let raw = source.format ? await sourceValue(source, source.format === 'legacy' ? r.doc : r.data, source.ruleContent.content, signal) : extract(r.doc, source.ruleContent.content);
    if (source.format && source.ruleContent.nextContentUrl) {
      const visited = new Set([r.url]);
      let chapterBytes = new TextEncoder().encode(raw).length;
      for (let page = 0; page < 100; page++) {
        const next = (await sourceValue(source, source.format === 'legacy' ? r.doc : r.data, source.ruleContent.nextContentUrl, signal)).split('\n').map(v => maybeUrl(v.trim(), r.url)).find(v => v && !visited.has(v));
        if (!next) break;
        // Many old sources use a next-chapter link here. Never merge other TOC chapters.
        if (knownChapters.has(next) && next !== chapter.url) break;
        if (!sameChapterPage(chapter.url, next)) throw new Error('正文分页地址无法确认属于本章，请检查书源分页规则');
        if (page === 99) throw new Error('正文分页超过 100 页，请检查书源');
        visited.add(next); r = await sourcePage(next, signal, source); visited.add(r.url);
        const part = await sourceValue(source, source.format === 'legacy' ? r.doc : r.data, source.ruleContent.content, signal);
        if (!part.trim()) throw new Error('正文分页内容为空，未保存本批章节');
        chapterBytes += new TextEncoder().encode(part).length + 1;
        if (chapterBytes + size > MAX_DOWNLOAD_BYTES) throw new Error('本批正文超过 256 MiB，请减少章节数');
        raw += '\n' + part;
      }
    }
    if (source.format === 'declarative' && source.ruleContent.replaceRegex) {
      const rule = source.ruleContent.replaceRegex;
      raw = await sourceRuleValue({ value: raw }, '$.value' + (rule.startsWith('##') ? rule : '##' + rule), signal);
    }
    if (!raw.trim()) throw new Error(`《${chapter.title}》正文为空，未保存本批章节`);
    const isHtml = source.format === 'legacy' ? legacyContentIsHtml(source.ruleContent.content) : source.format === 'declarative' ? sourceRuleIsHtml(source.ruleContent.content) || /^\s*<(?:p|div|br)\b/i.test(raw) : ruleParts(source.ruleContent.content).attr === 'html';
    const content = isHtml ? raw : raw.split(/\n+/).map((p) => `<p>${escapeHtml(p)}</p>`).join('');
    const safe = parseHtml(content, chapter.title).chapters.map((c) => c.html).join('');
    size += new TextEncoder().encode(safe).length; if (size > MAX_DOWNLOAD_BYTES) throw new Error('本批正文超过 256 MiB，请减少章节数');
    parts.push(`<h2>${escapeHtml(chapter.title)}</h2>${safe}`);
  }
  signal.throwIfAborted();
  return new File([`<html><head><title>${escapeHtml(book.title)}</title><meta name="author" content="${escapeHtml(book.author || '')}"></head><body>`, ...parts, '</body></html>'], `${book.title}.html`, { type: 'text/html' });
}
