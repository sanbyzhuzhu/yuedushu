import { shelfAction, shelfView, shelfSort, shelfVersion } from './shelf-actions.mjs';
/** UI/functional audit in an isolated browser profile. No live cloud account is used. */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5189, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await mkdir('output/playwright/audit', { recursive: true });
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; console.log(`✓ ${message}`); };
const shot = (name) => page.screenshot({ path: `output/playwright/audit/${name}.png` });
const fits = async () => page.evaluate(() => {
  const panel = document.querySelector('.drawer');
  return !panel || panel.scrollWidth <= panel.clientWidth + 1;
});
async function closePanel() { await page.locator('.drawer-head > button').click(); }

try {
  await page.goto('http://127.0.0.1:5189', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('.shelf').waitFor();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    const { dayKey } = await import('/src/store/stats.ts');
    const titles = ['闲情偶寄', '人间词话', '浮生六记', '小窗幽记', '山水清音', '夜航船'];
    const authors = ['李渔', '王国维', '沈复', '陈继儒', '佚名', '张岱'];
    const paragraphs = Array.from({ length: 35 }, (_, i) => `<p>第${i + 1}段。${i === 20 ? '松风入卷，灯火可亲。' : ''}读书之乐，在一窗晴日，也在半盏清茶。${'愿从书中看见天地，也照见自己的心。'.repeat(8)}</p>`).join('');
    for (let i = 0; i < titles.length; i++) await platform.putBook({ id: `audit-${i}`, title: titles[i], author: authors[i], format: 'epub', size: 4096, nodeId: null, addedAt: Date.now() - i }, [
      { title: '卷一 · 闲读', html: paragraphs, chars: paragraphs.length },
      { title: '卷二 · 札记', html: '<p>清风徐来，水波不兴。</p>', chars: 20 },
    ]);
    await platform.kvSet('progress:audit-0', { chapter: 0, page: 0, pages: 25, pct: .37, updatedAt: Date.now() });
    await platform.kvSet('annotations:audit-0', { list: [
      { id: 'audit-highlight', kind: 'highlight', exact: '读书之乐', note: '', chapter: 0 },
      { id: 'audit-note', kind: 'highlight', exact: '清风徐来，水波不兴。', note: '记录此刻的心境。', chapter: 1 },
      { id: 'audit-bookmark', kind: 'bookmark', exact: '卷一 · 闲读', note: '', chapter: 0, ratio: 0 },
    ].map((a) => ({ ...a, bookId: 'audit-0', prefix: '', suffix: '', color: 'red', createdAt: Date.now() })), deleted: [] });
    for (const [day, seconds] of [[0, 60], [20, 120], [100, 180], [400, 240]]) await platform.kvSet(`stats:${dayKey(day)}`, { seconds, byBook: { 'audit-0': seconds } });
  });
  await page.reload();
  await page.locator('.continue-reading').waitFor();
  ok((await page.locator('.cell').count()) === 6, 'shelf shows all books and a continue-reading entry');
  await shot('shelf-mobile');
  await shelfView(page, '列表');
  ok(await page.locator('.row-actions .book-menu').count() === 0, 'list view hides secondary management actions');
  await page.reload();
  await page.locator('.row').first().waitFor();
  ok(true, 'shelf view preference survives reload');
  await page.getByRole('button', { name: '管理《闲情偶寄》' }).click();
  await page.getByRole('button', { name: '编辑信息', exact: true }).click();
  await page.getByRole('textbox', { name: '书名', exact: true }).fill('');
  await page.getByRole('button', { name: '保存书籍信息' }).click();
  ok(await page.getByText('请填写书名', { exact: true }).isVisible(), 'book editor validates empty title without losing edits');
  await page.getByRole('textbox', { name: '书名', exact: true }).fill('闲情偶寄 · 珍藏');
  await shot('book-editor');
  await page.getByRole('button', { name: '保存书籍信息' }).click();
  await page.locator('.edit-card').waitFor({ state: 'hidden' });
  ok(await page.getByRole('button', { name: '阅读《闲情偶寄 · 珍藏》', exact: true }).isVisible(), 'book edits are saved before closing');
  await shelfView(page, '网格');
  await page.setViewportSize({ width: 1280, height: 850 });
  await shot('shelf-desktop');
  await page.setViewportSize({ width: 390, height: 844 });

  await shelfAction(page, '阅读统计');
  await page.waitForFunction(() => document.querySelector('.stat-cards')?.getAttribute('aria-busy') === 'false');
  assert.deepEqual(await page.locator('.stat-num').allTextContents(), ['1 分钟', '1 分钟', '3 分钟', '10 分钟']);
  ok(true, 'statistics correctly separate today, seven days, thirty days and all-time data');
  await shot('statistics');
  await page.locator('summary').filter({ hasText: '半年足迹' }).click();
  ok(await page.locator('.heatmap .hm-cell').count() === 182, 'optional reading history opens on demand');
  ok(await fits(), 'statistics fit the narrow panel');
  await page.keyboard.press('Escape');
  await page.locator('.drawer').waitFor({ state: 'hidden' });
  ok(true, 'Escape closes a panel');

  await shelfAction(page, '坚果云同步');
  ok(await page.getByRole('button', { name: '立即同步' }).isDisabled(), 'sync action is disabled before configuration');
  ok(!(await page.getByLabel('服务器（WebDAV）').isVisible()), 'advanced connection fields start collapsed');
  await shot('sync');
  await page.locator('summary').filter({ hasText: '连接设置' }).click();
  ok(await page.getByLabel('服务器（WebDAV）').isVisible() && await fits(), 'advanced sync fields remain accessible and fit');
  await closePanel();

  await shelfAction(page, '备份 / 恢复');
  await page.getByRole('button', { name: '完整备份', exact: true }).click();
  await shot('backup');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  const artifact = await download;
  const backup = await readFile(await artifact.path());
  ok(backup[0] === 0x50 && backup[1] === 0x4b, 'backup export creates a ZIP file');
  await closePanel();

  await shelfView(page, '树架');
  await page.locator('summary').filter({ hasText: '藏书索引' }).click();
  ok(await page.locator('.tree-index button').count() === 6, 'tree view has a complete textual book index');
  await shot('tree');
  await page.locator('.tree-index button').first().click();
  await page.waitForFunction(() => !!document.querySelector('.page-inner p'));
  await page.waitForTimeout(500);
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.getByRole('button', { name: '排版', exact: true }).click();
  ok(await page.getByRole('tab', { name: '常用', exact: true }).getAttribute('aria-selected') === 'true', 'settings open with common controls');
  await shot('settings-common');
  for (const name of ['纸墨', '版式', '更多']) {
    await page.getByRole('tab', { name, exact: true }).click();
    ok(await fits(), `${name} settings have no horizontal overflow`);
    await shot(`settings-${name}`);
  }
  await page.getByRole('tab', { name: '常用', exact: true }).click();
  await page.getByRole('button', { name: '古籍 楷体 · 竖排' }).click();
  ok(await page.locator('.reader').getAttribute('data-flow') === 'vertical', 'classical preset applies vertical reading');
  await page.getByRole('button', { name: '舒朗 宋体 · 横排' }).click();
  await page.getByRole('button', { name: '本书独立', exact: true }).click();
  await page.getByRole('button', { name: '跟随全局', exact: true }).click();
  ok(await page.getByRole('button', { name: '跟随全局', exact: true }).getAttribute('class') === 'active', 'reading scope returns to global settings correctly');
  await page.getByRole('tab', { name: '纸墨', exact: true }).click();
  await page.getByRole('button', { name: '青灯', exact: true }).click();
  ok(await page.locator('.swatch[data-theme="paper"]').evaluate((el) => getComputedStyle(el).backgroundColor) !== await page.locator('.swatch[data-theme="lamp"]').evaluate((el) => getComputedStyle(el).backgroundColor), 'theme previews retain their own paper colors in night mode');
  await shot('settings-night');
  await page.getByRole('button', { name: '宣纸', exact: true }).click();
  await closePanel();
  await page.getByRole('button', { name: '朗读', exact: true }).click();
  ok(!(await page.getByText('定时停止', { exact: true }).isVisible()), 'reading aloud starts with playback and speed controls');
  await shot('tts');
  await page.locator('summary').filter({ hasText: '朗读偏好' }).click();
  ok(await page.getByText('定时停止', { exact: true }).isVisible() && await fits(), 'voice, timer and continuation preferences are available');
  await closePanel();
  await page.getByRole('button', { name: '目录', exact: true }).click();
  await shot('catalog');
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索全书内容' }).fill('松风入卷');
  await page.locator('.search-hit').waitFor();
  await shot('search');
  await page.locator('.search-hit').click();
  await page.locator('mark.search-match').waitFor();
  ok(await page.evaluate(() => window.__rtPag.page > 0), 'search opens the matching page, not the chapter start');
  ok(await page.locator('mark.search-match').textContent() === '松风入卷', 'search briefly marks the exact matching words');
  await shot('search-located');
  await page.waitForTimeout(500);
  await page.locator('.reader-stage').click({ position: { x: 195, y: 400 } });
  await page.getByRole('button', { name: '笔记', exact: true }).click();
  ok(await page.locator('.ann-item').count() === 3, 'notes show highlights, comments and bookmarks');
  await page.getByRole('textbox', { name: '检索笔记' }).fill('记录');
  await page.locator('.note-filters').getByRole('button', { name: '批注', exact: true }).click();
  ok(await page.locator('.ann-item').count() === 1 && await page.locator('.ann-note').textContent() === '记录此刻的心境。', 'note search matches comment text together with the type filter');
  await shot('notes');
  await page.getByRole('textbox', { name: '检索笔记' }).fill('');
  await page.locator('.note-filters').getByRole('button', { name: '书签', exact: true }).click();
  ok(await page.locator('.ann-item').count() === 1 && await page.locator('.ann-tag').textContent() === '书签', 'bookmark filter excludes highlights and comments');
  await page.locator('.note-filters').getByRole('button', { name: '划线', exact: true }).click();
  ok(await page.locator('.ann-item').count() === 1 && await page.locator('.ann-text').textContent() === '读书之乐', 'highlight filter shows plain highlights');
  ok(await fits(), 'notes filtering and export controls fit the panel');
  ok(errors.length === 0, `all panels have no runtime errors: ${errors.join('; ')}`);
  console.log(`\n${checks} panel audit checks passed.`);
} finally { await context.close(); await browser.close(); await server.close(); }
