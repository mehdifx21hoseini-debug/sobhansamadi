/* ═══ داشبورد سشن‌های جهانی ═════════════════════════════════════════
   لایه‌ی نمایش. تمام محاسبات از MarketSessions می‌آید (lib/sessions.js)
   و اینجا هیچ ریاضیِ منطقه‌ی زمانی دوباره نوشته نشده. */
(function () {
	"use strict";

	var S = MarketSessions;
	var VIEW_ZONE = "Asia/Tehran";

	/* پنجره‌ی دید: از ۲۴ ساعت پیش تا ۲۴ ساعت بعد نیست - آن‌قدر پهن است
	   که همه‌چیز ریز شود. پنجره حولِ «اکنون» می‌چرخد و همیشه یک روزِ
	   معاملاتی را نشان می‌دهد: ۴ ساعت گذشته، ۲۰ ساعت پیش رو. */
	var BACK_H = 4, FWD_H = 20;

	function pad(n) { return (n < 10 ? "0" : "") + n; }
	var FA_D = "۰۱۲۳۴۵۶۷۸۹";
	function fa(s) { return String(s).replace(/[0-9]/g, function (d) { return FA_D[d]; }); }

	function el(tag, cls, txt) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (txt != null) n.textContent = txt;
		return n;
	}

	/* ── نقشه‌ی نقطه‌ای ────────────────────────────────────────────────
	   خشکی به‌صورت مستطیل‌های درشتِ lat/lon تعریف شده و نقطه‌ها از رویش
	   ساخته می‌شوند. عمداً تقریبی است: این یک لایه‌ی فضاست، نه اطلس، و
	   در این اندازه دقتِ بیشتر دیده هم نمی‌شود. */
	var LAND = [
		[[15, 72], [-168, -52]], [[50, 72], [-100, -20]], [[25, 50], [-125, -66]],
		[[8, 25], [-112, -77]], [[-56, 12], [-82, -34]], [[36, 71], [-10, 40]],
		[[55, 71], [20, 180]], [[-35, 37], [-18, 52]], [[10, 55], [40, 100]],
		[[5, 55], [95, 145]], [[-10, 8], [95, 141]], [[-44, -10], [113, 154]],
		[[-47, -34], [166, 179]], [[60, 84], [-58, -15]], [[30, 46], [128, 146]],
	];
	function isLand(lat, lon) {
		for (var i = 0; i < LAND.length; i++) {
			var b = LAND[i];
			if (lat >= b[0][0] && lat <= b[0][1] && lon >= b[1][0] && lon <= b[1][1]) return true;
		}
		return false;
	}
	function buildMap(svg, w, h) {
		var ns = "http://www.w3.org/2000/svg";
		svg.setAttribute("viewBox", "0 0 " + w + " " + h);
		svg.setAttribute("preserveAspectRatio", "none");
		while (svg.firstChild) svg.removeChild(svg.firstChild);
		var cols = 84, rows = 34;
		for (var r = 0; r < rows; r++) {
			for (var c = 0; c < cols; c++) {
				var lon = -180 + (c + .5) / cols * 360;
				var lat = 84 - (r + .5) / rows * 150;
				if (!isLand(lat, lon)) continue;
				var dot = document.createElementNS(ns, "circle");
				dot.setAttribute("cx", ((c + .5) / cols * w).toFixed(1));
				dot.setAttribute("cy", ((r + .5) / rows * h).toFixed(1));
				dot.setAttribute("r", "1.1");
				svg.appendChild(dot);
			}
		}
	}

	/* ── پرچم‌ها ─────────────────────────────────────────────────────
	   ایموجی نه: روی ویندوز اصلاً رندر نمی‌شود و تلگرام دسکتاپ به‌جایش
	   دو حرف نشان می‌دهد. اینها SVG سبک‌اند. */
	var FLAGS = {
		au: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#00247d"/><path d="M0 0h30v20H0z" fill="#00247d"/><path d="M0 0l30 20M30 0L0 20" stroke="#fff" stroke-width="4"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="6"/><path d="M15 0v20M0 10h30" stroke="#c8102e" stroke-width="3"/><circle cx="44" cy="26" r="3" fill="#fff"/></svg>',
		jp: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#fff"/><circle cx="30" cy="20" r="11" fill="#bc002d"/></svg>',
		gb: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#012169"/><path d="M0 0l60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0l60 40M60 0L0 40" stroke="#c8102e" stroke-width="4"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="13"/><path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7"/></svg>',
		us: '<svg viewBox="0 0 60 40"><rect width="60" height="40" fill="#b22234"/><path d="M0 5h60M0 14h60M0 23h60M0 32h60" stroke="#fff" stroke-width="4"/><rect width="26" height="22" fill="#3c3b6e"/></svg>'
	};
	function flag(code) {
		var n = el("span", "fl");
		n.innerHTML = FLAGS[code] || "";
		return n;
	}

	/* ── پنجره‌ی زمان ────────────────────────────────────────────────── */
	function windowOf(now) {
		var t = now.getTime();
		return { from: t - BACK_H * 3600000, to: t + FWD_H * 3600000 };
	}
	function pct(t, win) {
		return ((t - win.from) / (win.to - win.from)) * 100;
	}
	function clampSpan(a, b, win) {
		var s = Math.max(a, win.from), e = Math.min(b, win.to);
		if (e <= s) return null;
		return { l: pct(s, win), w: pct(e, win) - pct(s, win), cutStart: a < win.from, cutEnd: b > win.to };
	}

	function hhmm(t) { return S.hhmmInZone(t, VIEW_ZONE); }

	function countdown(target, nowMs) {
		var s = Math.max(0, Math.floor((target - nowMs) / 1000));
		var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
		return pad(h) + ":" + pad(m) + ":" + pad(sec);
	}

	/* ── داده‌ی نمونه ────────────────────────────────────────────────
	   شکلش دقیقاً همان چیزی است که /econ/miniapp می‌دهد: هر فیلد اینجا
	   در پاسخِ واقعیِ سرور هم هست. */
	var HOLIDAY = null; // {date, name} - وقتی تعطیلی باشد
	function sampleEvents(now) {
		var d = new Date(now);
		function at(h, m) {
			return S.instantAt(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, m, VIEW_ZONE);
		}
		return [
			{ at: at(12, 45), currency: "EUR", importance: "medium", title: "نرخ بهره بانک مرکزی اروپا", en: "ECB Interest Rate Decision", forecast: "4.25%", previous: "4.25%", actual: "4.25%", read: null },
			{ at: at(16, 0), currency: "USD", importance: "high", title: "شاخص قیمت مصرف‌کننده", en: "CPI YoY", forecast: "3.1%", previous: "3.2%", actual: "3.4%", read: { good: false } },
			{ at: at(17, 30), currency: "USD", importance: "high", title: "اشتغال غیرکشاورزی", en: "Non-Farm Payrolls", forecast: "185K", previous: "206K", actual: "227K", read: { good: true } },
			{ at: at(19, 0), currency: "USD", importance: "medium", title: "مدعیان بیمه بیکاری", en: "Initial Jobless Claims", forecast: "230K", previous: "228K", actual: "", read: null },
			{ at: at(21, 30), currency: "USD", importance: "low", title: "موجودی نفت خام", en: "Crude Oil Inventories", forecast: "-1.2M", previous: "0.8M", actual: "", read: null }
		].filter(Boolean);
		// عددِ واقعی فقط برای رویدادی که گذشته - وگرنه صفحه چیزی نشان
		// می‌دهد که هنوز اتفاق نیفتاده و کلِ منطقِ «منتشر نشده» دروغ
		// می‌شود.
	}

	/* ── رندر ────────────────────────────────────────────────────────── */
	var refs = {};

	function renderRuler(node, win) {
		node.innerHTML = "";
		var start = new Date(win.from);
		var firstTick = Math.ceil(win.from / 3600000) * 3600000;
		for (var t = firstTick; t <= win.to; t += 3600000) {
			var h = +S.hhmmInZone(t, VIEW_ZONE).slice(0, 2);
			if (h % 3 !== 0) continue;
			var x = pct(t, win);
			var line = el("i"); line.style.insetInlineStart = x + "%";
			node.appendChild(line);
			var lab = el("span", null, fa(pad(h)));
			lab.style.insetInlineStart = x + "%";
			node.appendChild(lab);
		}
	}

	function renderTracks(labelNode, node, now, win) {
		labelNode.innerHTML = "";
		node.innerHTML = "";
		var t = now.getTime();
		S.SESSIONS.forEach(function (s) {
			var tr = el("div", "track");
			tr.appendChild(el("div", "rail"));

			var occ = S.occurrences(s, now, -2, 3);
			var live = false;
			occ.forEach(function (o) {
				var sp = clampSpan(o.open, o.close, win);
				if (!sp) return;
				var isLive = t >= o.open && t < o.close;
				if (isLive) live = true;
				var seg = el("div", "seg" + (isLive ? " live" : "") + (s.key === "nyse" ? " nyse" : ""));
				seg.style.insetInlineStart = sp.l + "%";
				seg.style.width = sp.w + "%";
				// بازه فقط وقتی نوشته می‌شود که واقعاً جا باشد؛ متنِ بریده
				// از نبودنش بدتر است. bdi هم لازم است: بدونِ آن موتورِ
				// دوجهته «۰۰:۳۰ – ۰۹:۳۰» را وارونه نشان می‌دهد.
				// نوشتنِ بازه روی قطعه‌ای که لبه‌ی پنجره بریده‌اش، متنِ
				// نصفه می‌دهد - «۰:۳۰ – ۱۹:۳۰» که غلط خوانده می‌شود.
				if (s.key !== "nyse" && sp.w > 13 && !sp.cutStart && !sp.cutEnd) {
					var bd = document.createElement("bdi");
					bd.textContent = hhmm(o.open) + " – " + hhmm(o.close);
					seg.appendChild(bd);
				}
				tr.appendChild(seg);
			});
			node.appendChild(tr);

			var lab = el("div", "lab" + (live ? " live" : ""));
			lab.appendChild(flag(s.flag));
			lab.appendChild(el("span", null, s.sub || s.name));
			labelNode.appendChild(lab);
		});
	}

	function renderEventLane(node, events, win) {
		node.innerHTML = "";
		// برچسب‌ها به‌ترتیب زمان چیده می‌شوند و هر کدام دستِ‌کم ۹ درصدِ
		// عرض از قبلی فاصله می‌گیرد. بدون این، ۱۶:۰۰ و ۱۷:۳۰ روی موبایل
		// روی هم می‌افتادند و هر دو ناخوانا می‌شدند.
		var lastLabel = -100;
		events.slice().sort(function (a, b) { return a.at - b.at; }).forEach(function (e) {
			if (e.at < win.from || e.at > win.to) return;
			var x = pct(e.at, win);
			var dot = el("div", "evdot " + e.importance);
			dot.style.insetInlineStart = x + "%";
			dot.title = e.title + " — " + hhmm(e.at);
			node.appendChild(dot);
			if (e.importance === "high" && Math.abs(x - lastLabel) > 9) {
				var lab = el("span", "lbl", hhmm(e.at));
				lab.style.insetInlineStart = x + "%";
				node.appendChild(lab);
				lastLabel = x;
			}
		});
	}

	function renderSessions(node, now) {
		node.innerHTML = "";
		var t = now.getTime();
		S.SESSIONS.forEach(function (s) {
			var st = S.sessionState(s, now);
			var row = el("div", "srow");
			row.appendChild(flag(s.flag));

			var nm = el("div", "sname");
			nm.appendChild(el("span", "n", s.name));
			if (s.sub) { var sb = el("span", "sub"); sb.innerHTML = "<bdi>" + s.sub + "</bdi>"; nm.appendChild(sb); }
			row.appendChild(nm);

			var b = el("span", "badge" + (st.open ? " on" : ""));
			var led = el("span", "led " + (st.open ? "on" : "off"));
			led.style.width = "6px"; led.style.height = "6px";
			b.appendChild(led);
			b.appendChild(el("span", null, st.open ? "باز" : "بسته"));
			var times = el("div", "stimes");
			times.appendChild(b);
			row.appendChild(times);

			var cd = el("div", "scount");
			if (st.open) {
				cd.appendChild(el("div", "v mono", countdown(st.until, t)));
				cd.appendChild(el("div", "k", "تا بسته‌شدن"));
			} else if (st.nextOpen) {
				cd.appendChild(el("div", "v mono", countdown(st.nextOpen, t)));
				cd.appendChild(el("div", "k", "تا باز شدن"));
			} else {
				cd.appendChild(el("div", "v mono", "—"));
				cd.appendChild(el("div", "k", "آخر هفته"));
			}
			row.appendChild(cd);
			node.appendChild(row);
		});
	}

	function renderStatus(now) {
		var t = now.getTime();
		var ms = S.marketState(now);

		refs.led.className = "led " + (ms.onBreak ? "brk" : ms.open ? "on" : "off");
		refs.stateText.textContent = ms.onBreak ? "بازار جهانی — وقفه‌ی روزانه"
			: ms.open ? "بازار جهانی باز است" : "بازار جهانی بسته است";

		// «بعدی» همیشه نزدیک‌ترین رویدادِ سشن است، باز شدن باشد یا بسته شدن.
		var best = null;
		S.SESSIONS.forEach(function (s) {
			if (s.key === "nyse") return;
			var st = S.sessionState(s, now);
			var when = st.open ? st.until : st.nextOpen;
			var what = st.open ? "بسته می‌شود" : "باز می‌شود";
			if (when && (!best || when < best.when)) best = { when: when, what: what, name: s.name };
		});
		if (best) {
			refs.nextUp.innerHTML = "";
			refs.nextUp.appendChild(document.createTextNode(best.name + " " + best.what + " — "));
			var c = el("b", "mono", countdown(best.when, t));
			refs.nextUp.appendChild(c);
		}

		refs.clockT.textContent = fa(hhmm(t) + ":" + pad(new Date(t).getSeconds()));
	}

	function renderEvents(node, events, now) {
		node.innerHTML = "";
		events.forEach(function (e) {
			var row = el("div", "ev");
			row.appendChild(el("div", "imp " + e.importance));

			var w = el("div", "when");
			w.appendChild(el("div", "t mono", fa(hhmm(e.at))));
			var ses = sessionAt(e.at, now);
			w.appendChild(el("div", "c", ses || "—"));
			row.appendChild(w);

			var b = el("div", "body");
			b.appendChild(el("div", "ttl", e.title));
			var en = el("div", "en"); en.innerHTML = "<bdi>" + e.en + "</bdi>";
			b.appendChild(en);
			var fig = el("div", "fig");
			fig.innerHTML = "<span>پیش‌بینی <b class='mono'>" + fa(e.forecast || "—") +
				"</b></span><span>قبلی <b class='mono'>" + fa(e.previous || "—") + "</b></span>";
			b.appendChild(fig);
			row.appendChild(b);

			var out = el("div", "out");
			if (e.actual) {
				var cls = e.read ? (e.read.good ? "up" : "dn") : "";
				out.appendChild(el("div", "v mono " + cls, fa(e.actual)));
				out.appendChild(el("div", "s", "واقعی"));
			} else {
				out.appendChild(el("div", "v pend mono", "—"));
				out.appendChild(el("div", "s", "منتشر نشده"));
			}
			row.appendChild(out);
			node.appendChild(row);
		});
	}

	/* کدام سشن در لحظه‌ی این خبر باز است - همان اتصالی که خبر را به
	   تایم‌لاین وصل می‌کند. */
	function sessionAt(instant, now) {
		var names = [];
		S.SESSIONS.forEach(function (s) {
			if (s.key === "nyse") return;
			S.occurrences(s, now, -2, 3).forEach(function (o) {
				if (instant >= o.open && instant < o.close && names.indexOf(s.name) < 0) names.push(s.name);
			});
		});
		if (names.length === 0) return "بین سشن‌ها";
		if (names.length > 1) return names.join("+");
		return names[0];
	}

	/* ── حلقه‌ی زنده ─────────────────────────────────────────────────── */
	var events = null;

	function paint() {
		var now = PREVIEW_NOW ? new Date(PREVIEW_NOW) : new Date();
		var win = windowOf(now);
		if (!events) events = sampleEvents(now);

		renderStatus(now);
		renderRuler(refs.ruler, win);
		renderTracks(refs.labs, refs.tracks, now, win);
		renderEventLane(refs.evlane, events, win);
		renderSessions(refs.sessions, now);
		renderEvents(refs.events, events, now);
		refs.evCount.textContent = fa(events.length) + " رویداد";

		refs.now.style.insetInlineStart = pct(now.getTime(), win) + "%";
	}

	// در پیش‌نمایش، زمان ثابت است تا اسکرین‌شات‌ها قابل مقایسه باشند.
	var PREVIEW_NOW = window.PREVIEW_NOW || null;

	document.addEventListener("DOMContentLoaded", function () {
		["led", "stateText", "nextUp", "clockT", "ruler", "tracks", "labs", "evlane",
			"sessions", "events", "evCount", "now"].forEach(function (k) {
				refs[k] = document.getElementById(k);
			});

		var svg = document.getElementById("map");
		buildMap(svg, 800, 300);

		paint();
		if (!PREVIEW_NOW) setInterval(paint, 1000);
	});
})();
