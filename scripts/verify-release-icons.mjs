/** Resolve even shortened release resource names and compare actual APK pixels. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk');
const aapt = path.join(sdk, 'build-tools', '36.0.0', 'aapt.exe');
fs.mkdirSync('.tmp', { recursive: true });
const apk = path.resolve('.tmp/verify-icons.apk');
fs.copyFileSync(`releases/${version}/阅读树_${version}_Android_release.apk`, apk);
function dump(...args) {
  const result = spawnSync(aapt, ['dump', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
  return result.stdout;
}
const resources = dump('--values', 'resources', apk).split('\n');
const entries = [];
let config = '';
for (let i = 0; i < resources.length; i++) {
  const match = resources[i].match(/^\s+config (.*):/);
  if (match) config = match[1];
  const resource = resources[i].match(/^\s+resource (0x[0-9a-f]+) .*:mipmap\/(ic_launcher(?:_foreground|_round)?):/);
  if (!resource) continue;
  const filename = resources[i + 1]?.match(/"(res\/[^"]+)"/)?.[1];
  assert.ok(filename, 'Missing packaged icon path');
  entries.push({ id: resource[1], name: resource[2], config, filename });
}
const manifest = dump('xmltree', apk, 'AndroidManifest.xml');
for (const [attribute, name] of [['icon', 'ic_launcher'], ['roundIcon', 'ic_launcher_round']]) {
  const id = entries.find((e) => e.name === name)?.id;
  assert.ok(id && new RegExp(`android:${attribute}\\([^)]*\\)=@${id}`).test(manifest), `Manifest ${attribute} does not reference the expected icon`);
}
const zip = unzipSync(fs.readFileSync(apk), { filter: (entry) => entries.some((e) => e.filename === entry.name) });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const pngs = entries.filter((e) => e.filename.endsWith('.png'));
  assert.equal(pngs.length, 15, 'All five densities must contain launcher, round and foreground PNGs');
  for (const entry of pngs) {
    const local = fs.readFileSync(`src-tauri/gen/android/app/src/main/res/mipmap-${entry.config}/${entry.name}.png`);
    const result = await page.evaluate(async ({ expected, actual }) => {
      async function pixels(base64) {
        const img = new Image(); img.src = 'data:image/png;base64,' + base64; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        return { width: img.width, height: img.height, data: ctx.getImageData(0, 0, img.width, img.height).data };
      }
      const a = await pixels(expected), b = await pixels(actual);
      return a.width === b.width && a.height === b.height && a.data.every((v, i) => v === b.data[i]);
    }, { expected: local.toString('base64'), actual: Buffer.from(zip[entry.filename]).toString('base64') });
    assert.ok(result, `APK contains a stale icon: ${entry.name}/${entry.config}`);
  }
  const xmls = entries.filter((e) => e.filename.endsWith('.xml'));
  assert.equal(xmls.length, 2, 'Both launcher variants must use adaptive icons');
  const foreground = entries.find((e) => e.name === 'ic_launcher_foreground').id;
  const background = resources.find((line) => /^\s+resource /.test(line) && line.includes(':color/ic_launcher_background:'));
  assert.ok(background?.includes('d=0xfff3eddd'), 'Wrong adaptive background color');
  const backgroundId = background.match(/resource (0x[0-9a-f]+)/)[1];
  for (const entry of xmls) {
    const xml = dump('xmltree', apk, entry.filename);
    assert.ok(xml.includes('E: adaptive-icon') && xml.includes(`=@${foreground}`) && xml.includes(`=@${backgroundId}`), 'Adaptive icon uses wrong layers');
  }
  console.log('✓ APK: all 15 launcher PNGs match current source pixels; both adaptive icons and background verified');
} finally { await browser.close(); }
