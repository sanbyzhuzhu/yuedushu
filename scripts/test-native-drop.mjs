/** Isolated production WebView: real Tauri file IO and the native drop event channel. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const port = 9227;
const check = createServer();
await new Promise((resolve, reject) => { check.once('error', reject); check.listen(port, '127.0.0.1', resolve); });
await new Promise(resolve => check.close(resolve));
const directory = path.resolve('.tmp/native-drop-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const good = path.join(directory, '原生拖入.txt'), bad = path.join(directory, '不支持.bad');
fs.writeFileSync(good, '原生文件导入正文。'.repeat(500)); fs.writeFileSync(bad, 'bad');
const app = spawn(path.resolve('src-tauri/target/release/reading-tree.exe'), [], {
  windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: path.join(directory, 'profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=' + port },
});
let exited = false, connection;
app.on('exit', () => { exited = true; });
try {
  let endpoint;
  for (let i = 0; i < 60; i++) {
    if (exited) throw Error('Application exited before startup');
    try { endpoint = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl; if (endpoint) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(endpoint);
  connection = await chromium.connectOverCDP(endpoint);
  let page;
  for (let i = 0; i < 120; i++) {
    page = connection.contexts().flatMap(context => context.pages()).find(page => page.url().includes('tauri.localhost'));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'Production page missing: ' + connection.contexts().flatMap(context => context.pages()).map(p => p.url()).join(', '));
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.waitForFunction(() => window.__rtLib?.getState().ready);
  assert.equal(await page.evaluate(() => window.__rtLib.getState().books.length), 0);
  await page.waitForTimeout(500);
  const emit = (event, paths) => page.evaluate(({ event, paths }) => window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event, payload: { paths, position: { x: 100, y: 100 } } }), { event, paths });
  await emit('tauri://drag-enter', [good]);
  await page.getByText('松开即可导入书籍').waitFor();
  await emit('tauri://drag-leave', []);
  await page.getByText('松开即可导入书籍').waitFor({ state: 'hidden' });
  console.log('PASS: native drag enter/leave controls overlay');
  await emit('tauri://drag-drop', [bad, good]);
  await page.getByRole('status').filter({ hasText: '已导入 1 本' }).waitFor();
  assert.equal(await page.locator('.cell').count(), 1);
  assert.match(await page.getByRole('status').innerText(), /不支持/);
  console.log('PASS: production native drop reads book bytes and continues after unsupported file');
  await page.locator('.cell').click();
  await page.waitForFunction(() => window.__rtPag?.pages > 1);
  assert.match(await page.locator('.page-inner').innerText(), /原生文件导入正文/);
  await page.waitForTimeout(500);
  await page.locator('.reader-stage').hover(); await page.mouse.wheel(0, 120);
  await page.waitForFunction(() => window.__rtPag.page === 1);
  console.log('PASS: production Windows WebView wheel turns page');
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('exit_desktop'));
} finally {
  if (connection) await connection.close().catch(() => {});
  if (!exited && app.pid) spawnSync('taskkill.exe', ['/PID', String(app.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
}
