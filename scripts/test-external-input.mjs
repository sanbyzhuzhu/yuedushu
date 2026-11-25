import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5197, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const body = Array.from({ length: 60 }, () => '读书使人心静，思考使人明辨。窗前一卷书，字里行间皆有天地。'.repeat(6)).join('\n\n');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; console.log('PASS: ' + message); }
async function drop(page, entries) {
  await page.evaluate(entries => {
    const dataTransfer = new DataTransfer();
    for (const [name, text] of entries) dataTransfer.items.add(new File([text], name));
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer }));
  }, entries);
  await page.getByText('松开即可导入书籍').waitFor();
  await page.evaluate(entries => {
    const dataTransfer = new DataTransfer();
    for (const [name, text] of entries) dataTransfer.items.add(new File([text], name));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer, cancelable: true }));
  }, entries);
}
async function pageNumber(page) { return page.evaluate(() => window.__rtPag.page); }
async function wheel(page, deltaY, extra = {}) {
  await page.locator('.reader-stage').evaluate((stage, { deltaY, extra }) => stage.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true, ...extra })), { deltaY, extra });
}
function pdfBytes() {
  const stream = 'BT /F1 20 Tf 40 180 Td (Reading Tree) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
    ...Array(3).fill('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>'),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = text.length;
  text += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return [...new TextEncoder().encode(text)];
}
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto('http://127.0.0.1:5197');
  await page.waitForFunction(() => window.__rtLib?.getState().ready);
  await drop(page, [['滚轮测试.md', body], ['第二本.txt', '第二本正文'], ['无效.bad', 'bad']]);
  await page.getByRole('status').filter({ hasText: '已导入 2 本' }).waitFor();
  ok(await page.locator('.cell').count() === 2, 'multi-file drop imports supported files and reports unsupported files');
  ok(await page.locator('.book-drop-overlay').count() === 0, 'drop overlay closes');
  await page.getByRole('button', { name: '阅读《滚轮测试》', exact: true }).click();
  await page.waitForFunction(() => window.__rtPag?.pages > 3);
  await page.waitForTimeout(450);
  await wheel(page, 120);
  await page.waitForFunction(() => window.__rtPag.page === 1);
  ok(await pageNumber(page) === 1, 'wheel down turns a text page');
  await wheel(page, 120); await wheel(page, 120);
  ok(await pageNumber(page) === 1, 'same wheel burst does not skip pages after React updates');
  await page.waitForTimeout(220); await wheel(page, -120);
  await page.waitForFunction(() => window.__rtPag.page === 0);
  ok(await pageNumber(page) === 0, 'wheel up turns back');
  await page.waitForTimeout(220); await wheel(page, 120, { ctrlKey: true });
  ok(await pageNumber(page) === 0, 'Ctrl-wheel does not turn a page');
  await wheel(page, 120, { buttons: 1 });
  ok(await pageNumber(page) === 0, 'wheel during mouse drag does not turn a page');
  await page.evaluate(() => {
    const text = document.querySelector('.page-inner p').firstChild;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.locator('.reader-selection').waitFor();
  await wheel(page, 120);
  ok(await pageNumber(page) === 0, 'selection blocks wheel paging');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForTimeout(400);
  await page.locator('.reader-stage').click({ position: { x: 640, y: 400 } });
  await page.waitForFunction(() => document.querySelector('.reader').dataset.menu === 'open');
  await wheel(page, 120);
  ok(await pageNumber(page) === 0, 'open menu blocks wheel paging');
  await drop(page, [['阅读中拖入.txt', '阅读时也能导入']]);
  await page.getByRole('status').filter({ hasText: '已导入 1 本' }).waitFor();
  ok(await page.evaluate(() => window.__rtLib.getState().books.length) === 3, 'drop works while reading without closing current book');
  await page.evaluate(async () => {
    const { useSettings } = await import('/src/store/settings.ts');
    useSettings.getState().set({ readMode: 'scroll', flow: 'horizontal' });
  });
  await page.locator('.scroll-outer').waitFor();
  await page.getByRole('button', { name: '收起菜单', exact: true }).click();
  await page.locator('.scroll-ch-body p').first().waitFor();
  await page.waitForTimeout(400);
  const before = await page.locator('.scroll-outer').evaluate(el => el.scrollTop);
  await page.locator('.scroll-outer').hover(); await page.mouse.wheel(0, 300);
  await page.waitForTimeout(300);
  ok(await page.locator('.scroll-outer').evaluate(el => el.scrollTop) > before, 'scroll reading retains natural mouse scrolling');
  ok(errors.length === 0, 'desktop browser has no runtime errors: ' + errors.join(';'));
  await context.close();

  const pdfContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pdf = await pdfContext.newPage();
  await pdf.goto('http://127.0.0.1:5197');
  await pdf.waitForFunction(() => window.__rtLib?.getState().ready);
  await pdf.evaluate(async raw => {
    const { platform } = await import('/src/platform/web.ts');
    await platform.putBook({ id: 'wheel-pdf', title: 'PDF滚轮', format: 'pdf', size: raw.length, addedAt: Date.now(), nodeId: null }, [{ title: 'PDF', html: '', chars: 0 }], new Uint8Array(raw).buffer);
  }, pdfBytes());
  await pdf.reload(); await pdf.locator('.cell').click();
  await pdf.locator('.textLayer span').first().waitFor();
  await pdf.locator('.pdf-busy').waitFor({ state: 'hidden' });
  await pdf.getByRole('button', { name: '收起菜单', exact: true }).click();
  await wheel(pdf, 120);
  await pdf.waitForTimeout(30); await wheel(pdf, 120);
  await pdf.waitForFunction(async () => (await (await import('/src/platform/web.ts')).platform.kvGet('progress:wheel-pdf'))?.chapter === 1);
  ok(true, 'PDF wheel down turns one page and suppresses burst repeats');
  await pdf.locator('.pdf-busy').waitFor({ state: 'hidden' });
  await wheel(pdf, -120);
  await pdf.waitForFunction(async () => (await (await import('/src/platform/web.ts')).platform.kvGet('progress:wheel-pdf'))?.chapter === 0);
  ok(true, 'PDF wheel up turns back');
  await pdfContext.close();

  // Exercise the exact Android bridge contract before and after app startup.
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.addInitScript(() => {
    const files = new Map(), queue = [];
    window.sharedReleased = []; window.sharedReads = 0;
    window.injectShared = (name, text, open = true, error) => {
      const id = String(Math.random()), bytes = new TextEncoder().encode(text);
      files.set(id, bytes); queue.push({ id, name, size: bytes.length, open, error });
    };
    window.ReadingTreeNativeImports = {
      take() { return JSON.stringify(queue.splice(0)); },
      readChunk(id, offset) { window.sharedReads++; return btoa(String.fromCharCode(...files.get(id).slice(offset, offset + 17))); },
      release(id) { files.delete(id); window.sharedReleased.push(id); },
    };
    window.injectShared('冷启动.txt', '冷启动接收中文书籍。'.repeat(8));
  });
  const phone = await mobile.newPage();
  await phone.goto('http://127.0.0.1:5197');
  await phone.locator('.reader').waitFor();
  ok(await phone.evaluate(() => window.__rtLib.getState().books.some(b => b.title === '冷启动')), 'Android cold-start file waits for library initialization, imports and opens');
  ok(await phone.evaluate(() => window.sharedReads > 1 && window.sharedReleased.length === 1), 'chunked Unicode file transfer releases temporary source');
  await phone.evaluate(() => window.injectShared('运行中.txt', '运行中接收正文。'.repeat(8)));
  await phone.getByRole('status').filter({ hasText: '已导入 1 本' }).waitFor();
  await phone.waitForFunction(() => window.__rtLib.getState().books.length === 2);
  ok(await phone.evaluate(() => window.__rtLib.getState().books.some(b => b.title === '运行中')), 'Android running app accepts another file');
  await phone.evaluate(() => {
    window.injectShared('损坏.bad', '', false, '无法读取书籍');
    window.injectShared('批量甲.txt', '批量甲', false);
    window.injectShared('批量乙.txt', '批量乙', false);
  });
  await phone.waitForFunction(() => window.__rtLib.getState().books.length === 4);
  await phone.getByRole('status').filter({ hasText: '已导入 2 本' }).waitFor();
  ok(await phone.evaluate(() => window.sharedReleased.length === 5), 'Android multiple files continue after a read error and release all sources');
  await mobile.close();
  console.log(`Completed ${checks} external input checks`);
} finally { await browser.close(); await server.close(); }
