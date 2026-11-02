/**
 * dsh-token-alltime — host half.
 *
 * Serves one loopback-only JSON route with the all-time token total: a
 * platform-bill baseline imported from CSV exports (lib/data.json) plus the
 * live DSH usage ledger's growth since that import. The browser half renders
 * it as a right-edge pill; nothing here touches the dsh-usage plugin.
 * @module dsh-token-alltime
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'token-total';
export const inject = ['webServer'];

const API_PREFIX = '/api/dsh-token-alltime';

/** Empty baseline used when no platform export has been imported yet. */
const EMPTY_PLATFORM = {
  generatedAt: null,
  platformRange: [null, null],
  platformTotalTokens: 0,
  platformTotalCostCny: 0,
  platformCalls: 0,
  platformDays: [],
  platformModels: [],
  ledgerBaselineTokens: 0,
  ledgerBaselineCalls: 0,
  otherCostCny: 0,
};

/**
 * Read the imported platform baseline; null when this install has imported
 * nothing yet (a fresh install must report zeros, not the local ledger).
 */
function readPlatform() {
  try {
    const file = fileURLToPath(new URL('./data.json', import.meta.url));
    const doc = { ...EMPTY_PLATFORM, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    return doc.platformTotalTokens > 0 ? doc : null;
  } catch {
    return null;
  }
}

function home() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** Fold the live DSH usage ledger into plain totals; a missing file is not an error. */
function readLedger() {
  const file = path.join(home(), 'dsh-usage', 'usage-ledger.json');
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const days = [];
  const models = new Map();
  let hit = 0;
  let miss = 0;
  let out = 0;
  let calls = 0;
  let cost = 0;
  for (const [day, providers] of Object.entries(doc.days || {})) {
    let dayTokens = 0;
    let dayCalls = 0;
    let dayCost = 0;
    for (const [provider, byModel] of Object.entries(providers || {})) {
      for (const [model, v] of Object.entries(byModel || {})) {
        const h = v.cacheReadTokens || 0;
        const m = v.inputTokens || 0;
        const o = v.outputTokens || 0;
        const tokens = h + m + o + (v.cacheWriteTokens || 0) + (v.reasoningTokens || 0);
        hit += h;
        miss += m;
        out += o;
        calls += v.calls || 0;
        cost += v.cost || 0;
        dayTokens += tokens;
        dayCalls += v.calls || 0;
        dayCost += v.cost || 0;
        const key = provider + '/' + model;
        const prev = models.get(key) || { model: key, tokens: 0, calls: 0, cost: 0 };
        prev.tokens += tokens;
        prev.calls += v.calls || 0;
        prev.cost += v.cost || 0;
        models.set(key, prev);
      }
    }
    days.push({ day, tokens: dayTokens, calls: dayCalls, cost: dayCost });
  }
  days.sort((a, b) => (a.day < b.day ? -1 : 1));
  return {
    from: days[0]?.day ?? null,
    to: days[days.length - 1]?.day ?? null,
    tokens: hit + miss + out,
    hit,
    miss,
    out,
    calls,
    cost,
    days: days.slice(-90),
    models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
  };
}

/** Everything a fresh install reports until it imports its own export. */
function zeroOverview() {
  return {
    updatedAt: Date.now(),
    total: 0,
    sinceExport: 0,
    imported: false,
    cacheHitRate: null,
    platform: { range: [null, null], tokens: 0, calls: 0, costCny: 0, days: [], models: [] },
    ledger: null,
    baseline: { tokens: 0, calls: 0, generatedAt: null },
  };
}

/** Build the overview document the card renders. */
function overview() {
  const platform = readPlatform();
  if (platform === null) return zeroOverview();
  const ledger = readLedger();
  const sinceExport = ledger ? Math.max(0, ledger.tokens - platform.ledgerBaselineTokens) : 0;
  const totalHit = platform.platformModels.reduce((a, m) => a + (m.hit || 0), 0) + (ledger?.hit ?? 0);
  const totalMiss = platform.platformModels.reduce((a, m) => a + (m.miss || 0), 0) + (ledger?.miss ?? 0);
  const prompt = totalHit + totalMiss;
  return {
    updatedAt: Date.now(),
    total: platform.platformTotalTokens + sinceExport,
    sinceExport,
    imported: true,
    cacheHitRate: prompt > 0 ? totalHit / prompt : null,
    platform: {
      range: platform.platformRange,
      tokens: platform.platformTotalTokens,
      calls: platform.platformCalls,
      costCny: platform.platformTotalCostCny,
      days: platform.platformDays,
      models: platform.platformModels.map((m) => ({ model: m.model, tokens: m.tok, calls: m.req, cost: m.cost })),
    },
    ledger,
    baseline: {
      tokens: platform.ledgerBaselineTokens,
      calls: platform.ledgerBaselineCalls,
      generatedAt: platform.generatedAt,
    },
  };
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Loopback-only fence: this document is personal account data. */
function allowed(req) {
  return LOOPBACK.has(req.socket?.remoteAddress ?? '');
}

export function apply(ctx) {
  const dispose = ctx.webServer.register({
    kind: 'exact',
    path: API_PREFIX + '/overview',
    handler: (req, res) => {
      if (!allowed(req)) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden: loopback-only' }));
        return;
      }
      let body;
      try {
        body = JSON.stringify(overview());
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(body);
    },
  });
  if (typeof ctx.effect === 'function') ctx.effect(() => () => dispose());
}
