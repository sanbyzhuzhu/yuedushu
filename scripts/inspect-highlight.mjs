/** 划线链路实测：拖选 → 弹层 → 点色 → mark 落 DOM */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const cells = await page.locator('.cell').count();
if (cells === 0) {
  await page.setInputFiles('input[type=file]', 'E:/Anti/yuedushu/.tmp/realbooks/pg24264-images.epub');
  await page.waitForTimeout(4000);
}
await page.locator('.cell').first().click();
await page.waitForTimeout(3000);

// 页面上有文字吗
const probe = await page.evaluate(() => {
  const inner = document.querySelector('.page-inner');
  const r = inner?.getBoundingClientRect();
  // 找一个有文字的点的坐标
  const range = document.createRange();
  const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if ((node.textContent || '').trim().length > 5) {
      range.setStart(node, 0);
      range.setEnd(node, Math.min(8, node.textContent.length));
      const rect = range.getBoundingClientRect();
      if (rect.width > 0) return { x: rect.left + 2, y: rect.top + rect.height / 2, text: node.textContent.slice(0, 10), innerRect: { w: r?.width, h: r?.height } };
    }
  }
  return null;
});
console.log('文字锚点：', JSON.stringify(probe));
if (!probe) {
  console.log('✗ 页面无文字（章节未加载？）');
  await browser.close();
  process.exit(1);
}

// 模拟拖选：从锚点向右拖 120px
await page.mouse.move(probe.x, probe.y);
await page.mouse.down();
await page.mouse.move(probe.x + 120, probe.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);

const after = await page.evaluate(() => ({
  sel: window.getSelection()?.toString() ?? '',
  selPop: document.querySelectorAll('.sel-pop').length,
  marks: document.querySelectorAll('mark.hl').length,
}));
console.log('拖选后：', JSON.stringify(after));

// 若弹层出现，点第一个色点
if (after.selPop > 0) {
  await page.locator('.sel-pop .dot').first().click();
  await page.waitForTimeout(400);
  const done = await page.evaluate(() => ({
    marks: document.querySelectorAll('mark.hl').length,
    markText: document.querySelector('mark.hl')?.textContent?.slice(0, 12) ?? '',
  }));
  console.log('点色后：', JSON.stringify(done));
  console.log(done.marks > 0 ? '✓ 划线链路正常' : '✗ mark 未落 DOM');
} else {
  console.log('✗ 弹层未出现（getSelQuote 或事件流断了）');
  // 诊断：手动构造选区看 getSelQuote 逻辑需要的条件
  const diag = await page.evaluate(() => {
    const inner = document.querySelector('.page-inner');
    const sel = window.getSelection();
    return {
      selCollapsed: sel?.isCollapsed,
      selLen: sel?.toString().length,
      selAnchorInInner: sel?.anchorNode ? inner.contains(sel.anchorNode) : null,
      menuOpen: !!document.querySelector('.stage-close'),
    };
  });
  console.log('诊断：', JSON.stringify(diag));
}
await browser.close();
console.log('DONE');
