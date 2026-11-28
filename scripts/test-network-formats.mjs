import { shelfAction, shelfView, shelfSort, shelfVersion } from './shelf-actions.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5194, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; console.log('✓ ' + message); };
const source = { bookSourceName: '测试纯 CSS 书源', bookSourceUrl: 'https://library.test', searchUrl: '/search?q={{key}}&page={{page}}', ruleSearch: { bookList: '.book', name: 'a@text', bookUrl: 'a@href', author: '.author@text' }, ruleToc: { chapterList: '.toc a', chapterName: '@text', chapterUrl: '@href' }, ruleContent: { content: '#content@html' } };
const atom = '<feed xmlns="http://www.w3.org/2005/Atom"><title>我的远方书库</title><entry><title>网络测试书</title><author><name>测试作者</name></author><link rel="http://opds-spec.org/acquisition/open-access" type="text/plain" href="/files/book.txt" /></entry><entry><title>古籍分馆</title><link type="application/atom+xml;profile=opds-catalog" href="/sub" /></entry><link rel="next" href="/next" /></feed>';
const makeZip = (files) => Array.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, value]) => [n, strToU8(value)]))));
const wrap = (tag, body) => `<ofd:${tag} xmlns:ofd="http://www.ofdspec.org/2016">${body}</ofd:${tag}>`;
const ofd = {
  'OFD.xml': wrap('OFD', '<ofd:DocBody><ofd:DocRoot>Doc/Document.xml</ofd:DocRoot></ofd:DocBody>'),
  'Doc/Document.xml': wrap('Document', '<ofd:CommonData><ofd:TemplatePage ID="9" BaseLoc="Template.xml"/></ofd:CommonData><ofd:Pages><ofd:Page ID="1" BaseLoc="Page.xml"/></ofd:Pages>'),
  'Doc/Template.xml': wrap('Page', '<ofd:Content><ofd:Layer><ofd:TextObject Boundary="0 0 100 100"><ofd:TextCode X="0" Y="0">模板标题</ofd:TextCode></ofd:TextObject></ofd:Layer></ofd:Content>'),
  'Doc/Page.xml': wrap('Page', '<ofd:Template TemplateID="9"/><ofd:Content><ofd:Layer><ofd:TextObject Boundary="0 0 100 100" CTM="1 0 0 1 0 10"><ofd:TextCode X="0" Y="0" DeltaX="g 10 4">Hello world</ofd:TextCode></ofd:TextObject><ofd:TextObject Boundary="0 0 100 100"><ofd:TextCode X="0" Y="20">末行</ofd:TextCode></ofd:TextObject></ofd:Layer></ofd:Content>'),
};
try {
  fs.mkdirSync('output/playwright', { recursive: true });
  await page.route('https://library.test/**', async (route) => {
    const u = new URL(route.request().url());
    let body, contentType = 'text/html';
    if (u.pathname === '/opds') { body = atom; contentType = 'application/atom+xml'; }
    else if (u.pathname === '/sub' || u.pathname === '/next') { body = atom.replace('我的远方书库', '第二页书库'); contentType = 'application/atom+xml'; }
    else if (u.pathname === '/files/book.txt') { body = '网络测试书\n\n第一章\n书库下载正文。'.repeat(30); contentType = 'text/plain'; }
    else if (u.pathname === '/search') body = '<div class="book"><a href="/novel">书源测试小说</a><span class="author">作者甲</span></div>';
    else if (u.pathname === '/novel') body = '<div class="toc"><a href="/chapter/1">第一章 初见</a><a href="/chapter/2">第二章 重逢</a></div>';
    else if (u.pathname.startsWith('/chapter/')) body = `<div id="content"><p>${u.pathname.endsWith('1') ? '第一章正文。' : '第二章正文。'}</p><script>throw new Error('unsafe')</script></div>`;
    else if (u.pathname === '/dav/') { body = '<d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/files/book.txt</d:href><d:propstat><d:prop><d:displayname>网盘书籍.txt</d:displayname></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'; contentType = 'application/xml'; }
    else body = '<!doctype html><html><body>请登录查看分享</body></html>';
    await route.fulfill({ body, contentType, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('http://127.0.0.1:5194'); await page.locator('.shelf').waitFor();
  const result = await page.evaluate(async ({ ofd, atom, source }) => {
    const { parseOfd, parseHtml } = await import('/src/engine/importExtra.ts');
    const net = await import('/src/engine/networkLibrary.ts');
    const md = await import('/src/engine/md.ts');
    const tests = [];
    const check = (value, label) => { if (!value) throw new Error(label); tests.push(label); };
    const reject = async (fn, label) => { let rejected = false; try { await fn(); } catch { rejected = true; } check(rejected, label); };
    const text = parseOfd(new Uint8Array(ofd).buffer, 'test').chapters[0].html;
    check(text.indexOf('模板标题') < text.indexOf('Hello world') && text.indexOf('Hello world') < text.indexOf('末行'), 'OFD template, CTM, DeltaX and spaces preserve reading order');
    const html = parseHtml('<title>导出文档</title><h1>一</h1><p onclick="bad()">正文<script>unsafe()</script><img src="https://evil.test/a"><iframe src="https://evil.test"></iframe></p><h2>二</h2><p>内容</p>', 'test');
    check(html.title === '导出文档' && html.chapters.length === 2 && !JSON.stringify(html).includes('evil.test') && !JSON.stringify(html).includes('unsafe') && !JSON.stringify(html).includes('onclick'), 'HTML keeps headings and text, removes executable and remote content');
    const parsed = net.parseOpds(atom, 'https://library.test/opds');
    check(parsed.entries.length === 2 && parsed.entries[0].download && parsed.entries[0].url === 'https://library.test/files/book.txt' && parsed.next === 'https://library.test/next', 'OPDS 1 relative acquisition and pagination');
    const json = net.parseOpds(JSON.stringify({ metadata: { title: 'OPDS 2' }, publications: [{ metadata: { title: '二', author: [{ name: '乙' }] }, links: [{ href: '/b.epub', type: 'application/epub+zip', rel: 'http://opds-spec.org/acquisition' }] }], navigation: [{ title: '目录', href: '/cat' }], links: [{ rel: ['next'], href: '/p2' }] }), 'https://library.test/');
    check(json.entries.length === 2 && json.entries[0].author === '乙' && json.next.endsWith('/p2'), 'OPDS 2 metadata, navigation and next page');
    await reject(() => net.parseOpds('<html>登录</html>', 'https://library.test'), 'share pages rejected as catalogs');
    check(net.secureUrl('http://library.test') === 'http://library.test/', 'HTTP catalogs supported');
    const httpFeed = net.parseOpds(atom, 'http://192.168.1.17:8765/opds');
    check(httpFeed.entries.length === 2 && httpFeed.entries[0].url === 'http://192.168.1.17:8765/files/book.txt' && httpFeed.next === 'http://192.168.1.17:8765/next', 'HTTP OPDS links and pagination preserved');
    await reject(() => net.secureUrl('file:///book.txt'), 'non-HTTP protocols rejected');
    await reject(() => net.secureUrl('https://user:password@library.test'), 'credentials in URLs rejected');
    check(net.parseSources(JSON.stringify(source)).sources.length === 1, 'pure CSS Legado source accepted');
    for (const patch of [{ ruleContent: { content: '@js:java.ajax(url)' } }, { searchUrl: '/search, {"method":"POST"}' }, { ruleContent: { ...source.ruleContent, webJs: 'window.run()' } }]) check(net.parseSources(JSON.stringify({ ...source, ...patch })).rejected.length === 1, 'unsupported Legado rule reported');
    check(net.parseSources(JSON.stringify({ ...source, searchUrl: '/search,{"method":"POST","body":"q={{key}}"}', ruleToc: { ...source.ruleToc, nextTocUrl: 'a@href' } })).sources.length === 1, 'anonymous POST search and declarative TOC pagination supported');
    const split = md.splitMdChapters('---\ntitle: 我的笔记\n---\n# **第一卷**\n\n## 小节一\n正文\n\n```md\n# 代码里的标题\n```\n\n## 小节二\n内容\n\n下一卷\n====\n\n末节\n----\n正文', 'fallback');
    check(split.title === '我的笔记' && split.chapters.map((c) => c.title).join('|') === '第一卷|小节一|小节二|下一卷|末节', 'Markdown H1/H2, Setext and bold headings parsed without code fences');
    check(md.mdToHtml(split.chapters[0].text).includes('<h1>') && split.chapters[1].level === 2, 'Markdown headings remain visible and levels preserved');
    const old = [{ title: '旧版第一章', html: '<p>旧笔记正文</p><h2>旧小节</h2><p>目标</p>' }];
    check(md.markdownOutline(old).length === 2 && md.markdownOutline(old)[1].heading === 0 && old[0].html.startsWith('<p>旧笔记正文</p>'), 'old Markdown outline added without changing stored content or annotation offsets');
    // Test the transport directly: native fetch shares this redirect/size/cancel logic.
    const realFetch = window.fetch; const calls = [];
    try {
      window.fetch = async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn.test/book.txt' } }) : new Response('正文', { headers: { 'content-type': 'text/plain' } }); };
      await net.requestBytes('https://library.test/book', { credentials: { origin: 'https://library.test', username: '用户', password: 'secret' } });
      check(calls[0].auth?.startsWith('Basic ') && !calls[1].auth, 'cross-origin redirects never forward Basic credentials');
      window.fetch = async () => new Response('123456789');
      await reject(() => net.requestBytes('https://library.test', { limit: 4 }), 'stream limit enforced without Content-Length');
      window.fetch = async () => new Response('abc', { headers: { 'content-length': '10000' } });
      await reject(() => net.requestBytes('https://library.test', { limit: 4 }), 'oversized Content-Length rejected before reading');
      window.fetch = async () => new Response('abc'); const abort = new AbortController(); abort.abort();
      await reject(() => net.requestBytes('https://library.test', { signal: abort.signal }), 'cancelled requests do not return imported bytes');
      window.fetch = async () => new Response('<html>请登录</html>', { headers: { 'content-type': 'text/html' } });
      await reject(() => net.downloadBook('https://library.test/share', 'book.epub', new AbortController().signal), 'login response cannot masquerade as EPUB');
    } finally { window.fetch = realFetch; }
    return tests;
  }, { ofd: makeZip(ofd), atom, source });
  result.forEach((label) => ok(true, label));
  const vertical = { ...ofd, 'Doc/Page.xml': wrap('Page', '<ofd:Content><ofd:Layer><ofd:TextObject Boundary="0 0 100 100"><ofd:TextCode X="20" Y="0" DeltaY="g 2 4">天地人</ofd:TextCode></ofd:TextObject><ofd:TextObject Boundary="0 0 100 100"><ofd:TextCode X="10" Y="0" DeltaY="g 2 4">山水月</ofd:TextCode></ofd:TextObject></ofd:Layer></ofd:Content>') };
  ok(await page.evaluate(async (bytes) => { const { parseOfd } = await import('/src/engine/importExtra.ts'); const html = parseOfd(new Uint8Array(bytes).buffer, 'vertical').chapters[0].html; return html === '<p>天地人</p><p>山水月</p>'; }, makeZip(vertical)), 'vertical OFD keeps right-to-left column order');
  ok(await page.evaluate(async (bytes) => { const { parseOfd } = await import('/src/engine/importExtra.ts'); try { parseOfd(new Uint8Array(bytes).buffer, 'bad'); return false; } catch (e) { return e.message.includes('实体'); } }, makeZip({ ...ofd, 'OFD.xml': '<!DOCTYPE x [<!ENTITY t "bad">]>' + ofd['OFD.xml'] })), 'OFD rejects XML entity definitions');
  const odt = makeZip({ 'content.xml': '<office:document-content xmlns:office="urn:o" xmlns:text="urn:t"><office:body><office:text><text:h>第一节</text:h><text:p>文档正文<text:s text:c="2"/>尾句</text:p></office:text></office:body></office:document-content>', 'meta.xml': '<office:document-meta xmlns:office="urn:o" xmlns:dc="urn:dc"><office:meta><dc:title>ODT测试</dc:title><dc:creator>作者</dc:creator></office:meta></office:document-meta>' });
  ok(await page.evaluate(async (bytes) => { const { parseOdt } = await import('/src/engine/importExtra.ts'); const b = parseOdt(new Uint8Array(bytes).buffer, 'odt'); return b.title === 'ODT测试' && b.author === '作者' && b.chapters[0].html.includes('文档正文  尾句'); }, odt), 'ODT metadata, headings and whitespace');
  // Optional external converter fixtures are deliberately not bundled with the application.
  for (const name of ['horizontal', 'vertical', 'half-leaf']) {
    const path = `E:/Anti/ebookhuan/书转/test/out/ofd/${name}.ofd`;
    if (!fs.existsSync(path)) continue;
    const stats = await page.evaluate(async (base64) => { const { parseOfd } = await import('/src/engine/importExtra.ts'); const b = parseOfd(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer, 'sample'); return { pages: b.chapters.length, chars: b.chapters.reduce((n, c) => n + c.chars, 0) }; }, fs.readFileSync(path).toString('base64'));
    ok(stats.pages > 0 && stats.chars > 20, `converter OFD ${name}: ${stats.pages} pages, ${stats.chars} characters`);
  }
  await shelfAction(page, '网络书库');
  await page.getByRole('dialog', { name: '网络书库' }).waitFor();
  for (const width of [320, 390, 460]) {
    await page.setViewportSize({ width, height: 844 });
    ok(await page.locator('.drawer').evaluate((el) => el.getBoundingClientRect().left >= 0 && el.getBoundingClientRect().right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1), `network panel fits ${width}px phone`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('书库二维码图片').setInputFiles('tests/fixtures/library-qr.png');
  await page.getByText('已识别书库地址，请确认类型和地址，再打开书库选择书籍，或收藏地址。', { exact: true }).waitFor();
  ok(await page.getByLabel('书库地址', { exact: true }).inputValue() === 'http://192.168.1.17:8765/opds', 'QR image decoded into Olib OPDS address');
  await page.evaluate(() => { window.ReadingTreeNativeScanner = { scan: id => window.readingTreeScanResult(id, 'http://192.168.1.17:8765/', '') }; });
  await page.getByRole('button', { name: '扫码添加书库', exact: true }).click();
  await page.getByText('已识别书库地址，请确认类型和地址，再打开书库选择书籍，或收藏地址。', { exact: true }).waitFor();
  ok(await page.getByLabel('书库地址', { exact: true }).inputValue() === 'http://192.168.1.17:8765/opds', 'Olib QR fills OPDS address for confirmation');
  await page.getByLabel('书库地址', { exact: true }).fill('https://library.test/opds');
  await page.getByRole('button', { name: '打开书库', exact: true }).click();
  await page.getByRole('heading', { name: '我的远方书库' }).waitFor();
  await page.locator('.network-entry').filter({ hasText: '网络测试书' }).click();
  await page.getByText('《网络测试书》已加入书架', { exact: true }).waitFor(); ok(true, 'OPDS acquisition imports offline book through public UI');
  await page.getByRole('button', { name: '收藏地址' }).click();
  await page.getByText('书库地址已收藏，账号密码仅在本次面板中使用', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下一页目录' }).click(); await page.getByRole('heading', { name: '第二页书库' }).waitFor();
  await page.getByRole('button', { name: '返回上层' }).click(); await page.getByRole('heading', { name: '我的远方书库' }).waitFor(); ok(true, 'catalog pagination and back navigation');
  await page.getByLabel('书库类型').selectOption('webdav');
  await page.getByLabel('书库地址', { exact: true }).fill('https://library.test/dav/');
  await page.getByRole('button', { name: '打开书库', exact: true }).click();
  await page.locator('.network-entry').filter({ hasText: '网盘书籍.txt' }).waitFor(); ok(await page.locator('.network-entry').count() === 1, 'WebDAV omits current directory and lists supported files');
  await page.getByRole('tab', { name: '阅读书源' }).click();
  await page.getByRole('button', { name: '导入书源 JSON / TXT', exact: true }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === '导入书源 JSON / TXT' && !b.disabled));
  await page.locator('.drawer input[type=file]').setInputFiles({ name: 'source.txt', mimeType: 'text/plain', buffer: Buffer.from('\uFEFF' + JSON.stringify([source, { ...source, bookSourceName: '脚本书源', ruleContent: { content: '@js:bad()' } }])) });
  await page.getByText('已导入 1 个兼容书源，跳过 1 个', { exact: true }).waitFor();
  ok((await page.getByRole('alert').textContent()).includes('脚本书源'), 'incompatible source named with reason');
  await page.getByLabel('搜索书名 / 作者').fill('山水'); await page.getByRole('button', { name: '搜索书源', exact: true }).click();
  await page.locator('.network-entry').filter({ hasText: '书源测试小说' }).click();
  await page.getByText('目录共 2 章。每次最多下载 10000 章，总正文最多 256 MiB，可分批收藏。', { exact: true }).waitFor();
  await page.getByRole('button', { name: '下载所选章节' }).click(); await page.getByText('《书源测试小说 · 1–2章》已加入书架', { exact: true }).waitFor();
  ok(await page.evaluate(async () => { const { platform } = await import('/src/platform/web.ts'); const book = window.__rtLib.getState().books.find((b) => b.title.includes('书源测试小说')); const chapters = await platform.getChapters(book.id); return book.author === '作者甲' && chapters.length === 2 && chapters[0].html.includes('第一章正文') && !JSON.stringify(chapters).includes('unsafe'); }), 'Legado search, TOC, chapter download, author and sanitization');
  await page.screenshot({ path: 'output/playwright/network-source-mobile.png' });
  await page.getByRole('tab', { name: '链接导入' }).click(); await page.getByLabel('文件下载链接').fill('https://library.test/share');
  await page.getByRole('button', { name: '下载并加入书架' }).click(); await page.getByRole('alert').waitFor();
  ok((await page.getByRole('alert').textContent()).includes('分享页面'), 'share link explains export/direct-file requirement');
  await page.screenshot({ path: 'output/playwright/network-link-mobile.png' });
  await page.evaluate(() => window.readingTreeBack()); await page.getByRole('dialog').waitFor({ state: 'hidden' }); ok(await page.locator('.shelf').isVisible(), 'Android back closes network panel without exiting shelf');
  await page.reload(); await page.locator('.shelf').waitFor();
  ok(await page.evaluate(async () => { const { platform } = await import('/src/platform/web.ts'); return (await platform.kvGet('networkCatalogs')).length === 1 && (await platform.kvGet('networkSources')).length === 1; }), 'catalogs and sources survive restart');
  const markdown = '# 第一卷\n\n' + '正文段落。'.repeat(400) + '\n\n## 第二级标题\n\n第二节正文。\n\n# 第二卷\n\n终章。';
  await page.locator('.shelf > input[type=file]').setInputFiles({ name: '标题测试.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) });
  await page.getByRole('button', { name: '阅读《标题测试》', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.page-inner h1')?.textContent === '第一卷');
  await page.waitForTimeout(400); await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.getByRole('button', { name: '目录', exact: true }).click();
  ok(await page.locator('.toc > button').count() === 3, 'Markdown H1 and H2 both appear in reader TOC');
  await page.locator('.toc > button').filter({ hasText: '第二级标题' }).click();
  await page.waitForFunction(() => document.querySelector('.page-inner h2')?.textContent === '第二级标题'); ok(true, 'Markdown H2 TOC navigates to correct content');
  await page.screenshot({ path: 'output/playwright/markdown-heading-mobile.png' });
  await page.evaluate(() => window.readingTreeBack()); await page.locator('.shelf').waitFor();
  await page.evaluate(async () => { const { platform } = await import('/src/platform/web.ts'); const b = { id: 'old-md', title: '旧版MD', author: '', format: 'md', size: 100, addedAt: Date.now(), nodeId: null }; await platform.putBook(b, [{ title: '旧卷', html: '<p>' + '过去读过的文字。'.repeat(500) + '</p><h2>旧版二级标题</h2><p>目标正文</p>', chars: 5000 }]); await window.__rtLib.getState().init(); });
  await page.getByRole('button', { name: '阅读《旧版MD》', exact: true }).click();
  await page.waitForFunction(() => window.__rtPag.pages > 3); await page.waitForTimeout(400);
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } }); await page.getByRole('button', { name: '目录', exact: true }).click();
  await page.locator('.toc > button').filter({ hasText: '旧版二级标题' }).click();
  await page.waitForFunction(() => window.__rtPag.page > 0);
  ok(await page.locator('.page-inner h2').evaluate((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && r.top >= 0 && r.top < innerHeight; }), 'existing Markdown H2 jumps within original chapter, preserving book structure');
  ok(errors.length === 0, 'no runtime errors: ' + errors.join('; '));
  console.log(`${checks} network, format and Markdown checks passed.`);
} finally { await browser.close(); await server.close(); }
