/**
 * 竖排节距/框线/标点综合验证（clip 方案）：
 * 1. 导入含 blockquote/figure/h2/ul 的复杂 EPUB
 * 2. 竖排 + 界行 + 版框 + 独立边距（40/44）
 * 3. 连续点击翻 5 页，逐页度量：可视区文字是否全部落在版框内、节距残差
 * 4. 截图供人工核对（引号转向 ﹁﹂、栏线对齐、框线包住文字）
 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
const warn = [];
page.on('console', (m) => {
  if (m.type() === 'warning' && m.text().includes('paginator')) warn.push(m.text());
});

await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);

await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/samples/千字文浅说-复杂结构.epub');
await page.waitForTimeout(3500);

// 预写设置：竖排 + 界行 + 版框 + 独立边距
await page.evaluate(() => {
  return new Promise((resolve) => {
    const req = indexedDB.open('reading-tree');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      const g = tx.objectStore('kv').get('settings');
      g.onsuccess = () => {
        const rec = g.result || { k: 'settings', v: {} };
        rec.v = {
          ...rec.v,
          flow: 'vertical',
          decorLines: true,
          decorFrame: true,
          pageMarginX: 40,
          pageMarginY: 44,
          fontSize: 19,
          lineHeight: 1.9,
          conv: 'off',
        };
        tx.objectStore('kv').put(rec);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    };
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.locator('.cell').first().click();
await page.waitForTimeout(3000);

/** 度量当前页：只统计可视区（裁剪层内）的文字与版框关系 */
const measure = (label) =>
  page.evaluate((lbl) => {
    const outer = document.querySelector('.page-outer');
    const clip = document.querySelector('.page-clip');
    const pitch = parseFloat(outer.style.getPropertyValue('--pitch')) || 0;
    const totalW = document.querySelector('.page-inner').scrollWidth;
    const rem = pitch ? totalW % pitch : -1;
    const cb = clip.getBoundingClientRect();
    let outCount = 0;
    let seen = 0;
    const range = document.createRange();
    const walker = document.createTreeWalker(clip, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!(node.textContent || '').trim()) continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width < 1 || r.height < 1) continue;
        // 只统计与可视区相交的片段
        const l = Math.max(r.left, cb.left);
        const rr = Math.min(r.right, cb.right);
        if (rr <= cb.left || l >= cb.right) continue;
        seen++;
        if (l < cb.left - 1.5 || rr > cb.right + 1.5 || r.top < cb.top - 1.5 || r.bottom > cb.bottom + 1.5) {
          outCount++;
        }
      }
    }
    return {
      label: lbl,
      pitch,
      totalW,
      rem,
      clip: { l: +cb.left.toFixed(1), r: +cb.right.toFixed(1), t: +cb.top.toFixed(1), b: +cb.bottom.toFixed(1) },
      visibleSpans: seen,
      charsOutsideFrame: outCount,
    };
  }, label);

// 竖排：左侧 1/3 = 下一页
const next = async () => {
  await page.mouse.click(65, 420);
  await page.waitForTimeout(450);
};

console.log(JSON.stringify(await measure('第1页')));
for (let i = 2; i <= 5; i++) {
  await next();
  const m = await measure(`第${i}页`);
  console.log(JSON.stringify(m));
  await page.screenshot({ path: `E:/Anti/yuedushu/.tmp/clip-p${i}.png` });
}
console.log('WARNINGS:', JSON.stringify(warn.slice(0, 4)));
await browser.close();
console.log('DONE');
