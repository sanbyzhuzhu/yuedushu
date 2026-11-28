/** Build current working sources; keep signing material out of the source archive. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const mode = process.argv[2] || 'all';
if (!['all', 'windows', 'android', 'source', 'collect'].includes(mode)) throw new Error('Use all, windows, android, source or collect');
const debug = process.argv.includes('debug');
const description = JSON.parse(fs.readFileSync('package.json', 'utf8')).releaseDescription;
const output = path.join(root, 'releases', description ? `${version} ${description.replace(/[<>:"/\\|?*]/g, '_')}` : version);
fs.mkdirSync(output, { recursive: true });
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const releaseSection = changelog.split(/^## /m).slice(1).find(section => section.split(/\r?\n/, 1)[0].trim() === version);
if (releaseSection) fs.writeFileSync(path.join(output, '发布说明.md'), `# 阅读树 ${version}\n\n${releaseSection.slice(releaseSection.indexOf('\n') + 1).trim()}\n`);
else console.warn(`CHANGELOG.md 尚无 ${version} 条目，未生成本版发布说明。`);
const env = { ...process.env, CARGO_INCREMENTAL: '0' };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
const nodeDir = process.env.RELEASE_NODE_HOME || (fs.existsSync('C:/node-v20.18.0-win-x64/npm.cmd') ? 'C:/node-v20.18.0-win-x64' : path.dirname(process.execPath));
env[pathKey] = [nodeDir, path.join(env.USERPROFILE || '', '.cargo', 'bin'), env[pathKey]].join(path.delimiter);
env.JAVA_HOME ||= 'C:/Program Files/Microsoft/jdk-21.0.10.7-hotspot';
env.ANDROID_HOME ||= path.join(env.LOCALAPPDATA || '', 'Android', 'Sdk');
if (!env.NDK_HOME || !fs.existsSync(path.join(env.NDK_HOME, 'source.properties'))) {
  env.NDK_HOME = path.join(env.ANDROID_HOME, 'ndk', '27.1.12297006');
}
env.ANDROID_NDK_HOME = env.NDK_HOME;
env.GRADLE_USER_HOME = process.env.RELEASE_GRADLE_HOME || (fs.existsSync(path.join(root, '.gradle-home')) ? path.join(root, '.gradle-home') : env.GRADLE_USER_HOME || path.join(root, '.gradle-home'));

function run(executable, args) {
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build command failed (${result.status}): ${path.basename(executable)}`);
}
function tauri(args) {
  run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', ...args, '--ci', '--config', JSON.stringify({ build: { beforeBuildCommand: 'node node_modules/vite/bin/vite.js build' } })]);
}
function copy(from, name) {
  if (!fs.existsSync(from)) throw new Error(`Missing build artifact: ${from}`);
  fs.copyFileSync(from, path.join(output, name));
  console.log(`Saved ${name}`);
}
function windowsArtifact() {
  copy(`src-tauri/target/release/bundle/nsis/阅读树_${version}_x64-setup.exe`, `阅读树_${version}_Windows_x64_安装版.exe`);
}
function androidArtifact() {
  const flavor = debug ? 'debug' : 'release';
  copy(`src-tauri/gen/android/app/build/outputs/apk/universal/${flavor}/app-universal-${flavor}.apk`, `阅读树_${version}_Android_${flavor}.apk`);
}
function signWindowsUpdate() {
  const localPath = '.updater-signing.local.json';
  const local = fs.existsSync(localPath) ? JSON.parse(fs.readFileSync(localPath, 'utf8')) : {};
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY || local.privateKey;
  if (!key) throw new Error('Missing updater signing key. Restore .updater-signing.local.json or TAURI_SIGNING_PRIVATE_KEY; never generate a different key for an existing update channel.');
  const file = path.join(output, `阅读树_${version}_Windows_x64_安装版.exe`);
  const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js','signer','sign','--app-version',version,file], {
    cwd:root, windowsHide:true, encoding:'utf8', env:{...env, TAURI_SIGNING_PRIVATE_KEY:key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD:process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? local.password ?? ''},
  });
  if (result.status !== 0 || !fs.existsSync(file + '.sig')) throw new Error('Windows updater signing failed (signer output suppressed to protect signing material).');
  console.log('Signed Windows updater package, bound to release version.');
  return fs.readFileSync(file + '.sig', 'utf8').trim();
}
function sourceArchive() {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', windowsHide: true });
  const forbidden = (name) => /(^|\/)(node_modules|target|build|dist|releases|output|\.git|\.gradle|\.gradle-home|\.tmp|\.tauri|\.idea|\.playwright-cli)(\/|$)/.test(name)
    || /\.(keystore|jks|p12|pfx|log)$|(^|\/)\.env(?:\.|$)|signing.*\.json$|local\.properties$|key\.properties$|keystore\.properties$|vite\.config\.ts\.timestamp-/.test(name);
  // Extracted source archives have no .git; allow the same script to repackage them.
  function walk(dir = '') {
    return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
      const name = (dir ? `${dir}/` : '') + entry.name;
      if (forbidden(name) || entry.isSymbolicLink()) return [];
      return entry.isDirectory() ? walk(name) : [name];
    });
  }
  const names = git.status === 0 ? git.stdout.split('\0').filter(Boolean) : walk();
  const files = {};
  const prefix = `阅读树-${version}-源码/`;
  for (const name of new Set(names)) {
    if (forbidden(name) || !fs.existsSync(name) || !fs.lstatSync(name).isFile()) continue;
    files[prefix + name] = new Uint8Array(fs.readFileSync(name));
  }
  const archive = zipSync(files, { level: 6 });
  const verified = unzipSync(archive);
  for (const required of ['src/engine/appUpdate.ts', 'src/store/appUpdate.ts', 'src/ui/UpdatePanel.tsx', 'src/update-source.json', 'scripts/test-app-update.mjs', 'scripts/test-toc-current.mjs', 'docs/更新与Gitee发布.md']) {
    if (!verified[prefix + required] || !Buffer.from(verified[prefix + required]).equals(fs.readFileSync(required))) throw new Error(`Source archive verification failed: ${required}`);
  }
  for (const required of ['src/ui/HighlightActions.tsx', 'src/ui/PdfReader.tsx', 'scripts/test-highlight-actions.mjs']) {
    if (!verified[prefix + required] || !Buffer.from(verified[prefix + required]).equals(fs.readFileSync(required))) throw new Error(`Source archive verification failed: ${required}`);
  }
  for (const required of ['src/styles/shelf.css', 'scripts/shelf-actions.mjs', 'scripts/test-shelf-home.mjs', 'docs/首页优化.md', 'src/ui/BookCover.tsx', 'src/ui/BookPages.tsx', 'src/backup.ts', 'src/platform/web.ts', 'scripts/test-large-library.mjs', 'src/engine/pdfReflow.ts', 'src/ui/PdfReflowPanel.tsx', 'src/platform/bookWebsites.ts', 'scripts/test-public-libraries.mjs', 'src/engine/importExtra.ts', 'src/engine/networkLibrary.ts', 'src/ui/NetworkLibraryPanel.tsx', 'src/engine/md.ts', 'src-tauri/src/lib.rs', 'scripts/test-network-formats.mjs', 'src/App.tsx', 'src/ui/CategoryPanel.tsx', 'src/ui/BookmarkPanel.tsx', 'src/ui/Bookshelf.tsx', 'src/store/library.ts', 'scripts/test-library-management.mjs', 'src-tauri/gen/android/app/src/main/java/com/readingtree/app/MainActivity.kt']) {
    if (!verified[prefix + required] || !Buffer.from(verified[prefix + required]).equals(fs.readFileSync(required))) throw new Error(`Source archive verification failed: ${required}`);
  }
  for (const required of ['package.json', 'src/ui/Reader.tsx', 'src/ui/NoteCard.tsx', 'src/engine/paginator.ts', 'src/engine/textSelection.ts', 'scripts/test-selection-touch.mjs', 'scripts/test-reading-polish.mjs', 'scripts/render-icon.mjs', 'scripts/verify-release-icons.mjs', 'assets/icon.svg', 'src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png', 'src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', 'src/styles/refinement.css', 'src-tauri/Cargo.lock', 'src-tauri/gen/android/gradle/wrapper/gradle-wrapper.jar']) {
    if (!verified[prefix + required] || !Buffer.from(verified[prefix + required]).equals(fs.readFileSync(required))) throw new Error(`Source archive verification failed: ${required}`);
  }
  const name = `阅读树_${version}_源码.zip`;
  fs.writeFileSync(path.join(output, name), archive);
  console.log(`Saved ${name} (${Object.keys(files).length} files, current working contents verified)`);
}

if (mode === 'all' || mode === 'windows') { tauri(['build', '--bundles', 'nsis']); windowsArtifact(); }
if (mode === 'all' || mode === 'android') {
  if (!debug) {
    const local = fs.existsSync('.android-signing.local.json') ? JSON.parse(fs.readFileSync('.android-signing.local.json', 'utf8')) : {};
    env.TAURI_ANDROID_KEYSTORE_PATH ||= local.keystore ? path.resolve(local.keystore) : '';
    env.TAURI_ANDROID_KEYSTORE_PASSWORD ||= local.password || '';
    env.TAURI_ANDROID_KEY_ALIAS ||= local.alias || '';
    if (!env.TAURI_ANDROID_KEYSTORE_PATH || !env.TAURI_ANDROID_KEYSTORE_PASSWORD || !env.TAURI_ANDROID_KEY_ALIAS) throw new Error('Provide the three TAURI_ANDROID signing environment variables or .android-signing.local.json. See docs/打包与交付.md.');
  }
  tauri(['android', 'build', '--apk', '--target', 'aarch64', 'armv7', ...(debug ? ['--debug'] : [])]);
  androidArtifact();
}
if (mode === 'collect') { windowsArtifact(); androidArtifact(); }
// Publish assets before copying this manifest to the repository's master branch.
if (['all', 'collect'].includes(mode)) {
  const publishing = JSON.parse(fs.readFileSync('scripts/publish-config.json', 'utf8'));
  const downloads = {};
  for (const [target, name] of [['windows', `阅读树_${version}_Windows_x64_安装版.exe`], ['android', `阅读树_${version}_Android_release.apk`]]) {
    if (!fs.existsSync(path.join(output, name))) throw new Error('Missing update asset: ' + name);
    downloads[target] = publishing.downloads[target].replaceAll('{version}', version);
    if (new URL(downloads[target]).protocol !== 'https:') throw new Error('Release downloads must use HTTPS');
  }
  const sha256 = {};
  for (const [target, name] of [['windows', `阅读树_${version}_Windows_x64_安装版.exe`], ['android', `阅读树_${version}_Android_release.apk`]]) sha256[target] = createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex');
  const signature = signWindowsUpdate();
  const notes = releaseSection ? releaseSection.slice(releaseSection.indexOf('\n') + 1).trim() : '';
  fs.writeFileSync(path.join(output, 'update.json'), JSON.stringify({ version, publishedAt: new Date().toISOString(),
    notes, downloads, sha256, platforms:{'windows-x86_64':{url:downloads.windows,signature}} }, null, 2) + '\n');
  console.log('Saved update.json (publish release assets before making this manifest live)');
}
if (mode === 'all' || mode === 'source' || mode === 'collect') {
  copy('src/engine/curatedSources.json', '阅读树_精选书源.json');
  copy('docs/书源检测与精选书库.md', '书源使用说明.md');
  sourceArchive();
}
const hashes = fs.readdirSync(output).filter((name) => /\.(exe|apk|zip)$/.test(name) || name === '阅读树_精选书源.json').map((name) => `${createHash('sha256').update(fs.readFileSync(path.join(output, name))).digest('hex')}  ${name}`);
fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), hashes.join('\n') + '\n');
console.log(`Output: ${output}`);
