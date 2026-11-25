/** Browser regressions. npm run test:reader starts its own dev server.
 * Uses an isolated browser profile: never reads or changes the user's library.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { handleOffset, pageBoundary } from './selection-gestures.mjs';

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const origin = process.env.READER_URL || 'http://127.0.0.1:5188';
const server = process.env.READER_URL ? null : spawn(process.execPath,
  ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5188', '--strictPort'],
  { stdio: 'inherit', windowsHide: true });
if (server) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
await mkdir('output/playwright', { recursive: true });
let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks++; console.log(`✓ ${message}`); };
const paragraphs = Array.from({ length: 48 }, (_, i) => `<p>第${i + 1}段。读书使人心静，思考使人明辨。春日的庭院，花木扶疏，窗前一卷书，字里行间皆有天地。阅读的意义，在于看见世界，也看见自己。${'慢慢阅读，认真记录，书中的每一句话都值得细细品味。'.repeat(4)}</p>`).join('');

async function fixture(options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.shelf').waitFor();
  await page.evaluate(async (html) => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.putBook({ id: 'regression', title: '静读手记', author: '阅读树', format: 'epub', size: 5000, addedAt: Date.now(), nodeId: null }, [
      { title: '第一章 · 阅读与思考', html, chars: html.length },
      { title: '第二章 · 另一片天地', html: '<p>第二章的开头不应影响第一章的定位。</p>' + html, chars: html.length },
    ]);
  }, paragraphs);
  await page.reload();
  await page.locator('.cell').click();
  await page.waitForFunction(() => document.querySelector('.page-inner p') && window.__rtPag?.pages > 1);
  await page.waitForTimeout(450);
  return { page, context, errors };
}

async function selectText(page, { paragraph = 0, start = 0, end = 18, scrollChapter } = {}) {
  await page.evaluate(({ paragraph, start, end, scrollChapter }) => {
    const root = scrollChapter == null ? document.querySelector('.page-inner') : document.querySelectorAll('.scroll-ch-body')[scrollChapter];
    const p = root.querySelectorAll('p')[paragraph];
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) nodes.push(node);
    const point = (offset) => {
      for (const node of nodes) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      return [nodes[nodes.length - 1], nodes[nodes.length - 1].length];
    };
    const range = document.createRange();
    range.setStart(...point(start));
    range.setEnd(...point(end));
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  }, { paragraph, start, end, scrollChapter });
  try { await page.locator('.reader-selection').waitFor({ timeout: 5000 }); }
  catch (error) {
    console.log(await page.evaluate(() => ({ selection: getSelection()?.toString(), menu: !!document.querySelector('.stage-close'), marks: document.querySelectorAll('mark.hl').length, html: document.querySelector('.page-inner')?.innerHTML.slice(0, 800) })));
    await page.screenshot({ path: 'output/playwright/failure.png' });
    throw error;
  }
  await page.waitForTimeout(350);
}

async function state(page) {
  return page.evaluate(() => ({ page: window.__rtPag.page, left: document.querySelector('.page-outer').scrollLeft,
    transform: document.querySelector('.page-inner').style.transform, text: window.getSelection()?.toString() }));
}

try {
  for (const flow of ['horizontal', 'vertical', 'double']) {
    const { page, context, errors } = await fixture(flow === 'double' ? { viewport: { width: 1100, height: 780 } } : {});
    if (flow !== 'horizontal') await page.evaluate(async (flow) => {
      const { useSettings } = await import('/src/store/settings.ts');
      useSettings.getState().set(flow === 'vertical' ? { flow: 'vertical' } : { colsPerPage: 2 });
    }, flow);
    await page.waitForTimeout(200);
    // Real mouse drag, including the synthetic click after mouseup.
    const points = await page.evaluate(() => {
      const t = document.querySelector('.page-inner p').firstChild;
      const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 1);
      const a = r.getBoundingClientRect(); r.setStart(t, 5); r.setEnd(t, 6);
      const b = r.getBoundingClientRect();
      return { ax: a.left + 2, ay: a.top + 2, bx: b.right - 2, by: b.bottom - 2 };
    });
    await page.mouse.move(points.ax, points.ay); await page.mouse.down();
    await page.mouse.move(points.bx, points.by, { steps: 12 });
    await page.evaluate(() => { window.__testAnchor = getSelection().getRangeAt(0).cloneRange(); });
    await page.mouse.up();
    await page.locator('.reader-selection').waitFor();
    ok((await state(page)).page === 0, flow + ': real drag selects without turning a page');
    ok(await page.getByRole('button', { name: '拖动选区终点' }).isVisible(), flow + ': selection transfers to draggable handles');
    const initialCount = await page.locator('.selection-heading').textContent();
    await page.mouse.move(flow === 'vertical' ? 3 : (flow === 'double' ? 1097 : 387), 400);
    await page.waitForTimeout(900);
    ok((await state(page)).page === 0, flow + ': hovering at the edge never turns pages');

    const handle = await page.getByRole('button', { name: '拖动选区终点' }).boundingBox();
    const terminal = await pageBoundary(page, 1, await handleOffset(page));
    ok(await page.evaluate(({x,y}) => document.elementFromPoint(x + 22, y + 24)?.classList.contains('text-selection-handle'), handle), flow + ': selection handle is not covered by the popup');
    await page.mouse.move(handle.x + 22, handle.y + 24); await page.mouse.down();
    await page.mouse.move(flow === 'vertical' ? 3 : (flow === 'double' ? 1097 : 387), 400, { steps: 12 });
    await page.waitForTimeout(900);
    ok((await state(page)).page === 0, flow + ': holding a dragged handle at a side edge does not turn pages');
    if (flow === 'double') {
      await page.mouse.move(110, terminal.inside.y, { steps: 8 });
      await page.mouse.move(110, terminal.outside.y, { steps: 8 });
      await page.waitForTimeout(800);
      ok((await state(page)).page === 0, 'double: continuing below the first column does not skip the second column');
    }
    await page.mouse.move(terminal.inside.x, terminal.inside.y, { steps: 10 });
    await page.waitForTimeout(900);
    ok((await state(page)).page === 0, flow + ': selecting the final line and stopping does not turn pages');
    await page.mouse.move(terminal.outside.x, terminal.outside.y, { steps: 6 });
    await page.waitForFunction(() => window.__rtPag.page === 1);
    await page.waitForTimeout(1600);
    ok((await state(page)).page === 1, flow + ': continuing past the final line turns exactly one page');
    // Inspect a glyph on the newly revealed page. This only computes expected
    // coordinates/text; it never creates or installs a native selection.
    const target = await page.evaluate((flow) => {
      const root = document.querySelector('.page-inner');
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node, chosen;
      while ((node = walker.nextNode()) && !chosen) {
        for (let i = 1; i < node.length - 1; i++) {
          const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1);
          const b = r.getBoundingClientRect();
          if (b.left > 85 && b.right < innerWidth - 85 && b.top > 160 && b.bottom < innerHeight - 160) {
            chosen = { x: b.left + b.width * .75, y: b.top + b.height * .75 }; break;
          }
        }
      }
      if (!chosen) throw new Error('No target glyph');
      const caret = document.caretRangeFromPoint(chosen.x, chosen.y);
      const expected = window.__testAnchor.cloneRange();
      expected.setEnd(caret.startContainer, caret.startOffset);
      window.__testExpected = expected.toString().replace(/s/g, '');
      return { x: chosen.x + 14 - (flow === 'vertical' ? 4 : 0),
        y: chosen.y + (flow === 'vertical' ? 14 : 18), text: window.__testExpected };
    }, flow);
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await page.mouse.up();
    await page.locator('.reader-selection').waitFor();
    ok((await state(page)).page === 1 && target.text.length > 100, flow + ': actual handle drag extends across a page');
    ok((await page.locator('.selection-heading').textContent()) !== initialCount, flow + ': selection length updates after the drag');
    const afterRelease = await state(page);
    await page.mouse.move(flow === 'vertical' ? 3 : (flow === 'double' ? 1097 : 387), 400);
    await page.waitForTimeout(900);
    ok((await state(page)).page === afterRelease.page, flow + ': release stops edge navigation');
    ok(!await page.locator('.reader-selection button').evaluateAll((buttons) => buttons.some((button) => /d+s*字/.test(button.textContent || ''))), flow + ': no fixed-character extension controls');
    await page.screenshot({ path: 'output/playwright/selection-' + flow + '.png' });
    await page.getByRole('button', { name: '松绿划线', exact: true }).click();
    await page.locator('.reader-selection').waitFor({ state: 'hidden' });
    ok((await state(page)).page === afterRelease.page, flow + ': saving preserves the exact current page');
    const stored = await page.evaluate(async () => (await import('/src/store/annotations.ts')).useAnnotations.getState().list[0]);
    ok(stored.exact === target.text, flow + ': saved text equals the independently measured start and end');
    ok(await page.locator('mark.hl').count() > 0, flow + ': cross-page highlight renders');
    ok(errors.length === 0, `${flow}: no runtime errors`);
    await context.close();
  }

  const { page, context, errors } = await fixture();
  await page.evaluate(() => {
    const stage = document.querySelector('.reader-stage');
    const touch = new Touch({ identifier: 1, target: stage, clientX: 200, clientY: 200 });
    stage.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch], changedTouches: [touch] }));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const stage = document.querySelector('.reader-stage');
    const touch = new Touch({ identifier: 1, target: stage, clientX: 100, clientY: 200 });
    stage.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch] }));
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 380, clientY: 200 }));
  });
  ok((await state(page)).page === 0, 'long press with delayed native selection does not become a swipe or click');
  await page.evaluate(() => {
    const stage = document.querySelector('.reader-stage');
    const start = new Touch({ identifier: 1, target: stage, clientX: 250, clientY: 200 });
    const end = new Touch({ identifier: 1, target: stage, clientX: 100, clientY: 200 });
    stage.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
    stage.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [end] }));
    stage.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 380, clientY: 200 }));
  });
  ok((await state(page)).page === 1, 'normal swipe turns exactly one page, suppressing its following click');
  await page.evaluate(() => window.__rtPag.goTo(0));
  await selectText(page, { end: 1 });
  await page.getByRole('button', { name: '写笔记' }).click();
  await page.getByRole('textbox', { name: '笔记内容' }).fill('这是一条认真留下的读书笔记。');
  const beforeNote = await state(page);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft');
  ok((await state(page)).page === beforeNote.page, 'editing note with arrow keys never changes the page');
  await page.screenshot({ path: 'output/playwright/note-mobile.png' });
  await page.getByRole('button', { name: '保存笔记', exact: true }).click();
  await page.locator('.note-card').waitFor({ state: 'hidden' });
  ok((await page.locator('mark.has-note').count()) > 0, 'one-character highlight and note are supported');

  // Saving on a later page and jumping from the notes list locates the mark.
  await page.evaluate(() => window.__rtPag.goTo(3));
  const visibleParagraph = await page.evaluate(() => Array.from(document.querySelectorAll('.page-inner p')).findIndex((p) => {
    const r = p.getClientRects()[0]; return r.left >= 0 && r.left < innerWidth && r.top >= 0 && r.top < innerHeight;
  }));
  assert.ok(visibleParagraph >= 0);
  await selectText(page, { paragraph: visibleParagraph, end: 16 });
  await page.getByRole('button', { name: '朱砂划线', exact: true }).click();
  await page.locator('.reader-selection').waitFor({ state: 'hidden' });
  const notePage = (await state(page)).page;
  await page.evaluate(() => window.__rtPag.goTo(0));
  await page.waitForTimeout(450);
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.locator('.ann-item').last().click();
  ok((await state(page)).page === notePage, 'notes list jumps to the exact highlight, including the same chapter');

  // Anchor engine: long quotes and repeated strings across DOM elements.
  const anchors = await page.evaluate(async () => {
    const { quoteFromRange, applyQuote } = await import('/src/engine/annotate.ts');
    const root = document.createElement('div');
    root.innerHTML = '<p>甲的前文<em>同一句话</em>甲的后文</p><p>乙的前文<em>同一句话</em>乙的后文</p>';
    const range = document.createRange(); range.selectNodeContents(root.querySelectorAll('em')[1]);
    const quote = quoteFromRange(range, root);
    applyQuote(root, quote, { id: 'repeat', color: 'red', hasNote: false });
    const matched = root.querySelector('mark').closest('p') === root.children[1];
    root.textContent = '读'.repeat(2501); range.selectNodeContents(root);
    return { matched, length: quoteFromRange(range, root).exact.length };
  });
  ok(anchors.matched, 'duplicate text anchors to the selected occurrence across inline elements');
  ok(anchors.length === 2501, 'quotes longer than 2000 characters are not truncated');

  // Concurrency and failed writes must never silently lose annotations.
  const persistence = await page.evaluate(async () => {
    const { useAnnotations } = await import('/src/store/annotations.ts');
    const { platform } = await import('/src/platform/web.ts');
    const store = useAnnotations.getState();
    const base = { kind: 'highlight', chapter: 0, exact: '并行保存', prefix: '', suffix: '', color: 'blue', note: '' };
    const added = await Promise.all([store.add(base), store.add(base), store.add(base)]);
    const data = await platform.kvGet('annotations:regression');
    const count = data.list.filter((a) => added.some((b) => a.id === b.id)).length;
    const original = platform.kvSet;
    platform.kvSet = async () => { throw new Error('disk full'); };
    let rejected = false;
    try { await store.add({ ...base, exact: '不应出现的失败记录' }); } catch { rejected = true; }
    finally { platform.kvSet = original; }
    return { count, rejected, ghost: useAnnotations.getState().list.some((a) => a.exact === '不应出现的失败记录') };
  });
  ok(persistence.count === 3, 'concurrent writes preserve all annotations');
  ok(persistence.rejected && !persistence.ghost, 'failed persistence reports failure and creates no phantom highlight');

  // Scroll annotations must belong to the selected chapter, not the viewport tracker.
  await page.evaluate(async () => (await import('/src/store/settings.ts')).useSettings.getState().set({ readMode: 'scroll' }));
  await page.locator('.scroll-ch-body').first().waitFor();
  await selectText(page, { scrollChapter: 1, paragraph: 0, end: 12 });
  await page.getByRole('button', { name: '靛蓝划线', exact: true }).click();
  await page.locator('.reader-selection').waitFor({ state: 'hidden' });
  ok(await page.evaluate(async () => (await import('/src/store/annotations.ts')).useAnnotations.getState().list.slice(-1)[0].chapter === 1), 'scroll mode saves the selection chapter correctly');

  await page.evaluate(async () => (await import('/src/store/settings.ts')).useSettings.getState().set({ readMode: 'paged' }));
  await page.waitForFunction(() => !!document.querySelector('.page-inner p'));
  ok(true, 'switching from scroll to paged mode immediately renders content');

  await page.evaluate(async () => (await import('/src/store/settings.ts')).useSettings.getState().set({ readMode: 'paged', conv: 's2t', theme: 'lamp' }));
  await page.waitForFunction(() => document.querySelector('.page-inner')?.textContent?.includes('讀書'));
  await page.evaluate(() => window.__rtPag.goTo(0));
  await selectText(page, { end: 25 });
  await page.getByRole('button', { name: '琥珀划线' }).click();
  await page.locator('.reader-selection').waitFor({ state: 'hidden' });
  const converted = await page.evaluate(async () => (await import('/src/store/annotations.ts')).useAnnotations.getState().list.slice(-1)[0]);
  ok(converted.conv === 's2t' && converted.exact.includes('讀'), 'converted quote is stored in its actual display mode');
  await page.evaluate(async () => (await import('/src/store/settings.ts')).useSettings.getState().set({ conv: 'off' }));
  await page.waitForFunction((id) => Array.from(document.querySelectorAll('mark.hl')).some((m) => m.dataset.aid === id && m.textContent.includes('读')), converted.id);
  ok(true, 'converted highlights survive switching back to original text');
  await selectText(page, { paragraph: 1, end: 15 });
  await page.screenshot({ path: 'output/playwright/selection-night.png' });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  await page.locator('.ann-item').filter({ hasText: '第二章的开头' }).click();
  await page.waitForFunction(() => document.querySelector('.page-info.head')?.textContent?.includes('第二章'));
  ok(await page.locator('mark.hl').filter({ hasText: '第二章的开头' }).isVisible(), 'notes list locates a highlight in another chapter');
  await page.reload();
  await page.locator('.cell').waitFor();
  await page.screenshot({ path: 'output/playwright/shelf-mobile.png' });
  await page.getByPlaceholder('搜书名 / 作者').fill('不存在的书');
  await page.getByRole('button', { name: '查看全部藏书' }).waitFor();
  ok(await page.locator('.cell').count() === 0, 'empty search offers reset without pretending the library is empty');
  await page.getByRole('button', { name: '查看全部藏书' }).click();
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.screenshot({ path: 'output/playwright/shelf-desktop.png' });
  await page.locator('.cell').click();
  await page.waitForFunction(() => document.querySelector('mark.has-note'));
  ok(await page.evaluate(async () => (await import('/src/store/annotations.ts')).useAnnotations.getState().list.some((a) => a.note === '这是一条认真留下的读书笔记。')), 'saved note survives a full reload and reopening the book');
  ok(errors.length === 0, 'note, persistence, conversion and scroll scenarios have no runtime errors');
  await context.close();
  console.log(`\n${checks} reader regression checks passed.`);
} finally { await browser.close(); server?.kill(); }
