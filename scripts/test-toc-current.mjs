import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5198, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; console.log('PASS: ' + label); };
try {
  for (const mode of ['desktop', 'mobile', 'vertical', 'scroll']) {
    const context = await browser.newContext({ viewport: mode === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: mode === 'mobile' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:5198');
    await page.waitForFunction(() => window.__rtLib?.getState().ready);
    await page.evaluate(async mode => {
      const { platform } = await import('/src/platform/web.ts');
      const { useSettings } = await import('/src/store/settings.ts');
      useSettings.getState().set({ readMode: mode === 'scroll' ? 'scroll' : 'paged', flow: mode === 'vertical' ? 'vertical' : 'horizontal' });
      const chapters = Array.from({ length: 120 }, (_, i) => ({ title: `章节${i + 1}`, html: '<p>正在阅读的章节正文。</p>'.repeat(15), chars: 180 }));
      await platform.putBook({ id: 'toc-current', title: '目录定位测试', format: 'epub', size: 21600, addedAt: Date.now(), nodeId: null }, chapters);
      await platform.kvSet('progress:toc-current', { chapter: 86, page: 0, pages: 1, pct: 86 / 120, updatedAt: Date.now() });
    }, mode);
    await page.reload(); await page.locator('.cell').click();
    if (mode === 'scroll') {
      await page.locator('[data-ch="86"]').waitFor({ state: 'attached' });
      await page.waitForTimeout(500);
      await page.locator('.scroll-outer').evaluate(el => { el.scrollTop = el.querySelector('[data-ch="86"]').offsetTop + 20; });
    } else await page.waitForFunction(() => window.__rtPag?.pages >= 1);
    await page.waitForTimeout(600);
    const viewport = page.viewportSize();
    await page.locator('.reader-stage').click({ position: { x: viewport.width / 2, y: viewport.height / 2 } });
    await page.locator('.reader-head').waitFor();
    await page.waitForFunction(() => document.querySelector('.head-title span')?.textContent === '章节87');
    const readingPosition = () => page.evaluate(() => ({ chapter: document.querySelector('.head-title span')?.textContent, page: window.__rtPag?.page, scroll: document.querySelector('.scroll-outer')?.scrollTop }));
    const before = await readingPosition();
    const directory = page.getByRole('dialog', { name: '目录与笔记', exact: true });
    const checkCurrent = async label => {
      const result = await directory.evaluate(el => {
        const item = el.querySelector('[aria-current="location"]');
        const rect = item?.getBoundingClientRect(), panel = el.getBoundingClientRect();
        return { text: item?.textContent, visible: !!rect && rect.top >= panel.top && rect.bottom <= panel.bottom, scroll: el.scrollTop };
      });
      ok(result.text?.endsWith('章节87') && result.visible && result.scroll > 0, mode + ': ' + label);
      assert.deepEqual(await readingPosition(), before, 'opening directory must preserve reader position');
    };
    await page.locator('.reader-head').getByRole('button', { name: '目录', exact: true }).click();
    await checkCurrent('opens at current chapter instead of first chapter');
    await directory.evaluate(el => { el.scrollTop = 0; });
    await directory.getByRole('button', { name: '收起', exact: true }).click();
    await page.locator('.reader-head').getByRole('button', { name: '目录', exact: true }).click();
    await checkCurrent('reopening returns to current chapter after manual directory scrolling');
    await directory.getByRole('searchbox', { name: '查找章节' }).fill('章节1');
    await directory.getByRole('button', { name: '收起', exact: true }).click();
    await page.locator('.reader-head').getByRole('button', { name: '目录', exact: true }).click();
    ok(await directory.getByRole('searchbox', { name: '查找章节' }).inputValue() === '', mode + ': reopening clears stale filter');
    await checkCurrent('current chapter remains visible after a previous search');
    await directory.getByRole('button', { name: '笔记（0）', exact: true }).click();
    await directory.getByRole('button', { name: '目录', exact: true }).click();
    await checkCurrent('switching from notes also locates current chapter');
    ok(errors.length === 0, mode + ': no runtime errors: ' + errors.join(';'));
    await context.close();
  }
  console.log(`Passed ${checks} directory checks.`);
} finally { await browser.close(); await server.close(); }
