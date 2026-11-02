/**
 * Import DeepSeek platform usage CSV exports into lib/data.json.
 *
 * Usage:
 *   node tools/build-data.mjs <dir> [more dirs or csv files...]
 *
 * Accepts any mix of directories (searched recursively for *.csv) and explicit
 * CSV paths. The platform exports two files per window — amount-*.csv (token
 * buckets per day/model) and cost-*.csv (CNY per day/model) — and consecutive
 * windows overlap by one day, so rows are de-duplicated before aggregation.
 *
 * Model rows whose model name is empty are non-token charges (e.g. tool
 * searches); their cost is summed into otherCostCny and they never contribute
 * tokens.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'lib', 'data.json');

function collect(inputs) {
  const files = [];
  for (const input of inputs) {
    const stat = fs.statSync(input);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
        const full = path.join(input, entry.name);
        if (entry.isDirectory()) files.push(...collect([full]));
        else if (entry.name.endsWith('.csv')) files.push(full);
      }
    } else if (input.endsWith('.csv')) {
      files.push(input);
    }
  }
  return files;
}

function parseCsv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const head = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    if (cells.length !== head.length) throw new Error('malformed row in ' + file + ': ' + line);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
  });
}

export function importUsage(inputs) {
  const files = collect(inputs);
  if (files.length === 0) throw new Error('no csv files found in ' + inputs.join(', '));
  const amounts = new Map();
  const costs = new Map();
  for (const file of files) {
    const isAmount = path.basename(file).startsWith('amount');
    for (const row of parseCsv(file)) {
      if (isAmount) {
        amounts.set([row.start_time_iso, row.model, row.api_key, row.type, row.amount].join('|'), row);
      } else {
        costs.set([row.start_time_iso, row.model, row.name, row.wallet_type, row.cost].join('|'), row);
      }
    }
  }

  const dayModel = new Map();
  let otherCostCny = 0;
  for (const row of amounts.values()) {
    const day = row.start_time_iso.slice(0, 10);
    const tokenModel = row.model.startsWith('deepseek');
    if (!tokenModel) continue;
    const key = day + '|' + row.model;
    const acc = dayModel.get(key) || { day, model: row.model, hit: 0, miss: 0, out: 0, req: 0, cost: 0 };
    if (row.type === 'input_cache_hit_tokens') acc.hit += Number(row.amount);
    else if (row.type === 'input_cache_miss_tokens') acc.miss += Number(row.amount);
    else if (row.type === 'output_tokens') acc.out += Number(row.amount);
    else if (row.type === 'request_count') acc.req += Number(row.amount);
    dayModel.set(key, acc);
  }
  for (const row of costs.values()) {
    const day = row.start_time_iso.slice(0, 10);
    if (!row.model.startsWith('deepseek')) { otherCostCny += Number(row.cost); continue; }
    const key = day + '|' + row.model;
    const acc = dayModel.get(key);
    if (acc !== undefined) acc.cost += Number(row.cost);
  }

  const rows = [...dayModel.values()].map((r) => ({ ...r, tok: r.hit + r.miss + r.out }));
  const byDay = new Map();
  const byModel = new Map();
  for (const r of rows) {
    const d = byDay.get(r.day) || { d: r.day, req: 0, hit: 0, miss: 0, out: 0, tok: 0, cost: 0 };
    d.req += r.req; d.hit += r.hit; d.miss += r.miss; d.out += r.out; d.tok += r.tok; d.cost += r.cost;
    byDay.set(r.day, d);
    const m = byModel.get(r.model) || { model: r.model, hit: 0, miss: 0, out: 0, tok: 0, req: 0, cost: 0 };
    m.hit += r.hit; m.miss += r.miss; m.out += r.out; m.tok += r.tok; m.req += r.req; m.cost += r.cost;
    byModel.set(r.model, m);
  }
  const days = [...byDay.values()].sort((a, b) => (a.d < b.d ? -1 : 1)).map((d) => ({ ...d, cost: Number(d.cost.toFixed(4)) }));

  const ledgerFile = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-usage', 'usage-ledger.json');
  let ledgerBaselineTokens = 0;
  let ledgerBaselineCalls = 0;
  try {
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    for (const providers of Object.values(ledger.days || {})) {
      for (const models of Object.values(providers)) {
        for (const v of Object.values(models)) {
          ledgerBaselineTokens += (v.inputTokens || 0) + (v.cacheReadTokens || 0) + (v.cacheWriteTokens || 0) + (v.outputTokens || 0) + (v.reasoningTokens || 0);
          ledgerBaselineCalls += v.calls || 0;
        }
      }
    }
  } catch {
    console.warn('warning: no usage ledger at ' + ledgerFile + '; baseline recorded as 0');
  }

  return {
    generatedAt: new Date().toISOString(),
    platformRange: [days[0]?.d ?? null, days[days.length - 1]?.d ?? null],
    platformTotalTokens: days.reduce((a, d) => a + d.tok, 0),
    platformTotalCostCny: Number(days.reduce((a, d) => a + d.cost, 0).toFixed(2)),
    platformCalls: days.reduce((a, d) => a + d.req, 0),
    platformDays: days,
    platformModels: [...byModel.values()].map((m) => ({ ...m, cost: Number(m.cost.toFixed(2)) })),
    ledgerBaselineTokens,
    ledgerBaselineCalls,
    otherCostCny: Number(otherCostCny.toFixed(4)),
  };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error('usage: node tools/build-data.mjs <dir-or-csv> [...]');
    process.exit(2);
  }
  const data = importUsage(inputs);
  fs.writeFileSync(OUT, JSON.stringify(data, null, 1) + '\n');
  console.log('wrote ' + OUT);
  console.log('  range   ' + data.platformRange.join(' -> '));
  console.log('  tokens  ' + data.platformTotalTokens.toLocaleString('en-US') + ' (' + data.platformDays.length + ' active days)');
  console.log('  calls   ' + data.platformCalls.toLocaleString('en-US'));
  console.log('  cost    CNY ' + data.platformTotalCostCny + (data.otherCostCny > 0 ? ' + ' + data.otherCostCny + ' other' : ''));
  console.log('  baseline ' + data.ledgerBaselineTokens.toLocaleString('en-US') + ' ledger tokens at import time');
}
