import { shelfAction, shelfView, shelfSort, shelfVersion } from './shelf-actions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5195, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; console.log('✓ ' + message); };
const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>古腾堡目录</title><entry><title>经典测试</title><link href="/ebooks/1.opds" type="application/atom+xml" /></entry></feed>';
const toc = '<title>论语 · 国学汉籍</title><h3>论语</h3><ul class="lst8"><li><a href="/txt/classic/1.html">学而第一</a></li><li><a href="/txt/classic/2.html">为政第二</a></li></ul>';
const github = [{ type: 'dir', name: '分类', url: 'https://api.github.com/repos/demo/books/contents/classics' }, { type: 'file', name: '经典.txt', size: 100, download_url: 'https://raw.githubusercontent.com/demo/books/main/book.txt' }, { type: 'file', name: 'data.json', size: 100, download_url: 'https://raw.githubusercontent.com/demo/books/main/data.json' }, { type: 'file', name: '超大.pdf', size: 300 * 1024 * 1024, download_url: 'https://raw.githubusercontent.com/demo/books/main/big.pdf' }];
try {
  fs.mkdirSync('output/playwright', { recursive: true });
  await page.route('https://www.gutenberg.org/**', (route) => route.fulfill({ body: atom, contentType: 'application/atom+xml' }));
  await page.route('https://www.gxhj.com/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/' ? '<title>国学汉籍</title><a href="/txt/classic/">论语</a>' : path === '/txt/classic/' ? toc : '<nav>站点导航</nav><div class="panel content"><h3>章节</h3><div class="mcon"><p>学而时习之，不亦说乎？</p><script>unsafe()</script></div></div>';
    return route.fulfill({ body, contentType: 'text/html' });
  });
  await page.route('https://api.github.com/**', (route) => route.fulfill({ body: JSON.stringify(github), contentType: 'application/json' }));
  await page.route('https://raw.githubusercontent.com/**', (route) => route.fulfill({ body: '经典正文\n书库下载内容。', contentType: 'text/plain' }));
  await page.route('https://haodoo.net/**', (route) => route.fulfill({ body: '<title>好读</title><a href="?M=book&P=435">呐喊</a><input value="下载 EPUB" onclick="DownloadEpub(\'A435\')">', contentType: 'text/html' }));
  await page.route('https://haodoo.org/**', (route) => route.fulfill({ body: '<h1>好读二代</h1><article><h2 class="wp-block-post-title"><a href="?p=100">好读藏书</a></h2></article>', contentType: 'text/html' }));
  await page.goto('http://127.0.0.1:5195'); await page.locator('.shelf').waitFor();
  const cases = await page.evaluate(async ({ toc, github }) => {
    const net = await import('/src/engine/networkLibrary.ts');
    const pdf = await import('/src/engine/pdfReflow.ts');
    const checks = [];
    const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    const reject = async (fn, label, fragment) => { try { await fn(); } catch (e) { check(!fragment || e.message.includes(fragment), label); return; } throw new Error(label); };
    check(net.gutenbergSearch(' 红楼梦 & 诗 ') === 'https://www.gutenberg.org/ebooks/search.opds/?query=%E7%BA%A2%E6%A5%BC%E6%A2%A6%20%26%20%E8%AF%97', 'Gutenberg search correctly encodes Chinese and special characters');
    const web = net.parseWebList('<title>公开书单</title><base href="https://files.test/books/"><nav><a href="/nav">导航</a></nav><a href="a.epub">一本</a><a href="a.epub">重复</a><a href="http://bad.test/b.epub">降级</a><a href="javascript:bad()">脚本</a><a href="/download?id=1" download="第二本.pdf">二</a><div style="display: none"><a href="hidden.epub">隐藏</a></div><a href="/next">下页</a>', 'https://files.test/list');
    check(web.entries.length === 3 && web.entries[0].url === 'https://files.test/books/a.epub' && web.entries[1].filename === '第二本.pdf', 'web booklist resolves base URLs, deduplicates and filters hidden/unsafe links');
    await reject(() => net.parseWebList('<div id="app"></div><script>dynamic()</script>', 'https://example.feishu.cn/doc'), 'dynamic Feishu page explains direct-file fallback', '动态加载');
    const gx = net.parseWebList(toc, 'https://www.gxhj.com/txt/classic/');
    check(gx.chapterBook?.chapters.length === 2 && gx.entries.every((e) => e.textPage === 'gxhj'), 'gxhj TOC exposes ordered text chapter range');
    check(!net.parseWebList(toc, 'https://unrelated.test/txt/classic/').chapterBook, 'gxhj extraction is restricted to its actual host');
    check(net.githubCatalogUrl('https://github.com/demo/books.git') === 'https://api.github.com/repos/demo/books/contents', 'GitHub repository URL resolves without installing a Git client');
    await reject(() => net.githubCatalogUrl('https://github.com/demo/books/tree/main'), 'unsupported GitHub tree address explains repository homepage');
    const repo = net.parseGithub(JSON.stringify(github), 'https://api.github.com/repos/demo/books/contents');
    check(repo.entries.length === 2 && !repo.entries[0].download && repo.entries[1].filename === '经典.txt', 'GitHub shows subfolders and supported files, omits oversized and JSON files');
    const realFetch = window.fetch;
    try {
      window.fetch = async () => new Response('{}', { status: 403 });
      await reject(() => net.fetchCatalog('https://github.com/demo/books', 'github', new AbortController().signal), 'GitHub anonymous rate limit has actionable message', '频率');
      let auth;
      window.fetch = async (_, init) => { auth = init.headers.Authorization; return new Response('[]'); };
      await net.fetchCatalog('https://github.com/demo/books', 'github', new AbortController().signal, { origin: 'https://api.github.com', username: 'private', password: 'secret' });
      check(!auth, 'GitHub browsing never forwards catalog credentials');
      window.fetch = async () => new Response('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123');
      await reject(() => net.downloadBook('https://raw.githubusercontent.com/demo/book.txt', '', new AbortController().signal), 'Git LFS pointer rejected instead of imported as a book', 'LFS');
    } finally { window.fetch = realFetch; }
    const chapterFile = await net.downloadChapters(net.GXHJ_TEXT_SOURCE, { title: '论语', url: 'https://www.gxhj.com/txt/classic/', download: false }, gx.chapterBook.chapters, new AbortController().signal, () => {});
    const chapterHtml = await chapterFile.text();
    check(chapterHtml.includes('<h2>学而第一</h2>') && chapterHtml.includes('<h2>为政第二</h2>') && !chapterHtml.includes('unsafe') && !chapterHtml.includes('站点导航'), 'gxhj batch extraction imports only sanitized chapter text');
    const cancel = new AbortController();
    await reject(() => net.downloadChapters(net.GXHJ_TEXT_SOURCE, { title: '取消', url: '', download: false }, gx.chapterBook.chapters, cancel.signal, () => cancel.abort()), 'cancelled chapter batch returns no partial book');
    const item = (str, x, y, width = 20, hasEOL = false) => ({ str, dir: 'ltr', transform: [12, 0, 0, 12, x, y], width, hasEOL });
    const lines = pdf.pdfTextLines([item('Hello', 0, 100), item('world', 30, 100), item('中文', 0, 80), item('正文', 30, 80)]);
    check(lines.join('|') === 'Hello world|中文正文', 'PDF line extraction separates Latin words while preserving Chinese spacing');
    const doc = { numPages: 2, getPermissions: async () => null, getPage: async (n) => ({ getTextContent: async () => ({ items: n === 1 ? [item('<Test & text>', 0, 100)] : [] }) }) };
    const output = await pdf.reflowPdf(doc, '测试PDF', '作者', 1, 2, new AbortController().signal, () => {});
    const html = await output.file.text();
    check(output.emptyPages === 1 && html.includes('&lt;Test &amp; text&gt;') && html.includes('原第 2 页'), 'PDF reflow escapes markup, retains page chapters and labels empty pages');
    await reject(() => pdf.reflowPdf(doc, '', '', 0, 2, new AbortController().signal, () => {}), 'invalid PDF range rejected', '页码');
    await reject(() => pdf.reflowPdf(doc, '', '', 2, 2, new AbortController().signal, () => {}), 'image-only PDF range explains absence of OCR', 'OCR');
    await reject(() => pdf.reflowPdf({ ...doc, getPermissions: async () => [4] }, '', '', 1, 2, new AbortController().signal, () => {}), 'PDF copy restriction respected', '限制文字提取');
    const abort = new AbortController();
    await reject(() => pdf.reflowPdf(doc, '', '', 1, 2, abort.signal, () => abort.abort()), 'cancelled PDF extraction returns no partial file');
    return checks;
  }, { toc, github });
  cases.forEach((label) => ok(true, label));

  // Locally saved public responses are optional evidence, never a test dependency or bundled content.
  for (const [path, kind, url] of [['.tmp/gutenberg-book.txt', 'opds', 'https://www.gutenberg.org/ebooks/1513.opds'], ['.tmp/gxhj-book.html', 'web', 'https://www.gxhj.com/txt/1100054rmhm/']]) {
    if (!fs.existsSync(path)) continue;
    const result = await page.evaluate(async ({ text, kind, url }) => { const net = await import('/src/engine/networkLibrary.ts'); const c = kind === 'opds' ? net.parseOpds(text, url) : net.parseWebList(text, url); return { downloads: c.entries.filter((e) => e.download).length, chapters: c.chapterBook?.chapters.length }; }, { text: fs.readFileSync(path, 'utf8'), kind, url });
    ok(kind === 'opds' ? result.downloads > 0 : result.chapters > 100, `saved live ${kind} response exposes real acquisitions/chapters`);
  }

  await shelfAction(page, '网络书库');
  await page.getByText('更多书库 · 古籍与公共藏书', { exact: true }).click();
  for (const width of [320, 390, 460]) {
    await page.setViewportSize({ width, height: 844 });
    ok(await page.locator('.drawer').evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && el.getBoundingClientRect().left >= 0), `expanded public libraries fit ${width}px phone`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/public-libraries-mobile.png' });
  await page.evaluate(() => { window.__openedSites = []; window.ReadingTreeNativeMenu = { openWebsite: (site) => { window.__openedSites.push(site); return true; } }; });
  for (const site of ['net','org']) {
    await page.getByRole('button').filter({hasText:'好读 · haodoo.'+site}).click();await page.locator('.network-entry').first().waitFor();
    ok((await page.getByLabel('书库地址',{exact:true}).inputValue())==='https://haodoo.'+site+'/', 'Haodoo '+site+' opens in-app catalog');
    await page.getByRole('button',{name:'在原站打开本页 ↗',exact:true}).click();
  }
  for (const title of ['中国国家图书馆', '书格']) await page.getByRole('button').filter({ hasText: title }).click();
  ok(await page.evaluate(() => window.__openedSites.join('|') === 'https://haodoo.net/|https://haodoo.org/|national-library|shuge'), 'external actions open known catalog pages without login or cart actions');
  await page.getByRole('button', { name: '中文藏书', exact: true }).click(); await page.getByRole('heading', { name: '古腾堡目录' }).waitFor();
  ok((await page.getByLabel('书库地址', { exact: true }).inputValue()).endsWith('?query=l.zh'), 'Gutenberg Chinese preset opens official OPDS');
  await page.getByLabel('搜索古腾堡').fill('红楼梦'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.network-status'));
  ok((await page.getByLabel('书库地址', { exact: true }).inputValue()).includes('%E7%BA%A2'), 'Gutenberg search is wired to official catalog');
  await page.getByRole('button').filter({ hasText: '国学汉籍' }).click(); await page.locator('.network-entry').filter({ hasText: '论语' }).click();
  await page.getByLabel('下载章数').fill('1'); await page.getByRole('button', { name: '下载所选章节' }).click();
  await page.getByText('《论语 · 1–1章》已加入书架', { exact: true }).waitFor();
  ok(await page.getByLabel('起始章节').inputValue() === '2', 'gxhj selected chapter imports and next range advances one batch');
  await page.locator('.network-entry').filter({ hasText: '为政第二' }).click(); await page.getByText('《论语 · 为政第二》已加入书架', { exact: true }).waitFor();
  ok(true, 'single gxhj chapter imports with parent book title');
  await page.screenshot({ path: 'output/playwright/gxhj-chapters-mobile.png' });
  await page.getByLabel('书库类型').selectOption('github');
  await page.getByLabel('书库地址', { exact: true }).fill('https://github.com/demo/books');
  await page.getByRole('button', {name:'打开书库',exact:true}).click();
  await page.locator('.network-entry').filter({ hasText: '分类' }).click();
  await page.getByRole('button', { name: '返回上层' }).waitFor();
  await page.locator('.network-entry').filter({ hasText: '经典.txt' }).click(); await page.getByText('《经典》已加入书架', { exact: true }).waitFor();
  ok(true, 'GitHub directory browsing and Raw file download work through UI');
  await page.evaluate(() => window.readingTreeBack()); await page.locator('.drawer').waitFor({ state: 'hidden' });

  await page.evaluate(async () => {
    const stream = 'BT /F1 16 Tf 24 340 Td (Readable PDF text) Tj 0 -30 Td (Second line for reflow.) Tj ET';
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'];
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length; pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => String(o).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await window.__rtLib.getState().importFile(new File([pdf], '文字版PDF.pdf', { type: 'application/pdf' }));
  });
  await page.getByRole('button', { name: '阅读《文字版PDF》', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.head-title span')?.textContent === 'PDF · 2 页');
  await page.getByRole('button', { name: '书签', exact: true }).click(); await page.getByRole('button', { name: '添加当前位置' }).click(); await page.locator('.bookmark-entry').waitFor();
  await page.evaluate(() => window.readingTreeBack());
  await page.getByRole('button', { name: '文字重排', exact: true }).click();
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    ok(await page.locator('.drawer').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `PDF reflow dialog fits ${width}px phone`);
  }
  await page.evaluate(() => window.readingTreeBack()); await page.locator('.drawer').waitFor({ state: 'hidden' });
  ok(await page.locator('.pdf-page').isVisible(), 'Android back closes reflow panel before leaving PDF');
  await page.getByRole('button', { name: '文字重排', exact: true }).click(); await page.getByLabel('从第几页').fill('0');
  ok(await page.getByRole('button', { name: '生成重排副本' }).isDisabled(), 'UI prevents invalid PDF page range');
  await page.getByLabel('从第几页').fill('1'); await page.getByRole('button', { name: '生成重排副本' }).click();
  await page.getByRole('button', { name: '阅读重排副本' }).waitFor();
  await page.screenshot({ path: 'output/playwright/pdf-reflow-mobile.png' });
  await page.getByRole('button', { name: '阅读重排副本' }).click();
  await page.waitForFunction(() => document.querySelector('.page-inner')?.textContent?.includes('Readable PDF text'));
  ok(true, 'real PDF.js text extraction creates and opens readable reflow book');
  ok(await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts'); const books = window.__rtLib.getState().books;
    const original = books.find((b) => b.title === '文字版PDF'); const copy = books.find((b) => b.title.includes('文字重排'));
    const notes = await platform.kvGet('annotations:' + original.id); const chapters = await platform.getChapters(copy.id);
    return original.format === 'pdf' && copy.id !== original.id && notes.list.length === 1 && chapters.length === 2 && !!(await platform.kvGet('file:' + original.id));
  }), 'PDF original, source bytes and bookmark remain intact beside independent reflow copy');
  await page.evaluate(() => window.readingTreeBack()); await page.locator('.shelf').waitFor();
  ok(errors.length === 0, 'new catalog and PDF flows have no runtime errors: ' + errors.join('; '));
  console.log(`${checks} public library and PDF reflow checks passed.`);
} finally { await browser.close(); await server.close(); }
