/**
 * Offline smoke test: mounts the host half on a throwaway HTTP server, hits its
 * route with a synthetic bill + ledger, and checks the client bundle's loader
 * contract. No DSH, no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-token-alltime-'));
process.env.DSH_HOME = tmp;

const ledgerDir = path.join(tmp, 'dsh-usage');
fs.mkdirSync(ledgerDir, { recursive: true });
const ledgerFile = path.join(ledgerDir, 'usage-ledger.json');
const dataFile = path.join(tmp, 'data.json');
process.env.DSH_TOKEN_ALLTIME_DATA = dataFile;

const routes = [];
const ctx = {
  webServer: { register: (route) => { routes.push(route); return () => {}; } },
  effect: (fn) => { ctx.__dispose = fn(); },
};
const mod = await import('file://' + path.join(root, 'lib/index.js').split(path.sep).join('/'));
assert.equal(typeof mod.apply, 'function', 'apply must be exported');
assert.deepEqual(mod.inject, ['webServer'], 'inject must name the webServer service');
mod.apply(ctx);
assert.equal(routes.length, 1, 'exactly one route must be registered');
assert.equal(routes[0].path, '/api/dsh-token-alltime/overview');
assert.equal(routes[0].kind, 'exact');

const server = http.createServer((req, res) => {
  const found = routes.find((r) => r.path === new URL(req.url, 'http://x').pathname);
  if (found === undefined) { res.writeHead(404); res.end(); return; }
  found.handler(req, res);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = 'http://127.0.0.1:' + server.address().port + '/api/dsh-token-alltime/overview';
const read = async () => await (await fetch(url)).json();

const pad = (n) => String(n).padStart(2, '0');
const dayShift = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
};
const TODAY = dayShift(0);
const D1 = dayShift(-1);
const D2 = dayShift(-2);
/** A ledger cell whose token count is exactly `tokens`. */
const cell = (tokens, calls = 1, cost = 0, miss = 0) => ({ inputTokens: miss, cacheReadTokens: tokens, outputTokens: 0, calls, cost });

