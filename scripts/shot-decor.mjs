/** 装饰验证（状态自适应版）：界行/版框截图 + 翻页边缘检查 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const cells = await page.locator('.cell').count();
if (cells === 0) {
  await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
  await page.waitForTimeout(4000);
}
await page.locator('.cell').first().click();
await page.waitForTimeout(3000);
for (let i = 0; i < 3 && !(await page.locator('.page-outer').count()); i++) {
  await page.locator('.cell').first().click();
  await page.waitForTimeout(3000);
}
console.log('阅读器已打开：', await page.locator('.page-outer').count());

const menuOpen = () => page.locator('button', { hasText: '排版' }).count();
const drawerOpen = () => page.locator('.drawer').count();

const openSet = async () => {
  for (let i = 0; i < 4 && !(await menuOpen()); i++) {
    await page.mouse.click(195, 422);
    await page.waitForTimeout(400);
  }
  await page.locator('button', { hasText: '排版' }).first().click();
  await page.waitForTimeout(350);
  for (let i = 0; i < 4 && !(await drawerOpen()); i++) {
    await page.mouse.click(195, 422);
    await page.waitForTimeout(400);
    await page.locator('button', { hasText: '排版' }).first().click().catch(() => {});
    await page.waitForTimeout(350);
  }
};

const closeAll = async () => {
  for (let i = 0; i < 3 && (await drawerOpen()); i++) {
    await page.locator('.drawer-head button', { hasText: '收起' }).click().catch(() => {});
    await page.waitForTimeout(300);
  }
  for (let i = 0; i < 3 && (await menuOpen()); i++) {
    await page.mouse.click(195, 422);
    await page.waitForTimeout(350);
  }
};

const setDecor = async (name) => {
  await openSet();
  await page.locator('.set-group', { hasText: '页面装饰' }).locator('.seg button', { hasText: name }).click();
  await page.waitForTimeout(500);
  await closeAll();
};

// 竖排 + 界行
await openSet();
await page.locator('.seg button', { hasText: '竖排' }).first().click();
await page.waitForTimeout(400);
await closeAll();
await setDecor('界行');
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/decor-lines.png' });

// 翻两页查边缘
await page.mouse.click(65, 422);
await page.waitForTimeout(400);
await page.mouse.click(65, 422);
await page.waitForTimeout(400);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/decor-lines-p3.png' });

// 版框
await setDecor('版框');
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/decor-frame.png' });

// 横排版框
await openSet();
await page.locator('.seg button', { hasText: '横排' }).first().click();
await page.waitForTimeout(600);
await closeAll();
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/decor-frame-h.png' });

await browser.close();
console.log('DONE');
