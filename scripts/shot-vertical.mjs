/** 竖排渲染截图检查 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// 书架上应有上次的书（IndexedDB 同源保留）——若空则导入
const cells = await page.locator('.cell').count();
if (cells === 0) {
  await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
  await page.waitForTimeout(4000);
}
console.log('书卡：', await page.locator('.cell').count());

await page.locator('.cell').first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v-horizontal.png' });

// 切竖排
await page.mouse.click(195, 422);
await page.waitForTimeout(300);
await page.locator('button', { hasText: '排版' }).first().click();
await page.waitForTimeout(300);
await page.locator('.seg button', { hasText: '竖排' }).first().click();
await page.waitForTimeout(1200);
await page.locator('.drawer-head button', { hasText: '收起' }).click().catch(() => {});
await page.mouse.click(195, 300);
await page.waitForTimeout(600);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v-vertical.png' });

// 翻两页再截一张
await page.mouse.click(65, 422);
await page.waitForTimeout(500);
await page.mouse.click(65, 422);
await page.waitForTimeout(500);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v-vertical-p3.png' });

await browser.close();
console.log('DONE');
