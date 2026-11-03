/**
 * dsh-token-alltime — host half.
 *
 * Serves one loopback-only JSON route with the token totals: the platform bill
 * history imported from CSV exports (lib/data.json) plus the live DSH usage
 * ledger's growth since that import. Days are split at local midnight, so
 * `history` (everything up to yesterday) plus `today` add up to `total`.
 * The browser half renders it as a right-edge pill; nothing here touches the
 * dsh-usage plugin.
 * @module dsh-token-alltime
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'token-total';
export const inject = ['webServer'];

const API_PREFIX = '/api/dsh-token-alltime';
/** How many used days the bar chart keeps. */
const CHART_DAYS = 15;

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
  ledgerBaselineDays: null,
  otherCostCny: 0,
};

/** Where the imported baseline lives; overridable so tests can point elsewhere. */
function dataFile() {
  return process.env.DSH_TOKEN_ALLTIME_DATA || fileURLToPath(new URL('./data.json', import.meta.url));
}

/**
 * Read the imported platform baseline; null when this install has imported
 * nothing yet (a fresh install must report zeros, not the local ledger).
 */
function readPlatform() {
  try {
    const file = dataFile();
    const doc = { ...EMPTY_PLATFORM, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    return doc.platformTotalTokens > 0 ? doc : null;
  } catch {
    return null;
  }
}

function home() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** Local calendar day, the key shape the usage ledger uses. */
function localDay() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** The token count one ledger model cell stands for. */
function cellTokens(v) {
  return (v.cacheReadTokens || 0) + (v.inputTokens || 0) + (v.outputTokens || 0) + (v.cacheWriteTokens || 0) + (v.reasoningTokens || 0);
}

/**
 * Fold the live DSH usage ledger into per-day buckets (each carrying its own
 * per-model split, so models can grow in real time); a missing file is not an
 * error. Ledger model names are used as the merge key because the platform
 * export names models without their provider prefix.
 */
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
  let tokens = 0;
  let calls = 0;
  let cost = 0;
  for (const [day, providers] of Object.entries(doc.days || {})) {
    let dayTokens = 0;
    let dayCalls = 0;
    let dayCost = 0;
    let dayHit = 0;
    let dayMiss = 0;
    const byModel = {};
    for (const [provider, byModelOfProvider] of Object.entries(providers || {})) {
      for (const [model, v] of Object.entries(byModelOfProvider || {})) {
        const h = v.cacheReadTokens || 0;
        const m = v.inputTokens || 0;
        const o = v.outputTokens || 0;
        const t = cellTokens(v);
        tokens += t;
        calls += v.calls || 0;
        cost += v.cost || 0;
        dayTokens += t;
        dayCalls += v.calls || 0;
        dayCost += v.cost || 0;
        dayHit += h;
        dayMiss += m;
        byModel[model] = (byModel[model] || 0) + t;
        const prev = models.get(model) || { model, tokens: 0, calls: 0, cost: 0 };
        prev.tokens += t;
        prev.calls += v.calls || 0;
        prev.cost += v.cost || 0;
        models.set(model, prev);
      }
    }
    days.push({ day, tokens: dayTokens, calls: dayCalls, cost: dayCost, hit: dayHit, miss: dayMiss, models: byModel });
  }
  days.sort((a, b) => (a.day < b.day ? -1 : 1));
  return {
    from: days[0]?.day ?? null,
    to: days[days.length - 1]?.day ?? null,
    tokens,
    calls,
    cost,
    days: days.slice(-180),
    models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
  };
}

/**
 * The ledger reading the platform export already accounts for, per day.
 * `ledgerBaselineDays` (written by build-data) is exact; older data.json files
 * only carry a scalar snapshot, so replay the ledger instead: every complete
 * day before the export day is final, and whatever is left of the snapshot
 * belongs to the export day, which the export captured mid-day.
 */
function baselineDays(platform, ledger) {
  if (platform.ledgerBaselineDays !== null && typeof platform.ledgerBaselineDays === 'object') {
    return platform.ledgerBaselineDays;
  }
  const exportDay = platform.platformRange[1];
  const out = {};
  let spent = 0;
  for (const bucket of ledger?.days ?? []) {
    if (exportDay !== null && bucket.day < exportDay) {
      out[bucket.day] = bucket.tokens;
      spent += bucket.tokens;
    }
  }
  if (exportDay !== null) out[exportDay] = Math.max(0, platform.ledgerBaselineTokens - spent);
  return out;
}

/** Everything a fresh install reports until it imports its own export. */
function zeroOverview() {
  return {
    updatedAt: Date.now(),
    total: 0,
    history: 0,
    calls: 0,
    costCny: 0,
    today: { day: null, tokens: 0, calls: 0, hitRate: null },
    sinceExport: 0,
    imported: false,
    range: [null, null],
    models: [],
    days: [],
    platform: { range: [null, null], tokens: 0, calls: 0, costCny: 0, days: [], models: [] },
    ledger: null,
    baseline: { tokens: 0, calls: 0, generatedAt: null },
  };
}

