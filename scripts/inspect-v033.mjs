/** V0.3.3 实测：①PDF 页面垂直居中 ②Android 原生 TTS 桥（mock）双后端状态机 */
import pw from 'file:///C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core/index.js';
const { chromium } = pw;
const BASE = 'http://127.0.0.1:4173';
const OUT = 'E:/Anti/yuedushu/.tmp/';

const browser = await chromium.launch({ channel: 'msedge', headless: false });

// ---------- 0. 造一个 A4「扫描版」PDF（整页一张图，与手机扫描件同尺寸比例） ----------
{
  const c0 = await browser.newContext();
  const p0 = await c0.newPage();
  await p0.setContent(`<html><body style="margin:0;background:#fff">
    <div style="width:210mm;height:297mm;background:#fdfbf5;box-sizing:border-box;padding:24mm 20mm">
      <div style="font:16pt/2.2 serif;color:#333">
        扫描版测试页<br/>这一页用于验证 PDF 页面在阅读区是否垂直居中。<br/>
        内容模拟扫描件：整页为一张位图，页面为 A4 竖版比例。
      </div>
      <div style="margin-top:16mm;height:170mm;background:repeating-linear-gradient(#eee 0 2px,#fdfbf5 2px 14px)"></div>
    </div></body></html>`);
  await p0.pdf({ path: OUT + 'scan-test.pdf', format: 'A4', printBackground: true });
  await c0.close();
  console.log('⓪ 已生成 A4 扫描版测试 PDF');
}

// ---------- 1. PDF 居中 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 140)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => indexedDB.deleteDatabase('reading-tree'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.setInputFiles('input[type=file]', OUT + 'scan-test.pdf');
  await page.waitForTimeout(4500);
  console.log('① 导入后书卡数:', await page.locator('.cell').count());
  await page.locator('.cell').first().click();
  await page.waitForTimeout(3500);

  const geo = await page.evaluate(() => {
    const stage = document.querySelector('.pdf-stage');
    const pg = document.querySelector('.pdf-page');
    if (!stage || !pg) return null;
    const s = stage.getBoundingClientRect();
    const p = pg.getBoundingClientRect();
    return {
      stageH: Math.round(s.height),
      pageW: Math.round(p.width),
      pageH: Math.round(p.height),
      gapTop: Math.round(p.top - s.top),
      gapBottom: Math.round(s.bottom - p.bottom),
      gapLeft: Math.round(p.left - s.left),
      gapRight: Math.round(s.right - p.right),
    };
  });
  await page.screenshot({ path: OUT + 'v033-pdf.png' });
  if (!geo) {
    console.log('① ✗ 未找到 .pdf-stage / .pdf-page');
  } else {
    const vDiff = Math.abs(geo.gapTop - geo.gapBottom);
    const hDiff = Math.abs(geo.gapLeft - geo.gapRight);
    console.log('① 几何:', JSON.stringify(geo));
    console.log(`   垂直居中: 上 ${geo.gapTop} / 下 ${geo.gapBottom} → 差 ${vDiff}px ${vDiff <= 4 ? '✓' : '✗'} | 水平: 差 ${hDiff}px ${hDiff <= 4 ? '✓' : '✗'}`);
  }
  await ctx.close();
}

// ---------- 2. TTS 原生桥（mock）：验证原生优先路径与段落队列状态机 ----------
{
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  // 模拟真实 Android TextToSpeech：朗读耗时长；stop() 会触发 onError（原生没有 pause）
  await ctx2.addInitScript(() => {
    const calls = [];
    let lastId = '';
    window.__mockCalls = calls;
    window.ReadingTreeNativeTts = {
      isReady: () => true,
      hasChinese: () => true,
      getEngineName: () => 'mock-engine',
      getVoices: () =>
        JSON.stringify([
          { id: 'v-zh-1', name: '中文（中国） · 本地', lang: 'cmn-CN' },
          { id: 'v-zh-2', name: '中文（台湾） · 本地', lang: 'cmn-TW' },
        ]),
      setVoice: (id) => {
        calls.push(['setVoice', id]);
        return true;
      },
      speak: (text, id, rate) => {
        lastId = id;
        calls.push(['speak', id]);
        setTimeout(() => {
          if (window.__rtTtsNativeEvent) window.__rtTtsNativeEvent('done', id);
        }, 1000);
      },
      stop: () => {
        calls.push(['stop']);
        const lid = lastId;
        setTimeout(() => {
          if (window.__rtTtsNativeEvent) window.__rtTtsNativeEvent('error', lid);
        }, 30);
      },
    };
  });
  const page = await ctx2.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 140)));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('.empty button', { hasText: '载入示例古籍' }).click();
  await page.waitForTimeout(1200);

  const st0 = await page.evaluate(() => window.__rtTtsState());
  console.log('② 后端探测:', JSON.stringify(st0), st0.native && st0.voices === 2 ? '✓ 走原生桥' : '✗');

  await page.locator('.cell').first().click();
  await page.waitForTimeout(2500);
  await page.mouse.click(195, 300);
  await page.waitForTimeout(600);
  await page.locator('.reader-foot button', { hasText: '朗读' }).click();
  await page.waitForTimeout(600);

  const speakN = () => page.evaluate(() => window.__mockCalls.filter((c) => c[0] === 'speak').length);
  const stateOf = () => page.evaluate(() => window.__rtTtsState());

  // 关掉自动连播，聚焦队列状态机本身
  await page.locator('.set-group', { hasText: '读完本章后' }).locator('button', { hasText: '停止' }).click();
  await page.waitForTimeout(300);

  await page.locator('.tts-controls button', { hasText: '开始朗读' }).click();
  await page.waitForTimeout(450);
  const s1 = await stateOf();
  const n1 = await speakN();
  console.log('② 开始朗读:', 'playing=' + s1.playing, 'paused=' + s1.paused, 'speak次数=' + n1, s1.playing && !s1.paused && n1 === 1 ? '✓' : '✗');

  // 暂停：原生 stop() 会触发 onError，前端必须忽略它
  await page.locator('.tts-controls button', { hasText: '暂停' }).click();
  await page.waitForTimeout(500);
  const s2 = await stateOf();
  const n2 = await speakN();
  await page.waitForTimeout(700);
  const n2b = await speakN();
  console.log('② 暂停:', 'paused=' + s2.paused, `speak ${n2}→${n2b}`, s2.paused && n2 === n2b ? '✓ 停住且未被 onError 误推进' : '✗');

  // 继续：Android 无 resume，应重读当前段
  await page.locator('.tts-controls button', { hasText: '继续' }).click();
  await page.waitForTimeout(400);
  const s3 = await stateOf();
  const n3 = await speakN();
  console.log('② 继续:', 'playing=' + s3.playing, 'paused=' + s3.paused, `speak ${n2b}→${n3}`, s3.playing && !s3.paused && n3 > n2b ? '✓ 已重读当前段' : '✗');

  // 停止
  await page.locator('.tts-controls button', { hasText: '停止' }).click();
  await page.waitForTimeout(600);
  const s4 = await stateOf();
  const stopCalls = await page.evaluate(() => window.__mockCalls.filter((c) => c[0] === 'stop').length);
  const n4 = await speakN();
  await page.waitForTimeout(500);
  const n4b = await speakN();
  console.log('② 停止:', 'playing=' + s4.playing, 'stop调用=' + stopCalls, `speak ${n4}→${n4b}`, !s4.playing && n4 === n4b ? '✓' : '✗');
  await page.screenshot({ path: OUT + 'v033-tts.png' });
  await ctx2.close();
}

await browser.close();
console.log('--- 实测结束 ---');
