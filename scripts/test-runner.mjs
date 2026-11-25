import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const all = fs.readdirSync('scripts').filter(n => /^test-.*\.mjs$/.test(n) && n !== 'test-runner.mjs').sort();
const smoke = ['test-reader.mjs', 'test-panels.mjs', 'test-selection-touch.mjs', 'test-search-recycle.mjs', 'test-reader-fixes.mjs'];
const mode = process.argv[2] || 'smoke';
if (mode === 'list') { console.log(all.join('\n')); process.exit(0); }
if (!['all', 'smoke'].includes(mode)) throw new Error('Use list, smoke or all');
for (const script of mode === 'all' ? all : smoke) {
  console.log(`Running ${script}`);
  const result = spawnSync(process.execPath, [`scripts/${script}`], { stdio: 'inherit', windowsHide: true, env: { ...process.env, PW_CHANNEL: process.env.PW_CHANNEL || 'msedge' } });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
