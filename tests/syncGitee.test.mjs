import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateManifest, validateBytes, validateExisting, sha256 } from '../scripts/sync-gitee.mjs';
const version = '0.4.10';
const manifest = () => ({ version, downloads: {
  windows: `https://gitee.com/sanbyzhu/yuedushu/raw/downloads/v${version}/ReadingTree_${version}_Windows_x64_Setup.exe`,
  android: `https://github.com/sanbyzhuzhu/yuedushu/releases/download/v${version}/ReadingTree_${version}_Android.apk`,
}, sha256: {windows:'a'.repeat(64),android:'b'.repeat(64)}, platforms: {'windows-x86_64':{url:`https://gitee.com/sanbyzhu/yuedushu/raw/downloads/v${version}/ReadingTree_${version}_Windows_x64_Setup.exe`,signature:'signed'}} });
test('only accepts the intended version, public destinations and signed update structure', () => {
  validateManifest(manifest(), version);
  assert.throws(()=>validateManifest(manifest(),'0.4.11'));
  for(const change of [m=>m.downloads.windows='https://other.invalid/app.exe',m=>m.sha256.android='bad',m=>delete m.platforms['windows-x86_64'].signature,m=>m.platforms['windows-x86_64'].url='https://other.invalid/app.exe']){
    const m=manifest();change(m);assert.throws(()=>validateManifest(m,version));
  }
});
test('rejects corrupted and truncated release downloads', () => {
  const bytes=Buffer.from('release bytes');validateBytes('fixture',bytes,sha256(bytes),bytes.length);
  assert.throws(()=>validateBytes('fixture',Buffer.from('tampered'),sha256(bytes),bytes.length));
  assert.throws(()=>validateBytes('fixture',bytes,sha256(bytes),bytes.length+1));
});
test('reruns preserve immutable files and reject replacing a published version', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gitee-sync-test-'));
  try {const file=path.join(dir,'asset');validateExisting(file,Buffer.from('same'));fs.writeFileSync(file,'same');validateExisting(file,Buffer.from('same'));assert.throws(()=>validateExisting(file,Buffer.from('different')));assert.equal(fs.readFileSync(file,'utf8'),'same');}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
});