/**
 * Merge platform bill days with ledger growth into one day series: a day the
 * platform bill already covers keeps the platform number (it is the superset),
 * a later day is pure ledger growth, and the export day is the platform figure
 * plus the part of that day the export missed. Days are cut at local midnight.
 */
function mergeDays(platform, ledger, day, baseline) {
  const exportDay = platform.platformRange[1];
  const bills = new Map(platform.platformDays.map((d) => [d.d, d]));
  const buckets = new Map((ledger?.days ?? []).map((b) => [b.day, b]));
  const keys = new Set([...bills.keys(), ...buckets.keys(), day]);
  const rows = [];
  for (const d of [...keys].sort()) {
    const bucket = buckets.get(d);
    const known = Object.prototype.hasOwnProperty.call(baseline, d);
    let delta = 0;
    let deltaCalls = 0;
    let deltaCost = 0;
    const deltaModels = {};
    if (bucket !== undefined) {
      if (known) {
        // The export captured this day mid-way, so only what came after it
        // counts; calls, cost and the model split follow the same token share.
        const keep = Math.max(0, bucket.tokens - baseline[d]);
        const scale = bucket.tokens > 0 ? keep / bucket.tokens : 0;
        delta = keep;
        deltaCalls = Math.round(bucket.calls * scale);
        deltaCost = bucket.cost * scale;
        for (const [model, t] of Object.entries(bucket.models)) {
          const v = Math.round(t * scale);
          if (v > 0) deltaModels[model] = v;
        }
      } else if (exportDay === null || d > exportDay) {
        delta = bucket.tokens;
        deltaCalls = bucket.calls;
        deltaCost = bucket.cost;
        Object.assign(deltaModels, bucket.models);
      }
    }
    const bill = d <= day ? bills.get(d) : undefined;
    // Today counts once: when the import already covered part of it, the bill
    // figure is the part before that moment and the ledger delta is the rest;
    // otherwise the ledger alone is today.
    const once = d === day && !known;
    const add = (a, b) => (once ? Math.max(a, b) : a + b);
    rows.push({
      day: d,
      tokens: add(bill?.tok ?? 0, delta),
      calls: add(bill?.req ?? 0, deltaCalls),
      cost: add(bill?.cost ?? 0, deltaCost),
      delta,
      deltaModels,
    });
  }
  return rows;
}

/** Build the overview document the card renders. */
function overview() {
  const platform = readPlatform();
  if (platform === null) return zeroOverview();
  const ledger = readLedger();
  const day = localDay();
  const rows = mergeDays(platform, ledger, day, baselineDays(platform, ledger));

  let history = 0;
  let todayTokens = 0;
  let sinceExport = 0;
  let calls = 0;
  let costCny = 0;
  const byModel = new Map();
  for (const r of rows) {
    if (r.day < day) history += r.tokens;
    else if (r.day === day) todayTokens = r.tokens;
    if (r.day <= day) {
      calls += r.calls;
      costCny += r.cost;
    }
    sinceExport += r.delta;
    for (const [model, t] of Object.entries(r.deltaModels)) byModel.set(model, (byModel.get(model) || 0) + t);
  }
  const total = history + todayTokens;

  // Live per-model totals: the bill's model split plus ledger growth per model.
  const models = new Map();
  for (const m of platform.platformModels) models.set(m.model, m.tok);
  for (const [model, t] of byModel) models.set(model, (models.get(model) || 0) + t);
  const ranked = [...models.entries()]
    .filter(([, t]) => t > 0)
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
  const drift = total - ranked.reduce((a, m) => a + m.tokens, 0);
  if (drift !== 0 && ranked.length > 0) ranked[0].tokens += drift;

  const used = rows.filter((r) => r.tokens > 0);
  const live = ledger?.days.find((b) => b.day === day);
  // Today only: the all-time ratio would need every historical bucket, and the
  // day-to-day figure is what the pill is watched for anyway.
  const todayHit = live?.hit ?? 0;
  const todayMiss = live?.miss ?? 0;
  const prompt = todayHit + todayMiss;
  return {
    updatedAt: Date.now(),
    total,
    history,
    calls,
    costCny: Number(costCny.toFixed(2)),
    today: {
      day,
      tokens: todayTokens,
      calls: live?.calls ?? 0,
      hitRate: prompt > 0 ? todayHit / prompt : null,
    },
    sinceExport,
    imported: true,
    range: [rows[0]?.day ?? null, day],
    models: ranked,
    days: used.slice(-CHART_DAYS).map((r) => ({ day: r.day, tokens: r.tokens })),
    platform: {
      range: platform.platformRange,
      tokens: platform.platformTotalTokens,
      calls: platform.platformCalls,
      costCny: platform.platformTotalCostCny,
      days: platform.platformDays,
      models: platform.platformModels.map((m) => ({ model: m.model, tokens: m.tok, calls: m.req, cost: m.cost })),
    },
    ledger: {
      from: ledger?.from ?? null,
      to: ledger?.to ?? null,
      calls: ledger?.calls ?? 0,
      tokens: ledger?.tokens ?? 0,
    },
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
