/** V0.3.1 第二批功能实测：热力图/日目标、TTS 面板、分享卡片、插图放大、TXT/CSV 导出 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { promises as fsp } from 'node:fs';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 140)));
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// 导入示例 + 红楼梦（含插图）
await page.locator('.empty button', { hasText: '载入示例古籍' }).click();
await page.waitForTimeout(800);
await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
await page.waitForTimeout(4500);
console.log('① 书卡数:', await page.locator('.cell').count());

// ② 统计面板：热力图 + 每日目标
await page.locator('.m-tool', { hasText: '统计' }).click();
await page.waitForTimeout(1200);
const hmCells = await page.locator('.hm-cell').count();
const goalBar = await page.locator('.goal-bar').isVisible();
const streakText = await page.locator('.set-group', { hasText: '每日目标' }).textContent();
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v031-stats.png' });
console.log('② 热力图格子:', hmCells, '(182格+5图例) | 目标条:', goalBar ? '✓' : '✗', '| 含连续达标:', streakText?.includes('连续达标') ? '✓' : '✗');
await page.locator('.drawer-head button', { hasText: '完成' }).click();
await page.waitForTimeout(400);

// ③ 打开红楼梦 → 呼出菜单 → 朗读面板
await page.locator('.cell').first().click();
await page.waitForTimeout(2800);
await page.mouse.click(195, 300); // 中央呼出菜单
await page.waitForTimeout(600);
const menuOpen = await page.locator('.reader-foot').isVisible();
await page.locator('.reader-foot button', { hasText: '朗读' }).click();
await page.waitForTimeout(600);
const ttsOpen = await page.locator('.drawer.right', { hasText: '朗读' }).isVisible();
const ttsHint = await page.locator('.tts-status').textContent();
await page.locator('.tts-controls button', { hasText: '开始朗读' }).click();
await page.waitForTimeout(900);
const playing = await page.evaluate(() => window.__rtTtsState?.() ?? 'no-probe');
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v031-tts.png' });
console.log('③ TTS面板:', ttsOpen ? '✓' : '✗', '| 状态:', JSON.stringify(ttsHint), '| 点播放后:', JSON.stringify(playing));

// 停止并关闭
await page.locator('.tts-controls button', { hasText: '停止' }).click().catch(() => {});
await page.locator('.drawer-head button', { hasText: '完成' }).click();
await page.waitForTimeout(300);
await page.mouse.click(195, 300); // 中央再点一次收起菜单（弹层需要 menu=false）
await page.waitForTimeout(400);

// ④ 划线 → 批注卡 → 分享图下载
await page.evaluate(() => {
  const body = document.querySelector('.page-inner');
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
await page.locator('.sel-pop button', { hasText: '批注' }).click();
await page.waitForTimeout(500);
const cardOpen = await page.locator('.note-card').isVisible();
const dlPromise = page.waitForEvent('download', { timeout: 12000 }).catch(() => null);
await page.locator('.note-card button', { hasText: '分享图' }).click();
const dl = await dlPromise;
let cardOk = false;
if (dl) {
  const buf = await fsp.readFile(await dl.path());
  cardOk = buf.length > 20000 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47; // PNG
}
console.log('④ 批注卡:', cardOpen ? '✓' : '✗', '| 分享图 PNG:', cardOk ? '✓' : '✗');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);

// ⑤ 笔记导出 TXT / CSV
await page.mouse.click(195, 300); // 呼出菜单
await page.waitForTimeout(500);
await page.locator('.reader-foot button', { hasText: '笔记' }).click();
await page.waitForTimeout(500);
const dlTxt = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
await page.locator('.ann-exports button', { hasText: 'TXT' }).click();
const dt = await dlTxt;
const dlCsv = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
await page.locator('.ann-exports button', { hasText: 'CSV' }).click();
const dc = await dlCsv;
console.log('⑤ 导出 TXT:', dt ? '✓' : '✗', '| CSV:', dc ? '✓' : '✗');
await page.locator('.drawer-head button', { hasText: '收起' }).click();
await page.waitForTimeout(300);

// ⑥ 插图放大：优先用书内插图；无则注入一张（走同一 stage 事件委托路径）
let imgCnt = await page.locator('.page-inner img, .scroll-ch img').count();
if (imgCnt === 0) {
  await page.evaluate(() => {
    const inner = document.querySelector('.page-inner');
    const img = document.createElement('img');
    img.src =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAKklEQVR4nO3PMQEAIAzAsIF/z0PGBhYCFWlv780Hjhw5cuTIkSNHjhw5cuTIEZoKcQGguS1C2gAAAABJRU5ErkJggg==';
    img.style.width = '80px';
    inner.appendChild(img);
  });
  imgCnt = 1;
}
await page.locator('.page-inner img, .scroll-ch img').first().click();
await page.waitForTimeout(400);
const lb = await page.locator('.img-lightbox').isVisible();
await page.screenshot({ path: 'E:/Anti/yuedushu/.tmp/v031-lightbox.png' });
await page.locator('.img-lightbox').click();
const closed = (await page.locator('.img-lightbox').count()) === 0;
console.log('⑥ 插图放大:', lb ? '✓' : '✗', '| 点击关闭:', closed ? '✓' : '✗', `(插图${imgCnt}张)`);

await browser.close();
console.log('DONE');