try {
  // 1) A fresh install reports zeros and must never fold the local ledger in.
  fs.writeFileSync(ledgerFile, JSON.stringify({ days: { [D2]: { deepseek: { m1: cell(500) } } } }));
  const fresh = await read();
  assert.equal(fresh.imported, false, 'fresh install must not claim an import');
  assert.equal(fresh.total, 0, 'fresh install must report a zero total');
  assert.equal(fresh.history, 0, 'fresh install has no history');
  assert.equal(fresh.sinceExport, 0, 'fresh install must not fold the local ledger in');
  assert.deepEqual(fresh.models, [], 'fresh install lists no models');
  assert.deepEqual(fresh.days, [], 'fresh install has no chart');
  assert.equal(fresh.ledger, null, 'fresh install exposes no ledger breakdown');
  assert.equal(fresh.today.hitRate, null, 'fresh install has no hit rate');
  assert.equal(fresh.today.tokens, 0, 'fresh install shows no usage today');
  assert.equal(fresh.today.day, null, 'fresh install names no day');
  assert.equal(fresh.calls, 0, 'fresh install has no calls');
  assert.equal(fresh.costCny, 0, 'fresh install costs nothing');

  // 2) Legacy data.json (scalar baseline only): the export day was captured
  //    mid-day, so its platform figure plus the rest of that day's ledger bucket
  //    must add up, and history + today must equal the total exactly.
  fs.writeFileSync(dataFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    platformRange: [D2, D1],
    platformTotalTokens: 1400,
    platformTotalCostCny: 0.2,
    platformCalls: 2,
    platformDays: [
      { d: D2, req: 1, hit: 900, miss: 100, out: 0, tok: 1000, cost: 0.1 },
      { d: D1, req: 1, hit: 400, miss: 0, out: 0, tok: 400, cost: 0.1 },
    ],
    platformModels: [{ model: 'm1', hit: 1300, miss: 100, out: 0, tok: 1400, req: 2, cost: 0.2 }],
    ledgerBaselineTokens: 1200,
    ledgerBaselineCalls: 2,
    otherCostCny: 0,
  }));
  fs.writeFileSync(ledgerFile, JSON.stringify({
    days: {
      [D2]: { deepseek: { m1: cell(800, 1, 0.5) } },
      [D1]: { deepseek: { m1: cell(1000, 1, 0.6) } },
      [TODAY]: { deepseek: { m1: cell(200, 1, 0.2), m2: cell(100, 2, 0.1) } },
    },
  }));
  const doc = await read();
  assert.equal(doc.imported, true);
  assert.equal(doc.total, doc.history + doc.today.tokens, 'total must split into history + today');
  assert.equal(doc.history, 2000, 'history covers complete days plus the export day remainder');
  assert.equal(doc.today.day, TODAY, 'today is the local calendar day');
  assert.equal(doc.today.tokens, 300, "today must fold only today's ledger bucket");
  assert.equal(doc.today.calls, 3, "today must carry today's call count");
  assert.equal(doc.total, 2300, 'total is history plus today');
  assert.equal(doc.sinceExport, 900, 'sinceExport is the ledger growth past the import');
  assert.equal(doc.platform.tokens, 1400, 'platform.tokens stays the static bill figure');
  assert.equal(doc.models.reduce((a, m) => a + m.tokens, 0), doc.total, 'models must add up to the total');
  assert.deepEqual(doc.models.map((m) => m.model), ['m1', 'm2'], 'models are ranked by size');
  assert.deepEqual(doc.days, [{ day: D2, tokens: 1000 }, { day: D1, tokens: 1000 }, { day: TODAY, tokens: 300 }]);
  assert.equal(doc.range[0], D2, 'range starts at the first day with data');
  // Calls and cost follow the same day split: bill day + ledger growth past the import.
  assert.equal(doc.calls, 6, 'calls are the bill plus ledger growth');
  assert.equal(doc.costCny, 0.86, 'cost is the bill plus ledger growth, rounded to cents');
  assert.equal(doc.platform.calls, 2, 'platform.calls stays the static bill figure');
  assert.equal(doc.today.hitRate, 1, "today's cache hit rate reads today's ledger bucket only");

  // 3) The chart shows at most the last 15 used days, oldest first.
  fs.writeFileSync(dataFile, JSON.stringify({
    platformRange: [dayShift(-40), dayShift(-30)],
    platformTotalTokens: 1,
    ledgerBaselineTokens: 0,
  }));
  const many = {};
  for (let i = 1; i <= 20; i += 1) many[dayShift(-i - 2)] = { deepseek: { m1: cell(10 * i) } };
  fs.writeFileSync(ledgerFile, JSON.stringify({ days: many }));
  const chart = await read();
  assert.equal(chart.days.length, 15, 'the chart keeps exactly the last 15 used days');
  assert.ok(chart.days[chart.days.length - 1].day > chart.days[0].day, 'days are oldest first');
  assert.ok(chart.days.every((d) => d.tokens > 0), 'idle days never reach the chart');
  assert.equal(chart.days[chart.days.length - 1].day, dayShift(-3), 'the newest day stays in the chart');
  assert.ok(chart.days[0].day >= dayShift(-17), 'the oldest day is the 15th newest');
  // 4) The cache hit rate is today's only: an old heavy-miss day must not leak in.
  fs.writeFileSync(ledgerFile, JSON.stringify({
    days: {
      [dayShift(-5)]: { deepseek: { m1: cell(10, 1, 0, 900) } },
      [TODAY]: { deepseek: { m1: cell(300, 1, 0, 100) } },
    },
  }));
  const rate = await read();
  assert.equal(rate.today.tokens, 400, "today's tokens include the uncached input");
  assert.equal(rate.today.hitRate, 0.75, "the hit rate ignores every earlier day");
} finally {
  server.close();
}

const bundle = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');
let captured;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
new Function('window', bundle)(globalThis.window);
assert.equal(captured.id, 'dsh-token-alltime');
const clientExports = captured.factory(() => { throw new Error('client must not require modules'); });
assert.equal(typeof clientExports.apply, 'function', 'client apply must be exported');
assert.deepEqual(clientExports.inject, []);
assert.ok(!bundle.includes('Σ'), 'the pill caption no longer carries a sigma');
assert.ok(bundle.includes('POLL_MS = 300000'), 'the panel polls every 5 minutes');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
  assert.ok(pkg.files.some((g) => g === required || required.startsWith(g + '/')), 'not published: ' + required);
}
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');

console.log('smoke test passed');
