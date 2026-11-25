import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({ server: { host: '127.0.0.1', port: 5196, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
// Deterministic PDF: two pages, selectable Helvetica text; no local fixture or network dependency.
function pdfBytes() {
  const stream = 'BT /F1 20 Tf 40 180 Td (Reading Tree) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = text.length;
  text += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return [...new TextEncoder().encode(text)];
}
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await page.clock.install();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5196'); await page.locator('.shelf').waitFor();
  const ttsResult = await page.evaluate(async () => {
    const utterances = [];
    const original = window.speechSynthesis;
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, resume() {}, speak(u) { utterances.push(u); }, getVoices() { return []; } } });
    const { tts, useTts } = await import('/src/engine/tts.ts');
    try {
      tts.start(['第一句。', '第二句。']); const stale = utterances[0];
      tts.pause(); tts.resume(); stale.onend();
      const before = useTts.getState().paraIdx;
      utterances.at(-1).onend(); const after = useTts.getState().paraIdx;
      utterances.at(-1).onend();
      return { before, after, playing: useTts.getState().playing };
    } finally { tts.stop(); Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: original }); }
  });
  assert.deepEqual(ttsResult, { before: 0, after: 1, playing: false });
  await page.evaluate(async raw => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.putBook({ id: 'pdf-audit', title: 'PDF修复测试', author: '', format: 'pdf', size: raw.length, addedAt: 1, nodeId: null }, [{ title: 'PDF', html: '', chars: 0 }], new Uint8Array(raw).buffer);
    await platform.kvSet('sync-config', { username: 'private-user', password: 'private-password' });
    await platform.kvSet('sync-state', { bookRevs: {} }); await platform.kvSet('device-id', 'private-device');
  }, pdfBytes());
  const downloadEvent = page.waitForEvent('download');
  await page.evaluate(async () => { const { exportBackup } = await import('/src/backup.ts'); await exportBackup({ includeRaw: true }); });
  const download = await downloadEvent;
  const zip = unzipSync(new Uint8Array(await fs.readFile(await download.path())));
  assert.ok(!Object.keys(zip).some(k => /kv\/(sync-|device-id)/.test(decodeURIComponent(k))));
  await page.reload(); await page.getByRole('button', { name: '阅读《PDF修复测试》', exact: true }).click();
  await page.locator('.textLayer span').first().waitFor();
  await page.locator('.pdf-busy').waitFor({ state: 'hidden' });
  const dimensions = await page.evaluate(() => {
    const layer = document.querySelector('.textLayer'), canvas = document.querySelector('.pdf-page canvas');
    const text = layer.querySelector('span').getBoundingClientRect(), bounds = canvas.getBoundingClientRect();
    return { scale: +layer.style.getPropertyValue('--scale-factor'), width: layer.clientWidth, canvas: parseFloat(canvas.style.width), inside: text.left >= bounds.left && text.right <= bounds.right + 1 && text.top >= bounds.top && text.bottom <= bounds.bottom };
  });
  assert.ok(dimensions.scale > 0 && dimensions.inside); assert.ok(Math.abs(dimensions.width - dimensions.canvas) < 2);
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas'); const original = canvas.getContext.bind(canvas);
    window.canvasReads = 0; canvas.getContext = (...args) => { window.canvasReads++; return original(...args); };
    const { useAnnotations } = await import('/src/store/annotations.ts');
    const ann = await useAnnotations.getState().add({ kind: 'highlight', chapter: 0, exact: 'ReadingTree', prefix: '', suffix: '', color: 'red', note: '' });
    await useAnnotations.getState().update(ann.id, { note: '批注测试' });
  });
  await page.locator('.textLayer mark.has-note').waitFor();
  assert.equal(await page.evaluate(() => window.canvasReads), 0, 'PDF note changes must not redraw canvas');
  await page.clock.fastForward(60001);
  const seconds = await page.evaluate(async () => { const { platform } = await import('/src/platform/web.ts'); const rows = await platform.kvEntries('stats:'); return rows.reduce((sum, r) => sum + (r.v.byBook['pdf-audit'] || 0), 0); });
  assert.equal(seconds, 60, 'PDF must count exactly one minute');
  await page.clock.resume();
  await page.getByRole('button', { name: '收起菜单' }).click();
  await page.keyboard.press('PageDown');
  await page.locator('.pdf-busy').waitFor({ state: 'hidden' });
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  assert.match(await page.locator('.foot-ch').textContent(), /2\/2/);
  await page.getByRole('button', { name: '〈 书架', exact: true }).click();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.putBook({ id: 'text-audit', title: '菜单留白测试', author: '', format: 'txt', size: 20, addedAt: 2, nodeId: null }, [{ title: '卷一', html: '<h1>清风明月</h1><p>这是用于复制和菜单留白测试的正文。</p>', chars: 30 }]);
    const { useLibrary } = await import('/src/store/library.ts'); await useLibrary.getState().init();
  });
  await page.getByRole('button', { name: '阅读《菜单留白测试》', exact: true }).click();
  await page.locator('.page-inner h1').waitFor();
  await page.waitForTimeout(500);
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.locator('.reader-head').waitFor();
  assert.ok(await page.evaluate(() => document.querySelector('.page-inner h1').getBoundingClientRect().top >= document.querySelector('.reader-head').getBoundingClientRect().bottom), 'menu must not cover chapter title');
  await fs.mkdir('output/playwright/reader-fixes', { recursive: true });
  await page.screenshot({ path: 'output/playwright/reader-fixes/menu-mobile.png' });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const copied = await page.evaluate(async () => {
    const { copyText } = await import('/src/engine/clipboard.ts');
    const range = document.createRange(); range.selectNodeContents(document.querySelector('.page-inner p'));
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const text = sel.toString(); await copyText(text);
    return { expected: text, copied: await navigator.clipboard.readText(), selection: sel.toString() };
  });
  assert.equal(copied.copied, copied.expected); assert.equal(copied.selection, copied.expected);
  assert.deepEqual(errors, []);
  console.log('PASS: TTS resume; credential-free backup; PDF DPI, notes, timer and PageDown; menu title clearance; clipboard preserves selection');
} finally { await browser.close(); await server.close(); }
