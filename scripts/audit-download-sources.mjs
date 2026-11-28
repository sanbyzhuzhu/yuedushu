import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const downloads = 'C:/Users/Administrator/Downloads';
const out = path.join(downloads, '阅读树_可用书源_20261128');
fs.mkdirSync(out, { recursive: true });
const files = ['2.9书源.txt', '762个书源.txt', '书源导出2024.12.25 bookSource.json', '书源导出2024.12.25 bookSource(1).json'];
if (fs.existsSync(path.join(downloads, '阅读树_精选实测书源_20261128.txt'))) files.push('阅读树_精选实测书源_20261128.txt');
for (const dir of ['阅读树_书源检查与修复_20261128', '阅读树_0.4.14_书源兼容检查']) {
  for (const name of fs.readdirSync(path.join(downloads, dir))) {
    if (/匿名可识别_待联网|250个|已修复实测\.json|原规则已联网验证\.json/.test(name)) files.push(`${dir}/${name}`);
  }
}
const server = await createServer({ server: { host: '127.0.0.1', port: 5218, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const reportFile = path.join(out, '检测记录.json');
const reports = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : [];
const verify = process.argv.includes('--verify');
if (verify) files.length = 0;
try {
  const page = await browser.newPage();
  const responses = new Map();
  await page.route(/^https?:\/\//, async route => {
    if (route.request().url().startsWith('http://127.0.0.1:5218')) return route.continue();
    try {
      const req = route.request();
      const key = JSON.stringify([req.url(), req.method(), req.postData(), req.headers()]);
      if (!responses.has(key)) responses.set(key, (async () => {
        const response = await fetch(req.url(), { method: req.method(), headers: req.headers(), body: req.postDataBuffer() || undefined, signal: AbortSignal.timeout(12000) });
        return { status: response.status, contentType: response.headers.get('content-type') || 'text/html', body: Buffer.from(await response.arrayBuffer()) };
      })().catch(() => null));
      const response = await responses.get(key);
      if (response) await route.fulfill(response); else await route.abort('failed');
    } catch { await route.abort('failed'); }
  });
  await page.goto('http://127.0.0.1:5218');
  const candidates = new Map();
  const stats = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(downloads, file), 'utf8');
    const parsed = await page.evaluate(async text => {
      const net = await import('/src/engine/networkLibrary.ts');
      const parsed = net.parseSources(text);
      return { sources: parsed.sources, rejected: parsed.rejected.length };
    }, text);
    stats.push({ file, accepted: parsed.sources.length, rejected: parsed.rejected });
    for (const source of parsed.sources) candidates.set(JSON.stringify(source), source);
  }
  if (!verify) fs.writeFileSync(path.join(out, '文件统计.json'), JSON.stringify(stats, null, 2));
  const sources = [...candidates.values()];
  if (verify) sources.push(...reports.filter(result => result.status === 'readable').map(result => result.source));
  console.log('Compatible unique candidates', sources.length, JSON.stringify(stats));
  const verified = verify ? [] : reports.filter(r => r.status === 'readable').map(r => r.source);
  const done = new Set(verify ? [] : reports.map(r => JSON.stringify(r.source)));
  await page.exposeFunction('recordAudit', result => {
    if (!verify) reports.push(result);
    else fs.appendFileSync(path.join(out, '二次复测.jsonl'), JSON.stringify(result) + '\n');
    if (result.status === 'readable') verified.push(result.source);
    fs.appendFileSync(path.join(out, '逐条检测日志.jsonl'), JSON.stringify(result) + '\n');
    if (!verify && reports.length % 100 === 0) fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2));
    if (result.status === 'readable') fs.writeFileSync(path.join(out, '阅读树_实测可读书源.json'), JSON.stringify(verified, null, 2));
    if (reports.length % 10 === 0 || result.status === 'readable') console.log('Checked', reports.length, '/', sources.length, 'readable', verified.length, result.source.bookSourceName, result.status);
  });
  await page.evaluate(async ({ sources, verify }) => {
    const { auditSources } = await import('/src/engine/sourceAudit.ts');
    let cursor = 0;
    // Independent batches use the same parser and full chapter probe; cap total concurrency at 192.
    await Promise.all(Array.from({ length: verify ? 1 : 64 }, async () => {
      while (cursor < sources.length) {
        const batch = sources.slice(cursor, cursor += 3);
        const pending = [];
        await auditSources(batch, '西游记', new AbortController().signal, result => {
          pending.push(window.recordAudit({ ...result, source: batch[result.index], query: '西游记', testedAt: new Date().toISOString() }));
        }, verify ? 25000 : 18000);
        await Promise.all(pending);
      }
    }));
  }, { sources: sources.filter(source => !done.has(JSON.stringify(source))), verify });
  fs.writeFileSync(path.join(out, '阅读树_实测可读书源.json'), JSON.stringify(verified, null, 2));
  fs.writeFileSync(path.join(out, '说明.txt'), `检测日期：2026-11-28\n使用阅读树 0.4.15 实际引擎，搜索西游记、读取目录及首章；仅收录 readable。\n兼容去重后 ${sources.length} 个，实测可读 ${verified.length} 个。失败或无结果未收入。\n原始下载文件保持不变，未导入应用或增加内置书源。检测记录和文件统计同目录。\n`);
  fs.writeFileSync(reportFile, JSON.stringify(reports, null, 2));
  console.log('COMPLETE', sources.length, verified.length, out);
} finally { await browser.close(); await server.close(); }
