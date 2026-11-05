/**
 * Install doctor: the two failure modes this package has actually caused on a
 * user's machine, checked in one pass.
 *
 *  1. A stale file: dependency in a profile's package.json (the checkout was
 *     renamed or moved). pnpm resolves every direct dependency before any
 *     add/remove/upgrade, so one dead path blocks the whole profile: no plugin
 *     can be installed, removed or updated until the line is fixed.
 *  2. A pnpm-installed copy that no longer matches the checkout, most often
 *     lib/data.json (pnpm copies file: dependencies, it does not link them).
 *
 * Read-only. It prints the exact command for anything it finds and exits 1
 * when something is broken.
 *
 *   node tools/doctor.mjs
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const self = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(self, 'package.json'), 'utf8'));
const NAME = pkg.name;
const HASHED = ['lib/index.js', 'lib/client.js', 'package.json', 'cordis.patch.yml'];

const sha = (file) => {
  try {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
};

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const profilesDir = path.join(dshHome, 'profiles');

let failures = 0;
let warnings = 0;
const line = (state, text, fix) => {
  if (state === 'FAIL') failures += 1;
  if (state === 'WARN') warnings += 1;
  console.log('  ' + state.padEnd(4) + '  ' + text);
  if (fix && state !== 'PASS') console.log('        -> ' + fix);
};

/** Resolve a file:/link: spec the way pnpm does, against the profile. */
function resolveSpec(spec, from) {
  return path.resolve(from, spec.replace(/^(file|link):/, ''));
}

console.log(NAME + ' doctor - checkout ' + pkg.version);
console.log('checkout  ' + self);
console.log('DSH_HOME  ' + dshHome);

if (!fs.existsSync(profilesDir)) {
  console.log('\nno profiles directory yet: nothing installed, nothing to check');
  process.exit(0);
}

const profiles = fs
  .readdirSync(profilesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(profilesDir, d.name, 'package.json')))
  .map((d) => path.join(profilesDir, d.name));

if (profiles.length === 0) console.log('\nno profiles with a package.json');

for (const profile of profiles) {
  const file = path.join(profile, 'package.json');
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.log('\n' + path.basename(profile) + '  ' + profile);
    line('FAIL', 'package.json is not valid JSON: ' + error.message, 'fix or restore ' + file);
    continue;
  }
  const spec = (doc.dependencies || {})[NAME];
  const bundles = ((doc.dsh || {}).profile || {}).bundles || [];
  if (spec === undefined && !bundles.includes(NAME)) continue;

  console.log('\n' + path.basename(profile) + '  ' + profile);

  if (spec === undefined) {
    line('WARN', 'not a dependency of this profile; only the bundle list mentions it', 'keep the dependency pinned too, or the entry can outlive its package');
  } else if (/^(file|link):/.test(spec)) {
    const target = resolveSpec(spec, profile);
    if (!fs.existsSync(target)) {
      line('FAIL', 'dead local dependency: ' + spec, 're-point it at the checkout: npm pkg set "dependencies.' + NAME + '=file:' + self.split(path.sep).join('/') + '" --prefix "' + profile + '"');
    } else {
      let other = null;
      try {
        other = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8'));
      } catch {
        other = null;
      }
      if (other === null) line('FAIL', 'dependency target is not a package: ' + target, 're-point it at ' + self);
      else if (other.name !== NAME) line('WARN', 'dependency target is ' + other.name + ', not ' + NAME, 're-point it at ' + self);
      else line('PASS', 'local dependency resolves to ' + target + ' (v' + other.version + ')');
    }
  } else {
    line('PASS', 'dependency pinned to the registry: ' + spec);
  }

  line(bundles.includes(NAME) ? 'PASS' : 'WARN', bundles.includes(NAME) ? 'enabled in dsh.profile.bundles' : 'missing from dsh.profile.bundles, so it never mounts', 'add "' + NAME + '" to dsh.profile.bundles');

  const installed = path.join(profile, 'node_modules', NAME);
  if (!fs.existsSync(installed)) {
    line('WARN', 'no installed copy under node_modules; the plugin manager makes one on its next install', 'run a plugin install/enable in DSH, or copy the checkout there yourself');
    continue;
  }
  let installedVersion = '?';
  try {
    installedVersion = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).version;
  } catch {
    installedVersion = '?';
  }
  const stale = HASHED.filter((rel) => sha(path.join(self, rel)) !== sha(path.join(installed, rel)));
  line(
    stale.length === 0 ? 'PASS' : 'WARN',
    'installed copy v' + installedVersion + (stale.length === 0 ? ', identical to the checkout' : ', ' + stale.length + '/' + HASHED.length + ' files differ: ' + stale.join(', ')),
    're-sync: robocopy "' + self + '" "' + installed + '" /E /XD .git node_modules /XF data.json',
  );
  if (installedVersion !== pkg.version) {
    line('WARN', 'installed v' + installedVersion + ' vs checkout v' + pkg.version, 'DSH runs the installed copy: re-sync before testing a change');
  }
  const mine = sha(path.join(self, 'lib', 'data.json'));
  const theirs = sha(path.join(installed, 'lib', 'data.json'));
  if (mine === null && theirs === null) line('PASS', 'no lib/data.json anywhere: the card reports zeros until an export is imported');
  else if (mine !== null && theirs === null) line('WARN', 'lib/data.json exists in the checkout but not in the installed copy: the card shows zeros', 'copy "' + path.join(self, 'lib', 'data.json') + '" "' + path.join(installed, 'lib', 'data.json') + '"');
  else if (mine === null && theirs !== null) line('WARN', 'only the installed copy has lib/data.json', 'copy it back into the checkout, or re-import it');
  else if (mine !== theirs) line('WARN', 'lib/data.json differs between checkout and installed copy', 'decide which one is current, then copy it over the other');
  else line('PASS', 'lib/data.json matches the installed copy');
}

console.log('\n' + failures + ' failure(s), ' + warnings + ' warning(s)');
process.exit(failures > 0 ? 1 : 0);
