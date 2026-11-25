/** V0.3.5 实测：跨页划线（难划上 / 容易跳页）
 *
 *  症状：分页模式下想划一段跨页的文字，手指拖到页边缘就停住划不下去，
 *        而且常常一松手页面就跳走了。
 *
 *  根因（两条）：
 *    1) 分页容器 .page-outer 是 overflow:hidden（横排 multicol 多栏、竖排 transform 平移），
 *       浏览器原生的"拖选到边缘自动滚动"完全失效 —— 整章内容虽都在 DOM 里，
 *       但视口外的部分手指够不着，跨页内容根本划不上。
 *    2) 翻页手势与长按选择抢事件：长按选词时选区要到 touchend 之后才 finalize，
 *       那一刻 getSelQuote() 仍是 null → dx>=40 判为滑动 → 跳页。
 *
 *  本脚本用真实触摸事件序列验证：
 *    T1 正常滑动仍能翻页（防回归）
 *    T2 长按后横向拖动不再跳页（长按守卫）
 *    T3 选区激活时拖到边缘会【连续微滚】而非整页跳，且不翻页
 *    T4 微滚后选区未被打断，可扩展到跨页内容并成功锚定划线
 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';

const { chromium } = pw;
const BASE = 'http://127.0.0.1:4173';
const OUT = 'E:/Anti/yuedushu/.tmp/';

// ---------- 0. 生成多页测试 EPUB ----------
const SENT = [
  '话说当时住持真人对洪太尉说道，太尉不知此殿中当初是祖老天师洞玄真人传下法符。',
  '洪太尉听罢心中大怒，指着众人说道，你们这等可恶，明明见有天子御书丹诏在此。',
  '众人只得把大锁砸开，推开大门，只见里面黑气冲天，一道金光从地而起直冲云霄。',
  '那一片黑气散作百十道金光，望四面八方去了，众人惊得目瞪口呆，半晌言语不得。',
  '自此之后水浒寨中聚集英雄好汉，替天行道，杀富济贫，声名播于四海威震京师。',
];
const makeBody = (n) => {
  let s = '';
  let i = 0;
  while (s.length < n) s += SENT[i++ % SENT.length];
  return s.slice(0, n);
};
const ch1 = `<h2>第一回 张天师祈禳瘟疫 洪太尉误走妖魔</h2>${makeBody(6000)
  .match(/[^。]+。?/g)
  .map((s) => `<p>${s}</p>`)
  .join('')}`;
const xhtml = (t, b) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${t}</title></head><body>${b}</body></html>`;
const EPUB = {
  mimetype: strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  ),
  'OEBPS/content.opf': strToU8(
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>水浒传</dc:title><dc:creator>施耐庵</dc:creator><dc:identifier id="id">shuihu-hl</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
  ),
  'OEBPS/nav.xhtml': strToU8(
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一回</a></li></ol></nav></body></html>`,
  ),
  'OEBPS/ch1.xhtml': strToU8(xhtml('第一回', ch1)),
};
writeFileSync(OUT + 'hl-test.epub', Buffer.from(zipSync(EPUB)));

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});
// mock Android 原生长按菜单桥（V0.3.6）：统计前端压菜单的调用次数
await ctx.addInitScript(() => {
  window.__rtMenuCalls = 0;
  window.ReadingTreeNativeMenu = {
    hideMenu() {
      window.__rtMenuCalls = (window.__rtMenuCalls || 0) + 1;
    },
  };
});

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.setInputFiles('input[type=file]', OUT + 'hl-test.epub');
await page.waitForTimeout(5000);
await page.locator('.cell').first().click();
await page.waitForTimeout(2500);

// ---------- 工具 ----------
const fire = (type, x, y) =>
  page.evaluate(
    ({ type, x, y }) => {
      const el = document.elementFromPoint(x, y) || document.body;
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      const end = type === 'touchend';
      el.dispatchEvent(
        new TouchEvent(type, {
          touches: end ? [] : [t],
          targetTouches: end ? [] : [t],
          changedTouches: [t],
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    { type, x, y },
  );

const snap = () =>
  page.evaluate(() => {
    const outer = document.querySelector('.page-outer');
    const inner = document.querySelector('.page-inner');
    const foot = document.querySelector('.page-info.foot');
    // 竖排用 transform 平移分页，读 translateX 观察微滚
    let tx = 0;
    if (inner) {
      const m = /translateX\((-?[\d.]+)px\)/.exec(inner.style.transform || '');
      if (m) tx = Math.round(parseFloat(m[1]));
    }
    return {
      scrollLeft: outer ? Math.round(outer.scrollLeft) : -1,
      scrollW: outer ? outer.scrollWidth : 0,
      clientW: outer ? outer.clientWidth : 0,
      tx,
      pageLabel: foot ? foot.innerText.replace(/\s+/g, ' ') : '',
      selLen: (window.getSelection()?.toString() ?? '').replace(/\s+/g, '').length,
    };
  });

const pageNo = async () => {
  const s = await snap();
  const m = s.pageLabel.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? Number(m[1]) : -1;
};

/** 建立一段选区。backward=true 表示焦点在【起始端】（用户正向文档前方扩展），
 *  默认焦点在【末端】（用户正向文档后方扩展）——这决定自动滚动的方向。 */
