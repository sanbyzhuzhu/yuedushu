/** 边距×字号 矩阵验证：每种组合下 窗口==cols×pitch 且 内容网格完整 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
if ((await page.locator('.cell').count()) === 0) {
  await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
  await page.waitForTimeout(4000);
}
await page.locator('.cell').first().click();
await page.waitForTimeout(3000);

// 直接写设置（flow=vertical）后 reload，保证确定性
async function applySettings(patch) {
  await page.evaluate((patch) => {
    return new Promise((resolve) => {
      const req = indexedDB.open('reading-tree');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        const get = tx.objectStore('kv').get('settings');
        get.onsuccess = () => {
          const rec = get.result || { k: 'settings', v: {} };
          rec.v = { ...rec.v, flow: 'vertical', ...patch };
          tx.objectStore('kv').put(rec);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      };
    });
  }, patch);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.locator('.cell').first().click();
  await page.waitForTimeout(2200);
}

const margins = [16, 28, 40, 56, 72];
const fontSizes = [15, 19, 23];
let bad = 0;
for (const m of margins) {
  for (const fs of fontSizes) {
    await applySettings({ pageMarginX: m, pageMarginY: m, fontSize: fs });
    const r = await page.evaluate(() => {
      const p = window.__rtPag;
      const outer = document.querySelector('.page-outer');
      const cs = getComputedStyle(outer);
      const padL = parseFloat(cs.paddingLeft);
      const padR = parseFloat(cs.paddingRight);
      const contentW = outer.clientWidth - padL - padR;
      const pitch = p.colW;
      return {
        cols: p.cols,
        pitch: Math.round(pitch * 10) / 10,
        step: p.step,
        contentW: Math.round(contentW * 10) / 10,
        gridOK: Math.abs(contentW - p.cols * pitch) < 1.5,
        innerScrollW: document.querySelector('.page-inner').scrollWidth,
        scrollWModPitch: Math.round((document.querySelector('.page-inner').scrollWidth % pitch) * 10) / 10,
      };
    });
    const okGrid = r.gridOK;
    const okContent = Math.abs(r.innerScrollW - Math.round(r.innerScrollW / r.pitch) * r.pitch) < 1.5;
    if (!okGrid || !okContent) bad += 1;
    console.log(
      `m=${m} fs=${fs} cols=${r.cols} pitch=${r.pitch} 窗口=${r.contentW} ${okGrid ? '✓窗口=cols×pitch' : '✗窗口错'} 内容宽=${r.innerScrollW} ${okContent ? '✓网格整' : '✗网格破(差' + r.scrollWModPitch + ')'}`,
    );
  }
}
console.log(bad === 0 ? '全部组合通过' : `${bad} 个组合异常`);
await browser.close();
