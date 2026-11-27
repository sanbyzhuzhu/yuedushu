import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { shelfAction } from './shelf-actions.mjs';

const calls = [];
const dav = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,depth');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PROPFIND,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  calls.push({ method: req.method, path: req.url, auth: req.headers.authorization });
  if (req.headers.authorization !== 'Basic ' + Buffer.from('test:fixture').toString('base64')) { res.writeHead(401).end(); return; }
  if (req.method === 'PROPFIND') {
    const root = req.url;
    const entry = (href, folder) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${folder ? '<d:collection/>' : ''}</d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    res.writeHead(207, { 'Content-Type': 'application/xml' }).end(`<d:multistatus xmlns:d="DAV:">${entry(root, true)}${root === '/dav/' ? entry('/dav/folder/', true) : ''}${entry(root + encodeURIComponent('测试 书.txt'), false)}${entry('http://untrusted.test/book.txt', false)}</d:multistatus>`);
  } else res.writeHead(200, { 'Content-Type': 'text/plain;charset=utf-8' }).end('第一章\n\n这是一册测试电子书。');
});
await new Promise(resolve => dav.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${dav.address().port}`;
const vite = await createServer({ server: { host: '127.0.0.1', port: 5207, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5207');
  const result = await page.evaluate(async origin => {
    const m = await import('/src/engine/networkLibrary.ts');
    const signal = new AbortController().signal;
    const credentials = { origin, username: 'test', password: 'fixture' };
    const root = await m.fetchCatalog(origin + '/dav/', 'webdav', signal, credentials);
    const folder = await m.fetchCatalog(root.entries.find(e => !e.download).url, 'webdav', signal, credentials);
    const entry = folder.entries.find(e => e.download);
    const file = await m.downloadBook(entry.url, entry.filename, signal, credentials, undefined, true);
    let strict = false, embedded = false;
    try { m.secureUrl(origin); } catch { strict = true; }
    try { m.webdavUrl('http://name:secret@localhost/dav/'); } catch { embedded = true; }
    const actualFetch = window.fetch;
    const hops = [];
    window.fetch = async (url, init) => {
      hops.push({url, auth: init.headers.Authorization, method: init.method});
      return hops.length === 1 ? new Response(null, {status: 301, headers: {location: 'http://cdn.test/book.txt'}}) : new Response('book');
    };
    await m.requestBytes(origin + '/book.txt', {credentials, webdav:true});
    window.fetch = async () => new Response(null, {status:302, headers:{location:'http://downgrade.test/book.txt'}});
    let downgrade = false;
    try { await m.requestBytes('https://secure.test/dav/', {webdav:true}); } catch(e) { downgrade = e.message.includes('降为 HTTP'); }
    const {androidFetch} = await import('/src/platform/androidHttp.ts');
    const native = [];
    window.ReadingTreeNativeHttp = { cancel() {}, fetch() { throw Error('wrong bridge'); }, fetchWebdav(id, url, method) {
      native.push({url,method});
      queueMicrotask(() => {
        window.readingTreeHttpEvent(id, 'headers', JSON.stringify({status:200,headers:{}}));
        window.readingTreeHttpEvent(id, 'chunk', btoa('native book'));
        window.readingTreeHttpEvent(id, 'done', '');
      });
    }};
    const nativeText = await (await androidFetch(origin + '/book.txt', {method:'GET',headers:{},signal},1024,true)).text();
    window.fetch = async () => { throw new TypeError('fixture transport unavailable'); };
    const fallbackText = new TextDecoder().decode((await m.requestBytes(origin + '/book.txt', {webdav:true})).data);
    delete window.ReadingTreeNativeHttp;
    window.fetch = actualFetch;
    return {root:root.entries,folder:folder.entries,name:file.name,text:await file.text(),strict,embedded,hops,downgrade,native,nativeText,fallbackText};
  }, origin);
  assert.equal(result.root.length, 2);
  assert.equal(result.root[0].download, false);
  assert.equal(result.folder.length, 1);
  assert.equal(result.name, '测试 书.txt');
  assert.match(result.text, /测试电子书/);
  assert.ok(result.strict && result.embedded && result.downgrade);
  assert.ok(result.hops[0].auth);
  assert.equal(result.hops[1].auth, undefined);
  assert.equal(result.nativeText, 'native book');
  assert.equal(result.fallbackText, 'native book');
  assert.equal(result.native.length, 2);
  assert.deepEqual(calls.map(c => c.method), ['PROPFIND','PROPFIND','GET']);
  await page.locator('.shelf').waitFor();
  await shelfAction(page, '网络书库');
  await page.getByLabel('书库类型').selectOption('webdav');
  await page.getByLabel('书库地址', {exact:true}).fill(origin + '/dav/');
  await page.getByText('名称与访问账号（可选）', {exact:true}).click();
  await page.getByLabel('账号', {exact:true}).fill('test');
  await page.getByLabel('密码 / 应用密码', {exact:true}).fill('fixture');
  await page.getByRole('button', {name:'打开书库',exact:true}).click();
  await page.locator('.network-entry').filter({hasText:'folder'}).click();
  await page.locator('.network-entry').filter({hasText:'测试 书.txt'}).waitFor();
  await page.getByRole('button', {name:'返回上层'}).click();
  assert.equal(await page.locator('.network-entry').count(), 2);
  await page.getByRole('button', {name:'收藏地址',exact:true}).click();
  await page.getByText('书库地址已收藏，账号密码仅在本次面板中使用', {exact:true}).waitFor();
  const saved = await page.evaluate(async () => (await import('/src/platform/web.ts')).platform.kvGet('networkCatalogs'));
  assert.ok(saved.some(item => item.url === origin + '/dav/' && item.kind === 'webdav'));
  assert.ok(saved.every(item => !('username' in item) && !('password' in item)));
  await page.locator('.network-entry').filter({hasText:'测试 书.txt'}).click();
  await page.getByText(/已加入书架/).waitFor();
  for (const width of [390, 1280]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.locator('.drawer').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
  }
  await page.screenshot({path:'.tmp/webdav-library-fixed.png'});
  console.log('PASS UI: HTTP open, enter/back, favorite without credentials, selected book imported, mobile and desktop fit');
  console.log('PASS real HTTP WebDAV: authenticated listing, nested folders, Chinese filenames, selected download, foreign href rejection, strict public URLs, redirect credential isolation, downgrade rejection, Android opt-in');
} finally {
  await browser.close(); await vite.close(); await new Promise(resolve => dav.close(resolve));
}
