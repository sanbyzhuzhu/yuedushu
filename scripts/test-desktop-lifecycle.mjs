import { shelfAction, shelfView, shelfSort, shelfVersion } from './shelf-actions.mjs';
/** Exercise this build with an isolated WebView2 profile; never touch the user's running app. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chromium } from 'playwright';
const exe = path.resolve('src-tauri/target/release/reading-tree.exe');
const portCheck = createServer();
await new Promise((resolve, reject) => { portCheck.once('error', reject); portCheck.listen(9226, '127.0.0.1', resolve); });
await new Promise((resolve) => portCheck.close(resolve));
const profile = path.resolve('.tmp/desktop-lifecycle-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
const app = spawn(exe, [], { windowsHide: true, stdio: 'ignore', env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9226' } });
let exited = false; app.on('exit', () => { exited = true; });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const powershell = (body) => {
  const code = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class RTWindow {
  public delegate bool Callback(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback cb, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public static long TrayWindow(uint appProcess) {
    long found = 0;
    EnumWindows((h,p) => { uint pid; GetWindowThreadProcessId(h, out pid); var name = new StringBuilder(256); GetClassName(h,name,256); if(pid == appProcess && name.ToString() == "tray_icon_app") { found=h.ToInt64(); return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
'@\n${body}`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
};
let connection;
try {
  let endpoint;
  for (let i = 0; i < 60; i++) {
    if (exited) throw new Error('Desktop app exited before loading');
    try { const r = await fetch('http://127.0.0.1:9226/json/version'); endpoint = (await r.json()).webSocketDebuggerUrl; if (endpoint) break; } catch { /* starting */ }
    await pause(500);
  }
  assert.ok(endpoint, 'WebView2 debug endpoint available');
  connection = await chromium.connectOverCDP(endpoint);
  let page;
  for (let i = 0; i < 40; i++) {
    page = connection.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('tauri.localhost'));
    if (page) break; await pause(250);
  }
  assert.ok(page, 'isolated production app page loaded');
  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  await shelfVersion(page, version);
  assert.equal(await page.evaluate(() => window.__rtLib.getState().books.length), 0, 'isolated profile has no user books');
  if (process.argv.includes('--classics')) {
    await shelfAction(page, '网络书库');
    await page.getByText('更多书库 · 古籍与公共藏书', { exact: true }).click();
    await page.locator('.network-presets button').filter({hasText:'中文维基文库'}).click();
    await page.locator('.network-entry').filter({hasText:'論語'}).click();
    await page.locator('.network-entry').filter({hasText:'學而第一'}).waitFor({timeout:70000});
    await page.locator('.network-entry').filter({hasText:'學而第一'}).click();
    await page.locator('.network-message').waitFor({timeout:90000});
    assert.ok((await page.locator('.network-message').textContent()).includes('已加入书架'));
    await page.locator('.drawer-head button').click();
    assert.equal(await page.evaluate(()=>window.__rtLib.getState().books.length),1);
    console.log('PASS production native HTTP downloads real Wikisource chapter using system network');
  }
  if (process.argv.includes('--haodoo')) {
    await shelfAction(page, '网络书库');
    await page.getByText('更多书库 · 古籍与公共藏书', { exact: true }).click();
    await page.getByRole('button').filter({ hasText: '好读 · haodoo.net' }).click();
    await page.locator('.network-entry').first().waitFor({ timeout: 70000 });
    await page.locator('.network-entry').filter({ hasText: '世紀百強' }).click();
    await page.locator('.network-entry').filter({ hasText: '吶喊' }).click({ timeout: 70000 });
    const epub = page.locator('.network-entry').filter({ hasText: '下載 epub 檔' }).first();
    await epub.waitFor({ timeout: 70000 }); await epub.click();
    await page.locator('.network-message').waitFor({ timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__rtLib.getState().books.length), 1);
    console.log('✓ Production native HTTP via system proxy browses Haodoo category/detail and downloads 呐喊 EPUB');
    await page.getByRole('button').filter({ hasText: '好读 · haodoo.org' }).click();
    const book = page.locator('.network-entry').filter({ hasText: /好讀新書/ }).first();
    await book.waitFor({ timeout: 70000 }); await book.click();
    await page.getByRole('button', { name: '在原站打开本页 ↗', exact: true }).waitFor({ timeout: 70000 });
    await page.locator('.network-entry').filter({ hasText: '下載' }).first().waitFor({ timeout: 70000 });
    console.log('✓ Production native HTTP loads Haodoo org public book and download detail without login/cart');
    await page.getByRole('dialog', { name: '网络书库' }).getByRole('button', { name: '关闭', exact: true }).click();
  }
  if (process.argv.includes('--libraries')) {
    await page.getByRole('button', { name: '网络书库', exact: true }).click();
    await page.getByRole('button', { name: '热门藏书', exact: true }).click();
    await page.locator('.network-entry').first().waitFor({ timeout: 70000 });
    await page.locator('.network-entry').first().click();
    const epub = page.locator('.network-entry').filter({ hasText: /EPUB/ }).first();
    await epub.waitFor({ timeout: 70000 }); await epub.click();
    await page.locator('.network-message').waitFor({ timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__rtLib.getState().books.length), 1);
    console.log('✓ Production native HTTP browses live Gutenberg and downloads an actual EPUB');
    await page.getByLabel('书库类型').selectOption('web');
    await page.getByLabel('书库地址', { exact: true }).fill('https://www.gxhj.com/txt/1100054rmhm/');
    await page.getByRole('button', { name: '打开书库', exact: true }).click();
    await page.getByLabel('下载章数').waitFor({ timeout: 70000 });
    await page.getByLabel('下载章数').fill('1');
    await page.getByRole('button', { name: '下载所选章节', exact: true }).click();
    await page.locator('.network-message').waitFor({ timeout: 90000 });
    assert.equal(await page.evaluate(() => window.__rtLib.getState().books.length), 2);
    console.log('✓ Production native HTTP downloads one selected gxhj chapter from the live site');
    await page.getByRole('dialog', { name: '网络书库' }).getByRole('button', { name: '关闭', exact: true }).click();
  }
  const handle = powershell(`(Get-Process -Id ${app.pid}).MainWindowHandle.ToInt64()`);
  assert.ok(/^\d+$/.test(handle) && handle !== '0');
  powershell(`[RTWindow]::PostMessage([IntPtr]${handle}, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)`);
  await pause(900);
  assert.ok(!exited, 'window close keeps desktop process running');
  assert.equal(powershell(`[RTWindow]::IsWindowVisible([IntPtr]${handle})`), 'False', 'window close hides to tray');
  console.log('✓ Production Windows close hides window while process stays alive');
  const tray = powershell(`[RTWindow]::TrayWindow(${app.pid})`);
  assert.ok(/^\d+$/.test(tray) && tray !== '0', 'native tray window registered');
  // tray-icon 0.24.2 uses message 6002 and WM_LBUTTONUP for its actual click callback.
  powershell(`[RTWindow]::PostMessage([IntPtr]${tray}, 6002, [IntPtr]::Zero, [IntPtr]0x0202)`);
  for (let i = 0; i < 12; i++) {
    await pause(500);
    if (powershell(`[RTWindow]::IsWindowVisible([IntPtr]${handle})`) === 'True') break;
  }
  assert.equal(powershell(`[RTWindow]::IsWindowVisible([IntPtr]${handle})`), 'True');
  console.log('✓ Native tray click callback restores the existing live window');
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: /^退出阅读树/ }).click({ noWaitAfter: true }).catch((e) => { if (!/closed/.test(String(e))) throw e; });
  for (let i = 0; i < 40 && !exited; i++) await pause(250);
  assert.ok(exited, 'explicit Exit ends application process');
  console.log('✓ Public Exit button terminates the actual Windows process');
} finally {
  if (connection) await connection.close().catch(() => {});
  if (!exited) app.kill();
}
