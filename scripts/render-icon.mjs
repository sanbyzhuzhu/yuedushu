/** Rebuild desktop and Android icons from the same vector artwork. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
fs.mkdirSync('.tmp', { recursive: true });
const svg = fs.readFileSync('assets/icon.svg', 'utf8');
const emblem = svg.slice(svg.indexOf('<g id="emblem">'), svg.lastIndexOf('</svg>'));
// Android crops a 108 dp layer to 72 dp. Keep all artwork in the 66 dp safe circle.
const foreground = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><g transform="translate(512 512) scale(.74) translate(-512 -490)">${emblem}</g></svg>`;
const background = '#F3EDDD';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
async function render(source, size, filename) {
  const png = await page.evaluate(async ({ source, size }) => {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source); await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { source, size });
  fs.writeFileSync(filename, Buffer.from(png, 'base64'));
}
try {
  await render(svg, 1024, '.tmp/icon-source.png');
  const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', '.tmp/icon-source.png'], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Desktop icon generation failed');
  const res = 'src-tauri/gen/android/app/src/main/res';
  const adaptive = `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/ic_launcher_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>`;
  fs.mkdirSync(`${res}/mipmap-anydpi-v26`, { recursive: true });
  for (const name of ['ic_launcher', 'ic_launcher_round']) fs.writeFileSync(`${res}/mipmap-anydpi-v26/${name}.xml`, adaptive);
  fs.writeFileSync(`${res}/values/ic_launcher_background.xml`, `<resources><color name="ic_launcher_background">${background}</color></resources>`);
  const round = svg.replace(/<rect[^>]+\/>/g, '').replace('<g id="emblem">', '<circle cx="512" cy="512" r="512" fill="#F3EDDD"/><g id="emblem">');
  for (const [density, scale] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
    const dir = `${res}/mipmap-${density}`;
    fs.mkdirSync(dir, { recursive: true });
    await render(svg, 48 * scale, `${dir}/ic_launcher.png`);
    await render(round, 48 * scale, `${dir}/ic_launcher_round.png`);
    await render(foreground, 108 * scale, `${dir}/ic_launcher_foreground.png`);
  }
  fs.mkdirSync('output/playwright', { recursive: true });
  const cropped = foreground.replace('viewBox="0 0 1024 1024"', 'viewBox="170.667 170.667 682.666 682.666"');
  await page.setViewportSize({ width: 1000, height: 430 });
  await page.setContent(`<style>body{margin:0;padding:38px;background:#e7e0d0;font-family:serif;color:#4b4033}h1{font-size:22px;font-weight:normal;margin:0 0 28px}.row{display:flex;gap:46px;align-items:center}.icon{width:160px;height:160px;background:${background};overflow:hidden}.icon svg{width:100%;height:100%}p{text-align:center;font-size:14px}.circle{border-radius:50%}.squircle{border-radius:38%}.square{border-radius:24%}.small{width:48px;height:48px;border-radius:50%}</style><h1>阅读树 · Android 图标裁切预览</h1><div class="row">${['circle', 'squircle', 'square', 'small'].map((shape) => `<div><div class="icon ${shape}">${cropped}</div><p>${shape === 'small' ? '48 px' : shape === 'circle' ? '圆形' : shape === 'squircle' ? '圆角方形' : '方形'}</p></div>`).join('')}</div>`);
  await page.screenshot({ path: 'output/playwright/icon-masks.png' });
  const safe = await page.evaluate(async (source) => {
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source); await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, 1024, 1024).data;
    let furthest = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (pixels[(y * 1024 + x) * 4 + 3] > 0) furthest = Math.max(furthest, Math.hypot(x + .5 - 512, y + .5 - 512));
    return { furthest, safeRadius: 1024 * 33 / 108 };
  }, foreground);
  if (safe.furthest > safe.safeRadius) throw new Error(`Icon escapes Android safe circle: ${JSON.stringify(safe)}`);
  console.log('Icon safe circle verified:', safe);
} finally { await browser.close(); }
