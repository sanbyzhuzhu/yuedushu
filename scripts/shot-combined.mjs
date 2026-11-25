/** 界行+版框同开截图 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
if ((await page.locator('.cell').count()) === 0) {
  await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
  await page.waitForTimeout(4000);
}
await page.evaluate(() => {
  return new Promise((resolve) => {
    const req = indexedDB.open('reading-tree');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      const get = tx.objectStore('kv').get('settings');
      get.onsuccess = () => {
        const rec = get.result || { k: 'settings', v: {} };
        rec.v = { ...rec.v, flow: 'vertical', decorLines: true, decorFrame: true, pageMarginX: 40, pageMarginY: 44, fontSize: 19 };
        tx.objectStore('kv').put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    };
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('.cell').first().click();
await page.waitForTimeout(3000);
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/decor-both.png' });
await browser.close();
console.log('DONE');
