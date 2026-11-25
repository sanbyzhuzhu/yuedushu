/** 长章节竖排分页验证：紅樓夢（78 万字 31 章） */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 导入紅樓夢
await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
await page.waitForTimeout(3500);
console.log('书卡：', await page.locator('.cell').count());

// 打开书 → 竖排
await page.locator('.cell').first().click();
await page.waitForTimeout(2500); // 等章节加载
await page.mouse.click(195, 422);
await page.waitForTimeout(300);
await page.locator('button', { hasText: '排版' }).first().click();
await page.waitForTimeout(300);
await page.locator('.seg button', { hasText: '竖排' }).first().click();
await page.waitForTimeout(800);
await page.locator('.drawer-head button', { hasText: '收起' }).click().catch(() => {});
await page.mouse.click(195, 300);
await page.waitForTimeout(600);

const geo = await page.evaluate(() => {
  const outer = document.querySelector('.page-outer');
  return {
    scrollW: outer.scrollWidth,
    clientW: outer.clientWidth,
    innerW: document.querySelector('.page-inner').style.width,
    colW: getComputedStyle(document.querySelector('.page-inner')).columnWidth,
  };
});
console.log('竖排几何：', JSON.stringify(geo));
console.log(geo.scrollW > geo.clientW ? `✓ 真分页：内容宽 ${geo.scrollW} > 视口 ${geo.clientW}` : '✗ 无溢出');

// 竖排：左侧=下一页（transform 度量），连续点 3 次；右侧=上一页
const readState = () =>
  page.evaluate(() => ({
    tf: document.querySelector('.page-inner')?.style.transform || 'none',
    sl: document.querySelector('.page-outer')?.scrollLeft ?? 0,
  }));
let prev = await readState();
for (let i = 1; i <= 3; i++) {
  await page.mouse.click(65, 422);
  await page.waitForTimeout(400);
  const cur = await readState();
  console.log(`点左 #${i}: ${JSON.stringify(prev)} → ${JSON.stringify(cur)} ${JSON.stringify(prev) !== JSON.stringify(cur) ? '✓' : '✗'}`);
  prev = cur;
}
await page.mouse.click(325, 422);
await page.waitForTimeout(400);
const back = await readState();
console.log(`点右回退: ${JSON.stringify(prev)} → ${JSON.stringify(back)} ${JSON.stringify(back) !== JSON.stringify(prev) ? '✓' : '✗'}`);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/shot-hlm-vertical.png' });

// 横排也验证一下
await page.mouse.click(195, 422);
await page.waitForTimeout(300);
await page.locator('button', { hasText: '排版' }).first().click();
await page.waitForTimeout(300);
await page.locator('.seg button', { hasText: '横排' }).first().click();
await page.waitForTimeout(800);
await page.locator('.drawer-head button', { hasText: '收起' }).click().catch(() => {});
await page.mouse.click(195, 300);
await page.waitForTimeout(500);
const h0 = await page.evaluate(() => document.querySelector('.page-outer')?.scrollLeft);
await page.mouse.click(325, 422); // 横排右侧=下一页
await page.waitForTimeout(400);
const h1 = await page.evaluate(() => document.querySelector('.page-outer')?.scrollLeft);
console.log(`横排点右: ${h0} → ${h1} ${h1 !== h0 ? '✓ 翻页' : '✗'}`);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/shot-hlm-horizontal.png' });

await browser.close();
console.log('DONE');