const makeSel = (chars, backward = false) =>
  page.evaluate(
    ({ chars, backward }) => {
      const inner = document.querySelector('.page-inner');
      if (!inner) return false;
      const w = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let n;
      while ((n = w.nextNode())) if ((n.nodeValue || '').trim()) nodes.push(n);
      if (nodes.length < 2) return false;
      const a = nodes[0];
      const b = nodes[1];
      const sel = window.getSelection();
      sel.removeAllRanges();
      if (backward) sel.setBaseAndExtent(b, Math.min(chars, b.length), a, 0);
      else sel.setBaseAndExtent(a, 0, b, Math.min(chars, b.length));
      return true;
    },
    { chars, backward },
  );

/** 把选区终点向后扩展到第 k 个文本节点（模拟手指继续拖动跨过页面边界） */
const extendSel = (k) =>
  page.evaluate((k) => {
    const inner = document.querySelector('.page-inner');
    const sel = window.getSelection();
    if (!inner || !sel || sel.rangeCount === 0) return 0;
    const w = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = w.nextNode())) if ((n.nodeValue || '').trim()) nodes.push(n);
    const r = sel.getRangeAt(0);
    const target = nodes[Math.min(k, nodes.length - 1)];
    r.setEnd(target, target.length);
    sel.removeAllRanges();
    sel.addRange(r);
    return (sel.toString() ?? '').replace(/\s+/g, '').length;
  }, k);

const clearSel = () => page.evaluate(() => window.getSelection()?.removeAllRanges());

/** 复位 UI：清选区 + 收掉划线弹层。
 *  加了「续选」行后弹层变宽，会盖住原本用于翻页的点击坐标，
 *  而 onStageClick 里 selPop 存在时会直接 return，翻页就全被吞了。 */
