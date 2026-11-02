/**
 * dsh-token-alltime browser half: right-edge pill showing the all-time token total
 * (platform CSV history + live ledger served by this package's own host route),
 * expanding into a breakdown panel. Plain DOM in a shadow root: no bundler, no
 * React, and it cannot disturb the shell's reconciliation.
 */
window.__ModuleLoader__.load({
	id: "dsh-token-alltime",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

	const API = "api/dsh-token-alltime/overview";
	const POLL_MS = 60000;

	const fmt = (n) => {
		if (!Number.isFinite(n)) return "—";
		if (n >= 1e8) return (n / 1e8).toFixed(3) + " 亿";
		if (n >= 1e4) return (n / 1e4).toFixed(1) + " 万";
		return String(Math.round(n));
	};
	const num = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");

	const CSS = ":host { all: initial; }* { box-sizing: border-box; font-family: ui-sans-serif, Segoe UI, Microsoft YaHei, system-ui, sans-serif; }.pill { position: fixed; right: 0; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 9px 8px 9px 10px; border-radius: 12px 0 0 12px; background: rgba(24,26,32,0.88); color: #e9edf5; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); border-right: none; box-shadow: -2px 4px 16px rgba(0,0,0,0.28); backdrop-filter: blur(8px); user-select: none; z-index: 2147483000; }.pill:hover { background: rgba(38,41,50,0.94); }.pill .cap { font-size: 9px; letter-spacing: 0.08em; opacity: 0.55; }.pill .val { font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }.pill .sub { font-size: 9px; opacity: 0.5; font-variant-numeric: tabular-nums; }.panel { position: fixed; right: 12px; top: 50%; transform: translateY(-50%) scale(0.98); width: 330px; max-height: 76vh; overflow: auto; padding: 14px 16px; border-radius: 14px; background: rgba(20,22,27,0.96); color: #e9edf5; border: 1px solid rgba(255,255,255,0.1); box-shadow: -8px 12px 40px rgba(0,0,0,0.45); backdrop-filter: blur(10px); z-index: 2147483001; opacity: 0; pointer-events: none; transition: opacity 140ms, transform 140ms; font-size: 12px; line-height: 1.5; }.panel.open { opacity: 1; pointer-events: auto; transform: translateY(-50%) scale(1); }.panel h3 { margin: 0 0 2px; font-size: 12px; font-weight: 650; }.hint { font-size: 10px; opacity: 0.45; margin-bottom: 8px; }.big { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }.big small { font-size: 11px; font-weight: 500; opacity: 0.5; margin-left: 4px; }.row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; font-variant-numeric: tabular-nums; }.row .k { opacity: 0.62; }.row .v { font-weight: 550; }.sep { height: 1px; background: rgba(255,255,255,0.09); margin: 9px 0; }.bars { display: flex; align-items: flex-end; gap: 3px; height: 46px; margin: 6px 0 2px; }.bar { flex: 1; background: linear-gradient(180deg,#7aa2ff,#3f5fbf); border-radius: 2px 2px 0 0; min-height: 2px; opacity: 0.85; }.barlabel { display: flex; justify-content: space-between; font-size: 9px; opacity: 0.4; }.err { color: #ff9a9a; font-size: 10px; margin-top: 6px; }";

	function row(k, v) {
		const el = document.createElement("div");
		el.className = "row";
		const kk = document.createElement("span");
		kk.className = "k";
		kk.textContent = k;
		const vv = document.createElement("span");
		vv.className = "v";
		vv.textContent = v;
		el.append(kk, vv);
		return el;
	}

	function sep() {
		const s = document.createElement("div");
		s.className = "sep";
		return s;
	}

	function apply(ctx) {
		if (document.getElementById("dsh-token-alltime-root")) return;
		const host = document.createElement("div");
		host.id = "dsh-token-alltime-root";
		document.body.appendChild(host);
		const root = host.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = CSS;

		const pill = document.createElement("div");
		pill.className = "pill";
		pill.title = "总 token 用量（点击展开）";
		const cap = document.createElement("div");
		cap.className = "cap";
		cap.textContent = "Σ TOKEN";
		const val = document.createElement("div");
		val.className = "val";
		val.textContent = "…";
		const sub = document.createElement("div");
		sub.className = "sub";
		pill.append(cap, val, sub);

		const panel = document.createElement("div");
		panel.className = "panel";
		root.append(style, pill, panel);

		let doc = null;
		let error = null;
		let open = false;

		function paintPill() {
			if (!doc) {
				val.textContent = error ? "—" : "…";
				sub.textContent = error ? "读取失败" : "读取中";
				return;
			}
			if (!doc.imported) {
				val.textContent = "0";
				sub.textContent = "未导入";
				return;
			}
			val.textContent = fmt(doc.total);
			sub.textContent = num(doc.total) + " tok";
		}

		function paintPanel() {
			panel.textContent = "";
			const h = document.createElement("h3");
			h.textContent = "总 Token 用量";
			const hint = document.createElement("div");
			hint.className = "hint";
			panel.append(h, hint);

			if (!doc) {
				hint.textContent = "等待主机数据";
				const e = document.createElement("div");
				e.className = "err";
				e.textContent = error ? "主机接口读取失败：" + error : "读取中…";
				panel.append(e);
				return;
			}

			if (!doc.imported) {
				hint.textContent = "尚未导入账单 · 全新安装一律显示 0";
				const zero = document.createElement("div");
				zero.className = "big";
				zero.textContent = "0";
				zero.append(Object.assign(document.createElement("small"), { textContent: "tokens" }));
				const tip = document.createElement("div");
				tip.className = "err";
				tip.textContent = "本机还没有平台账单基线。去 platform.deepseek.com/usage 导出 CSV，运行 node tools/build-data.mjs <解压目录>，把生成的 lib/data.json 放进本插件 lib/ 目录并刷新页面。步骤见 README「导入 / 刷新平台历史」。";
				panel.append(zero, sep(), tip);
				return;
			}

			hint.textContent = doc.platform.range[0] + " 至今 · 平台历史 + 实时账本";

			const big = document.createElement("div");
			big.className = "big";
			big.textContent = num(doc.total);
			const small = document.createElement("small");
			small.textContent = "tokens";
			big.append(small);
			panel.append(big, sep());

			panel.append(row("平台历史（" + doc.platform.range[0] + "→" + doc.platform.range[1] + "）", num(doc.platform.tokens)));
			panel.append(row("　调用 / 花费", num(doc.platform.calls) + " 次 · ¥" + doc.platform.costCny));
			panel.append(row("此后新增（实时账本）", "+" + num(doc.sinceExport)));
			if (doc.ledger) panel.append(row("账本覆盖", (doc.ledger.from || "—") + " → " + (doc.ledger.to || "—")));
			panel.append(row("缓存命中率", doc.cacheHitRate == null ? "—" : (doc.cacheHitRate * 100).toFixed(2) + "%"));

			panel.append(sep());
			panel.append(row("按模型（平台导出）", ""));
			for (const m of doc.platform.models) panel.append(row("　" + m.model, fmt(m.tokens)));

			const byDay = new Map();
			for (const d of doc.platform.days) byDay.set(d.d, { day: d.d, tokens: d.tok });
			if (doc.ledger) for (const d of doc.ledger.days) if (!byDay.has(d.day)) byDay.set(d.day, { day: d.day, tokens: d.tokens });
			const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).slice(-30);
			if (days.length) {
				panel.append(sep());
				panel.append(row("按天（最近 " + days.length + " 个活跃日）", ""));
				const bars = document.createElement("div");
				bars.className = "bars";
				const max = Math.max.apply(null, days.map((d) => d.tokens).concat(1));
				for (const d of days) {
					const b = document.createElement("div");
					b.className = "bar";
					b.style.height = Math.max(2, Math.round((d.tokens / max) * 46)) + "px";
					b.title = d.day + " · " + num(d.tokens) + " tok";
					bars.append(b);
				}
				const labels = document.createElement("div");
				labels.className = "barlabel";
				labels.append(
					Object.assign(document.createElement("span"), { textContent: days[0].day.slice(5) }),
					Object.assign(document.createElement("span"), { textContent: days[days.length - 1].day.slice(5) }),
				);
				panel.append(bars, labels);
			}

			if (error) {
				const e = document.createElement("div");
				e.className = "err";
				e.textContent = "最近一次刷新失败：" + error;
				panel.append(e);
			}
		}

		function paint() {
			paintPill();
			if (open) paintPanel();
		}

		pill.addEventListener("click", (ev) => {
			ev.stopPropagation();
			open = !open;
			panel.classList.toggle("open", open);
			paint();
		});
		document.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape" && open) {
				open = false;
				panel.classList.remove("open");
			}
		});

		async function poll() {
			try {
				const res = await fetch(API, { signal: AbortSignal.timeout(15000) });
				if (!res.ok) throw new Error("HTTP " + res.status);
				doc = await res.json();
				error = null;
			} catch (e) {
				error = String((e && e.message) || e);
			}
			paint();
		}

		paint();
		poll();
		const timer = setInterval(poll, POLL_MS);
		if (typeof ctx?.effect === "function") {
			ctx.effect(() => () => {
				clearInterval(timer);
				host.remove();
			});
		}
	}

	exports.apply = apply;
	exports.inject = [];
	return module.exports;
}
});
