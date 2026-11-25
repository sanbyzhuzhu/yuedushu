/** Real Chromium touch input, isolated library. No Selection.addRange is used.
 * This exercises WebView-like touch events; a physical Android install is still required. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { handleOffset, pageBoundary } from './selection-gestures.mjs';
const origin = 'http://127.0.0.1:5190';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5190', '--strictPort'], { windowsHide: true, stdio: 'pipe' });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let checks = 0, currentPage;
const ok = (value, message) => { assert.ok(value, message); checks++; console.log('✓ ' + message); };
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await mkdir('output/playwright', { recursive: true });
  for (const flow of ['horizontal', 'vertical']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); currentPage = page;
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(origin); await page.locator('.shelf').waitFor();
    await page.evaluate(async (flow) => {
      const { platform } = await import('/src/platform/web.ts');
      const { useSettings } = await import('/src/store/settings.ts');
      useSettings.getState().set({ flow, decorFrame: flow === 'vertical', decorLines: flow === 'vertical' });
      const html = Array.from({ length: 40 }, (_, i) => '<p>第' + i + '段：山有木兮木有枝，心悦君兮君不知。' + '读书使人心静，思考使人明辨。窗前一卷书，字里行间皆有天地。'.repeat(8) + '</p>').join('');
      await platform.putBook({ id: 'touch', title: '触摸跨页试读', author: '测试', format: 'epub', size: 2000, addedAt: Date.now(), nodeId: null }, [{ title: '第一章', html, chars: html.length }]);
    }, flow);
    await page.reload(); await page.locator('.cell').click();
    await page.waitForFunction(() => window.__rtPag?.pages > 3);
    await page.waitForTimeout(500);
    const cdp = await context.newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 1, radiusX: 3, radiusY: 3, force: 1 }] });
    const glyph = await page.evaluate(() => {
      const text = document.querySelector('.page-inner p').firstChild;
      const r = document.createRange(); r.setStart(text, 6); r.setEnd(text, 7);
      const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await touch('touchStart', glyph.x, glyph.y); await page.waitForTimeout(650); await touch('touchEnd');
    await page.locator('.reader-selection').waitFor();
    ok(await page.getByRole('button', { name: '拖动选区终点' }).isVisible(), flow + ': real touch long-press opens selection handles');
    const startButton = await page.getByRole('button', { name: '拖动选区起点' }).boundingBox();
    ok(await page.evaluate(({x,y}) => document.elementFromPoint(x + 22, y + 24)?.getAttribute('data-endpoint') === 'start', startButton), flow + ': single-character start handle has an independent touch target');
    ok(await page.evaluate(() => window.__rtPag.page === 0), flow + ': long-press stays on the current page');
    const handle = await page.getByRole('button', { name: '拖动选区终点' }).boundingBox();
    let offset = await handleOffset(page);
    await touch('touchStart', handle.x + 22, handle.y + 24);
    const forwardX = flow === 'vertical' ? 4 : 386;
    await touch('touchMove', forwardX, 420);
    await page.waitForTimeout(1600);
    ok(await page.evaluate(() => window.__rtPag.page === 0), flow + ': side-edge hold does not turn the page');
    let terminal = await pageBoundary(page, 1, offset);
    await touch('touchMove', terminal.inside.x, terminal.inside.y);
    await page.waitForTimeout(1200);
    ok(await page.evaluate(() => window.__rtPag.page === 0), flow + ': stopping on the last line does not turn the page');
    await touch('touchMove', terminal.outside.x, terminal.outside.y);
    await page.waitForFunction(() => window.__rtPag.page === 1);
    await page.waitForTimeout(2000);
    await touch('touchMove', terminal.outside.x + 2, terminal.outside.y - 1);
    await page.waitForTimeout(800);
    ok(await page.evaluate(() => window.__rtPag.page === 1), flow + ': holding or jittering after a turn never skips further pages');
    ok(await page.locator('.text-selection-paint span').count() === 0, flow + ': page turn itself does not select extra text on the new page');
    await touch('touchEnd');
    await page.locator('.reader-selection').waitFor();
    ok(await page.locator('.text-selection-paint span').count() === 0, flow + ': releasing at the boundary preserves the intended selection');
    const resume = await page.getByRole('button', { name: '拖动选区终点' }).boundingBox();
    offset = await handleOffset(page);
    await touch('touchStart', resume.x + 22, resume.y + 24);
    // Only returning to the new text and deliberately continuing past its end
    // constitutes a second page turn.
    await touch('touchMove', 190, 400);
    terminal = await pageBoundary(page, 1, offset);
    await touch('touchMove', terminal.inside.x, terminal.inside.y);
    await touch('touchMove', terminal.outside.x, terminal.outside.y);
    await page.waitForFunction(() => window.__rtPag.page === 2);
    await touch('touchMove', 190, 400);
    await touch('touchEnd');
    await page.locator('.reader-selection').waitFor();
    const longCount = Number((await page.locator('.selection-heading span').textContent()).match(/[0-9]+/)[0]);
    ok(longCount > 500, flow + ': two deliberate continuations span two page boundaries');
    for (const endpoint of ['start', 'end']) {
      const button = await page.locator('.text-selection-handle.' + endpoint).boundingBox();
      ok(await page.evaluate(({button, endpoint}) => document.elementFromPoint(button.x + 22, button.y + 24)?.getAttribute('data-endpoint') === endpoint, { button, endpoint }), flow + ': ' + endpoint + ' handle remains reachable after crossing pages');
    }
    const releasedPage = await page.evaluate(() => window.__rtPag.page);
    await page.waitForTimeout(900);
    ok(await page.evaluate((p) => window.__rtPag.page === p, releasedPage), flow + ': finger release stops paging');
    // Reverse using the same endpoint. The fixed starting glyph must be retained.
    const end = await page.getByRole('button', { name: '拖动选区终点' }).boundingBox();
    const backBoundary = await pageBoundary(page, -1, await handleOffset(page));
    await touch('touchStart', end.x + 22, end.y + 24);
    await touch('touchMove', backBoundary.inside.x, backBoundary.inside.y);
    await touch('touchMove', backBoundary.outside.x, backBoundary.outside.y);
    await page.waitForFunction(() => window.__rtPag.page === 1);
    await touch('touchMove', 190, 400); await touch('touchEnd');
    await page.locator('.reader-selection').waitFor();
    const shorter = Number((await page.locator('.selection-heading span').textContent()).match(/[0-9]+/)[0]);
    ok(shorter > 1 && shorter < longCount, flow + ': reversing across a page shrinks the selection');
    // Browser/system cancellation must also stop the dwell timer.
    const last = await page.getByRole('button', { name: '拖动选区终点' }).boundingBox();
    await touch('touchStart', last.x + 22, last.y + 24);
    await touch('touchMove', forwardX, 400); await touch('touchCancel');
    const cancelledPage = await page.evaluate(() => window.__rtPag.page);
    await page.waitForTimeout(900);
    ok(await page.evaluate((p) => window.__rtPag.page === p, cancelledPage), flow + ': touch cancellation stops paging');
    await page.locator('.reader-selection').waitFor();
    const finalCount = Number((await page.locator('.selection-heading span').textContent()).match(/[0-9]+/)[0]);
    await page.screenshot({ path: 'output/playwright/touch-selection-' + flow + '.png' });
    await page.getByRole('button', { name: '朱砂划线' }).tap();
    await page.locator('.reader-selection').waitFor({ state: 'hidden' });
    const stored = await page.evaluate(async () => (await import('/src/store/annotations.ts')).useAnnotations.getState().list[0]);
    ok(stored.exact.length === finalCount, flow + ': touch-selected text is saved without truncation');
    ok(await page.evaluate((p) => window.__rtPag.page === p, cancelledPage), flow + ': saving keeps the reading page');
    // Adjust the other endpoint backwards across a page, then compare every
    // saved character with independently measured caret positions.
    const lateGlyph = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.querySelector('.page-inner'), NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement.closest('mark')) continue;
        for (let i = 1; i < node.length - 1; i++) {
          const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
          const b = r.getBoundingClientRect();
          if (b.left < 55 || b.right > 335 || b.top < 500 || b.bottom > 730) continue;
          const point = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
          const caret = document.caretRangeFromPoint(point.x, point.y);
          caret.setStart(caret.startContainer, Math.min(caret.startOffset, caret.startContainer.length - 1) + 1);
          caret.collapse(true); window.__touchFixedEnd = caret;
          return point;
        }
      }
      throw new Error('No unmarked target glyph');
    });
    await touch('touchStart', lateGlyph.x, lateGlyph.y); await page.waitForTimeout(650); await touch('touchEnd');
    await page.locator('.reader-selection').waitFor();
    const startHandle = page.getByRole('button', { name: '拖动选区起点' });
    const startBox = await startHandle.boundingBox();
    const dragOffset = await startHandle.evaluate((element, flow) => {
      const b = element.getBoundingClientRect(), stage = element.parentElement.getBoundingClientRect();
      return { x: stage.left + parseFloat(element.style.left) - (b.left + 22) + (flow === 'vertical' ? 4 : 0),
        y: stage.top + parseFloat(element.style.top) - (b.top + 24) - (flow === 'vertical' ? 0 : 4) };
    }, flow);
    await touch('touchStart', startBox.x + 22, startBox.y + 24);
    const firstBoundary = await pageBoundary(page, -1, dragOffset);
    await touch('touchMove', firstBoundary.inside.x, firstBoundary.inside.y);
    await touch('touchMove', firstBoundary.outside.x, firstBoundary.outside.y);
    await page.waitForFunction(() => window.__rtPag.page === 0);
    const expected = await page.evaluate((offset) => {
      const caret = document.caretRangeFromPoint(190 + offset.x, 500 + offset.y);
      const range = document.createRange(); range.setStart(caret.startContainer, caret.startOffset);
      range.setEnd(window.__touchFixedEnd.startContainer, window.__touchFixedEnd.startOffset);
      return range.toString().split(/\s+/).join('');
    }, dragOffset);
    await touch('touchMove', 190, 500); await touch('touchEnd');
    await page.locator('.reader-selection').waitFor();
    await page.getByRole('button', { name: '松绿划线' }).tap();
    await page.locator('.reader-selection').waitFor({ state: 'hidden' });
    const fromStart = await page.evaluate(async () => (await import('/src/store/annotations.ts')).useAnnotations.getState().list.slice(-1)[0]);
    ok(expected.length > 100 && fromStart.exact === expected, flow + ': dragging the start backwards preserves the fixed end and exact text');
    ok(errors.length === 0, flow + ': no runtime exceptions');
    await context.close(); currentPage = null;
  }
  console.log(checks + ' touch interaction checks passed.');
} catch (error) {
  if (currentPage) {
    await currentPage.screenshot({ path: 'output/playwright/touch-failure.png' });
    console.log(await currentPage.evaluate(() => ({ page: window.__rtPag?.page, native: getSelection()?.toString(),
      popup: document.querySelector('.reader-selection')?.textContent, layer: document.querySelector('.text-selection-layer')?.outerHTML.slice(-1500) })));
  }
  throw error;
} finally { await browser.close(); server.kill(); }
