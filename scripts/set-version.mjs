/** Explicit release version setter; no implicit bump during ordinary builds. */
import fs from 'node:fs';
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('用法：node scripts/set-version.mjs 0.3.18');
const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'];
// Parse/validate every input before changing any file.
const updates = files.map(path => {
  const source = fs.readFileSync(path, 'utf8');
  const data = JSON.parse(source); data.version = version;
  if (path === 'package-lock.json') data.packages[''].version = version;
  return [path, JSON.stringify(data, null, 2) + '\n'];
});
const cargoPath = 'src-tauri/Cargo.toml';
const cargo = fs.readFileSync(cargoPath, 'utf8');
if (!/^version\s*=\s*"[^"]+"/m.test(cargo)) throw new Error('Cargo.toml 缺少版本字段');
updates.push([cargoPath, cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)]);
const lockPath = 'src-tauri/Cargo.lock';
const lock = fs.readFileSync(lockPath, 'utf8');
const packageName = cargo.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
const block = lock.split('[[package]]');
const entry = block.findIndex(s => s.includes(`name = "${packageName}"`));
if (entry < 0) throw new Error('Cargo.lock 缺少应用条目');
block[entry] = block[entry].replace(/^version = "[^"]+"/m, `version = "${version}"`);
updates.push([lockPath, block.join('[[package]]')]);
for (const [path, content] of updates) fs.writeFileSync(path, content);
console.log(`应用版本已统一设置为 ${version}，请记录变更后再打包。`);
