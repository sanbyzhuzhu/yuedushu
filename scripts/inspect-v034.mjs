/** V0.3.4 实测：朗读「只读章节标题就跳下一章」
 *
 *  复现的两种真实书源形状（都没用 <p> 逐段）：
 *    ① 整章正文挤在一个块里（外层 div + 单个超长 p）→ 旧代码把「整章」当一段，远超
 *       Android TextToSpeech 单次上限 4000 字被引擎拒收，跳过；只剩 <h2> 标题能读。
 *    ② 裸文本 + <br>（没有任何 p/div）→ 旧代码的选择器一个正文块都匹配不到，只取到标题。
 *
 *  本脚本：生成同形状 EPUB → 走真实导入/阅读/朗读链路（mock 原生桥，>4000 字一律拒收）
 *          → 断言整章正文都被读出来。
 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
import { zipSync, strToU8 } from 'fflate';
import { writeFileSync } from 'node:fs';

const { chromium } = pw;
const BASE = 'http://127.0.0.1:4173';
const OUT = 'E:/Anti/yuedushu/.tmp/';

// ---------- 0. 生成「水浒传」式测试 EPUB ----------
const SENT = [
  '话说当时住持真人对洪太尉说道，太尉不知此殿中当初是祖老天师洞玄真人传下法符，嘱付道，此殿内镇锁着三十六员天罡星，七十二座地煞星，共是一百单八个魔君在里面。',
  '洪太尉听罢，心中大怒，指着众人说道，你们这等可恶，明明见有天子御书丹诏在此，怎敢违拗。',
  '众人只得把大锁砸开，推开大门，只见里面黑气冲天，一道金光从地而起，直冲云霄。',
  '那一片黑气散作百十道金光，望四面八方去了，众人惊得目瞪口呆，半晌言语不得。',
  '自此之后，水浒寨中聚集英雄好汉，替天行道，杀富济贫，声名播于四海，威震于京师。',
];
function makeBody(target) {
  let s = '';
  let i = 0;
  while (s.length < target) s += SENT[i++ % SENT.length];
  return s.slice(0, target);
}
const BODY1 = makeBody(5200); // ① 一个超长 <p>
const BODY2 = makeBody(4300); // ② 裸文本 + <br>
const BODY3 = makeBody(3000).match(/[^。]+。?/g).join('|'); // ③ 正常逐段

const ch1 = `<div class="box"><h2>第一回 张天师祈禳瘟疫 洪太尉误走妖魔</h2><p>${BODY1}</p></div>`;
const ch2 = `<h2>第二回 王教头私走延安府 九纹龙大闹史家村</h2>${BODY2.split('。').filter(Boolean).map((s) => s + '。').join('<br/>')}`;
const ch3 = `<section><h2>第三回 史大郎夜走华阴县 鲁提辖拳打镇关西</h2>${BODY3
  .split('|')
  .map((s) => `<p>${s}</p>`)
  .join('')}</section>`;
const ch4 = `<div><div>第四回 赵员外重修文殊院 鲁智深大闹五台山</div><div>${makeBody(4600)}</div></div>`;

const xhtml = (title, inner) =>
  `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${inner}</body></html>`;

const EPUB = {
  mimetype: strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  ),
  'OEBPS/content.opf': strToU8(
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>水浒传</dc:title><dc:creator>施耐庵</dc:creator><dc:identifier id="id">shuihu-test</dc:identifier></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/><item id="c4" href="ch4.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/><itemref idref="c4"/></spine></package>`,
  ),
  'OEBPS/nav.xhtml': strToU8(
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一回 张天师祈禳瘟疫 洪太尉误走妖魔</a></li><li><a href="ch2.xhtml">第二回 王教头私走延安府 九纹龙大闹史家村</a></li><li><a href="ch3.xhtml">第三回 史大郎夜走华阴县 鲁提辖拳打镇关西</a></li><li><a href="ch4.xhtml">第四回 赵员外重修文殊院 鲁智深大闹五台山</a></li></ol></nav></body></html>`,
  ),
  'OEBPS/ch1.xhtml': strToU8(xhtml('第一回', ch1)),
  'OEBPS/ch2.xhtml': strToU8(xhtml('第二回', ch2)),
  'OEBPS/ch3.xhtml': strToU8(xhtml('第三回', ch3)),
  'OEBPS/ch4.xhtml': strToU8(xhtml('第四回', ch4)),
};
writeFileSync(OUT + 'shuihu-test.epub', Buffer.from(zipSync(EPUB)));
console.log('⓪ 已生成测试 EPUB：4 章，正文全长', BODY1.length, '/', BODY2.length, '/', BODY3.length, '/ 4600');

const norm = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
const EXPECT = [norm(ch1), norm(ch2), norm(ch3), norm(ch4)];

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

// ---------- 1. mock Android 原生桥：>4000 字一律拒收（真机行为） ----------
await ctx.addInitScript(() => {
  const calls = [];
  let timer = null;
  let lastId = '';
  window.__rtMock = {
    reset() {
      calls.length = 0;
    },
    stats() {
      const lens = calls.filter((c) => c[0] === 'speak').map((c) => c[1]);
      return {
        speaks: lens.length,
        totalChars: lens.reduce((a, b) => a + b, 0),
        maxLen: lens.length ? Math.max(...lens) : 0,
        rejected: calls.filter((c) => c[0] === 'reject').map((c) => c[1]),
        firstTexts: calls.filter((c) => c[0] === 'speak').slice(0, 2).map((c) => c[2]),
      };
    },
  };
  window.ReadingTreeNativeTts = {
    isReady: () => true,
    hasChinese: () => true,
    getEngineName: () => 'mock-android',
    getVoices: () => JSON.stringify([{ id: 'v1', name: '中文（中国） · 本地', lang: 'cmn-CN' }]),
    setVoice: () => true,
    speak: (text, id, rate) => {
      lastId = id;
      if (text.length > 4000) {
        // 真机 TextToSpeech：超过 getMaxSpeechInputLength() → speak 返回 ERROR
        calls.push(['reject', text.length]);
        setTimeout(() => window.__rtTtsNativeEvent && window.__rtTtsNativeEvent('error', id), 10);
        return;
      }
      calls.push(['speak', text.length, text.slice(0, 14)]);
      clearTimeout(timer);
      timer = setTimeout(() => window.__rtTtsNativeEvent && window.__rtTtsNativeEvent('done', id), 25);
    },
    stop: () => {
      clearTimeout(timer);
      const lid = lastId;
      setTimeout(() => window.__rtTtsNativeEvent && window.__rtTtsNativeEvent('error', lid), 10);
    },
  };
});

const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 160)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// ---------- 2. 段落切分（对四种真实形状，对比旧实现） ----------
{
  const shapes = { '① 外层div+单个超长p（水浒传常见）': ch1, '② 裸文本+br（无p无div）': ch2, '③ section+p 正常': ch3, '④ 嵌套div、标题与正文各自成块': ch4 };
  const res = await page.evaluate(
    ({ shapes }) => {
      // 旧实现（V0.3.3）：固定选择器一次性取块
      const oldParas = (html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const blocks = doc.body ? Array.from(doc.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,div')) : [];
        const arr = blocks.map((b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 0);
        return arr.length ? arr : [(doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim()].filter(Boolean);
      };
      const out = {};
      for (const [k, html] of Object.entries(shapes)) {
        const o = oldParas(html);
        const n = window.__rtChapterParas(html);
        out[k] = {
          oldCount: o.length,
          oldMax: Math.max(...o.map((t) => t.length)),
          oldOver: o.filter((t) => t.length > 4000).length,
          newCount: n.length,
          newMax: Math.max(...n.map((t) => t.length)),
          newHead: n[0] ?? '',
          newDup: n.reduce((a, t) => a + t.length, 0),
          raw: html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length,
        };
      }
      return out;
    },
    { shapes },
  );
  console.log('\n=== 段落切分（旧 vs 新）===');
  for (const [k, r] of Object.entries(res)) {
    const dup = Math.abs(r.newDup - r.raw) <= r.raw * 0.02 ? '无重复/无遗漏 ✓' : `总量 ${r.newDup} vs 原文 ${r.raw} ✗`;
    console.log(
      `${k}\n   旧: ${r.oldCount} 段，最长 ${r.oldMax} 字，超 4000 的段 ${r.oldOver} 个 → ${r.oldOver ? '引擎必拒收 ✗' : '可读'}` +
        `\n   新: ${r.newCount} 段，最长 ${r.newMax} 字，首段「${r.newHead.slice(0, 18)}…」，${dup}`,
    );
  }
}

// ---------- 3. 真实链路：导入 → 朗读整章 ----------
await page.setInputFiles('input[type=file]', OUT + 'shuihu-test.epub');
await page.waitForTimeout(5000);
console.log('\n=== 端到端朗读 ===');
console.log('导入后书卡数:', await page.locator('.cell').count());
await page.locator('.cell').first().click();
await page.waitForTimeout(2500);

const openMenu = async () => {
  if ((await page.locator('.reader-head').count()) === 0) {
    await page.mouse.click(195, 300);
    await page.waitForTimeout(500);
  }
};
const openPanel = async () => {
  await openMenu();
  await page.locator('.reader-foot button', { hasText: '朗读' }).click();
  await page.waitForTimeout(500);
};
await openPanel();
// 关掉自动连播：本章读完即停，便于统计
await page.locator('.set-group', { hasText: '读完本章后' }).locator('button', { hasText: '停止' }).click();
await page.waitForTimeout(200);

const readChapter = async (idx) => {
  // 关面板 → 开目录 → 跳章 → 重开面板
  await page.locator('.drawer-head button', { hasText: '完成' }).click();
  await page.waitForTimeout(300);
  await openMenu();
  await page.locator('.reader-head button', { hasText: '目录' }).click();
  await page.waitForTimeout(400);
  await page.locator('.toc button').nth(idx).click();
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__rtMock.reset());
  await openPanel();
  await page.locator('.tts-controls button', { hasText: '开始朗读' }).click();
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !window.__rtTtsState().playing && window.__rtMock.stats().speaks > 0, null, { timeout: 90000 });
  const stats = await page.evaluate(() => window.__rtMock.stats());
  const st = await page.evaluate(() => window.__rtTtsState());
  return { ...stats, err: st.error };
};

let allOk = true;
for (const [idx, name] of [
  [0, '第一回（外层div+单个5200字p）'],
  [1, '第二回（裸文本+br，4300字）'],
]) {
  const r = await readChapter(idx);
  const exp = EXPECT[idx];
  const cov = r.totalChars / exp;
  const ok = cov > 0.95 && r.rejected.length === 0 && r.maxLen <= 200 && !r.err;
  allOk = allOk && ok;
  console.log(
    `${name}\n   speak ${r.speaks} 次 / 共 ${r.totalChars} 字（原文 ${exp} 字，覆盖率 ${(cov * 100).toFixed(1)}%）` +
      ` / 单次最长 ${r.maxLen} 字 / 被引擎拒收 ${r.rejected.length} 次` +
      `\n   首两段：「${r.firstTexts[0] ?? ''}…」「${r.firstTexts[1] ?? ''}…」` +
      `\n   错误提示：${r.err || '（无）'}  → ${ok ? '✓ 整章正文都读出来了' : '✗'}`,
  );
}
await page.screenshot({ path: OUT + 'v034-tts.png' });
console.log('\n--- 实测结束：', allOk ? '全部通过 ✓' : '存在失败项 ✗', '---');
await browser.close();