const resetUi = async () => {
  await clearSel();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(320);
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}\n    ${detail}`);
};

const W = 390;
const H = 844;
const EDGE_X = W - 20; // 右边缘（横排：内容向后方延伸）

console.log('\n========== 跨页划线实测 ==========');
const s0 = await snap();
console.log(`初始：${s0.pageLabel}  scrollLeft=${s0.scrollLeft}  可滚宽=${s0.scrollW - s0.clientW}`);

// ---------- T1 正常滑动仍能翻页（防回归） ----------
{
  await resetUi();
  const before = await pageNo();
  await fire('touchstart', 300, 400);
  await fire('touchmove', 200, 402);
  await fire('touchend', 100, 402); // dx=-200，明显滑动
  await page.waitForTimeout(600);
  const after = await pageNo();
  check(
    'T1 正常滑动翻页（防回归）',
    after !== before,
    `页码 ${before} → ${after}${after !== before ? '' : '（滑动失效 ✗）'}`,
  );
}

// 回到首页，保证后续用例起点一致
await page.evaluate(() => window.scrollTo(0, 0));
await resetUi();
await page.mouse.click(20, 400); // 左侧 = 上一页
await page.waitForTimeout(400);
await resetUi();
{
  let guard = 0;
  while ((await pageNo()) > 1 && guard++ < 30) {
    await page.mouse.click(20, 400);
    await page.waitForTimeout(250);
  }
}
await page.waitForTimeout(400);

// ---------- T2 长按守卫：长按后横向拖动不再被判为滑动 ----------
{
  await resetUi();
  const before = await pageNo();
  const sl0 = (await snap()).scrollLeft;
  await fire('touchstart', 300, 400);
  await page.waitForTimeout(520); // 超过 450ms 长按阈值且无位移
  await fire('touchmove', 200, 402);
  await fire('touchend', 100, 402); // 旧逻辑：dx=-200 → 翻页跳走
  await page.waitForTimeout(700);
  const after = await pageNo();
  const sl1 = (await snap()).scrollLeft;
  check(
    'T2 长按后拖动不跳页（长按守卫）',
    after === before && sl0 === sl1,
    `页码 ${before} → ${after}，scrollLeft ${sl0} → ${sl1}（旧实现此处会跳页）`,
  );
}

// ---------- T3 方向判定（用户反馈的确切场景）----------
// 手指停在【左】边缘，但想选的是后面的文字 → 必须向后滚，不能往回到章节前面
{
  let guard = 0;
  while ((await pageNo()) > 1 && guard++ < 30) {
    await page.mouse.click(20, 400);
    await page.waitForTimeout(220);
  }
  await resetUi();
  await page.waitForTimeout(400);
  const sl0 = (await snap()).scrollLeft;
  await fire('touchstart', 200, 400);
  await makeSel(20, false); // 焦点在末端 = 向文档后方扩展
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(55);
    await fire('touchmove', 10, 400); // 手指贴在【左】边缘
  }
  const sl1 = (await snap()).scrollLeft;
  await fire('touchend', 10, 400);
  check(
    'T3 左边缘起手但选区向后扩展 → 向后滚（不再往章节前面跳）',
    sl1 > sl0,
    `scrollLeft ${sl0} → ${sl1}（增量 ${sl1 - sl0}px，旧实现此处是负值 = 跳到章节前面）`,
  );
}

// ---------- T3b 反向：选区向前扩展时才向前滚 ----------
{
  // 必须先清掉上一条用例留下的选区：选区非空时 onStageClick 会直接 return，
  // 翻页点击会被整条吞掉。
  await resetUi();
  await page.waitForTimeout(400);
  // 再往后翻几页，留出向前滚动的空间
  for (let i = 0; i < 5; i++) {
    await page.mouse.click(370, 400);
    await page.waitForTimeout(220);
  }
  await page.waitForTimeout(400);
  const sl0 = (await snap()).scrollLeft;
  await fire('touchstart', 200, 400);
  await makeSel(20, true); // 焦点在起始端 = 向文档前方扩展
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(55);
    await fire('touchmove', 380, 400); // 手指贴在【右】边缘
  }
  const sl1 = (await snap()).scrollLeft;
  await fire('touchend', 380, 400);
  check(
    'T3b 选区向前扩展时才向前滚（方向可反向）',
    sl1 < sl0,
    `scrollLeft ${sl0} → ${sl1}（增量 ${sl1 - sl0}px）`,
  );
}

// ---------- T3c 松手不回弹（settlePan 只同步页码、不再吸附/丢弃位移）----------
{
  let guard = 0;
  while ((await pageNo()) > 1 && guard++ < 40) {
    await page.mouse.click(20, 400);
    await page.waitForTimeout(200);
  }
  await resetUi();
  await page.waitForTimeout(400);
  await fire('touchstart', 200, 400);
  await makeSel(20, false);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(55);
    await fire('touchmove', 195, 830); // 贴近底边（横排往下划的直觉），不在左右边缘
  }
  const before = (await snap()).scrollLeft;
  await fire('touchend', 195, 830);
  await page.waitForTimeout(700);
  const after = (await snap()).scrollLeft;
  check(
    'T3c 松手后视口不回弹、不吸附（保留微滚位置）',
    before > 0 && Math.abs(after - before) <= 2,
    `松手前 ${before} → 松手后 ${after}（旧实现会回弹到整页位置，或算错方向一次性甩过一整页）`,
  );
  await resetUi();
}

// ---------- T4 选区激活 → 贴近右边缘连续微滚，且不整页跳 ----------
{
  await resetUi();
  const before = await pageNo();
  const sl0 = (await snap()).scrollLeft;
  await fire('touchstart', 200, 400);
  const okSel = await makeSel(30);
  await fire('touchmove', EDGE_X, 400); // 手指贴近右边缘
  const deltas = [];
  let prev = (await snap()).scrollLeft;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(55);
    await fire('touchmove', EDGE_X, 400);
    const cur = (await snap()).scrollLeft;
    deltas.push(cur - prev);
    prev = cur;
  }
  const sl1 = (await snap()).scrollLeft;
  const moved = sl1 - sl0;
  const maxStep = Math.max(...deltas);
  const nonzero = deltas.filter((d) => d !== 0);
  const avg = nonzero.length ? Math.round(nonzero.reduce((a, b) => a + b, 0) / nonzero.length) : 0;
  check(
    'T3-a 选区激活时拖到边缘会自动滚动',
    okSel && moved > 200,
    `选区建立=${okSel}，scrollLeft ${sl0} → ${sl1}（累计移动 ${moved}px）`,
  );
  check(
    'T3-b 是【连续微滚】而非整页跳（保住选区的关键）',
    moved > 200 && maxStep <= 30,
    `单次最大位移 ${maxStep}px，平均 ${avg}px/次（贴边时 2 档加速，整页跳会是 ~398px 一次）`,
  );

  // ---------- T4 微滚后选区未被打断，可扩展到跨页内容 ----------
  const selBefore = (await snap()).selLen;
  const crossLen = await extendSel(40); // 手指继续拖到后面几页的内容
  const after = await pageNo();
  check(
    'T4 微滚后选区仍有效且可延伸到跨页内容',
    selBefore > 0 && crossLen > selBefore * 3,
    `选区字数 ${selBefore} → 延伸后 ${crossLen}（跨越了约 ${after - before + 1} 页的内容）`,
  );

  await fire('touchend', EDGE_X, 400);
  await page.waitForTimeout(500);
  const pop = await page.locator('.sel-pop').count();
  check('T4-b 松手后划线弹层正常出现（未被翻页打断）', pop > 0, `.sel-pop 数量=${pop}`);

  // V0.3.6：弹层露出时必须主动收掉系统长按菜单，否则会被压住
  const menuCalls = await page.evaluate(() => window.__rtMenuCalls || 0);
  check(
    'T4-b2 划线时主动收掉系统长按菜单（防遮挡）',
    menuCalls > 0,
    `hideMenu() 调用 ${menuCalls} 次（为 0 说明原生菜单会盖住划线弹层）`,
  );

  if (pop > 0) {
    await page.locator('.sel-pop .dot').first().click();
    await page.waitForTimeout(800);
    const marks = await page.locator('mark.hl').count();
    const total = await page.evaluate(() =>
      Array.from(document.querySelectorAll('mark.hl')).reduce(
        (a, m) => a + (m.textContent ?? '').replace(/\s+/g, '').length,
        0,
      ),
    );
    check(
      'T4-c 跨页长划线完整落库（不被 400 字上限截断）',
      marks > 0 && total > crossLen * 0.8,
      `选区 ${crossLen} 字 → mark ${marks} 个 / 共 ${total} 字`,
    );
  }
}

// ---------- T5 竖排模式：transform 平移分支的边缘微滚（方向相反） ----------
{
  await resetUi();
  // 上一步划了 1497 字的线，mark 铺满数页——点中部会命中 mark.hl 打开批注卡片而非菜单。
  // 这里只把 <mark> 从 DOM 剥离（不动已落库的数据），让后续 UI 操作能正常命中。
  await page.evaluate(() => {
    document.querySelectorAll('mark.hl').forEach((m) => {
      const p = m.parentNode;
      if (!p) return;
      while (m.firstChild) p.insertBefore(m.firstChild, m);
      p.removeChild(m);
      p.normalize?.();
    });
  });
  // 呼出菜单 → 排版 → 竖排（先收掉所有浮层，再点中部呼出菜单）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) {
    if (await page.locator('.reader-foot').count()) break;
    await page.mouse.click(195, 300);
    await page.waitForTimeout(700);
  }
  const menuOpen = await page.locator('.reader-foot').count();
  check('T5-0 阅读菜单可呼出', menuOpen > 0, `.reader-foot 数量=${menuOpen}`);
  if (menuOpen === 0) throw new Error('菜单打不开，竖排用例无法继续');
  await page.locator('.reader-foot button', { hasText: '排版' }).click();
  await page.waitForTimeout(500);
  await page.locator('.set-group', { hasText: '排版方向' }).locator('button', { hasText: '竖排' }).click();
  await page.waitForTimeout(1500);
  await page.locator('.drawer-head button', { hasText: '完成' }).click().catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const tx0 = (await snap()).tx;
  await fire('touchstart', 200, 400);
  const okSel = await makeSel(30);
  // 先发一次 touchmove 刷新 lastTouchMoveAt，让轮询让路，避免首轮叠加
  await fire('touchmove', 20, 400);
  const deltas = [];
  let prev = (await snap()).tx;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(55);
    await fire('touchmove', 20, 400); // 竖排 RTL：内容向后方在【左】边
    const cur = (await snap()).tx;
    deltas.push(cur - prev);
    prev = cur;
  }
  const tx1 = (await snap()).tx;
  const moved = tx1 - tx0;
  const maxStep = Math.max(...deltas.map(Math.abs));
  check(
    'T5 竖排模式下也能连续微滚（transform 分支）',
    okSel && Math.abs(moved) > 150 && maxStep <= 30,
    `translateX ${tx0} → ${tx1}（移动 ${moved}px），单次最大 ${maxStep}px`,
  );
  await fire('touchend', 20, 400);
  await page.waitForTimeout(400);
  const pop = await page.locator('.sel-pop').count();
  check('T5-b 竖排松手后弹层正常出现（未跳页）', pop > 0, `.sel-pop 数量=${pop}`);
  if (pop > 0) await page.locator('.sel-pop button', { hasText: '取消' }).click();
  await resetUi();
}

// ---------- T6 极端情况：完全收不到 touchmove（模拟 WebView 吞掉 select-handle 事件）----------
// 只发 touchstart + touchend，中途零 touchmove，靠轮询守护推进滚动。
// 这条路径一天不验证，真机就一天不确定——此前所有自动滚动都建立在"touchmove 会到 JS"的假设上。
{
  let guard = 0;
  while ((await pageNo()) > 1 && guard++ < 40) {
    await page.mouse.click(20, 400);
    await page.waitForTimeout(200);
  }
  await resetUi();
  await page.waitForTimeout(400);
  // T5 结束时排版是竖排：竖排走 transform 平移（改 translateX 而非 scrollLeft），
  // 所以位移要把两者都算上
  const sStart = await snap();
  const sl0 = sStart.scrollLeft;
  const tx0 = sStart.tx;
  await fire('touchstart', 200, 400); // 手指按下
  // 模拟 WebView 把选区一路扩展到版面底部（原生手柄拖动的结果），全程不通知 JS 的 touchmove
  const reach = await page.evaluate(() => {
    const inner = document.querySelector('.page-inner');
    const stage = document.querySelector('.reader-stage')?.getBoundingClientRect();
    if (!inner || !stage) return null;
    const w = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let n;
    while ((n = w.nextNode())) if ((n.nodeValue || '').trim()) nodes.push(n);
    // 找到第一个已经排到视口右侧之外（下一栏）的文本节点，把选区一路选到它。
    // 这样选区的扩展端正落在视口外，focusPoint 会把它夹到右边缘 → 触发自动滚动。
    let cross = null;
    for (const t of nodes) {
      const rr = document.createRange();
      rr.setStart(t, 0);
      rr.setEnd(t, t.length);
      const b = rr.getBoundingClientRect();
      if (b.width > 0 && b.left > stage.right + 10) {
        cross = t;
        break;
      }
    }
    if (!cross) return null;
    const r = document.createRange();
    r.setStart(nodes[0], 0);
    r.setEnd(cross, Math.min(12, cross.length));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    const boxes = Array.from(r.getClientRects()).filter((b) => b.height > 0);
    return {
      lastBottom: Math.round(boxes.length ? boxes[boxes.length - 1].bottom : best.bottom),
      stageBottom: Math.round(stage.bottom),
    };
  });
  const diag = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return { err: 'no selection' };
    const r = sel.getRangeAt(0);
    const stage = document.querySelector('.reader-stage')?.getBoundingClientRect();
    const boxes = Array.from(r.getClientRects()).filter((b) => b.width > 0 || b.height > 0);
    const last = boxes[boxes.length - 1];
    return {
      stage: stage ? { l: Math.round(stage.left), r: Math.round(stage.right), t: Math.round(stage.top), b: Math.round(stage.bottom) } : null,
      nBoxes: boxes.length,
      lastBox: last ? { l: Math.round(last.left), w: Math.round(last.width), t: Math.round(last.top) } : null,
      focusIsEnd: sel.focusNode === r.endContainer && sel.focusOffset === r.endOffset,
      focusIsStart: sel.focusNode === r.startContainer && sel.focusOffset === r.startOffset,
      selLen: (sel.toString() ?? '').replace(/\s+/g, '').length,
    };
  });
  console.log('    [T6 诊断]', JSON.stringify(diag));
  // 复算 autoPanForSelect 的「是否贴近边缘」，确认几何判据是否成立
  const nearCalc = await page.evaluate(() => {
    const sel = window.getSelection();
    const r = sel.getRangeAt(0);
    const st = document.querySelector('.reader-stage')?.getBoundingClientRect();
    const boxes = Array.from(r.getClientRects()).filter((b) => b.width > 0 || b.height > 0);
    const box = boxes[boxes.length - 1];
    const x = Math.min(Math.max(box.left + box.width / 2, st.left + 1), st.left + st.width - 1);
    const y = Math.min(Math.max(box.top + box.height / 2, st.top + 1), st.top + st.height - 1);
    const dx = x - st.left;
    const dy = y - st.top;
    const ex = Math.min(56, st.width * 0.12);
    return { x: Math.round(x), y: Math.round(y), near: dx < ex || dx > st.width - ex || dy < 28 || dy > st.height - 28 };
  });
  console.log('    [T6 near]', JSON.stringify(nearCalc));
  await page.evaluate(() => {
    window.__scrollEvents = 0;
    const o = document.querySelector('.page-outer');
    if (o) o.addEventListener('scroll', () => (window.__scrollEvents = (window.__scrollEvents || 0) + 1));
  });
  const menuBefore = await page.evaluate(() => window.__rtMenuCalls || 0);
  // 关键：这里一个 touchmove 都不派发，只让轮询守护自己跑
  await page.waitForTimeout(2400);
  const menuAfter = await page.evaluate(() => window.__rtMenuCalls || 0);
  const panDbg = await page.evaluate(() => window.__rtPanDebug || {});
  console.log('    [T6 autoPan 判定]', JSON.stringify(panDbg));
  const scrollEvents = await page.evaluate(() => window.__scrollEvents || 0);
  const slMid = (await snap()).scrollLeft;
  console.log(
    `    [T6 轮询在跑?] hideMenu ${menuBefore} → ${menuAfter}；scroll 事件 ${scrollEvents} 次；scrollLeft=${slMid}`,
  );
  const sEnd = await snap();
  const sl1 = sEnd.scrollLeft;
  const moved = Math.abs(sl1 - sl0) + Math.abs(sEnd.tx - tx0);
  await fire('touchend', 200, 400);
  await page.waitForTimeout(300);
  check(
    'T6 收不到 touchmove 时仍能自动滚动（轮询守护兜住 WebView 吞事件）',
    moved > 150,
    `零 touchmove 纯靠轮询：scrollLeft ${sl0}→${sl1}、translateX ${tx0}→${sEnd.tx}，合计位移 ${moved}px；panBy 命中 ${panDbg.pan ?? 0} 次`,
  );
  await resetUi();
}

// ---------- T7 手动续选：完全由 JS 掌控的跨页兜底手段 ----------
{
  await resetUi();
  await page.waitForTimeout(300);
  await fire('touchstart', 200, 400);
  await makeSel(20, false);
  await fire('touchend', 200, 400);
  await page.waitForTimeout(700);
  const pop0 = await page.locator('.sel-pop').count();
  if (pop0 === 0) {
    check('T7 手动续选能跨页扩展', false, '划线弹层未出现，无法续选');
  } else {
    const len0 = await page.evaluate(
      () => (window.getSelection()?.toString() ?? '').replace(/\s+/g, '').length,
    );
    for (let i = 0; i < 3; i++) {
      await page.locator('.sel-pop button', { hasText: '续选后文' }).click();
      await page.waitForTimeout(450);
    }
    const len1 = await page.evaluate(
      () => (window.getSelection()?.toString() ?? '').replace(/\s+/g, '').length,
    );
    await page.locator('.sel-pop .dot').first().click();
    await page.waitForTimeout(900);
    const total = await page.evaluate(() =>
      Array.from(document.querySelectorAll('mark.hl')).reduce(
        (a, m) => a + (m.textContent ?? '').replace(/\s+/g, '').length,
        0,
      ),
    );
    check(
      'T7 手动续选能跨页扩展并划线（不依赖任何原生行为）',
      len1 > len0 * 3 && total > 0,
      `选区 ${len0} 字 → 续选 3 次后 ${len1} 字 → 划线落库 ${total} 字`,
    );
  }
}

// ---------- 汇总 ----------
await page.screenshot({ path: OUT + 'v035-hl.png' });
const fail = results.filter((r) => !r.ok);
console.log(`\n========== ${results.length - fail.length}/${results.length} 通过 ==========`);
if (fail.length) {
  for (const f of fail) console.log(`  ✗ ${f.name}: ${f.detail}`);
}
await browser.close();
process.exit(fail.length ? 1 : 0);
