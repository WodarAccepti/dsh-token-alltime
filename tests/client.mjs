/**
 * Client half: renders the bundle into a minimal DOM stub and walks the
 * collapsed / hovered / panel-open transitions, then feeds it the payloads and
 * environments that used to be able to throw. No browser, no DSH, no network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8');

/** Enough of the DOM to run the bundle: nodes, classes, listeners, shadow root. */
class El {
	constructor(tag) { this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this._cls = new Set(); this._text = ''; this._ls = {}; this.title = ''; }
	get className() { return [...this._cls].join(' '); }
	set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
	get classList() {
		const s = this._cls;
		return {
			add: (c) => s.add(c),
			remove: (c) => s.delete(c),
			contains: (c) => s.has(c),
			toggle: (c, on) => { const want = on === undefined ? !s.has(c) : Boolean(on); if (want) s.add(c); else s.delete(c); return want; },
		};
	}
	get textContent() { return this._text; }
	set textContent(v) { this._text = String(v); this.children = []; }
	get lastChild() { return this.children[this.children.length - 1] ?? null; }
	append(...kids) { for (const k of kids) { if (k && typeof k === 'object') this.children.push(k); else this._text += String(k); } }
	appendChild(kid) { this.append(kid); return kid; }
	addEventListener(type, fn) { (this._ls[type] ??= []).push(fn); }
	emit(type, event = {}) { const ev = { stopPropagation() {}, preventDefault() {}, key: '', target: this, ...event }; for (const fn of this._ls[type] ?? []) fn(ev); }
	getBoundingClientRect() { return { width: 58, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; }
	attachShadow() { this.shadow = new El('#shadow'); return this.shadow; }
	remove() { this.removed = true; }
	find(cls) { const out = []; const walk = (n) => { for (const kid of n.children) { if (kid._cls?.has(cls)) out.push(kid); walk(kid); } }; walk(this); return out; }
}

/** A fresh window/document pair, with or without a body to attach to. */
function makeEnv({ withBody = true } = {}) {
	const body = withBody ? new El('body') : null;
	const document = {
		body,
		getElementById: () => null,
		createElement: (tag) => new El(tag),
		_ls: {},
		addEventListener(type, fn) { (this._ls[type] ??= []).push(fn); },
		emit(type, event = {}) { for (const fn of this._ls[type] ?? []) fn({ key: '', stopPropagation() {}, ...event }); },
	};
	const window = { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load(spec) { this.spec = spec; } } };
	return { body, document, window };
}

/** Run the real bundle against one environment; returns what it mounted. */
function mount(env, fetchImpl) {
	new Function('window', 'document', 'fetch', bundle)(env.window, env.document, fetchImpl);
	const client = env.window.__ModuleLoader__.spec.factory(() => { throw new Error('client must not require modules'); });
	client.apply({ effect() {} });
	const shadow = env.body?.children[0]?.shadow ?? null;
	return {
		client,
		document: env.document,
		shadow,
		dock: shadow?.find('dock')[0],
		tab: shadow?.find('tab')[0],
		pill: shadow?.find('pill')[0],
		panel: shadow?.find('panel')[0],
	};
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const FIXTURE = {
	imported: true,
	total: 218513501,
	history: 202050621,
	calls: 2326,
	costCny: 20.61,
	range: ['2026-09-19', '2026-11-02'],
	today: { day: '2026-11-03', tokens: 16462880, hitRate: 0.6218 },
	ledger: { from: '2026-09-29', to: '2026-11-03' },
	models: [{ model: 'deepseek-flash', tokens: 216894234 }, { model: 'deepseek-v4-pro', tokens: 1619267 }],
	days: [{ day: '2026-10-20', tokens: 4200000 }, { day: '2026-11-03', tokens: 16462880 }],
	updatedAt: Date.now(),
};

// 1) The reveal state machine.
const main = mount(makeEnv(), async () => ({ ok: true, json: async () => FIXTURE }));
await wait(30);
assert.equal(main.dock.dataset.show, '0', 'the pill starts collapsed');
assert.equal(main.tab.textContent, '◀', 'the collapsed state is marked by an arrow');
assert.equal(main.shadow.find('cap')[0].textContent, 'TOKEN', 'the collapsed pill keeps the caption');
assert.equal(main.shadow.find('val')[0].textContent, '218.5m', 'the collapsed pill still paints the total');

main.dock.emit('pointerenter');
assert.equal(main.dock.dataset.show, '1', 'hovering reveals the pill');
main.dock.emit('pointerleave');
await wait(60);
assert.equal(main.dock.dataset.show, '1', 'a leaving pointer gets a grace period');
await wait(320);
assert.equal(main.dock.dataset.show, '0', 'the pill collapses once the pointer is gone');

main.dock.emit('pointerenter');
main.tab.emit('click');
assert.ok(main.panel.classList.contains('open'), 'the arrow opens the panel');
assert.equal(main.panel.style.right, '70px', 'the panel clears the pill by its measured width');
main.dock.emit('pointerleave');
await wait(400);
assert.equal(main.dock.dataset.show, '1', 'an open panel pins the pill out');
assert.ok(main.panel.classList.contains('open'), 'the panel survives a leaving pointer');

main.pill.emit('click');
await wait(60);
assert.ok(!main.panel.classList.contains('open'), 'a second click closes the panel');
assert.equal(main.dock.dataset.show, '0', 'closing it collapses the pill again');

main.pill.emit('click');
main.document.emit('keydown', { key: 'Escape' });
await wait(320);
assert.ok(!main.panel.classList.contains('open'), 'Escape closes the panel');
assert.equal(main.dock.dataset.show, '0', 'Escape settles the pill back to the arrow');

// 2) A payload with the optional blocks missing keeps painting the total: a
//    version skew must not blank the panel, let alone throw out of the shell.
const skew = { imported: true, total: 1234567, history: 1234567, calls: 3, costCny: 0.5, range: null, today: null, models: undefined, days: undefined };
const partial = mount(makeEnv(), async () => ({ ok: true, json: async () => skew }));
await wait(30);
assert.equal(partial.shadow.find('val')[0].textContent, '1.23m', 'a payload without models/days still paints the total');
partial.tab.emit('click');
assert.ok(partial.panel.classList.contains('open'), 'the panel opens on a thin payload');
assert.ok(partial.panel.find('big')[0], 'the panel still renders its headline number');

// 3) A failing host paints an error state instead of rejecting.
const failing = mount(makeEnv(), async () => { throw new Error('boom'); });
await wait(40);
assert.equal(failing.shadow.find('val')[0].textContent, '—', 'a failed fetch shows a dash');
assert.equal(failing.shadow.find('sub')[0].textContent, '读取失败', 'a failed fetch says so');

// 4) Mounting without a document body is a no-op, not a throw.
const bodyless = makeEnv({ withBody: false });
const headless = mount(bodyless, async () => ({ ok: true, json: async () => FIXTURE }));
assert.equal(headless.shadow, null, 'nothing is mounted without a body');

console.log('client test passed');
// The bundle keeps its own 5-minute poll timer alive; nothing else is pending.
process.exit(0);
