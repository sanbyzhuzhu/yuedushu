import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { shelfAction } from './shelf-actions.mjs';
const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('http://127.0.0.1:5197');
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.replaceAll([{ id: 'backup-fixture', title: '备份测试', format: 'txt', addedAt: 1 }], [{ id: 'backup-fixture', chapters: [{ title: '正文', html: '<p>测试</p>' }] }], []);
  });
  await page.reload();
  await shelfAction(page, '备份 / 恢复');
  await page.getByText(/每批最多 200 本、原始数据最多 256 MiB/).waitFor();
  const exportButton = page.getByRole('button', { name: '导出备份', exact: true });
  await exportButton.click();
  await page.getByRole('button', { name: '文件已保存，记录本批' }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('reading-tree-backup-history')), null);
  await page.getByRole('button', { name: '未保存，不记录' }).click();
  await exportButton.click();
  await page.getByRole('button', { name: '文件已保存，记录本批' }).click();
  assert.ok(await exportButton.isDisabled());
  await page.reload();
  await shelfAction(page, '备份 / 恢复');
  assert.ok(await exportButton.isDisabled());
  await page.getByRole('button', { name: '完整备份', exact: true }).click();
  assert.ok(await exportButton.isEnabled(), 'light backup must not skip a full backup');
  await exportButton.click();
  await page.getByRole('button', { name: '文件已保存，记录本批' }).click();
  assert.ok(await exportButton.isDisabled());
  await page.getByRole('button', { name: '轻量备份', exact: true }).click();
  assert.ok(await exportButton.isDisabled());
  await page.getByRole('checkbox').uncheck();
  assert.ok(await exportButton.isEnabled(), 'manual repeat backup stays available');
  console.log('Backup UI passed: capacity, unsaved download, confirmation, reload, raw/light distinction, manual repeat.');
} finally {
  await browser.close();
  await server.close();
}
