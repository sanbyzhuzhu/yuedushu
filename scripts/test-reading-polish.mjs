/** Frame spacing, recoverable drafts and chapter filtering in an isolated library. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5192, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
let checks = 0;
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
const ok = (value, message) => { assert.ok(value, message); checks++; console.log('✓ ' + message); };
const setting = async (patch) => {
  await page.evaluate(async (patch) => { const { useSettings } = await import('/src/store/settings.ts'); useSettings.getState().set(patch); }, patch);
  await page.waitForTimeout(150);
};
const open = async () => {
  await page.locator('.cell').click();
  await page.waitForFunction(() => !!document.querySelector('mark.hl') && window.__rtPag?.pages > 2);
  await page.waitForTimeout(500);
};
try {
  await mkdir('output/playwright', { recursive: true });
  await page.goto('http://127.0.0.1:5192'); await page.locator('.shelf').waitFor();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    const html = '<p>读书之乐，在一窗晴日，也在半盏清茶。</p>' + Array.from({ length: 30 }, () => '<p>' + '山有木兮木有枝，心悦君兮君不知。'.repeat(12) + '</p>').join('');
    await platform.putBook({ id: 'polish', title: '窗前读书', author: '测试', format: 'epub', size: 1000, addedAt: Date.now(), nodeId: null }, [
      { title: '卷一 · 晴日', html, chars: html.length }, { title: '卷二 · 清茶', html, chars: html.length },
    ]);
    await platform.kvSet('annotations:polish', { list: [{ id: 'note', bookId: 'polish', kind: 'highlight', chapter: 0, exact: '读书之乐', prefix: '', suffix: '，在一窗晴日', color: 'red', note: '原来的笔记', createdAt: Date.now() }], deleted: [] });
  });
  await page.reload(); await open();
  await page.locator('mark.hl').first().click();
  const textarea = page.getByRole('textbox', { name: '笔记内容' });
  await textarea.fill('尚未正式保存的想法');
  ok(await page.getByText('草稿已留在本机 · 下次打开继续写').isVisible(), 'draft persistence is disclosed');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload(); await open();
  await page.locator('mark.hl').first().click();
  ok(await textarea.inputValue() === '尚未正式保存的想法', 'draft survives editor close and full app reload');
  await page.getByRole('button', { name: '放弃草稿', exact: true }).click();
  ok(await textarea.inputValue() === '原来的笔记', 'discard restores the saved note');
  await textarea.fill('正式保存的新笔记');
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.locator('.note-card').waitFor({ state: 'hidden' });
  ok(await page.evaluate(() => localStorage.getItem('note-draft:polish:note') === null), 'successful save removes the draft');
  await page.locator('mark.hl').first().click();
  ok(await textarea.inputValue() === '正式保存的新笔记', 'saved note reopens correctly');
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.locator('.reader-head').getByRole('button', { name: '目录', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '查找章节' });
  await search.fill('清茶');
  ok(await page.locator('.toc button').count() === 1 && (await page.locator('.toc-index').textContent()) === '02', 'chapter filter preserves original chapter number');
  await search.fill('不存在的章节');
  ok(await page.getByText('没有找到对应章节').isVisible(), 'chapter filter explains empty results');
  await search.fill('清茶'); await page.locator('.toc button').click();
  ok(await page.locator('.head-title span').textContent() === '卷二 · 清茶', 'filtered chapter opens the correct original chapter');
  await page.keyboard.press('Escape');

  await setting({ flow: 'vertical', decorFrame: true, decorLines: true, indent: false });
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const fontSize of [18, 24, 32]) {
      await setting({ fontSize });
      for (const index of [0, 2]) {
        await page.evaluate((index) => window.__rtPag.goTo(index), index);
        const bounds = await page.evaluate(() => {
          const clip = document.querySelector('.page-clip').getBoundingClientRect();
          const root = document.querySelector('.page-inner');
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let top = Infinity, bottom = 0, count = 0;
          while (walker.nextNode()) {
            const range = document.createRange(); range.selectNodeContents(walker.currentNode);
            for (const r of range.getClientRects()) if (r.width && r.height && r.left >= clip.left - 1 && r.right <= clip.right + 1) {
              top = Math.min(top, r.top); bottom = Math.max(bottom, r.bottom); count++;
            }
          }
          return { top: top - clip.top, bottom: clip.bottom - bottom, count };
        });
        ok(bounds.count > 0 && bounds.top >= 9 && bounds.bottom >= 9, `vertical frame keeps upper/lower space: ${viewport.width}px, ${fontSize}px, page ${index + 1} (${JSON.stringify(bounds)})`);
      }
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await setting({ fontSize: 24 });
  await page.evaluate(() => window.__rtPag.goTo(0));
  await page.screenshot({ path: 'output/playwright/vertical-frame-spacing.png' });
  await setting({ decorFrame: false });
  ok(await page.locator('.page-inner').evaluate((el) => el.style.top === '0px'), 'turning the frame off removes its extra inset immediately');
  await setting({ decorFrame: true, flow: 'horizontal' });
  ok(await page.locator('.page-inner').evaluate((el) => el.style.top === ''), 'returning to horizontal layout clears vertical offsets');
  ok(errors.length === 0, `no runtime errors: ${errors.join('; ')}`);
  console.log(`${checks} reading polish checks passed.`);
} finally { await browser.close(); await server.close(); }
