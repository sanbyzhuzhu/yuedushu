import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { shelfAction } from './shelf-actions.mjs';
const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:5197');
  await page.locator('.shelf').waitFor();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.putBook({ id: 'recover', title: '测试古籍', author: '', format: 'txt', size: 2, addedAt: 1, nodeId: null }, [{ title: '第一卷', html: '<p>清风明月</p>', chars: 4 }], new Uint8Array([1, 2]).buffer);
    await platform.kvSet('annotations:recover', { list: [{ bookId: 'recover', note: '我的批注' }], deleted: [] });
    await platform.kvSet('progress:recover', { chapter: 0, pct: .5 });
    await platform.recycleBook('recover');
    if ((await platform.listBooks()).length) throw new Error('删除后仍在书架');
    if (!(await platform.kvGet('tombstones')).books.includes('recover')) throw new Error('缺少同步删除记录');
  });
  await shelfAction(page, '回收站');
  await page.getByText('测试古籍', { exact: true }).waitFor();
  await page.getByRole('button', { name: '恢复到书架' }).click();
  await page.getByText('回收站为空', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const restored = await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    const [book] = await platform.listBooks();
    return { id: book.id, ann: await platform.kvGet('annotations:' + book.id), progress: await platform.kvGet('progress:' + book.id), raw: (await platform.kvGet('file:' + book.id)).byteLength };
  });
  assert.notEqual(restored.id, 'recover');
  assert.equal(restored.ann.list[0].bookId, restored.id);
  assert.equal(restored.progress.pct, .5); assert.equal(restored.raw, 2);
  await shelfAction(page, '跨书全文检索');
  await page.getByLabel('查找藏书正文').fill('清风');
  await page.getByRole('button', { name: '查找', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '查找完成' }).waitFor();
  await page.locator('.ann-item').filter({ hasText: '测试古籍' }).click();
  await page.locator('.reader').waitFor();
  console.log('PASS: atomic recycle, tombstone, restore UI, annotations/progress/raw, cross-book search and opening result');
} finally { await browser.close(); await server.close(); }
