/** Mirror only this repository's source/tags and verified public release files.
 * Credentials stay in the environment and are never embedded in Git URLs. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const githubRepository = 'sanbyzhuzhu/yuedushu';
export const giteeRepository = 'https://gitee.com/sanbyzhu/yuedushu';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function validateManifest(manifest, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || manifest.version !== version) throw Error('Manifest version mismatch');
  const expected = {
    windows: `${giteeRepository}/raw/downloads/v${version}/ReadingTree_${version}_Windows_x64_Setup.exe`,
    android: `https://github.com/${githubRepository}/releases/download/v${version}/ReadingTree_${version}_Android.apk`,
  };
  for (const target of ['windows', 'android']) {
    if (manifest.downloads?.[target] !== expected[target]) throw Error('Unexpected download URL: ' + target);
    if (!/^[a-f0-9]{64}$/.test(manifest.sha256?.[target] || '')) throw Error('Missing SHA256: ' + target);
  }
  const platform = manifest.platforms?.['windows-x86_64'];
  if (platform?.url !== expected.windows || typeof platform.signature !== 'string' || !platform.signature.trim()) throw Error('Missing Windows updater signature');
}

export function validateBytes(name, bytes, expectedHash, expectedSize) {
  if (bytes.length !== expectedSize || sha256(bytes) !== expectedHash) throw Error('Release checksum mismatch: ' + name);
}

export function validateExisting(file, bytes) {
  if (fs.existsSync(file) && !fs.readFileSync(file).equals(bytes)) throw Error('Refusing to replace an existing version file: ' + path.basename(file));
}

async function request(url, { auth = false } = {}) {
  if (auth && !url.startsWith(`https://api.github.com/repos/${githubRepository}/`)) throw Error('Unexpected authenticated endpoint');
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'ReadingTree-Gitee-Sync', ...(auth ? { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' } : {}) }, signal: AbortSignal.timeout(120000) });
      if (!response.ok) { await response.body?.cancel(); throw Error('HTTP ' + response.status); }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 3000 * (attempt + 1)));
    }
  }
  throw Error('Public release request failed: ' + new URL(url).pathname + ' (' + last.message + ')');
}

async function run() {
  if (!process.env.GITEE_TOKEN || !process.env.GH_TOKEN) throw Error('Configure the GITEE_TOKEN repository secret before running');
  if (process.env.GITHUB_REPOSITORY !== githubRepository) throw Error('Unexpected source repository');
  const root = process.cwd();
  const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const manifestBytes = fs.readFileSync('update.json');
  const manifest = JSON.parse(manifestBytes);
  validateManifest(manifest, version);
  const release = JSON.parse(await request(`https://api.github.com/repos/${githubRepository}/releases/tags/v${version}`, { auth: true }));
  if (release.tag_name !== 'v' + version || release.draft || release.prerelease) throw Error('Publish a stable GitHub release before activating its Gitee update');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-tree-gitee-'));
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' };
  const git = (args, cwd = root) => {
    const result = spawnSync('git', ['-c', 'credential.helper=', ...args], { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    // Do not include raw Git output in errors: credentials must never reach logs.
    if (result.status !== 0) throw Error('Git ' + args[0] + ' failed; existing remote history was not overwritten');
    return result.stdout.trim();
  };
  try {
    const askpass = path.join(temp, 'askpass.cjs');
    fs.writeFileSync(askpass, '#!/usr/bin/env node\nprocess.stdout.write(/username/i.test(process.argv[2]||\'\') ? \'sanbyzhu\\n\' : process.env.GITEE_TOKEN+\'\\n\');\n', { mode: 0o700 });
    env.GIT_ASKPASS = askpass;
    const sourceCommit = git(['rev-parse', 'HEAD']);
    git(['rev-parse', '--verify', 'refs/tags/v' + version]);
    const files = new Map();
    const required = [`ReadingTree_${version}_Windows_x64_Setup.exe`, `ReadingTree_${version}_Android.apk`, `ReadingTree_${version}_Source.zip`, 'SHA256SUMS.txt', 'update.json', `ReadingTree_${version}_Windows_x64_Setup.exe.sig`];
    for (const name of required) {
      const asset = release.assets.find(a => a.name === name);
      const url = `https://github.com/${githubRepository}/releases/download/v${version}/${name}`;
      if (!asset || asset.browser_download_url !== url || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) throw Error('Missing verified release asset: ' + name);
      const bytes = await request(url);
      validateBytes(name, bytes, asset.digest.slice(7), asset.size);
      files.set(name, bytes);
      console.log('Verified GitHub asset: ' + name);
    }
    if (!files.get('update.json').equals(manifestBytes)) throw Error('Master update.json differs from the published release');
    if (files.get(`ReadingTree_${version}_Windows_x64_Setup.exe.sig`).toString().trim() !== manifest.platforms['windows-x86_64'].signature.trim()) throw Error('Updater signature file differs from manifest');
    for (const [target, name] of [['windows', required[0]], ['android', required[1]]]) {
      if (sha256(files.get(name)) !== manifest.sha256[target]) throw Error('Update manifest checksum mismatch: ' + target);
    }
    const checksums = new Map(files.get('SHA256SUMS.txt').toString().trim().split(/\r?\n/).map(line => {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
      if (!match) throw Error('Invalid release checksum list');
      return [match[2], match[1]];
    }));
    for (const name of required.slice(0, 3)) if (checksums.get(name) !== sha256(files.get(name))) throw Error('Checksum list differs: ' + name);
    const downloadDir = path.join(temp, 'downloads');
    fs.mkdirSync(downloadDir);
    git(['init', '-q', downloadDir]);
    git(['fetch', '--depth=1', `${giteeRepository}.git`, 'downloads'], downloadDir);
    git(['checkout', '-b', 'downloads', 'FETCH_HEAD'], downloadDir);
    const folder = path.join(downloadDir, 'v' + version);
    fs.mkdirSync(folder, { recursive: true });
    for (const [name, bytes] of files) { const file = path.join(folder, name); validateExisting(file, bytes); fs.writeFileSync(file, bytes); }
    fs.writeFileSync(path.join(downloadDir, 'README.md'), `# 阅读树安装包下载\n\n当前版本：v${version}。源码位于 master 分支。各版本校验值位于对应目录的 SHA256SUMS.txt。\n\nGitee 大文件匿名下载可能要求登录。公开安卓下载与全部发行文件也可从 https://github.com/${githubRepository}/releases/latest 获取。\n`);
    git(['add', '--all'], downloadDir);
    if (git(['diff', '--cached', '--name-only'], downloadDir)) {
      git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'Sync verified Reading Tree v' + version + ' downloads'], downloadDir);
      git(['push', `${giteeRepository}.git`, 'HEAD:refs/heads/downloads'], downloadDir);
    }
    const publicWindows = await request(manifest.downloads.windows);
    if (sha256(publicWindows) !== manifest.sha256.windows) throw Error('Gitee public Windows download differs; live source/update feed left unchanged');
    // No force push, pruning, or mirroring of private/internal refs. Release files go first.
    git(['push', `${giteeRepository}.git`, 'refs/tags/*:refs/tags/*']);
    git(['push', `${giteeRepository}.git`, 'HEAD:refs/heads/master']);
    const remote = git(['ls-remote', `${giteeRepository}.git`, 'refs/heads/master']);
    if (remote.split(/\s/)[0] !== sourceCommit) throw Error('Gitee source HEAD verification failed');
    console.log(`Gitee source, tags and verified v${version} downloads are synchronized.`);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Gitee 同步成功\n\n版本：${version}\n\n源码提交：\`${sourceCommit}\`\n\n安装包、源码 ZIP、SHA-256、更新签名和 update.json 已校验；先同步下载文件，再同步主分支。\n`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run().catch(error => { console.error(error.message); process.exitCode = 1; });
