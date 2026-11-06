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
	const POLL_MS = 300000;
	// Opening the panel re-fetches when the cached document is older than this.
	const OPEN_REFRESH_MS = 30000;
	// An open panel closes itself once the pointer has been away from it and from
	// the dock for this long: a details card should not outlive the interest in it.
	const AUTO_CLOSE_MS = 1000;

	// Coarse units, matching the thousands grouping: 206.5m reads the same as 206,537,935.
	const fmt = (n) => {
		if (!Number.isFinite(n)) return "—";
		if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "m";
		if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
		return String(Math.round(n));
	};
	const num = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");

	const CSS = ":host { all: initial; }* { box-sizing: border-box; font-family: ui-sans-serif, Segoe UI, Microsoft YaHei, system-ui, sans-serif; }.dock { position: fixed; right: 0; top: 50%; width: 0; height: 0; z-index: 2147483000; }.tab { position: absolute; right: 0; top: 0; transform: translateY(-50%); display: flex; align-items: center; justify-content: center; width: 13px; height: 46px; border-radius: 9px 0 0 9px; background: rgba(24,26,32,0.86); color: #8e99ab; border: 1px solid rgba(255,255,255,0.1); border-right: none; box-shadow: -2px 2px 12px rgba(0,0,0,0.24); backdrop-filter: blur(8px); cursor: pointer; font-size: 9px; line-height: 1; user-select: none; transition: opacity 150ms ease, color 150ms ease, background 150ms ease; }.tab:hover { color: #e9edf5; background: rgba(38,41,50,0.94); }.dock[data-show='1'] .tab { opacity: 0; }.pill { position: absolute; right: 0; top: 0; transform: translate(100%, -50%); opacity: 0; pointer-events: none; display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 9px 8px 9px 10px; border-radius: 12px 0 0 12px; background: rgba(24,26,32,0.88); color: #e9edf5; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); border-right: none; box-shadow: -2px 4px 16px rgba(0,0,0,0.28); backdrop-filter: blur(8px); user-select: none; transition: transform 170ms ease, opacity 170ms ease; }.dock[data-show='1'] .pill { transform: translate(0, -50%); opacity: 1; pointer-events: auto; }.pill:hover { background: rgba(38,41,50,0.94); }.pill .cap { font-size: 9px; letter-spacing: 0.08em; opacity: 0.55; }.pill .val { font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }.pill .sub { font-size: 9px; opacity: 0.5; font-variant-numeric: tabular-nums; }.panel { position: fixed; right: 12px; top: 50%; transform: translateY(-50%) scale(0.98); width: 330px; max-height: 76vh; overflow: auto; padding: 14px 16px; border-radius: 14px; background: rgba(20,22,27,0.96); color: #e9edf5; border: 1px solid rgba(255,255,255,0.1); box-shadow: -8px 12px 40px rgba(0,0,0,0.45); backdrop-filter: blur(10px); z-index: 2147483001; opacity: 0; pointer-events: none; transition: opacity 140ms, transform 140ms; font-size: 12px; line-height: 1.5; }.panel.open { opacity: 1; pointer-events: auto; transform: translateY(-50%) scale(1); }.panel h3 { margin: 0 0 2px; font-size: 12px; font-weight: 650; }.hint { font-size: 10px; opacity: 0.45; margin-bottom: 8px; }.big { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }.big small { font-size: 11px; font-weight: 500; opacity: 0.5; margin-left: 4px; }.row { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; font-variant-numeric: tabular-nums; }.row .k { opacity: 0.62; }.row .k.ind { padding-left: 1em; }.row .v { font-weight: 550; }.sep { height: 1px; background: rgba(255,255,255,0.09); margin: 9px 0; }.bars { display: flex; align-items: flex-end; gap: 3px; height: 46px; margin: 6px 0 2px; }.bar { flex: 1; background: linear-gradient(180deg,#7aa2ff,#3f5fbf); border-radius: 2px 2px 0 0; min-height: 2px; opacity: 0.85; }.barlabel { display: flex; justify-content: space-between; font-size: 9px; opacity: 0.4; }.err { color: #ff9a9a; font-size: 10px; margin-top: 6px; }";

	function row(k, v, ind) {
		const el = document.createElement("div");
		el.className = "row";
		const kk = document.createElement("span");
		kk.className = ind ? "k ind" : "k";
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

	/**
	 * Mount, or fail quietly: this runs inside the shell's own boot path, so an
	 * exception escaping apply would break the whole web UI, not just the pill.
	 */
	function apply(ctx) {
		try {
			mount(ctx);
		} catch (error) {
			console.warn("[dsh-token-alltime] mount failed:", error);
		}
	}

	function mount(ctx) {
		if (!document.body || document.getElementById("dsh-token-alltime-root")) return;
		const host = document.createElement("div");
		host.id = "dsh-token-alltime-root";
		document.body.appendChild(host);
		const root = host.attachShadow({ mode: "open" });
		const style = document.createElement("style");
		style.textContent = CSS;

		// Zero-size anchor on the right edge: the arrow tab rests here, the pill
		// slides out of the edge from behind it.
		const dock = document.createElement("div");
		dock.className = "dock";
		dock.dataset.show = "0";

		const tab = document.createElement("div");
		tab.className = "tab";
		tab.textContent = "◀";
		tab.title = "总 token 用量（悬停展开）";

		const pill = document.createElement("div");
		pill.className = "pill";
		pill.title = "总 token 用量（点击展开 / 收起）";
		const cap = document.createElement("div");
		cap.className = "cap";
		cap.textContent = "TOKEN";
		const val = document.createElement("div");
		val.className = "val";
		val.textContent = "…";
		const sub = document.createElement("div");
		sub.className = "sub";
		pill.append(cap, val, sub);
		dock.append(pill, tab);

		const panel = document.createElement("div");
		panel.className = "panel";
		root.append(style, dock, panel);

		// Keep the panel clear of the pill: measure it instead of guessing a width.
		function placePanel() {
			const w = pill.getBoundingClientRect().width;
			if (w > 0) panel.style.right = Math.round(w + 12) + "px";
		}
		function onResize() {
			if (open) placePanel();
		}
		window.addEventListener("resize", onResize);

		let doc = null;
		let error = null;
		let open = false;
		// Collapsed by default: only the edge arrow is visible. The pill stays out
		// while the pointer is inside the dock or while the panel is open.
		let hovered = false;
		// Pointer inside the open panel: it holds both the panel and the pill.
		let overPanel = false;
		let collapseTimer = 0;
		let closeTimer = 0;

		function showPill(on) {
			dock.dataset.show = on ? "1" : "0";
		}

		function settle() {
			clearTimeout(collapseTimer);
			if (!hovered && !open) showPill(false);
		}

		/** Close the panel exactly the way a second click does, whoever asked. */
		function closePanel() {
			clearTimeout(closeTimer);
			overPanel = false;
			if (!open) return;
			open = false;
			panel.classList.remove("open");
			settle();
		}

		/** Arm the "pointer left the panel" timeout; entering either surfaces cancels it. */
		function armAutoClose() {
			clearTimeout(closeTimer);
			if (!open || hovered || overPanel) return;
			closeTimer = setTimeout(closePanel, AUTO_CLOSE_MS);
		}

		dock.addEventListener("pointerenter", () => {
			hovered = true;
			clearTimeout(collapseTimer);
			clearTimeout(closeTimer);
			showPill(true);
		});
		dock.addEventListener("pointerleave", () => {
			hovered = false;
			clearTimeout(collapseTimer);
			if (open) return armAutoClose();
			collapseTimer = setTimeout(settle, 240);
		});
		panel.addEventListener("pointerenter", () => {
			overPanel = true;
			clearTimeout(closeTimer);
		});
		panel.addEventListener("pointerleave", () => {
			overPanel = false;
			armAutoClose();
		});

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

			hint.textContent = ((doc.range && doc.range[0]) || "—") + " 起 · 历史（至昨日）+ 今日使用";

			const big = document.createElement("div");
			big.className = "big";
			big.textContent = num(doc.total);
			const small = document.createElement("small");
			small.textContent = "tokens";
			big.append(small);
			panel.append(big, sep());

			panel.append(row("历史（至昨日）", num(doc.history)));
			panel.append(row("调用 / 花费", num(doc.calls) + " 次 · ¥" + Number(doc.costCny || 0).toFixed(2)));
			panel.append(row("今日使用", num(doc.today ? doc.today.tokens : 0)));
			const rate = doc.today ? doc.today.hitRate : null;
			panel.append(row("今日缓存命中率", rate == null ? "—" : (rate * 100).toFixed(2) + "%"));
			if (doc.ledger) panel.append(row("账本", (doc.ledger.from || "—") + " → " + (doc.ledger.to || "—")));

			panel.append(sep());
			panel.append(row("按模型", ""));
			for (const m of doc.models || []) {
				const line = row(m.model, fmt(m.tokens), true);
				line.lastChild.title = num(m.tokens) + " tokens";
				panel.append(line);
			}

			const days = doc.days || [];
			if (days.length) {
				panel.append(sep());
				panel.append(row("按天（最近 " + days.length + " 个使用日）", ""));
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
				// Right edge: today when it has usage, otherwise the newest used day.
				const todayDay = doc.today && doc.today.tokens > 0 ? doc.today.day : null;
				const right = days.some((d) => d.day === todayDay) ? todayDay : days[days.length - 1].day;
				labels.append(
					Object.assign(document.createElement("span"), { textContent: days[0].day.slice(5) }),
					Object.assign(document.createElement("span"), { textContent: right.slice(5) }),
				);
				panel.append(bars, labels);
			}

			if (doc.updatedAt) {
				const stamp = new Date(doc.updatedAt);
				const foot = document.createElement("div");
				foot.className = "hint";
				foot.style.margin = "10px 0 0";
				const hh = String(stamp.getHours()).padStart(2, "0");
				const mm = String(stamp.getMinutes()).padStart(2, "0");
				foot.textContent = "更新于 " + hh + ":" + mm + " · 每 5 分钟自动刷新 · 移开 1 秒自动收起";
				panel.append(foot);
			}

			if (error) {
				const e = document.createElement("div");
				e.className = "err";
				e.textContent = "最近一次刷新失败：" + error;
				panel.append(e);
			}
		}

		function paint() {
			// A malformed or half-updated payload keeps the last good paint instead
			// of throwing out of a timer callback.
			try {
				paintPill();
				if (open) paintPanel();
			} catch (error) {
				console.warn("[dsh-token-alltime] paint failed:", error);
			}
		}

		function toggle(ev) {
			ev.stopPropagation();
			if (open) {
				closePanel();
			} else {
				open = true;
				clearTimeout(closeTimer);
				showPill(true);
				placePanel();
				if (!doc || Date.now() - (doc.updatedAt || 0) > OPEN_REFRESH_MS) poll();
				panel.classList.add("open");
			}
			paint();
		}
		pill.addEventListener("click", toggle);
		tab.addEventListener("click", toggle);
		document.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape") closePanel();
		});

		async function poll() {
			try {
				const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
				const res = await fetch(API, signal ? { signal } : undefined);
				if (!res.ok) throw new Error("HTTP " + res.status);
				const next = await res.json();
				if (!next || typeof next !== "object") throw new Error("主机返回的不是对象");
				doc = next;
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
				clearTimeout(collapseTimer);
				clearTimeout(closeTimer);
				clearInterval(timer);
				window.removeEventListener("resize", onResize);
				host.remove();
			});
		}
	}

	exports.apply = apply;
	exports.inject = [];
	return module.exports;
}
});
