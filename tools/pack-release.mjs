/**
 * Build distributable release artifacts under release/:
 *   <name>-<version>.tgz  — publishable package contents
 *   <name>-<version>-source.zip — full source tree
 *   SHA256SUMS
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const outDir = path.join(ROOT, 'release');
fs.mkdirSync(outDir, { recursive: true });

const publishFiles = pkg.files.filter((f) => fs.existsSync(path.join(ROOT, f)));
const tgz = path.join(outDir, pkg.name + '-' + pkg.version + '.tgz');
execFileSync('tar', ['-czf', tgz, '--exclude=lib/data.json', 'package.json', ...publishFiles], { cwd: ROOT, stdio: 'inherit' });

const zip = path.join(outDir, pkg.name + '-' + pkg.version + '-source.zip');
const skip = new Set(['.git', 'node_modules', 'release', 'lib/data.json']);
const entries = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join('/');
    if (skip.has(entry.name) || skip.has(relative)) continue;
    if (entry.isDirectory()) walk(path.join(dir, entry.name));
    else entries.push(relative);
  }
})(ROOT);
execFileSync('tar', ['-a', '-cf', zip, ...entries], { cwd: ROOT, stdio: 'inherit' });

const sums = [tgz, zip].map((file) => {
  const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return hash + '  ' + path.basename(file);
});
fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), sums.join('\n') + '\n');
for (const file of [tgz, zip]) console.log('built ' + path.relative(ROOT, file) + ' (' + fs.statSync(file).size + ' bytes)');
console.log(sums.join('\n'));
