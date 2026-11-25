import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 5195, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('output/playwright', { recursive: true });
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; console.log('PASS: ' + label); };
try {
  for (const target of ['windows', 'android']) {
    const context = await browser.newContext(target === 'android'
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36' }
      : { viewport: { width: 1100, height: 800 } });
    const page = await context.newPage();
    const errors = [], dialogs = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await page.addInitScript(() => { window.__openedUrls = []; window.open = url => { window.__openedUrls.push(url); return null; }; });
    let manifest = { version: '9.0.0', notes: '测试发布说明：目录定位与安静更新', downloads: {
      windows: 'https://gitee.com/sanbyzhu/yuedushu/releases/download/v9.0.0/windows.exe',
      android: 'https://gitee.com/sanbyzhu/yuedushu/releases/download/v9.0.0/android.apk',
    } };
    let failure = false, requests = 0;
    await page.route('https://gitee.com/sanbyzhu/yuedushu/raw/master/update.json?*', route => {
      requests++;
      return failure ? route.fulfill({ status: 503, body: 'unavailable' })
        : route.fulfill({ contentType: 'application/json', body: JSON.stringify(manifest) });
    });
    await page.goto('http://127.0.0.1:5195');
    await page.waitForFunction(() => window.__rtLib?.getState().ready);
    await page.evaluate(async () => {
      const { platform } = await import('/src/platform/web.ts');
      await platform.putBook({ id: 'update-reading', title: '更新期间阅读', format: 'txt', size: 100, addedAt: Date.now(), nodeId: null },
        [{ title: '正文', html: '<p>静读一卷书，不被更新打扰。</p>'.repeat(100), chars: 1400 }]);
    });
    await page.reload(); await page.locator('.cell').click();
    await page.waitForFunction(() => window.__rtPag?.pages > 1);
    const before = await page.evaluate(() => window.__rtPag.page);
    await page.evaluate(async () => { window.__updateStore = (await import('/src/store/appUpdate.ts')).useAppUpdate; });
    await page.waitForFunction(() => !!window.__updateStore.getState().manifest, null, { timeout: 20000 });
    ok(requests === 1, target + ': real delayed background check fetched once (requests=' + requests + ')');
    ok(await page.locator('.reader').count() === 1 && await page.evaluate(() => window.__rtPag.page) === before, target + ': background update preserves reader and page');
    ok(dialogs.length === 0 && await page.getByRole('dialog').count() === 0 && await page.locator('.toast').count() === 0, target + ': update never opens a popup or toast');
    await page.reload();
    await page.getByRole('button', { name: '更多', exact: true }).click();
    const row = page.getByRole('button', { name: '检查更新，有新版本', exact: true });
    ok(await row.locator('.update-dot').count() === 1, target + ': red dot appears only in update row');
    ok(await row.evaluate(el => el.previousElementSibling.textContent.startsWith('关于阅读树')), target + ': update row sits immediately below About');
    await row.click();
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    ok(await page.evaluate(() => window.__openedUrls.length) === 0, target + ': download requires a separate confirmation');
    await page.getByRole('button', { name: '暂不更新', exact: true }).click();
    ok(await page.evaluate(() => window.__openedUrls.length) === 0, target + ': cancelling does not open a download');
    await page.getByRole('button', { name: '下载更新', exact: true }).click();
    await page.getByRole('button', { name: '确认打开下载', exact: true }).click();
    await page.getByText('已请求打开下载地址，请在系统浏览器中继续下载。', { exact: true }).waitFor();
    ok((await page.evaluate(() => window.__openedUrls))[0] === manifest.downloads[target], target + ': confirmation opens the matching platform package');
    await page.getByRole('button', { name: '忽略此版本', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: '更多', exact: true }).click();
    ok(await page.locator('.update-dot').count() === 0, target + ': ignored release remains hidden after restart');
    await page.getByRole('button', { name: '检查更新', exact: true }).click();
    await page.getByRole('button', { name: '恢复此版本提示', exact: true }).click();
    manifest = { ...manifest, version: '9.0.1' };
    await page.getByRole('button', { name: '立即检查更新', exact: true }).click();
    await page.getByRole('heading', { name: '阅读树 v9.0.1' }).waitFor();
    ok(true, target + ': a newer release still appears after an ignored release');
    await page.screenshot({ path: `output/playwright/update-preview-${target}.png` });
    failure = true;
    await page.getByRole('button', { name: '立即检查更新', exact: true }).click();
    await page.getByText(/检查未完成/).waitFor();
    ok(await page.getByRole('heading', { name: '阅读树 v9.0.1' }).count() === 1 && dialogs.length === 0, target + ': network failure keeps cached release without popup');
    await page.getByRole('checkbox').uncheck();
    const requestCount = requests;
    await page.evaluate(async () => { const { useAppUpdate } = await import('/src/store/appUpdate.ts'); useAppUpdate.setState({ checkedAt: 0 }); await useAppUpdate.getState().check(); });
    ok(requests === requestCount, target + ': disabling background checks prevents network access');
    await page.getByText('更新来源设置', { exact: true }).click();
    await page.getByLabel('公开的 update.json 地址').fill('javascript:alert(1)');
    await page.getByRole('button', { name: '保存更新地址', exact: true }).click();
    ok(await page.getByText('更新地址必须是公开的 HTTPS 链接', { exact: true }).count() === 1, target + ': unsafe update sources are rejected');
    ok(errors.length === 0, target + ': no runtime errors: ' + errors.join(';'));
    await context.close();
  }
  console.log(`Passed ${checks} quiet update checks.`);
} finally { await browser.close(); await server.close(); }
