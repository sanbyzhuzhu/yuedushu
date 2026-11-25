import fs from 'node:fs';
import path from 'node:path';
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const seen = new Set();
const sections = [];
for (const [location, info] of Object.entries(lock.packages)) {
  if (!location || info.dev) continue;
  const manifest = path.join(location, 'package.json');
  if (!fs.existsSync(manifest) && info.optional) continue;
  if (!fs.existsSync(manifest)) throw new Error(`缺少依赖：${location}；请先 npm ci`);
  const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const identity = `${pkg.name}@${pkg.version}`;
  if (seen.has(identity)) continue;
  seen.add(identity);
  const licenseFiles = fs.readdirSync(location).filter(name => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name) && fs.statSync(path.join(location, name)).isFile());
  const texts = licenseFiles.map(name => `### ${name}\n\n${fs.readFileSync(path.join(location, name), 'utf8').trim()}`).join('\n\n');
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  sections.push(`## ${identity}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : info.license || 'See upstream license'}\n\n${repository ? `Source: ${repository}\n\n` : ''}${texts || 'License text: see the upstream source linked above.'}`);
}
sections.sort();
fs.writeFileSync('THIRD-PARTY-NOTICES.md', '# Third-party notices\n\nGenerated from installed production npm dependencies. Native dependencies are documented separately in docs/发布与许可证.md.\n\n' + sections.join('\n\n---\n\n') + '\n');
console.log(`Generated notices for ${sections.length} production packages.`);
