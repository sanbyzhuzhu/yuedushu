/** V0.3.0 第一批功能自动化实测：排序筛选/信息编辑/滚动模式/页眉页脚/备份导出 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 120)));
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 导入两本书（示例 + 红楼梦）
await page.evaluate(() => fetch(new Request('/')))
  .catch(() => {});
await page.locator('.empty button', { hasText: '载入示例古籍' }).click();
await page.waitForTimeout(800);
await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
await page.waitForTimeout(4500);
const cells0 = await page.locator('.cell').count();
console.log('① 导入后书卡数:', cells0);

// ② 排序：按书名排序后第一张卡应为「示例」开头？zh 排序：古文三篇 vs 紅樓夢 → 古(4E00 段)在前
const firstTitle = () => page.locator('.cell-title').first().textContent();
const t1 = await firstTitle();
await page.selectOption('.sort-select', 'title');
await page.waitForTimeout(300);
const t2 = await firstTitle();
console.log('② 书名排序:', t1, '→', t2, t1 !== t2 ? '✓' : '(顺序未变，检查)');

// ③ 筛选：未读应为 2 本
await page.locator('.f-chip', { hasText: '未读' }).click();
await page.waitForTimeout(250);
const unreadCnt = await page.locator('.cell').count();
await page.locator('.f-chip', { hasText: '全部' }).click();
console.log('③ 未读筛选数量:', unreadCnt, unreadCnt === 2 ? '✓' : '✗');

// ④ 编辑信息：改红楼梦书名
await page.locator('.cell-more').nth(1).click(); // 第二张卡的 ⋯（红楼梦）
await page.waitForTimeout(250);
await page.locator('.book-menu button', { hasText: '编辑信息' }).click();
await page.waitForTimeout(400);
const editVisible = await page.locator('.edit-card').isVisible();
await page.locator('.edit-card input.field').first().fill('紅樓夢（測試改名）');
await page.locator('.edit-card .edit-save').click();
await page.waitForTimeout(400);
const t3 = await page.locator('.cell-title').nth(1).textContent();
console.log('④ 编辑卡可见:', editVisible, '· 改名结果:', t3, t3?.includes('測試改名') ? '✓' : '✗');

// ⑤ 滚动模式：写设置 → 刷新 → 开书
await page.evaluate(() => {
  return new Promise((resolve) => {
    const req = indexedDB.open('reading-tree');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      const get = tx.objectStore('kv').get('settings');
      get.onsuccess = () => {
        const rec = get.result || { k: 'settings', v: {} };
        rec.v = { ...rec.v, readMode: 'scroll', flow: 'horizontal' };
        tx.objectStore('kv').put(rec);
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    };
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
// 打开红楼梦（改过名的第二张卡）
await page.locator('.cell').nth(1).click();
await page.waitForTimeout(2500);
const hasScroll = await page.locator('.scroll-outer').isVisible();
const chCnt = await page.locator('.scroll-ch').count();
const headVisible = await page.locator('.page-info.head').isVisible();
const footText = await page.locator('.page-info.foot').textContent();
// 滚动到底再回看比例
await page.evaluate(() => {
  const el = document.querySelector('.scroll-outer');
  el.scrollTop = el.scrollHeight - el.clientHeight;
  el.dispatchEvent(new Event('scroll'));
});
await page.waitForTimeout(700);
const pctAfter = await page.evaluate(() => {
  const el = document.querySelector('.scroll-outer');
  return Math.round((el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100);
});
const footAfter = await page.locator('.page-info.foot').textContent();
console.log('⑤ 滚动模式: 容器', hasScroll ? '✓' : '✗', '章节数', chCnt, '页眉', headVisible ? '✓' : '✗', '页脚', JSON.stringify(footText), '→ 滚底后', JSON.stringify(footAfter), pctAfter > 90 ? '✓' : '✗');

// ⑥ 滚动模式下选区弹层（划线链路在滚动 DOM 上也应工作）
await page.evaluate(() => {
  const el = document.querySelector('.scroll-outer');
  el.scrollTop = 0;
  el.dispatchEvent(new Event('scroll'));
});
await page.waitForTimeout(600);
await page.evaluate(() => {
  const body = document.querySelector('.scroll-ch .scroll-ch-body');
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if ((node.textContent || '').trim().length > 8) {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(8, node.textContent.length));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      break;
    }
  }
});
await page.waitForTimeout(700);
const selPop = await page.locator('.sel-pop').count();
console.log('⑥ 滚动模式划线弹层:', selPop > 0 ? '✓' : '✗');

await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v030-scroll.png' });

// ⑦ 备份导出：拦截下载
const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
// 打开书架（返回键路径）→ 备份面板
await page.keyboard.press('Escape');
await page.evaluate(() => history.back()); // 阅读页 → 书架
await page.waitForTimeout(1200);
const onShelf = await page.locator('.shelf-toolbar').isVisible();
if (!onShelf) {
  await page.locator('.reader-head button', { hasText: '书架' }).click().catch(() => {});
  await page.waitForTimeout(800);
}
await page.locator('.m-tool', { hasText: '备份' }).click();
await page.waitForTimeout(500);
const backupVisible = await page.locator('.drawer.right', { hasText: '本地备份' }).isVisible();
await page.locator('button', { hasText: '导出备份' }).click();
const dl = await dlPromise;
let dlOk = false;
let zipHead = '';
if (dl) {
  const path = await dl.path();
  const buf = await import('node:fs').then((fs) => fs.promises.readFile(path));
  dlOk = buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b; // PK
  zipHead = `${buf.length}B`;
}
console.log('⑦ 备份面板', backupVisible ? '✓' : '✗', '· 下载 zip', dlOk ? `✓(${zipHead})` : '✗');

await browser.close();
console.log('DONE');
