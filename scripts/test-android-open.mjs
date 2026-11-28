/** Only for a disposable/read-only Android emulator, never a connected personal phone. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const serial = process.argv[2];
assert.match(serial || '', /^emulator-\d+$/, 'Pass the disposable emulator serial');
const adbPath = path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe');
function adb(...args) {
  const result = spawnSync(adbPath, ['-s', serial, ...args], { windowsHide: true, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw Error(result.stdout + result.stderr);
  return result.stdout.trim();
}
assert.equal(adb('shell', 'getprop', 'ro.kernel.qemu'), '1');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const directory = path.resolve('.tmp/android-open-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const description = JSON.parse(fs.readFileSync('package.json', 'utf8')).releaseDescription;
adb('install', '-r', `releases/${version}${description ? ' ' + description : ''}/阅读树_${version}_Android_release.apk`);
const remote = '/sdcard/Download/readingtree-import-qa';
adb('shell', 'mkdir', '-p', remote);
const uri = name => 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Freadingtree-import-qa%2F' + name + '.txt';
for (const name of ['cold', 'warm', 'share']) {
  const file = path.join(directory, name + '.txt');
  fs.writeFileSync(file, name + '\n\n' + ('Native Android imported ' + name + ' successfully. ').repeat(60));
  adb('push', file, remote + '/' + name + '.txt');
}
for (const mime of ['application/epub+zip', 'text/plain', 'application/pdf', 'application/octet-stream', 'application/x-mobipocket-ebook']) {
  const candidates = adb('shell', 'cmd', 'package', 'query-activities', '--brief', '-a', 'android.intent.action.VIEW', '-d', uri('cold'), '-t', mime);
  assert.match(candidates, /com\.readingtree\.app/);
  console.log('PASS: Android Open With lists Reading Tree for ' + mime);
}
function ui() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/readingtree-qa-window.xml');
  return adb('exec-out', 'cat', '/sdcard/readingtree-qa-window.xml');
}
function tapNode(xml, matches, long = false) {
  for (const node of xml.match(/<node\b[^>]*>/g) || []) {
    const text = /\btext="([^"]*)"/.exec(node)?.[1] || '';
    const desc = /content-desc="([^"]*)"/.exec(node)?.[1] || '';
    if (!matches(text, desc)) continue;
    const bounds = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
    if (!bounds) continue;
    const [, a, b, c, d] = bounds.map(Number), x = Math.round((a + c) / 2), y = Math.round((b + d) / 2);
    if (long) adb('shell', 'input', 'swipe', String(x), String(y), String(x), String(y), '800');
    else adb('shell', 'input', 'tap', String(x), String(y));
    return true;
  }
  return false;
}
async function openFromFiles(name, share = false) {
  // The actual file manager, rather than adb's shell UID, grants access to the book.
  adb('shell', 'am', 'force-stop', 'com.google.android.documentsui');
  adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Freadingtree-import-qa', '-t', 'vnd.android.document/directory');
  assert.ok(tapNode(ui(), text => text === name + '.txt', share), 'Fixture visible in file manager');
  if (share) assert.ok(tapNode(ui(), (text, desc) => /^(Share|分享)$/i.test(text || desc)), 'Share action visible');
  let xml = ui();
  if (share && !xml.includes('text="阅读树"')) {
    const bounds = /bounds="\[0,0\]\[(\d+),(\d+)\]"/.exec(xml);
    assert.ok(bounds, 'Share sheet geometry available');
    const x = Math.round(Number(bounds[1]) / 2), height = Number(bounds[2]);
    adb('shell', 'input', 'swipe', String(x), String(Math.round(height * .85)), String(x), String(Math.round(height * .3)), '600');
    xml = ui();
  }
  if (tapNode(xml, text => text === '阅读树')) xml = ui();
  tapNode(xml, text => /^(Just once|JUST ONCE|仅此一次|仅一次)$/.test(text));
}
async function expectReading(name) {
  let xml = '';
  for (let i = 0; i < 20; i++) {
    xml = ui();
    if (xml.includes('Native Android imported ' + name + ' successfully.')) {
      fs.writeFileSync(path.join(directory, name + '.xml'), xml); return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  fs.writeFileSync(path.join(directory, 'failed.xml'), xml);
  throw Error('Imported reader content not found for ' + name + '; see ' + directory);
}
adb('shell', 'am', 'force-stop', 'com.readingtree.app');
await openFromFiles('cold');
await expectReading('cold');
console.log('PASS: cold-start ACTION_VIEW reads granted content URI and opens imported book');
await openFromFiles('warm');
await expectReading('warm');
console.log('PASS: warm ACTION_VIEW delivers a second file without restarting the app');
await openFromFiles('share', true);
await expectReading('share');
console.log('PASS: ACTION_SEND imports and opens shared book');
console.log('Android emulator evidence: ' + directory);
