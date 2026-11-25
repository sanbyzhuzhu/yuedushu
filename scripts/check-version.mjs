import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const tauri = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf8').match(/^version\s*=\s*"([^"]+)"/m)?.[1];
for (const version of [lock.version, lock.packages[''].version, tauri.version, cargo]) {
  if (version !== pkg.version) throw new Error(`Version mismatch: ${version} vs ${pkg.version}`);
}
console.log(`Release versions agree: ${pkg.version}`);
