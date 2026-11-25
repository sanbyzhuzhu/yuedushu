import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { pageBoundary } from './selection-gestures.mjs';

const server = await createServer({ server: { host: '127.0.0.1', port: 5196, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const flow of ['horizontal', 'vertical']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(10000);
    await page.goto('http://127.0.0.1:5196');
    await page.locator('.shelf').waitFor();
    await page.evaluate(async flow => {
      const { platform } = await import('/src/platform/web.ts');
      const { useSettings } = await import('/src/store/settings.ts');
      useSettings.getState().set({ flow });
      const html = '<p>' + '读书使人心静，思考使人明辨。窗前一卷书，字里行间皆有天地。'.repeat(500) + '</p>';
      await platform.putBook({ id: 'mouse', title: '鼠标跨页', format: 'epub', size: 2000, addedAt: Date.now(), nodeId: null }, [{ title: '第一章', html, chars: html.length }]);
    }, flow);
    await page.reload();
    await page.locator('.cell').click();
    await page.waitForFunction(() => window.__rtPag?.pages > 3);
    await page.waitForTimeout(500);
    const glyphs = await page.evaluate(() => {
      const text = document.querySelector('.page-inner p').firstChild;
      return [4, 12].map(offset => {
        const range = document.createRange(); range.setStart(text, offset); range.setEnd(text, offset + 1);
        const r = range.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    });
    await page.mouse.move(glyphs[0].x, glyphs[0].y);
    await page.mouse.down();
    await page.mouse.move(glyphs[1].x, glyphs[1].y, { steps: 12 });
    await page.waitForFunction(() => document.querySelector('.text-selection-layer')?.dataset.dragging === 'true', null, { timeout: 10000 });
    const terminal = await pageBoundary(page, 1, { x: 0, y: 0 });
    await page.mouse.move(terminal.inside.x, terminal.inside.y, { steps: 20 });
    assert.equal(await page.evaluate(() => window.__rtPag.page), 0);
    await page.mouse.move(terminal.outside.x, terminal.outside.y, { steps: 20 });
    await page.waitForFunction(() => window.__rtPag.page === 1, null, { timeout: 10000 });
    await page.mouse.up();
    await page.locator('.reader-selection').waitFor();
    assert.ok(await page.locator('.reader-selection').innerText());
    console.log('PASS: ' + flow + ' mouse drag selects and turns a page without releasing');
    await context.close();
  }
} finally { await browser.close(); await server.close(); }
