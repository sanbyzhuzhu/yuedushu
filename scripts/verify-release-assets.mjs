/** Verify the APK actually embeds the current frontend, not a stale build.
 * Run after release.mjs android/windows; reads only build and release files. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const directory = path.join('releases', version);
const frontend = fs.readdirSync('dist/assets').filter((name) => name.endsWith('.js'))
  .map((name) => fs.readFileSync(path.join('dist/assets', name)))
  .find((bytes) => bytes.includes(Buffer.from('text-selection-handle')));
assert.ok(frontend, 'Missing selection controller in production frontend');
assert.ok(frontend.includes(Buffer.from(version)), 'Missing visible release version');
for (const text of ['检查更新', '忽略此版本', '确认打开下载', 'sanbyzhu/yuedushu', 'open_update_url']) {
  assert.ok(frontend.includes(Buffer.from(text)), 'Missing quiet update feature: ' + text);
}
for (const text of ['应用内下载', '确认安装并重启', '移入隐藏分组', '__hidden', 'coverUpdatedAt', 'download_app_update', 'ReadingTreeNativeUpdate']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing in-app updater/hidden shelf/cover fix: ' + text);
for (const text of ['pendingImport','importRevision','acknowledgeImport']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing immediate shelf refresh: ' + text);
for (const text of ['Wi-Fi 传书','wifi_start','wifi_read_chunk','wifi-transfer']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing Wi-Fi receiver: ' + text);
for (const text of ['划线操作', '复制原文', '复制笔记', '已复制原文', '这条划线有笔记']) {
  assert.ok(frontend.includes(Buffer.from(text)), 'Missing highlight quick action: ' + text);
}
for (const text of ['ReadingTreeNativeImports', 'read_import_file', '松开即可导入书籍']) {
  assert.ok(frontend.includes(Buffer.from(text)), 'Missing external book import: ' + text);
}
for (const text of ['跨书全文检索', '回收站', '不记住密码', 'trash-index:']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing library/sync upgrade: ' + text);
for (const text of ['复制', '--scale-factor', 'menu-preview-scale', '排版设置未能保存']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing 0.3.19 reader fixes: ' + text);
assert.ok(!/前选|后选/.test(frontend.toString()), 'Old character extension controls remain');
for (const text of ['readingTreeBack', '批量归类', '确认删除书签']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing management/back functionality: ' + text);
assert.ok(frontend.includes(Buffer.from('文字重排')), 'Missing PDF text reflow');
for (const text of ['清简书架版', '全部分类', '关于阅读树', 'book-pages', '停止后续导入', '准备下一批']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing large-library feature: ' + text);
for (const text of ['开发者：朱振坚（公号小二菜园）', '页面留白', '--reader-font-size', '--reader-image-height']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing reading-comfort feature: ' + text);
for (const text of ['标记已读完','标记未读完']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing completion action: ' + text);
for (const text of ['笔记管理', 'ReadingTreeNativeFiles', 'throwIfAborted', '个人阅读与藏书软件', 'WebDAV']) assert.ok(frontend.includes(Buffer.from(text)), 'Missing notes/export/about upgrade: ' + text);
const notesName = fs.readdirSync('dist/assets').find((name) => /^NotesManagerPanel-.*\.js$/.test(name));
assert.ok(notesName, 'Missing notes manager');
const notes = fs.readFileSync(path.join('dist/assets', notesName));
const catalogName = fs.readdirSync('dist/assets').find((name) => /^NetworkLibraryPanel-.*\.js$/.test(name));
assert.ok(catalogName, 'Missing lazy network library chunk');
const catalog = fs.readFileSync(path.join('dist/assets', catalogName));
// The updater also imports HTTP utilities, so Vite may split library data into shared chunks.
const extraJavascript = fs.readdirSync('dist/assets').filter(name => name.endsWith('.js') && name !== catalogName && name !== notesName)
  .map(name => ({ name, bytes: fs.readFileSync(path.join('dist/assets', name)) })).filter(asset => !asset.bytes.equals(frontend));
const libraryJavascript = Buffer.concat([catalog, ...extraJavascript.map(asset => asset.bytes)]);
for (const text of ['WebDAV 支持 HTTP 和 HTTPS', 'fetchWebdav', '书库跳转从 HTTPS 降为 HTTP']) assert.ok(libraryJavascript.includes(Buffer.from(text)), 'Missing HTTP WebDAV fix: ' + text);
const styleName = fs.readdirSync('dist/assets').find((name) => /^index-.*\.css$/.test(name));
assert.ok(styleName, 'Missing production stylesheet');
const stylesheet = fs.readFileSync(path.join('dist/assets', styleName));
const wifiStyleName = fs.readdirSync('dist/assets').find(name => /^WifiTransferPanel-.*\.css$/.test(name));
assert.ok(wifiStyleName,'Missing lazy Wi-Fi panel stylesheet');
const wifiStyles = fs.readFileSync(path.join('dist/assets',wifiStyleName));
const wifiPage = fs.readFileSync('src-tauri/src/wifi_upload.html');
for (const text of ['.all-categories', '.book-page-compact', '.shelf-search']) assert.ok(stylesheet.includes(Buffer.from(text)), 'Missing home style: ' + text);
for (const text of ['国学汉籍', 'GitHub', '中国国家图书馆', 'standard-ebooks']) assert.ok(libraryJavascript.includes(Buffer.from(text)), 'Missing library preset: ' + text);
for (const text of ['中文维基文库','中华诗词','Kanripo','中国哲学书电子化计划','GITenberg','Standard Ebooks','书格']) assert.ok(libraryJavascript.includes(Buffer.from(text)), 'Missing selected public library: ' + text);
for (const text of ['典籍总目录','networkChapterDownloads','无需重复下载','256 MiB','10000']) assert.ok(libraryJavascript.includes(Buffer.from(text)), 'Missing directory/download upgrade: ' + text);
function embeddedAsset(target, expected = frontend) {
  const root = path.join('src-tauri/target', target, 'release/build');
  for (const build of fs.readdirSync(root).filter((name) => name.startsWith('reading-tree-'))) {
    const assets = path.join(root, build, 'out/tauri-codegen-assets');
    if (!fs.existsSync(assets)) continue;
    for (const name of fs.readdirSync(assets).filter((name) => /\.(js|css)$/.test(name))) {
      const compressed = fs.readFileSync(path.join(assets, name));
      try { if (brotliDecompressSync(compressed).equals(expected)) return compressed; } catch {}
    }
  }
  throw new Error('No matching compiled frontend for ' + (target || 'Windows'));
}
const apk = unzipSync(fs.readFileSync(path.join(directory, `阅读树_${version}_Android_release.apk`)),
  { filter: (entry) => entry.name.endsWith('/libapp_lib.so') || /^classes\d*\.dex$/.test(entry.name) });
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('window.readingTreeBack'))), 'APK lacks the native back dispatcher bridge');
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('national-library')) && Buffer.from(bytes).includes(Buffer.from('openWebsite'))), 'APK lacks the new website bridge');
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('ReadingTreeNativeFiles')) && Buffer.from(bytes).includes(Buffer.from('Download/阅读树'))), 'APK lacks public Downloads file saving');
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('ReadingTreeNativeHttp'))), 'APK lacks Android system HTTPS fallback');
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('fetchWebdav'))), 'APK lacks explicit HTTP WebDAV bridge');
for (const text of ['ReadingTreeNativeUpdate','canRequestPackageInstalls','getPackageArchiveInfo']) assert.ok(Object.entries(apk).some(([name,bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from(text))), 'APK lacks verified installer bridge: ' + text);
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('ReadingTreeNativeImports')) && Buffer.from(bytes).includes(Buffer.from('readChunk'))), 'APK lacks Android external book import bridge');
assert.ok(Object.entries(apk).some(([name, bytes]) => name.endsWith('.dex') && Buffer.from(bytes).includes(Buffer.from('openUpdateUrl'))), 'APK lacks confirmed update download bridge');
for (const [abi, target] of [['arm64-v8a', 'aarch64-linux-android'], ['armeabi-v7a', 'armv7-linux-androideabi']]) {
  const lib = apk[`lib/${abi}/libapp_lib.so`];
  assert.ok(lib, 'APK library missing: ' + abi);
  assert.ok(Buffer.from(lib).includes(embeddedAsset(target)), 'APK contains stale frontend: ' + abi);
  assert.ok(Buffer.from(lib).includes(embeddedAsset(target, catalog)), 'APK contains stale library chunk: ' + abi);
  assert.ok(Buffer.from(lib).includes(embeddedAsset(target, notes)), 'APK contains stale notes manager: ' + abi);
  assert.ok(Buffer.from(lib).includes(embeddedAsset(target, stylesheet)), 'APK contains stale home styles: ' + abi);
  assert.ok(Buffer.from(lib).includes(embeddedAsset(target,wifiStyles)),'APK contains stale Wi-Fi styles: '+abi);
  assert.ok(Buffer.from(lib).includes(wifiPage),'APK lacks current native Wi-Fi upload page: '+abi);
  for (const asset of extraJavascript) assert.ok(Buffer.from(lib).includes(embeddedAsset(target, asset.bytes)), 'APK contains stale shared/runtime chunk: ' + abi + '/' + asset.name);
  console.log('✓ ' + abi + ': APK embedded frontend, styles and library chunk match the current production bundle byte for byte');
}
const windows = 'src-tauri/target/release/reading-tree.exe';
if (!process.argv.includes('--android-only')) {
  assert.ok(fs.existsSync(windows), 'Windows binary is missing');
  assert.ok(fs.readFileSync(windows).includes(embeddedAsset('')), 'Windows binary contains stale frontend');
  assert.ok(fs.readFileSync(windows).includes(embeddedAsset('', catalog)), 'Windows binary contains stale library chunk');
  assert.ok(fs.readFileSync(windows).includes(embeddedAsset('', notes)), 'Windows binary contains stale notes manager');
  assert.ok(fs.readFileSync(windows).includes(embeddedAsset('', stylesheet)), 'Windows binary contains stale home styles');
  const executable = fs.readFileSync(windows);
  assert.ok(executable.includes(embeddedAsset('',wifiStyles)),'Windows contains stale Wi-Fi styles');
  assert.ok(executable.includes(wifiPage),'Windows lacks current native Wi-Fi upload page');
  for (const asset of extraJavascript) assert.ok(executable.includes(embeddedAsset('', asset.bytes)), 'Windows contains stale shared/runtime chunk: ' + asset.name);
  console.log('✓ Windows executable embeds the same verified frontend, styles and library chunk');
}
console.log('Frontend SHA-256: ' + createHash('sha256').update(frontend).digest('hex'));
