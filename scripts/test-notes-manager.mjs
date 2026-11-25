import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
try {
  // Emulate the missing API seen on older Android WebViews before app startup.
  await page.addInitScript(() => { delete AbortSignal.prototype.throwIfAborted; });
  await page.goto('http://127.0.0.1:5198'); await page.locator('.shelf').waitFor();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.putBook({ id: 'notes-test', title: '笔记验收', author: '', format: 'txt', size: 100, addedAt: 1, nodeId: null }, [{ title: '一', html: '<p>书中有天地</p>', chars: 6 }]);
    const rows = Array.from({ length: 53 }, (_, i) => ({ id: 'n' + i, bookId: 'notes-test', kind: 'highlight', chapter: 0, exact: '划线原文' + i, note: i === 52 ? '独立批注' : '', color: 'red', prefix: '', suffix: '', createdAt: i + 1 }));
    rows.push({ ...rows[0], id: 'bookmark', kind: 'bookmark', exact: '不应显示的书签' });
    await platform.kvSet('annotations:notes-test', rows);
  });
  await page.reload(); await page.locator('.cell').first().waitFor();
  const open = async () => { await page.getByRole('button', { name: '更多', exact: true }).click(); await page.getByRole('button').filter({ hasText: '笔记管理' }).click(); await page.locator('.notes-manager-entry').first().waitFor(); };
  await open();
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.locator('.drawer').evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.notes-manager-entry').count(), 50);
  assert.equal(await page.getByText('不应显示的书签').count(), 0);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  assert.equal(await page.locator('.notes-manager-entry').count(), 3);
  await page.getByLabel('只看有批注的').check();
  assert.equal(await page.locator('.notes-manager-entry').count(), 1);
  await page.locator('.notes-manager-entry').getByRole('button', { name: '编辑' }).click();
  await page.locator('.note-card textarea').fill('编辑后仍保留原文');
  await page.locator('.note-card').getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.getByText('编辑后仍保留原文', { exact: true }).waitFor();
  await page.evaluate(() => {
    window.ReadingTreeNativeFiles = { save(id, name, mime, base64) {
      window.exportedNote = atob(base64);
      window.readingTreeFileResult(id, '已保存到 Download/阅读树/' + name, '');
    } };
  });
  await page.getByRole('button', { name: /导出筛选结果/ }).click();
  await page.getByRole('status').filter({ hasText: 'Download/阅读树' }).waitFor();
  await page.evaluate(() => {
    window.ReadingTreeNativeFiles.save = (id) => window.readingTreeFileResult(id, '', '导出失败：空间不足');
  });
  await page.getByRole('button', { name: /导出筛选结果/ }).click();
  await page.getByRole('alert').filter({ hasText: '空间不足' }).waitFor();
  await page.locator('.notes-manager-entry').getByRole('button', { name: '编辑' }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除划线', exact: true }).click();
  await page.locator('.note-card').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.notes-manager-entry').count(), 0);
  const saved = await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    const data = await platform.kvGet('annotations:notes-test');
    const c = new AbortController(); c.signal.throwIfAborted(); c.abort();
    let cancelled = false; try { c.signal.throwIfAborted(); } catch { cancelled = true; }
    return { remaining: data.list.length, deleted: data.deleted, bookmark: data.list.some((a) => a.kind === 'bookmark'), cancelled };
  });
  assert.deepEqual(saved, { remaining: 53, deleted: ['n52'], bookmark: true, cancelled: true });
  await page.getByLabel('只看有批注的').uncheck();
  await page.screenshot({ path: 'output/playwright/notes-manager-mobile.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: legacy notes, 50-row paging, no bookmarks, filtering, editing, export callback, deletion tombstones, old WebView cancellation compatibility');
} finally { await browser.close(); await server.close(); }
