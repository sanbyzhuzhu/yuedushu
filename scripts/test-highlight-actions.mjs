import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5199, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
function makePdf() {
  const stream = 'BT /F1 20 Tf 40 180 Td (Reading Tree) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return [...new TextEncoder().encode(text)];
}
const pdfBytes = makePdf();
let checks = 0;
function ok(value, label) { assert.ok(value, label); checks++; console.log('PASS: ' + label); }
try {
  for (const mode of ['paged', 'scroll', 'touch', 'pdf']) {
    const context = await browser.newContext(mode === 'touch'
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } });
    await context.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => { window.__copied = text; } }, configurable: true,
    }));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto('http://127.0.0.1:5199');
    await page.waitForFunction(() => window.__rtLib?.getState().ready);
    await page.evaluate(async ({ mode, raw }) => {
      const { platform } = await import('/src/platform/web.ts');
      const { useSettings } = await import('/src/store/settings.ts');
      useSettings.getState().set({ readMode: mode === 'scroll' ? 'scroll' : 'paged', flow: 'horizontal' });
      const exact = mode === 'pdf' ? 'Reading' : '读书使人心静';
      await platform.putBook({ id: 'actions', title: '划线测试', format: mode === 'pdf' ? 'pdf' : 'txt', size: 100, addedAt: Date.now(), nodeId: null },
        [{ title: '第一章', html: '<p>读书使人心静，思考使人明辨。</p>' + '<p>窗前一卷书，字里行间皆有天地。</p>'.repeat(100), chars: 1800 }],
        mode === 'pdf' ? new Uint8Array(raw).buffer : undefined);
      const make = (id, exact, note) => ({ id, bookId: 'actions', kind: 'highlight', chapter: 0, exact, prefix: '', suffix: '', note, color: 'red', createdAt: Date.now() });
      await platform.kvSet('annotations:actions', { list: [make('first', exact, ''), make('second', mode === 'pdf' ? 'Tree' : '思考使人明辨', '已有笔记')], deleted: [] });
    }, { mode, raw: pdfBytes });
    await page.reload(); await page.locator('.cell').click();
    if (mode === 'pdf') {
      await page.locator('.pdf-busy').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '收起菜单', exact: true }).click();
    }
    const first = page.locator('mark[data-aid="first"]').first();
    await first.waitFor(); await page.waitForTimeout(700);
    const open = async (mark, right = false) => {
      await page.waitForTimeout(450); // Reader's post-gesture click-through guard.
      if (mode === 'touch') await mark.tap();
      else await mark.click(right ? { button: 'right' } : {});
      await page.getByRole('dialog', { name: '划线操作', exact: true }).waitFor();
    };
    await open(first);
    ok(await page.getByRole('textbox', { name: '笔记内容' }).count() === 0, mode + ': click opens quick actions without editor');
    await page.getByRole('button', { name: '复制原文', exact: true }).click();
    ok(await page.evaluate(() => window.__copied) === (mode === 'pdf' ? 'Reading' : '读书使人心静'), mode + ': copies full saved quote without selecting');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await open(first, true);
    ok(true, mode + ': right-click (or mobile tap) opens actions');
    await page.getByRole('button', { name: '撤销划线', exact: true }).click();
    await first.waitFor({ state: 'hidden' });
    const second = page.locator('mark[data-aid="second"]').first();
    ok(await second.count() === 1, mode + ': removes only the targeted highlight');
    await open(second);
    await page.getByRole('button', { name: '复制笔记', exact: true }).click();
    ok(await page.evaluate(() => window.__copied) === '已有笔记', mode + ': copies saved note');
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: '撤销划线', exact: true }).click();
    ok(await second.count() === 1, mode + ': cancelling confirmation preserves note');
    await page.getByRole('button', { name: '编辑笔记', exact: true }).click();
    await page.getByRole('textbox', { name: '笔记内容' }).fill('修改后的笔记');
    await page.getByRole('button', { name: '保存笔记', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await open(second);
    ok(await page.locator('.highlight-note').textContent() === '修改后的笔记', mode + ': edit and save remain available');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload();
    await page.locator('.cell').click();
    await second.waitFor();
    ok(await first.count() === 0, mode + ': undo persists after reload');
    ok(errors.length === 0, mode + ': no runtime errors: ' + errors.join(';'));
    await context.close();
  }
  console.log(`Passed ${checks} highlight action checks.`);
} finally { await browser.close(); await server.close(); }
