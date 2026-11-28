import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { shelfAction } from './shelf-actions.mjs';

const live = process.argv.includes('--live');
const server = await createServer({ server: { host: '127.0.0.1', port: 5207, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  if (live) await page.route(/^https:\/\//, async route => {
    try {
      const response = await fetch(route.request().url(), { signal: AbortSignal.timeout(20000) });
      await route.fulfill({ status: response.status, contentType: response.headers.get('content-type') || 'text/html', body: Buffer.from(await response.arrayBuffer()) });
    } catch { await route.abort('failed'); }
  });
  await page.goto('http://127.0.0.1:5207');
  if (live) {
    const checks = await page.evaluate(async raw => {
      const net = await import('/src/engine/networkLibrary.ts');
      const parsed = net.parseSources(JSON.stringify(raw));
      if (parsed.rejected.length) throw new Error(parsed.rejected.join('\n'));
      const checks = [];
      for (const [index, query, excerpt] of [[0, '西游记', '混沌'], [0, '论语', '学而时习之'], [0, '道德经', '道可道'], [1, '史记', '史记'], [2, '西游记', '混沌'], [2, '红楼梦', '甄士隐']]) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        try {
          const source = parsed.sources[index];
          const books = await net.searchSource(source, query, 1, controller.signal);
          if (!books.length || books.some(b => !b.title.includes(query))) throw new Error(query + '未按书名筛选');
          const chapters = await net.sourceChapters(source, books[0], controller.signal);
          if (!chapters.length) throw new Error(query + '无目录');
          const file = await net.downloadChapters(source, books[0], chapters.slice(0, 1), controller.signal, () => {});
          const body = await file.text();
          if (!body.includes(excerpt) || body.length < 200) throw new Error(query + '正文不符合预期');
          checks.push({ source: source.bookSourceName, query, title: books[0].title, chapters: chapters.length, firstChapter: chapters[0].title, bytes: file.size });
        } finally { clearTimeout(timer); }
      }
      return checks;
    }, JSON.parse(fs.readFileSync('src/engine/curatedSources.json', 'utf8')));
    fs.mkdirSync('output/source-recheck', { recursive: true });
    fs.writeFileSync('output/source-recheck/live-results.json', JSON.stringify({ testedAt: new Date().toISOString(), checks }, null, 2));
    console.log('PASS LIVE', JSON.stringify(checks));
  }
  await shelfAction(page, '网络书库');
  await page.getByRole('button', { name: '书源管理 · 检测/清理', exact: true }).click();
  await page.getByRole('button', { name: '一键添加 3 个精选书源', exact: true }).click();
  await page.getByText('已添加 3 个精选书源，已选中 5000言；可直接点击“搜索书源”试读西游记', { exact: true }).waitFor();
  assert.equal(await page.locator('.network-note[open] summary').textContent(), '批量检测与清理书源');
  assert.equal(await page.getByLabel('选择书源', { exact: true }).locator('option').count(), 3);
  assert.equal(await page.getByText('可导入新旧版“阅读 / Legado” JSON 或 TXT 书源。', { exact: true }).count(), 1);
  assert.equal(await page.getByText(/单个文件最大 50 MB/).count(), 0);
  fs.mkdirSync('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/source-manager-simplified.png', fullPage: true });
  await page.getByRole('button', { name: '一键添加 3 个精选书源', exact: true }).click();
  await page.getByText(/已保存 3 个书源/).waitFor();
  console.log('PASS visible management entry, expanded tools, one-click sources and duplicate merge');
  await page.evaluate(() => {
    window.fetch = async () => { throw new Error('受控离线检测'); };
  });
  await page.getByRole('button', { name: '检测全部书源（3）', exact: true }).click();
  await page.getByText('已检测 3 / 3：可读 0，无结果 0，失败 3', { exact: true }).waitFor();
  await page.reload();
  await shelfAction(page, '网络书库');
  await page.getByRole('button', { name: '书源管理 · 检测/清理', exact: true }).click();
  await page.getByText('已检测 3 / 3：可读 0，无结果 0，失败 3', { exact: true }).waitFor();
  console.log('PASS audit results survive page reload');
  await page.getByRole('button', { name: '选择检测失败（3）', exact: true }).click();
  await page.getByRole('button', { name: '批量移除所选（3）', exact: true }).click();
  await page.getByRole('button', { name: '确认移除', exact: true }).click();
  await page.getByText('已移除 3 个书源，保留 0 个', { exact: true }).waitFor();
  const saved = await page.evaluate(async () => (await import('/src/platform/web.ts')).platform.kvGet('networkSources'));
  assert.deepEqual(saved, []);
  console.log('PASS batch check, failure selection, explicit removal and persisted empty list');
  await page.getByRole('button', { name: '一键添加 3 个精选书源', exact: true }).click();
  await page.getByText(/已添加 3 个精选书源/).waitFor();
  await page.evaluate(async () => {
    const { platform } = await import('/src/platform/web.ts');
    const sources = await platform.kvGet('networkSources');
    await platform.kvSet('networkSourceAudit', { query: '西游记', entries: [{ source: JSON.stringify(sources[0]), result: { index: 0, status: 'readable', detail: '保留的首章检测结果' } }] });
  });
  await page.reload();
  await shelfAction(page, '网络书库');
  await page.getByRole('button', { name: '书源管理 · 检测/清理', exact: true }).click();
  await page.getByText('已检测 1 / 3：可读 1，无结果 0，失败 0', { exact: true }).waitFor();
  await page.evaluate(() => { window.fetch = async () => { throw new Error('受控离线检测'); }; });
  await page.getByRole('button', { name: '继续检测剩余（2）', exact: true }).click();
  await page.getByText('已检测 3 / 3：可读 1，无结果 0，失败 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: '一键清空所有书源', exact: true }).click();
  await page.getByRole('button', { name: '保留书源', exact: true }).click();
  assert.equal(await page.getByLabel('选择书源', { exact: true }).locator('option').count(), 3);
  await page.getByRole('button', { name: '一键清空所有书源', exact: true }).click();
  await page.getByRole('button', { name: '确认清空所有书源', exact: true }).click();
  await page.getByText('已移除 3 个书源，保留 0 个', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(async () => (await import('/src/platform/web.ts')).platform.kvGet('networkSources')), []);
  console.log('PASS resume only unchecked sources, clear cancellation and confirmed clear');
} finally { await browser.close(); await server.close(); }
