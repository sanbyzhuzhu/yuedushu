import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5195, strictPort: true } }); await server.listen();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await page.goto('http://127.0.0.1:5195');
  const result = await page.evaluate(async () => {
    const { TextSelection } = await import('/src/engine/textSelection.ts');
    const stage = document.createElement('div'); stage.style.cssText = 'position:fixed;inset:0;background:white;z-index:999';
    stage.innerHTML = '<div class="page-outer" style="padding:36px 76px 36px 36px"><div class="edge-root page-inner" style="width:318px;font:19px/1.9 serif;text-align:justify">' + '要获得更多的自由时间，就要对选择的专业领域、工作性质、职业路径以及与雇主达成的交易类型做出审慎的判断。一旦做出正确的决策，你就无须担心时间管理的问题了。'.repeat(5) + '</div></div>';
    document.body.append(stage); const root = stage.querySelector('.edge-root'), node = root.firstChild;
    const control = new TextSelection({ stage, rootFor: () => root, paginator: () => null, scrollContainer: () => null, vertical: false, onChange() {} });
    // Reproduce the paginator's trailing 40px spacer being mistaken for margin.
    const viewport = control.viewport;
    control.viewport = () => new DOMRect(36, 36, 278, 772);
    const legacyRight = control.viewport().right;
    control.viewport = viewport;
    const range = document.createRange(); range.setStart(node, 5); range.setEnd(node, 180);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); control.capture();
    const rects = [...stage.querySelectorAll('.text-selection-paint span')].map(s => s.getBoundingClientRect());
    const missed = [], legacyMissed = [], lines = new Map();
    for (let i = 5; i < 180; i++) {
      const glyph = document.createRange(); glyph.setStart(node, i); glyph.setEnd(node, i + 1);
      const r = glyph.getBoundingClientRect(); if (r.bottom > 808 || r.top < 36) continue;
      lines.set(Math.round(r.top), { offset: i + 1, rect: r });
      if (r.left + r.width / 2 > legacyRight) legacyMissed.push(i);
      if (!rects.some(p => p.left <= r.left + r.width / 2 && p.right >= r.left + r.width / 2 && p.top <= r.top + r.height / 2 && p.bottom >= r.top + r.height / 2)) missed.push(i);
    }
    const edges = [...lines.values()].slice(1, -1).map(({ offset, rect }) => {
      const caret = control.caretAt({ x: 360, y: rect.top + rect.height / 2 });
      return { expected: offset, actual: caret?.startOffset, sameNode: caret?.startContainer === node };
    });
    const actualRight = control.viewport().right;
    control.destroy(); stage.remove(); return { missed, legacyMissed, edges, legacyRight, actualRight };
  });
  assert.deepEqual(result.missed, [], 'every selected glyph must be covered, including justified line ends');
  assert.ok(result.legacyMissed.length > 10, 'fixture reproduces clipped characters on multiple lines before the fix');
  assert.equal(result.actualRight - result.legacyRight, 40, 'trailing pagination gap must not clip the reading area');
  assert.ok(result.edges.length > 3);
  for (const edge of result.edges) assert.ok(edge.sameNode && edge.actual === edge.expected, JSON.stringify(edge));
  console.log('PASS: justified selected text covers every glyph; right-edge caret reaches the last character on early and later lines');
} finally { await browser.close(); await server.close(); }
