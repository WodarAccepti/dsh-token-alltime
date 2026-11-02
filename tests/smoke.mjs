/**
 * Offline smoke test: mounts the host half on a throwaway HTTP server, hits its
 * route, and checks the client bundle's loader contract. No DSH, no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
process.env.DSH_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-total-'));

const routes = [];
const ctx = {
  webServer: { register: (route) => { routes.push(route); return () => {}; } },
  effect: (fn) => { ctx.__dispose = fn(); },
};
const mod = await import('file://' + path.join(root, 'lib/index.js'));
assert.equal(typeof mod.apply, 'function', 'apply must be exported');
assert.deepEqual(mod.inject, ['webServer'], 'inject must name the webServer service');
mod.apply(ctx);
assert.equal(routes.length, 1, 'exactly one route must be registered');
assert.equal(routes[0].path, '/api/dsh-token-total/overview');
assert.equal(routes[0].kind, 'exact');

const server = http.createServer((req, res) => {
  const found = routes.find((r) => r.path === new URL(req.url, 'http://x').pathname);
  if (found === undefined) { res.writeHead(404); res.end(); return; }
  found.handler(req, res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));

const url = 'http://127.0.0.1:' + server.address().port + '/api/dsh-token-total/overview';
try {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.equal(typeof doc.total, 'number', 'total must be a number');
  assert.ok(doc.total >= 0, 'total must be non-negative');
  const dataFile = path.join(root, 'lib/data.json');
  const imported = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : null;
  const backed = (imported?.platformTotalTokens ?? 0) > 0;

  // A fresh install must report zeros and must never fold the local ledger in.
  const ledgerDir = path.join(process.env.DSH_HOME, 'dsh-usage');
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.writeFileSync(
    path.join(ledgerDir, 'usage-ledger.json'),
    JSON.stringify({
      days: { '2026-01-01': { deepseek: { 'deepseek-chat': { inputTokens: 500, cacheReadTokens: 1000, outputTokens: 200, calls: 3, cost: 1 } } } },
    }),
  );
  const fresh = await (await fetch(url)).json();
  if (!backed) {
    assert.equal(fresh.imported, false, 'fresh install must not claim an import');
    assert.equal(fresh.total, 0, 'fresh install must report a zero total');
    assert.equal(fresh.platform.tokens, 0, 'fresh install has no platform history');
    assert.equal(fresh.sinceExport, 0, 'fresh install must not fold the local ledger in');
    assert.equal(fresh.ledger, null, 'fresh install exposes no ledger breakdown');
    assert.equal(fresh.cacheHitRate, null, 'fresh install has no hit rate');
  } else {
    assert.ok(fresh.total > 0, 'an imported install reports its own numbers');
  }

  assert.equal(doc.imported, backed, 'imported flag must follow lib/data.json');
  assert.equal(doc.platform.tokens, imported?.platformTotalTokens ?? 0, 'platform tokens must come from lib/data.json');
  assert.equal(doc.total, doc.platform.tokens + doc.sinceExport, 'total must be baseline plus ledger growth');
  assert.equal(typeof doc.sinceExport, 'number');
  assert.ok(doc.cacheHitRate === null || typeof doc.cacheHitRate === 'number');
} finally {
  server.close();
}

const bundle = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');
let captured;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
new Function('window', bundle)(globalThis.window);
assert.equal(captured.id, 'dsh-token-total');
const clientExports = captured.factory(() => { throw new Error('client must not require modules'); });
assert.equal(typeof clientExports.apply, 'function', 'client apply must be exported');
assert.deepEqual(clientExports.inject, []);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  assert.ok(pkg.files.some((g) => g === required || required.startsWith(g + '/')), 'not published: ' + required);
}
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');

console.log('smoke test passed');
