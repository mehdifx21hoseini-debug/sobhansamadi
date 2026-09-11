(function () {
	"use strict";

	// ═══════════════════════════════════════════════════════════════
	// «رصد»
	//
	// سه مقصد، نه سه تب: اکنون / تقویم / تنظیمات.
	//
	// «اکنون» جوابِ یک نگاه است - ساعت، وضعیتِ بازار، کدام سشن باز است،
	// خبرِ بعدی و چقدر مانده. سشن‌ها یک دیالِ ۲۴ ساعته‌اند نه پنج ردیفِ
	// نواری، و خبرها گره‌هایی روی یک خطِ زمان‌اند نه ردیف‌های یک جدول.
	//
	// قراردادِ داده دست‌نخورده است: همان سه action، همان فیلدها، همان
	// ذخیره‌ی اشتراک. فقط نمایش عوض شده.
	// ═══════════════════════════════════════════════════════════════

	var API = "https://sobhansamadi.mehdifx21hoseini.workers.dev/econ/miniapp";
	var tg = window.Telegram && window.Telegram.WebApp;

	// ── سازنده‌ی گره ────────────────────────────────────────────────
	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) n.className = cls;
		if (text != null) n.textContent = text;
		return n;
	}
	function $(id) { return document.getElementById(id); }
	function svgEl(tag, attrs) {
		var n = document.createElementNS("http://www.w3.org/2000/svg", tag);
		for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
		return n;
	}
	function haptic(kind) {
		try {
			if (!tg || !tg.HapticFeedback) return;
			if (kind === "select") tg.HapticFeedback.selectionChanged();
			else tg.HapticFeedback.impactOccurred("light");
		} catch (e) { /* older clients */ }
	}

	// ── رقم ─────────────────────────────────────────────────────────
	var FA = "۰۱۲۳۴۵۶۷۸۹";
	function fa(v) { return String(v).replace(/[0-9]/g, function (d) { return FA[d]; }); }
	function pad(n) { return (n < 10 ? "0" : "") + n; }
	// ساعت با رقمِ لاتین. در فونتِ مونو هم‌عرض است و ستون نمی‌لرزد.
	function clock(v) { return String(v); }

	// ── تاریخ شمسی ──────────────────────────────────────────────────
	var J_M = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
		"مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
	var WD = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];
	var G_M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	function toJalali(gy, gm, gd) {
		var gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
		var jy = (gy <= 1600) ? 0 : 979;
		gy -= (gy <= 1600) ? 621 : 1600;
		var gy2 = (gm > 2) ? gy + 1 : gy;
		var days = 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
			+ Math.floor((gy2 + 399) / 400) - 80 + gd + gdm[gm - 1];
		jy += 33 * Math.floor(days / 12053);
		days %= 12053;
		jy += 4 * Math.floor(days / 1461);
		days %= 1461;
		if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
		var jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
		var jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
		return [jy, jm, jd];
	}
	function jalaliLabel(iso) {
		var p = iso.split("-").map(Number);
		var j = toJalali(p[0], p[1], p[2]);
		return WD[new Date(p[0], p[1] - 1, p[2]).getDay()] + " " + fa(j[2]) + " " + J_M[j[1] - 1];
	}
	function gregLabel(iso) {
		var p = iso.split("-").map(Number);
		return p[2] + " " + G_M[p[1] - 1] + " " + p[0];
	}

	// ── منطقه‌ی زمانی ───────────────────────────────────────────────
	var ZONES = [
		{ key: "tehran", name: "تهران", zone: "Asia/Tehran" },
		// ساعتِ سرورِ بروکر.
		//
		// Etc/GMT-3 است نه Etc/GMT+3: در پایگاه‌داده‌ی مناطق، علامتِ
		// Etc/* وارونه است و این یکی یعنی UTC+3. ثابت هم هست - ساعتِ
		// تابستانی ندارد، پس نیم‌ساعت اختلافش با تهران تمامِ سال همان
		// می‌ماند. همین ساعت است که پنجره‌ی تسویه‌ی روزانه با آن تعریف
		// می‌شود (۰۰:۰۰ تا ۰۱:۰۰ سرور = ۰۰:۳۰ تا ۰۱:۳۰ تهران).
		{ key: "broker", name: "بروکر معتمد", sub: "ساعت سرور", zone: "Etc/GMT-3" },
		{ key: "gmt", name: "گرینویچ", zone: "UTC" },
		{ key: "london", name: "لندن", zone: "Europe/London" },
		{ key: "newyork", name: "نیویورک", zone: "America/New_York" },
		{ key: "tokyo", name: "توکیو", zone: "Asia/Tokyo" },
		{ key: "sydney", name: "سیدنی", zone: "Australia/Sydney" },
		{ key: "dubai", name: "دبی", zone: "Asia/Dubai" }
	];
	var VIEW_KEY = "econAppZone";
	var viewZone = ZONES[0];
	function VIEW() { return viewZone.zone; }

	function offsetLabel(zone, at) {
		var m = tzOffsetMinutes(at || new Date(), zone);
		if (m === 0) return "GMT";
		var sign = m > 0 ? "+" : "−";
		var a = Math.abs(m);
		return "GMT" + sign + Math.floor(a / 60) + (a % 60 ? ":" + pad(a % 60) : "");
	}
	function dayInZone(instant, zone) {
		try {
			return new Intl.DateTimeFormat("fa-IR", { timeZone: zone, weekday: "long" }).format(new Date(instant));
		} catch (e) { return ""; }
	}

	// دقیقه‌ی روز در یک منطقه - پایه‌ی هر چیزی که روی دیال کشیده می‌شود.
	function minutesInZone(instant, zone) {
		var p = tzParts(new Date(instant), zone);
		return Number(p.hour) * 60 + Number(p.minute);
	}

	// ── حالت ────────────────────────────────────────────────────────
	var LEVELS = [
		{ key: "high", fa: "مهم", en: "High impact" },
		{ key: "medium", fa: "متوسط", en: "Medium impact" },
		{ key: "low", fa: "کم‌اهمیت", en: "Low impact" }
	];
	var LEVELS_KEY = "econ.levels";
	var ROUTE_KEY = "econAppRoute";
	var RANGE_KEY = "econAppRange";

	var CURRENCIES = [
		{ code: "USD", fa: "دلار آمریکا" },
		{ code: "EUR", fa: "یورو" },
		{ code: "GBP", fa: "پوند انگلیس" },
		{ code: "JPY", fa: "ین ژاپن" },
		{ code: "AUD", fa: "دلار استرالیا" },
		{ code: "CAD", fa: "دلار کانادا" },
		{ code: "NZD", fa: "دلار نیوزیلند" },
		{ code: "CHF", fa: "فرانک سوئیس" }
	];
	// هشت ارز داریم و تا حالا فقط چهار پرچم در اسپرایت بود؛ چهارتای
	// دیگر - یورو، کانادا، نیوزیلند، سوییس - به کره‌ی خاکستری می‌افتادند.
	var FLAG_BY_CCY = {
		USD: "us", GBP: "gb", JPY: "jp", AUD: "au",
		EUR: "eu", CAD: "ca", NZD: "nz", CHF: "ch"
	};
	var CUR_FA = {
		USD: "دلار", EUR: "یورو", GBP: "پوند", JPY: "ین",
		AUD: "دلار استرالیا", CAD: "دلار کانادا", NZD: "دلار نیوزیلند", CHF: "فرانک"
	};

	var state = {
		route: "now",
		range: "today",
		query: "",
		data: null,
		failure: null,
		lastOk: null,
		saving: false,
		savePending: false,
		levels: { high: true, medium: true, low: false },
		open: {},
		// توضیحِ هر خبر، بعد از اولین درخواست. عمداً فقط در حافظه:
		// متن روی سرور کش می‌شود، این فقط جلوی درخواستِ تکراری در همین
		// نشست را می‌گیرد.
		explain: {}
	};

	function levelOn(imp) {
		if (!imp || !(imp in state.levels)) return true;
		return state.levels[imp];
	}
	function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ترجیح است، نه داده */ } }
	function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

	function loadPrefs() {
		var z = recall(VIEW_KEY);
		ZONES.forEach(function (x) { if (x.key === z) viewZone = x; });
		var r = recall(ROUTE_KEY);
		if (r === "now" || r === "cal" || r === "me") state.route = r;
		var g = recall(RANGE_KEY);
		if (g === "today" || g === "week") state.range = g;
		try {
			var raw = recall(LEVELS_KEY);
			if (raw) {
				var v = JSON.parse(raw);
				LEVELS.forEach(function (l) {
					if (typeof v[l.key] === "boolean") state.levels[l.key] = v[l.key];
				});
			}
		} catch (e) { /* ترجیح است، نه داده */ }
	}

	// ── شبکه ────────────────────────────────────────────────────────
	function call(payload) {
		payload.initData = tg ? tg.initData : "";
		return fetch(API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		}).then(function (res) {
			return res.json().catch(function () { return {}; }).then(function (body) {
				if (!res.ok || body.success === false) {
					var err = new Error(body.error || ("خطای سرور (" + res.status + ")"));
					err.status = res.status;
					throw err;
				}
				return body;
			});
		});
	}

	function load() {
		return call({ action: "data" })
			.then(function (body) {
				state.data = body;
				state.failure = null;
				state.lastOk = Date.now();
				render();
			})
			.catch(function (err) {
				state.failure = err.status === 401
					? { msg: "تلگرام نتونست هویتت رو تأیید کنه. برنامه رو ببند و از دکمه‌ی داخل ربات دوباره بازش کن.", retry: false }
					: { msg: "دریافت اطلاعات ناموفق بود.", retry: true };
				render();
			});
	}

	// ── داده‌ی رویداد ───────────────────────────────────────────────
	function atOf(e) { return e.at ? new Date(e.at).getTime() : null; }
	function isPast(e) { var t = atOf(e); return t !== null && t < Date.now(); }

	function todays() {
		if (!state.data) return [];
		var d = state.data.today;
		return state.data.events.filter(function (e) { return e.date === d; });
	}

	function matches(e) {
		var q = state.query.trim().toLowerCase();
		if (!q) return true;
		return ((e.en || "") + " " + (e.title || "") + " " + (e.short || "") + " " + (e.currency || ""))
			.toLowerCase().indexOf(q) !== -1;
	}

	function visible() {
		if (!state.data) return [];
		var today = state.data.today;
		var weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
		return state.data.events.filter(function (e) {
			if (!levelOn(e.importance)) return false;
			if (state.query) return matches(e);
			if (state.range === "today" && e.date !== today) return false;
			if (state.range === "week" && e.date > weekEnd) return false;
			return true;
		});
	}

	function nextEvent() {
		var now = Date.now();
		return todays().filter(function (e) {
			var t = atOf(e);
			return t !== null && t > now && levelOn(e.importance);
		}).sort(function (a, b) { return atOf(a) - atOf(b); })[0] || null;
	}

	// ── عدد ─────────────────────────────────────────────────────────
	function numOf(v) {
		var m = /^\s*([+-]?[\d.,]+)/.exec(String(v || ""));
		if (!m) return null;
		var n = parseFloat(m[1].replace(/,/g, ""));
		return isNaN(n) ? null : n;
	}
	function unitOf(v) {
		var m = /([%KMBT])\s*$/i.exec(String(v || ""));
		return m ? m[1].toUpperCase() : "";
	}
	function decOf(v) {
		var s = String(v || "").replace(/[^0-9.]/g, "").split(".")[1];
		return s ? s.length : 0;
	}

	/** اختلافِ واقعی با پیش‌بینی. رقمِ اعشار از خودِ ورودی می‌آید. */
	function deltaOf(e) {
		var a = numOf(e.actual), f = numOf(e.forecast);
		if (a === null || f === null) return null;
		var d = a - f;
		var dec = Math.max(decOf(e.actual), decOf(e.forecast));
		if (Math.abs(d) < Math.pow(10, -dec) / 2) return { flat: true, text: "مطابق پیش‌بینی" };
		var unit = unitOf(e.forecast) === "%" ? "" : unitOf(e.forecast);
		// رقمِ لاتین، عمداً. هر عددی که «خوانده» می‌شود - نرخ، اختلاف،
		// ساعت - در یک زبانِ رقمی می‌ماند تا چشم بینشان جابه‌جا نشود.
		return { flat: false, text: (d > 0 ? "+" : "−") + Math.abs(d).toFixed(dec) + unit };
	}

	/** رنگِ عدد از قضاوتِ سرور می‌آید، نه بالا/پایینِ خام. */
	function tone(e) { return e.read ? (e.read.good ? "is-up" : "is-down") : ""; }

	function until(ms) {
		var m = Math.max(0, Math.round((ms - Date.now()) / 60000));
		if (m < 1) return "همین حالا";
		if (m < 60) return fa(m) + " دقیقه";
		var h = Math.floor(m / 60), r = m % 60;
		if (h < 24) return fa(h) + " ساعت" + (r ? " و " + fa(r) + " دقیقه" : "");
		return fa(Math.round(h / 24)) + " روز";
	}
	function countdown(ms) {
		var s = Math.max(0, Math.floor((ms - Date.now()) / 1000));
		var d = Math.floor(s / 86400);
		if (d > 0) return fa(d) + " روز " + pad(Math.floor(s % 86400 / 3600)) + ":" + pad(Math.floor(s % 3600 / 60));
		return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60);
	}

	function flagNode(ccy) {
		var id = FLAG_BY_CCY[String(ccy || "").toUpperCase()];
		var box = el("span", "fl");
		var svg = svgEl("svg", { viewBox: "0 0 512 512", "aria-hidden": "true" });
		if (id) {
			svg.appendChild(svgEl("use", { href: "#fi-" + id }));
		} else {
			svg.setAttribute("viewBox", "0 0 24 24");
			svg.setAttribute("fill", "none");
			svg.setAttribute("stroke", "currentColor");
			svg.setAttribute("stroke-width", "1.6");
			["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18", "M3 12h18", "M12 3c2.6 2.4 2.6 15.6 0 18", "M12 3c-2.6 2.4-2.6 15.6 0 18"]
				.forEach(function (d) { svg.appendChild(svgEl("path", { d: d })); });
		}
		box.appendChild(svg);
		return box;
	}

	// ═══════════════════════════════════════════════════════════════
	// دیالِ ۲۴ ساعته
	//
	// چرا دیال و نه پنج نوارِ افقی: نوارها همان زبانِ تقویم‌های سنتی‌اند
	// و روی عرضِ گوشی هر کدام چند پیکسل می‌شوند. روز *دوره‌ای* است -
	// دایره شکلِ طبیعیِ آن است، هم‌پوشانی‌ها به‌شکلِ کمان‌های هم‌مرکز خودشان
	// را نشان می‌دهند، و عقربه بدونِ هیچ برچسبی می‌گوید کجای روزیم.
	// ═══════════════════════════════════════════════════════════════
	var DIAL = { size: 260, cx: 130, cy: 130, r0: 118 };

	function polar(min, r) {
		// دقیقه‌ی صفر بالای دیال، و ساعت‌ها ساعتگرد.
		var a = (min / 1440) * Math.PI * 2 - Math.PI / 2;
		return [DIAL.cx + r * Math.cos(a), DIAL.cy + r * Math.sin(a)];
	}
	function arcPath(from, to, r) {
		var span = to - from;
		if (span <= 0) return "";
		// کمانِ کامل با یک path کشیده نمی‌شود؛ کمی کوتاهش می‌کنیم.
		if (span >= 1439) span = 1438;
		var a = polar(from, r), b = polar(from + span, r);
		return "M" + a[0].toFixed(2) + " " + a[1].toFixed(2) +
			" A" + r + " " + r + " 0 " + (span > 720 ? 1 : 0) + " 1 " + b[0].toFixed(2) + " " + b[1].toFixed(2);
	}

	function buildDial(now) {
		var svg = svgEl("svg", {
			class: "dial", viewBox: "0 0 " + DIAL.size + " " + DIAL.size,
			role: "img", "aria-label": "دیال ۲۴ ساعته‌ی بازارها"
		});

		// حلقه‌ی بیرونی و نشانه‌ی هر شش ساعت.
		svg.appendChild(svgEl("circle", { class: "dial-ring", cx: DIAL.cx, cy: DIAL.cy, r: DIAL.r0 }));
		[0, 6, 12, 18].forEach(function (h) {
			var p1 = polar(h * 60, DIAL.r0 - 5), p2 = polar(h * 60, DIAL.r0 + 2);
			svg.appendChild(svgEl("line", { class: "dial-tick", x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] }));
			var lp = polar(h * 60, DIAL.r0 + 11);
			var t = svgEl("text", { class: "dial-hour", x: lp[0], y: lp[1] });
			t.textContent = pad(h);
			svg.appendChild(t);
		});

		// خبرهای امروز روی حلقه‌ی بیرونی: هرچه مهم‌تر، بلندتر.
		todays().forEach(function (e) {
			if (!e.at || !levelOn(e.importance)) return;
			var m = minutesInZone(atOf(e), VIEW());
			var len = e.importance === "high" ? 11 : e.importance === "medium" ? 7 : 4;
			var w = e.importance === "high" ? 2.4 : 1.6;
			var p1 = polar(m, DIAL.r0 - 3), p2 = polar(m, DIAL.r0 - 3 - len);
			svg.appendChild(svgEl("line", {
				class: "dial-ev" + (e.importance === "high" ? " is-high" : "") + (isPast(e) ? " is-done" : ""),
				x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], "stroke-width": w
			}));
		});

		// یک کمان برای هر سشن، هرکدام روی شعاعِ خودش.
		var r = DIAL.r0 - 24;
		SESSIONS.forEach(function (s) {
			var st = sessionState(s, now);
			var hol = holidayToday(s);
			var ref = st.open ? { open: st.since, close: st.until }
				: (st.nextOpen ? { open: st.nextOpen, close: st.nextClose } : null);
			if (ref) {
				var from = minutesInZone(ref.open, VIEW());
				var span = Math.round((ref.close - ref.open) / 60000);
				var arc = svgEl("path", {
					class: "dial-arc" + (st.open && !hol ? " is-open" : ""),
					d: arcPath(from, from + span, r),
					stroke: "var(--k-" + s.key + ")",
					"stroke-width": st.open && !hol ? 7 : 5
				});
				svg.appendChild(arc);
			}
			r -= 12;
		});

		// عقربه‌ی «حالا».
		var nowMin = minutesInZone(now.getTime(), VIEW());
		var h1 = polar(nowMin, DIAL.r0 - 2), h2 = polar(nowMin, DIAL.r0 - 78);
		svg.appendChild(svgEl("line", { class: "dial-hand", x1: h1[0], y1: h1[1], x2: h2[0], y2: h2[1] }));
		svg.appendChild(svgEl("circle", { class: "dial-dot", cx: h1[0], cy: h1[1], r: 3.4 }));
		return svg;
	}

	function holidayToday(s) {
		if (!state.data || !state.data.holidays || !state.data.holidays.length) return null;
		// تعطیلیِ منتشرشده مالِ بازارهای آمریکاست؛ فید کشور نمی‌دهد.
		if (s.key !== "newyork" && s.key !== "nyse") return null;
		var d = state.data.today;
		for (var i = 0; i < state.data.holidays.length; i++) {
			if (state.data.holidays[i].date === d) return state.data.holidays[i];
		}
		return null;
	}

	// ═══════════════════════════════════════════════════════════════
	// صحنه‌ها
	// ═══════════════════════════════════════════════════════════════

	function render() {
		var stage = $("stage");
		stage.textContent = "";
		$("zoneName").textContent = viewZone.name;
		$("zoneOff").textContent = offsetLabel(VIEW());

		if (state.failure) { stage.appendChild(failureView()); return; }
		if (!state.data) { stage.appendChild(loadingView()); return; }

		if (state.route === "now") stage.appendChild(viewNow());
		else if (state.route === "cal") stage.appendChild(viewCal());
		else stage.appendChild(viewMe());

		syncDock();
	}

	function loadingView() {
		var w = el("div", null);
		w.style.paddingTop = "24px";
		for (var i = 0; i < 4; i++) w.appendChild(el("div", "skel"));
		return w;
	}

	function stateBlock(glyph, title, body, action) {
		var w = el("div", "state");
		var g = el("div", "state-glyph");
		var svg = svgEl("svg", { viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor", "stroke-width": "1.7", "stroke-linecap": "round" });
		(glyph || []).forEach(function (d) { svg.appendChild(svgEl("path", { d: d })); });
		g.appendChild(svg);
		w.appendChild(g);
		w.appendChild(el("h3", null, title));
		var p = el("p", null);
		p.innerHTML = body;
		w.appendChild(p);
		if (action) w.appendChild(action);
		return w;
	}

	function failureView() {
		var body = state.failure.msg;
		if (state.lastOk) {
			body += "<br>آخرین بروزرسانیِ موفق: " +
				'<span class="n">' + hhmmInZone(state.lastOk, VIEW()) + "</span>";
		}
		var btn = null;
		if (state.failure.retry) {
			btn = el("button", "btn", "تلاش دوباره");
			btn.type = "button";
			btn.addEventListener("click", function () { state.failure = null; render(); load(); });
		}
		return stateBlock(["M12 3v9", "M6.6 6.6a9 9 0 1 0 10.8 0"], "داده در دسترس نیست", body, btn);
	}

	// ── اکنون ───────────────────────────────────────────────────────
	var tickers = [];

	function viewNow() {
		tickers = [];
		var now = new Date();
		var market = marketState(now);
		var weekend = !market.open && !market.onBreak && !!market.nextOpen;

		var wrap = el("div", null);

		var dialBox = el("div", "now");
		dialBox.appendChild(buildDial(now));

		var read = el("div", "now-read");
		var t = el("div", "now-time n", hhmmInZone(now.getTime(), VIEW()));
		read.appendChild(t);
		tickers.push(function () { t.textContent = hhmmInZone(Date.now(), VIEW()); });
		var stateWord = market.onBreak ? "تسویه" : (market.open ? "باز" : (weekend ? "آخر هفته" : "بسته"));
		read.appendChild(el("div", "now-state" + (market.open ? "" : " is-shut"), stateWord));
		dialBox.appendChild(read);
		wrap.appendChild(dialBox);

		// جمله‌ی زیرِ دیال: تغییرِ بعدی، نه فهرستِ بازِ فعلی.
		//
		// تا حالا اینجا نوشته می‌شد «لندن و نیویورک هم‌زمان باز» و بعد
		// تراشه‌ها همان نام‌ها را دوباره می‌گفتند - یک حرف، دو بار، پشتِ
		// هم. تنها چیزی که تراشه‌ها نمی‌گویند این است که *بعدی* کِی
		// اتفاق می‌افتد؛ حالا جمله همان را می‌گوید.
		var line = el("div", "now-line");
		line.style.marginInline = "auto";
		if (weekend && market.nextOpen) {
			line.innerHTML = "بازارها تا <b>" + dayInZone(market.nextOpen, VIEW()) + " " +
				'<span class="n">' + hhmmInZone(market.nextOpen, VIEW()) + "</span></b> بسته‌اند.";
		} else if (market.onBreak && market.resumesAt) {
			line.innerHTML = "تسویه‌ی روزانه — از سر گرفته می‌شود <b>" +
				'<span class="n">' + hhmmInZone(market.resumesAt, VIEW()) + "</span></b>";
		} else {
			var nt = nextTurn(now);
			if (nt) {
				line.innerHTML = "<b>" + until(nt.at) + "</b> تا " +
					(nt.closing ? "بسته شدنِ " : "باز شدنِ ") + "<b>" + nt.name + "</b>";
			} else if (market.nextOpen) {
				line.innerHTML = "بازارِ بعدی <b>" + '<span class="n">' +
					hhmmInZone(market.nextOpen, VIEW()) + "</span></b> باز می‌شود.";
			}
		}
		if (line.innerHTML) wrap.appendChild(line);

		// لژِ سشن‌ها: تراشه‌های کوچک، هرکدام درِ ورودیِ جزئیات.
		//
		// چیدمان شبکه است نه wrapِ وسط‌چین. با wrap، پنج تراشه با نام‌های
		// نابرابر به ۳+۲ می‌شکستند و بلوک دندانه‌دار می‌شد؛ در شبکه هر
		// ستون یک عرض دارد و تراشه‌ی پنجم عمداً کلِ ردیف را می‌گیرد.
		//
		// بازها اول می‌آیند. در حالتِ wrap ترتیب ثابت بود و کاربر باید
		// بینِ پنج‌تا دنبالِ روشن‌ها می‌گشت.
		var lede = el("div", "lede");
		SESSIONS.slice().sort(function (a, b2) {
			var oa = sessionState(a, now).open && !holidayToday(a) ? 0 : 1;
			var ob = sessionState(b2, now).open && !holidayToday(b2) ? 0 : 1;
			return oa - ob;
		}).forEach(function (s) {
			var st = sessionState(s, now);
			var hol = holidayToday(s);
			var b = el("button", null);
			b.type = "button";
			b.className = (st.open && !hol ? "is-open" : "") + (hol ? " is-hol" : "");
			b.style.setProperty("--k", "var(--k-" + s.key + ")");
			b.appendChild(el("span", "kdot"));
			b.appendChild(el("span", null, s.name));
			// ساعت روی خودِ تراشه.
			//
			// تا حالا تراشه فقط یک نقطه‌ی رنگی و یک نام بود: می‌گفت باز
			// است یا نه، ولی نمی‌گفت «تا کِی». آن جواب یک ضربه پایین‌تر،
			// داخلِ ورق، پنهان بود - درحالی‌که دقیقاً همان چیزی است که
			// کاربر برای برنامه‌ریزیِ ساعتِ بعدی‌اش می‌خواهد.
			var t = "";
			if (hol) t = "تعطیل";
			else if (st.open && st.until) t = "تا " + hhmmInZone(st.until, VIEW());
			else if (st.nextOpen) t = hhmmInZone(st.nextOpen, VIEW());
			if (t) b.appendChild(el("span", "kt n", t));
			b.addEventListener("click", function () { openSession(s); });
			lede.appendChild(b);
		});
		wrap.appendChild(lede);

		// ساعت‌ها به وقتِ کدام منطقه‌اند.
		//
		// تراشه‌ها ساعتِ باز و بسته شدن را می‌گویند ولی هیچ‌جا نمی‌گفت
		// این ساعت‌ها به وقتِ کجاست. کسی که منطقه را عوض کرده - یا
		// نکرده و فرض کرده وقتِ بروکر است - عددها را اشتباه می‌خواند.
		// خودِ این خط دکمه است، پس همان‌جا هم می‌شود عوضش کرد.
		var tzNote = el("button", "tz-note");
		tzNote.type = "button";
		tzNote.innerHTML = "ساعت‌ها به وقتِ <b>" + viewZone.name + "</b> " +
			'<span class="n">' + offsetLabel(VIEW(), now) + "</span>";
		tzNote.addEventListener("click", openZones);
		wrap.appendChild(tzNote);

		// رویدادِ بعدی — بزرگ‌ترین چیزِ صفحه بعد از ساعت.
		var nx = nextEvent();
		if (nx) {
			var card = el("div", "upnext");
			card.appendChild(el("div", "upnext-k", "رویداد بعدی"));
			var cd = el("div", "upnext-cd n", countdown(atOf(nx)));
			card.appendChild(cd);
			// دقیقه‌ی آخر.
			//
			// زیر یک دقیقه هیچ اتفاقی در رفتارِ شمارنده نمی‌افتاد -
			// همان رقم‌ها، همان رنگ. ولی این دقیقاً لحظه‌ای است که
			// کاربر باید بداند باید نگاه کند. رنگ به «زنده» می‌رود و
			// یک ضربانِ خیلی ملایم می‌گیرد.
			var lastMin = null;
			function beat() {
				cd.textContent = countdown(atOf(nx));
				var left = atOf(nx) - Date.now();
				var hot = left > 0 && left <= 60000;
				if (hot !== lastMin) { cd.classList.toggle("is-hot", hot); lastMin = hot; }
			}
			beat();
			tickers.push(beat);
			card.appendChild(el("div", "upnext-name", nx.en || nx.title || nx.short || ""));
			if (nx.title) card.appendChild(el("div", "upnext-fa", nx.title));
			var meta = el("div", "upnext-meta");
			meta.appendChild(el("span", "n", hhmmInZone(atOf(nx), VIEW())));
			meta.appendChild(el("span", "node-cur", nx.currency || ""));
			meta.appendChild(impMark(nx.importance));
			meta.appendChild(el("span", null, impWord(nx.importance)));
			card.appendChild(meta);
			wrap.appendChild(card);
		}

		// جریانِ امروز.
		//
		// رویدادِ بعدی از این فهرست کنار می‌رود. nextEvent خودش از
		// todays می‌آید، پس تا امروز همان خبر دو بار روی صفحه بود - یک
		// بار در کارتِ بزرگ، یک بار چند سانت پایین‌تر در فهرست. حالا
		// کارت همان «بعدی» است و فهرست «بقیه».
		var todayShown = todays().filter(function (e) {
			return levelOn(e.importance) && !(nx && e.event_id === nx.event_id);
		});
		var h = el("div", "sec-h");
		h.appendChild(el("h2", null, nx ? "بقیه‌ی امروز" : "امروز"));
		h.appendChild(el("span", "aside", state.data ? jalaliLabel(state.data.today) : ""));
		wrap.appendChild(h);

		if (todayShown.length) {
			wrap.appendChild(buildStream(todayShown, false));
		} else if (nx) {
			// فهرست خالی است ولی روز خالی نیست: کارتِ بالا تنها رویدادِ
			// امروز بود. حالتِ خالیِ کاملِ «امروز خبری نیست» اینجا دروغ
			// می‌گفت.
			wrap.appendChild(el("div", "thin", "رویدادِ دیگری برای امروز نمانده."));
		} else {
			wrap.appendChild(emptyToday(weekend, market));
		}
		return wrap;
	}

	/**
	 * نزدیک‌ترین تغییرِ وضعیتِ بازارها - باز شدن یا بسته شدن.
	 *
	 * بینِ همه‌ی سشن‌ها می‌گردد و زودترین لحظه را برمی‌گرداند. تعطیلیِ
	 * بانکی کنار گذاشته می‌شود: بازاری که امروز تعطیل است «باز» نمی‌شود.
	 */
	function nextTurn(now) {
		var best = null;
		SESSIONS.forEach(function (s) {
			if (holidayToday(s)) return;
			var st = sessionState(s, now);
			var at = st.open ? st.until : st.nextOpen;
			if (!at) return;
			if (!best || at < best.at) best = { at: at, name: s.name, closing: !!st.open };
		});
		return best;
	}

	function impWord(imp) {
		return imp === "high" ? "مهم" : imp === "medium" ? "متوسط" : "کم‌اهمیت";
	}

	/**
	 * نشانِ اهمیت: یک دایره‌ی رنگی - قرمز، نارنجی، طلایی.
	 *
	 * اول با سه میله‌ی بی‌رنگ ساخته شد تا از زبانِ رنگیِ فارکس‌فکتوری
	 * فاصله بگیرد، ولی در عمل کافی نبود: سطحِ خبر باید در یک نگاه و از
	 * فاصله خوانده شود، و رنگ این کار را می‌کند که شکل نمی‌کند.
	 *
	 * چیزی که از آن پرهیز می‌شود پُر شدنِ صفحه از قرمز است، نه خودِ
	 * رنگ. پس دایره کوچک می‌ماند و رنگ فقط همین‌جاست: عنوان و عددها
	 * رنگِ اهمیت نمی‌گیرند. دو نشانه‌ی موازی هم سرِ جایشان‌اند -
	 * اندازه‌ی گره روی خط و بزرگیِ عنوان - تا اگر کسی رنگ را تشخیص
	 * نمی‌دهد، سطح همچنان دیده شود.
	 */
	function impMark(imp) {
		var s = el("span", "sig lv-" + (imp === "high" ? 3 : imp === "medium" ? 2 : 1));
		s.setAttribute("role", "img");
		s.setAttribute("aria-label", "اهمیت: " + impWord(imp));
		return s;
	}

	function emptyToday(weekend, market) {
		var off = LEVELS.filter(function (l) { return !state.levels[l.key]; });
		if (weekend) {
			var msg = "بازارها بسته‌اند و داده‌ی تازه‌ای منتشر نمی‌شود.";
			if (market.nextOpen) {
				msg += "<br>دوباره " + dayInZone(market.nextOpen, VIEW()) + " ساعت " +
					'<span class="n">' + hhmmInZone(market.nextOpen, VIEW()) + "</span> باز می‌شوند.";
			}
			return stateBlock(["M12 3v2", "M12 19v2", "M5 12H3", "M21 12h-2", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8"],
				"آخر هفته", msg, null);
		}
		if (off.length) {
			var b = el("button", "btn", "باز کردن تنظیمات");
			b.type = "button";
			b.addEventListener("click", function () { go("me"); });
			return stateBlock(["M4 6h16", "M4 12h10", "M4 18h6"], "خبری در سطح‌های روشن نیست",
				"سطح " + off.map(function (l) { return l.fa; }).join(" و ") + " خاموش است.", b);
		}
		return stateBlock(["M4 6h16", "M4 12h10", "M4 18h6"], "امروز رویدادی نیست",
			"برای امروز چیزی در تقویم ثبت نشده.", null);
	}

	// ── تقویم ───────────────────────────────────────────────────────
	function viewCal() {
		tickers = [];
		var wrap = el("div", null);

		var bar = el("div", null);
		bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px";
		var seg = el("div", "seg");
		[["today", "امروز"], ["week", "هفته"]].forEach(function (r) {
			var b = el("button", null, r[1]);
			b.type = "button";
			b.setAttribute("aria-pressed", state.range === r[0] ? "true" : "false");
			b.addEventListener("click", function () {
				state.range = r[0];
				store(RANGE_KEY, r[0]);
				haptic("select");
				render();
			});
			seg.appendChild(b);
		});
		bar.appendChild(seg);
		var offCount = LEVELS.filter(function (l) { return !state.levels[l.key]; }).length;
		if (offCount) {
			var flt = el("button", null, fa(3 - offCount) + " از " + fa(3) + " سطح");
			flt.type = "button";
			flt.style.cssText = "appearance:none;border:0;background:none;font-family:inherit;font-size:12px;font-weight:600;color:var(--dim);cursor:pointer;min-height:36px";
			flt.addEventListener("click", function () { go("me"); });
			bar.appendChild(flt);
		}
		wrap.appendChild(bar);

		var find = el("label", "find");
		var svg = svgEl("svg", { viewBox: "0 0 24 24", width: "15", height: "15", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" });
		svg.appendChild(svgEl("circle", { cx: 11, cy: 11, r: 7 }));
		svg.appendChild(svgEl("path", { d: "m20 20-3.2-3.2" }));
		find.appendChild(svg);
		var inp = el("input", null);
		inp.type = "search";
		inp.id = "findInput";
		inp.autocomplete = "off";
		inp.placeholder = "جستجوی شاخص… مثلاً CPI یا تورم";
		inp.value = state.query;
		inp.addEventListener("input", function () {
			state.query = this.value;
			var host = $("calStream");
			if (!host) return;
			host.textContent = "";
			paintCal(host);
		});
		find.appendChild(inp);
		wrap.appendChild(find);

		var host = el("div", null);
		host.id = "calStream";
		wrap.appendChild(host);
		paintCal(host);
		return wrap;
	}

	function paintCal(host) {
		var rows = visible();
		if (!rows.length) {
			host.appendChild(stateBlock(["M4 6h16", "M4 12h10", "M4 18h6"],
				state.query ? "چیزی پیدا نشد" : "رویدادی نیست",
				state.query ? "برای این جستجو رویدادی در بازه‌ی بارگذاری‌شده نبود." : "برای این بازه چیزی ثبت نشده.",
				null));
			return;
		}
		// گروه‌بندی به روز، با سرصفحه‌ی سبک.
		var byDay = [];
		var seen = {};
		rows.forEach(function (e) {
			if (!seen[e.date]) { seen[e.date] = []; byDay.push(e.date); }
			seen[e.date].push(e);
		});
		byDay.forEach(function (d) {
			var head = el("div", "daymark");
			head.appendChild(el("span", null, jalaliLabel(d)));
			var g = el("span", "g", gregLabel(d));
			g.dir = "ltr";
			head.appendChild(g);
			if (state.data && d === state.data.today) head.appendChild(el("span", "today", "امروز"));
			host.appendChild(head);
			host.appendChild(buildStream(seen[d], true));
		});
	}

	// ── جریان و گره ─────────────────────────────────────────────────
	function buildStream(rows, compact) {
		var s = el("div", "stream");
		rows.slice().sort(function (a, b) {
			var x = atOf(a), y = atOf(b);
			if (x === null) return 1;
			if (y === null) return -1;
			return x - y;
		}).forEach(function (e, i, all) {
			// تکرارِ پرچم و کدِ ارز.
			//
			// وقتی چهار خبرِ دلاری پشتِ هم می‌آیند، چهار بار همان پرچم
			// و همان «USD» نوشته می‌شود. این‌ها نه اطلاعاتِ تازه‌ای
			// دارند و نه چشم را جایی می‌برند - فقط شلوغی‌اند. بارِ اولِ
			// هر دسته نگه داشته می‌شود و بقیه کنار می‌روند؛ همان‌جا که
			// ارز عوض می‌شود، دوباره ظاهر می‌شود و همان تغییر را نشان
			// می‌دهد. برچسبِ دسترس‌پذیر روی خودِ گره می‌ماند.
			var prev = i > 0 ? all[i - 1] : null;
			var same = !!prev && (prev.currency || "") === (e.currency || "");
			s.appendChild(buildNode(e, compact, same));
		});
		return s;
	}

	function buildNode(e, compact, sameCur) {
		var imp = e.importance || "low";
		var at = atOf(e);
		var done = isPast(e);
		var live = !done && at !== null && at - Date.now() < 30 * 60000;

		var node = el("div", "node imp-" + imp +
			(done ? " is-done" : "") + (e.actual ? " has-actual" : "") + (live ? " is-live" : ""));

		node.appendChild(el("div", "node-t", e.time_tehran
			? clock(hhmmInZone(at, VIEW()))
			: "—"));

		var head = el("button", "node-head");
		head.type = "button";
		head.setAttribute("aria-expanded", state.open[e.event_id] ? "true" : "false");

		var top = el("div", "node-top");
		if (sameCur) {
			// جای‌گیرِ هم‌عرض تا عنوان‌ها زیرِ هم بمانند؛ کدِ ارز داخلش
			// هست ولی فقط برای صفحه‌خوان.
			top.appendChild(el("span", "node-cur-echo sr", e.currency || ""));
		} else {
			top.appendChild(flagChipSmall(e));
			top.appendChild(el("span", "node-cur", e.currency || ""));
		}
		top.appendChild(impMark(imp));
		top.appendChild(el("span", "node-gap"));
		if (live) top.appendChild(el("span", "node-tag is-live", "تا " + until(at)));
		else if (!done && at !== null && !compact) top.appendChild(el("span", "node-tag", "تا " + until(at)));
		else if (done && !e.actual) top.appendChild(el("span", "node-tag", "منتشر شد"));
		head.appendChild(top);

		head.appendChild(el("div", "node-name", e.en || e.title || e.short || ""));
		if (e.title && e.title !== (e.en || "")) head.appendChild(el("div", "node-fa", e.title));

		if (e.actual) {
			var out = el("div", "node-out");
			out.appendChild(el("span", "node-actual n " + tone(e), e.actual));
			var d = deltaOf(e);
			if (d) out.appendChild(el("span", "node-delta" + (d.flat ? " is-flat" : ""), d.text));
			head.appendChild(out);
		}

		node.appendChild(head);

		var more = el("div", "node-more");
		more.hidden = !state.open[e.event_id];
		more.appendChild(detailBody(e));
		node.appendChild(more);

		head.addEventListener("click", function () {
			state.open[e.event_id] = !state.open[e.event_id];
			more.hidden = !state.open[e.event_id];
			head.setAttribute("aria-expanded", state.open[e.event_id] ? "true" : "false");
			haptic("select");
		});
		return node;
	}

	function flagChipSmall(e) {
		var f = flagNode(e.currency);
		f.style.cssText = "width:18px;height:12px;border-radius:2px;overflow:hidden;display:inline-block;box-shadow:0 0 0 1px var(--hair-2)";
		var svg = f.querySelector("svg");
		if (svg) svg.style.cssText = "width:100%;height:100%;display:block";
		return f;
	}

	/**
	 * بازشده‌ی یک رویداد.
	 *
	 * به‌جای جدولِ سه‌ستونیِ «قبلی / پیش‌بینی / واقعی» - که همان زبانِ
	 * تقویم‌های سنتی است - یک محور کشیده می‌شود: پیش‌بینی نقطه‌ی صفر، و
	 * واقعی از آن فاصله می‌گیرد. نسبت دیده می‌شود، نه فقط سه عدد.
	 */
	function detailBody(e) {
		var box = el("div", "node-body");

		var f = numOf(e.forecast), a = numOf(e.actual), p = numOf(e.previous);
		if (f !== null && a !== null) {
			box.appendChild(buildGauge(e, f, a, p));
		}

		var facts = el("div", "facts");
		function fact(k, v, extra) {
			var s = el("span", null);
			s.appendChild(document.createTextNode(k + " "));
			s.appendChild(el("b", null, v ? String(v) : "—"));
			if (extra) s.appendChild(el("span", "rev", " " + extra));
			facts.appendChild(s);
		}
		fact("قبلی", e.previous, e.previous_before ? "(بازنگری از " + e.previous_before + ")" : "");
		fact("پیش‌بینی", e.forecast, "");
		if (!numOf(e.actual) && e.actual) fact("واقعی", e.actual, "");
		box.appendChild(facts);

		// خوانش: پس از انتشار قضاوت، پیش از آن قاعده‌ی کلی.
		var cur = CUR_FA[e.currency] || "ارز";
		if (e.read) {
			box.appendChild(el("div", "effect " + (e.read.good ? "is-good" : "is-bad"),
				(e.read.higher ? "بالاتر از پیش‌بینی — " : "پایین‌تر از پیش‌بینی — ") +
				(e.read.good ? "معمولاً مثبت برای " : "معمولاً منفی برای ") + cur));
		} else if (e.direction) {
			box.appendChild(el("div", "effect",
				e.direction === "inverse"
					? "معمولاً عددِ پایین‌تر از پیش‌بینی به نفعِ " + cur + " است"
					: "معمولاً عددِ بالاتر از پیش‌بینی به نفعِ " + cur + " است"));
		}

		var sp = sparkline(e);
		if (sp) box.appendChild(sp);

		box.appendChild(explainRow(e));
		return box;
	}

	/**
	 * توضیحِ هوش مصنوعیِ همین خبر.
	 *
	 * تا امروز یک بلوکِ «تحلیل هوش مصنوعی» تهِ صفحه‌ی «اکنون» بود که
	 * کلِ روز را یکجا توضیح می‌داد: سنگین‌ترین عنصرِ صفحه، برای متنی که
	 * درباره‌ی خبری بود که کاربر شاید اصلاً بازش نکرده. حالا توضیح
	 * همان‌جایی است که خبر است و فقط وقتی می‌آید که خواسته شود.
	 *
	 * پاسخ در همان لحظه در حافظه‌ی صفحه می‌ماند، پس بستن و باز کردنِ
	 * دوباره‌ی خبر درخواستِ تازه نمی‌فرستد.
	 */
	function explainRow(e) {
		var wrap = el("div", "xai");
		var btn = el("button", "xai-b");
		btn.type = "button";
		var out = el("div", "xai-out");
		out.hidden = true;

		function show(text, stamp) {
			out.hidden = false;
			out.textContent = "";
			// متن از سرور می‌آید و <b> دارد؛ فقط همین چند تگ اجازه دارند.
			out.appendChild(safeRich(text));
			if (stamp) out.appendChild(el("span", "xai-stamp", stamp));
		}

		var cached = state.explain[e.event_id];
		btn.textContent = cached ? "توضیح این خبر" : "توضیح این خبر";
		if (cached) show(cached.text, cached.stamp);

		btn.addEventListener("click", function () {
			if (!out.hidden) { out.hidden = true; return; }
			if (state.explain[e.event_id]) {
				var c = state.explain[e.event_id];
				show(c.text, c.stamp);
				return;
			}
			btn.disabled = true;
			btn.textContent = "در حال نوشتن…";
			haptic();
			call({ action: "explain", event_id: e.event_id }).then(function (body) {
				if (body && body.available && body.answer) {
					var stamp = "";
					if (body.created_at) {
						var d = new Date(body.created_at);
						if (!isNaN(d.getTime())) {
							stamp = "تهیه‌شده در " + d.toLocaleTimeString("en-GB",
								{ hour: "2-digit", minute: "2-digit" });
						}
					}
					state.explain[e.event_id] = { text: body.answer, stamp: stamp };
					show(body.answer, stamp);
				} else {
					out.hidden = false;
					out.textContent = "توضیحِ این خبر فعلاً در دسترس نیست.";
				}
			}).catch(function () {
				out.hidden = false;
				out.textContent = "دریافت توضیح ناموفق بود. دوباره بزن.";
			}).then(function () {
				btn.disabled = false;
				btn.textContent = "توضیح این خبر";
			});
		});

		wrap.appendChild(btn);
		wrap.appendChild(out);
		return wrap;
	}

	/**
	 * متنِ سرور با چند تگِ ساده، بدونِ innerHTML.
	 *
	 * پاسخِ مدل <b> و <i> دارد. innerHTML اینجا یعنی هر چیزی که از آن
	 * سمت بیاید اجرا می‌شود؛ به‌جایش متن تکه‌تکه می‌شود و فقط همین دو
	 * تگ به عنصرِ واقعی تبدیل می‌شوند - بقیه متنِ خام می‌مانند.
	 */
	function safeRich(text) {
		var frag = document.createDocumentFragment();
		var re = /<(\/?)(b|i|u|code)>/gi;
		var stack = [frag], m, last = 0, s = String(text || "");
		while ((m = re.exec(s))) {
			if (m.index > last) stack[stack.length - 1].appendChild(
				document.createTextNode(s.slice(last, m.index)));
			if (m[1]) { if (stack.length > 1) stack.pop(); }
			else {
				var node = el(m[2].toLowerCase(), null);
				stack[stack.length - 1].appendChild(node);
				stack.push(node);
			}
			last = m.index + m[0].length;
		}
		if (last < s.length) stack[stack.length - 1].appendChild(
			document.createTextNode(s.slice(last)));
		return frag;
	}

	function buildGauge(e, f, a, p) {
		var g = el("div", "gauge");
		// دامنه: پیش‌بینی وسط، و بزرگ‌ترین انحراف لبه را تعیین می‌کند.
		var spread = Math.max(Math.abs(a - f), p !== null ? Math.abs(p - f) : 0);
		if (!spread) spread = Math.abs(f) * .05 || 1;
		var span = spread * 2.4;
		function at(v) { return Math.max(4, Math.min(96, 50 + ((v - f) / span) * 100)); }

		g.appendChild(el("div", "gauge-rail"));
		var mid = at(f), av = at(a);
		var fill = el("div", "gauge-fill " + (e.read ? (e.read.good ? "is-up" : "is-down") : ""));
		fill.style.insetInlineStart = Math.min(mid, av) + "%";
		fill.style.width = Math.abs(av - mid) + "%";
		g.appendChild(fill);

		var pinF = el("div", "gauge-pin");
		pinF.style.insetInlineStart = mid + "%";
		g.appendChild(pinF);
		var labF = el("div", "gauge-lab", "پیش‌بینی");
		labF.style.insetInlineStart = mid + "%";
		g.appendChild(labF);

		if (p !== null) {
			var pinP = el("div", "gauge-pin");
			pinP.style.insetInlineStart = at(p) + "%";
			pinP.style.opacity = ".5";
			g.appendChild(pinP);
		}

		var val = el("div", "gauge-val " + (e.read ? (e.read.good ? "is-up" : "is-down") : ""), String(e.actual));
		val.style.insetInlineStart = av + "%";
		val.style.color = e.read ? (e.read.good ? "var(--up)" : "var(--down)") : "var(--text)";
		g.appendChild(val);
		return g;
	}

	function sparkline(e) {
		var rows = (e.history || []).filter(function (h) { return typeof h.value === "number"; });
		if (rows.length < 3) return null;
		var ordered = rows.slice().reverse();
		var vals = ordered.map(function (h) { return h.value; });
		var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
		var span = hi - lo || 1;
		var wrap = el("div", null);
		var bars = el("div", "spark");
		ordered.forEach(function (h) {
			var good = e.direction === "inverse" ? !(h.beat > 0) : (h.beat > 0);
			var i = el("i", h.beat === 0 ? "" : (good ? "up" : "down"));
			i.style.height = (20 + ((h.value - lo) / span) * 80) + "%";
			bars.appendChild(i);
		});
		wrap.appendChild(bars);
		wrap.appendChild(el("div", "spark-k", fa(ordered.length) + " انتشار اخیر"));
		return wrap;
	}

	// ── تنظیمات ─────────────────────────────────────────────────────
	function viewMe() {
		tickers = [];
		var wrap = el("div", null);
		var sub = state.data && state.data.subscription;

		// اهمیت
		var g1 = el("div", "group");
		g1.appendChild(el("div", "group-k", "سطح اهمیت"));
		var b1 = el("div", "group-box");
		LEVELS.forEach(function (l) {
			var row = el("div", "line");
			// همان نشانی که در فهرستِ خبرها دیده می‌شود، نه یک نقطه‌ی
			// رنگیِ دیگر: کاربر باید بتواند سوییچِ اینجا را به چیزی که
			// آنجا می‌بیند وصل کند.
			row.appendChild(impMark(l.key));
			var m = el("div", "line-main");
			m.appendChild(el("div", "line-t", l.fa));
			m.appendChild(el("div", "line-s n", l.en));
			row.appendChild(m);
			var sw = el("button", "sw");
			sw.type = "button";
			sw.setAttribute("role", "switch");
			sw.setAttribute("aria-checked", state.levels[l.key] ? "true" : "false");
			sw.setAttribute("aria-label", l.fa);
			sw.addEventListener("click", function () {
				state.levels[l.key] = !state.levels[l.key];
				sw.setAttribute("aria-checked", state.levels[l.key] ? "true" : "false");
				store(LEVELS_KEY, JSON.stringify(state.levels));
				haptic("select");
			});
			row.appendChild(sw);
			b1.appendChild(row);
		});
		g1.appendChild(b1);
		wrap.appendChild(g1);

		// ارزها
		if (sub) {
			var g2 = el("div", "group");
			g2.appendChild(el("div", "group-k", "ارزهای من"));
			var b2 = el("div", "group-box");
			var grid = el("div", "cur-grid");
			CURRENCIES.forEach(function (c) {
				var on = (sub.currencies || []).indexOf(c.code) !== -1;
				var b = el("button", "cur");
				b.type = "button";
				b.setAttribute("aria-pressed", on ? "true" : "false");
				b.setAttribute("aria-label", c.fa);
				b.appendChild(flagNode(c.code));
				b.appendChild(el("span", "code", c.code));
				b.addEventListener("click", function () {
					var list = (sub.currencies || []).slice();
					var i = list.indexOf(c.code);
					if (i === -1) list.push(c.code);
					else if (list.length > 1) list.splice(i, 1);
					else return;
					sub.currencies = list;
					b.setAttribute("aria-pressed", list.indexOf(c.code) !== -1 ? "true" : "false");
					haptic("select");
					save();
				});
				grid.appendChild(b);
			});
			b2.appendChild(grid);
			g2.appendChild(b2);
			wrap.appendChild(g2);

			// هشدار
			var g3 = el("div", "group");
			g3.appendChild(el("div", "group-k", "هشدار پیش از خبر"));
			var b3 = el("div", "group-box");
			b3.appendChild(switchLine("دریافت هشدار",
				(sub.currencies || []).join(" · ") || "هیچ ارزی انتخاب نشده",
				sub.subscribed, function (v) { sub.subscribed = v; save(); }));

			var minsWrap = el("div", "line");
			minsWrap.style.cssText = "display:block;padding-bottom:0";
			minsWrap.appendChild(el("div", "line-t", "چند دقیقه قبل"));
			b3.appendChild(minsWrap);
			var mins = el("div", "mins");
			[5, 15, 30, 60].forEach(function (m) {
				var b = el("button", null, fa(m));
				b.type = "button";
				b.className = "";
				b.setAttribute("aria-pressed", Number(sub.alert_minutes) === m ? "true" : "false");
				b.addEventListener("click", function () {
					sub.alert_minutes = m;
					Array.prototype.forEach.call(mins.children, function (x) {
						x.setAttribute("aria-pressed", x === b ? "true" : "false");
					});
					haptic("select");
					save();
				});
				mins.appendChild(b);
			});
			b3.appendChild(mins);

			b3.appendChild(switchLine("خبرهای کم‌اهمیت هم بیاید",
				"پیش‌فرض: فقط مهم و متوسط",
				sub.show_low_importance, function (v) { sub.show_low_importance = v; save(); }));
			g3.appendChild(b3);
			wrap.appendChild(g3);
		}

		// نمایش
		var g4 = el("div", "group");
		g4.appendChild(el("div", "group-k", "نمایش"));
		var b4 = el("div", "group-box");
		var zrow = el("div", "line is-tap");
		var zm = el("div", "line-main");
		zm.appendChild(el("div", "line-t", "منطقه‌ی زمانی"));
		zm.appendChild(el("div", "line-s", "همه‌ی ساعت‌ها با این منطقه نشان داده می‌شوند"));
		zrow.appendChild(zm);
		zrow.appendChild(el("span", "line-val", viewZone.name));
		zrow.addEventListener("click", openZones);
		b4.appendChild(zrow);
		g4.appendChild(b4);
		wrap.appendChild(g4);

		var note = el("p", null);
		note.style.cssText = "margin:24px 4px 0;font-size:11px;line-height:1.9;color:var(--faint);text-align:center";
		note.innerHTML = "داده از ForexFactory و BEA · خوانش تأثیر یک برداشت کلی است، نه سیگنال معاملاتی.";
		wrap.appendChild(note);
		return wrap;
	}

	function switchLine(title, subtitle, on, onChange) {
		var row = el("div", "line");
		var m = el("div", "line-main");
		m.appendChild(el("div", "line-t", title));
		if (subtitle) m.appendChild(el("div", "line-s", subtitle));
		row.appendChild(m);
		var sw = el("button", "sw");
		sw.type = "button";
		sw.setAttribute("role", "switch");
		sw.setAttribute("aria-checked", on ? "true" : "false");
		sw.setAttribute("aria-label", title);
		sw.addEventListener("click", function () {
			var v = sw.getAttribute("aria-checked") !== "true";
			sw.setAttribute("aria-checked", v ? "true" : "false");
			haptic("select");
			onChange(v);
		});
		row.appendChild(sw);
		return row;
	}

	/**
	 * ذخیره‌ی ترجیح‌ها.
	 *
	 * اگر ذخیره‌ای در راه باشد، تغییرِ تازه *دور ریخته نمی‌شود* - علامت
	 * می‌خورد و بعد از برگشتِ اولی دوباره فرستاده می‌شود.
	 *
	 * نسخه‌ی قبلی در این حالت بی‌صدا return می‌کرد، و تستِ ناوبری همان را
	 * گرفت: وقتی کاربر سریع دو تنظیم را عوض می‌کند - مثلاً ارز و بعد
	 * دقیقه‌ی هشدار - دومی هرگز به سرور نمی‌رسید و صفحه هم چیزی نمی‌گفت.
	 */
	function save() {
		if (!state.data || !state.data.subscription) return;
		if (state.saving) { state.savePending = true; return; }
		state.saving = true;
		state.savePending = false;
		var s = state.data.subscription;
		call({
			action: "subscribe",
			subscribed: s.subscribed,
			alert_minutes: s.alert_minutes,
			show_low_importance: s.show_low_importance,
			currencies: s.currencies
		}).then(function (body) {
			// مقدارِ ذخیره‌شده مرجع است، نه چیزی که فرستادیم - سرور ممکن
			// است کدی را دور ریخته باشد.
			//
			// ولی *درجا* نوشته می‌شود، نه با جای‌گزینیِ خودِ شیء: کنترل‌های
			// تنظیمات به همین شیء ارجاع دارند، و عوض کردنِ مرجع یعنی هر
			// تغییرِ بعدیِ کاربر روی یک شیءِ جدامانده می‌نشیند و بی‌صدا گم
			// می‌شود. تستِ ناوبری همین را گرفت: دقیقه‌ی هشدار عوض می‌شد و
			// هیچ‌وقت به سرور نمی‌رسید.
			if (body && body.subscription) {
				var fresh = body.subscription;
				for (var k in fresh) if (Object.prototype.hasOwnProperty.call(fresh, k)) s[k] = fresh[k];
			}
		}).catch(function () { /* بی‌صدا: تلاشِ بعدی خودش می‌فرستد */ })
			.then(function () {
				state.saving = false;
				if (state.savePending) save();
			});
	}

	// ── ورقِ پایین ──────────────────────────────────────────────────
	function openSheet(title, build) {
		$("sheetTitle").textContent = title;
		var body = $("sheetBody");
		body.textContent = "";
		build(body);
		$("scrim").hidden = false;
		$("sheet").hidden = false;
		haptic();
	}
	function closeSheet() {
		$("scrim").hidden = true;
		$("sheet").hidden = true;
	}

	function openSession(s) {
		var now = new Date();
		var st = sessionState(s, now);
		var hol = holidayToday(s);
		openSheet(s.name + (s.sub ? " · " + s.sub : ""), function (body) {
			var head = el("div", null);
			head.style.cssText = "font-size:12.5px;color:var(--dim);margin-bottom:4px";
			head.textContent = hol ? ("امروز تعطیل است — " + (hol.name || ""))
				: (st.open ? "همین حالا باز است" : "الان بسته است");
			body.appendChild(head);

			var ref = st.open ? { open: st.since, close: st.until }
				: (st.nextOpen ? { open: st.nextOpen, close: st.nextClose } : null);
			var facts = el("div", "sess-facts");
			function fact(k, v, live) {
				var c = el("div", "sess-fact");
				c.appendChild(el("div", "k", k));
				c.appendChild(el("div", "v" + (live ? " is-live" : ""), v));
				facts.appendChild(c);
			}
			if (ref) {
				fact("به وقت " + viewZone.name,
					hhmmInZone(ref.open, VIEW()) + "–" + hhmmInZone(ref.close, VIEW()));
				fact("به وقت محلی",
					hhmmInZone(ref.open, s.zone) + "–" + hhmmInZone(ref.close, s.zone));
				fact(st.open ? "تا بسته شدن" : "تا باز شدن",
					until(st.open ? ref.close : ref.open), true);
			}
			body.appendChild(facts);

			var all = el("div", null);
			all.style.cssText = "margin-top:20px";
			all.appendChild(el("div", "group-k", "بقیه‌ی بازارها"));
			SESSIONS.forEach(function (x) {
				if (x.key === s.key) return;
				var xs = sessionState(x, now);
				var row = el("button", "pick");
				row.type = "button";
				var dot = el("span", "kdot");
				dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:var(--k-" + x.key + ")";
				row.appendChild(dot);
				row.appendChild(el("span", null, x.name));
				row.appendChild(el("span", "pick-now n",
					xs.open ? "باز" : (xs.nextOpen ? hhmmInZone(xs.nextOpen, VIEW()) : "—")));
				row.addEventListener("click", function () { openSession(x); });
				all.appendChild(row);
			});
			body.appendChild(all);
		});
	}

	function openZones() {
		openSheet("منطقه‌ی زمانی", function (body) {
			var now = new Date();
			ZONES.forEach(function (z) {
				var b = el("button", "pick");
				b.type = "button";
				b.setAttribute("role", "radio");
				b.setAttribute("aria-checked", z.key === viewZone.key ? "true" : "false");
				var tick = svgEl("svg", { class: "pick-tick", viewBox: "0 0 24 24", width: "17", height: "17", fill: "none", stroke: "currentColor", "stroke-width": "2.4", "stroke-linecap": "round" });
				tick.appendChild(svgEl("path", { d: "M5 12.5l4.5 4.5L19 7.5" }));
				b.appendChild(tick);
				var nm = el("span", null, z.name);
				// زیرنویس فقط جایی که نام به‌تنهایی گویا نیست - «بروکر»
				// یک شهر نیست و باید گفته شود منظور ساعتِ سرور است.
				if (z.sub) nm.appendChild(el("i", "pick-sub", z.sub));
				b.appendChild(nm);
				b.appendChild(el("span", "pick-off n", offsetLabel(z.zone, now)));
				b.appendChild(el("span", "pick-now n", hhmmInZone(now.getTime(), z.zone)));
				b.addEventListener("click", function () {
					viewZone = z;
					store(VIEW_KEY, z.key);
					haptic("select");
					closeSheet();
					render();
				});
				body.appendChild(b);
			});
		});
	}

	// ── ناوبری ──────────────────────────────────────────────────────
	var ROUTES = [["navNow", "now"], ["navCal", "cal"], ["navMe", "me"]];

	function syncDock() {
		var idx = 0;
		ROUTES.forEach(function (p, i) {
			var on = p[1] === state.route;
			$(p[0]).setAttribute("aria-selected", on ? "true" : "false");
			if (on) idx = i;
		});
		// در راست‌به‌چپ، گزینه‌ی اول سمتِ راست است؛ نشانگر باید به چپ برود.
		$("dockPill").style.transform = "translateX(" + (-idx * 100) + "%)";
	}

	function go(route) {
		if (state.route === route) {
			window.scrollTo({ top: 0, behavior: "smooth" });
			return;
		}
		state.route = route;
		store(ROUTE_KEY, route);
		haptic("select");
		render();
		window.scrollTo({ top: 0 });
	}

	ROUTES.forEach(function (p) {
		$(p[0]).addEventListener("click", function () { go(p[1]); });
	});
	$("btnZone").addEventListener("click", openZones);
	$("scrim").addEventListener("click", closeSheet);
	$("sheetClose").addEventListener("click", closeSheet);
	document.addEventListener("keydown", function (ev) {
		if (ev.key === "Escape" && !$("sheet").hidden) closeSheet();
	});

	$("btnRefresh").addEventListener("click", function () {
		var b = this;
		if (b.classList.contains("is-busy")) return;
		b.classList.add("is-busy");
		haptic();
		load().then(function () { b.classList.remove("is-busy"); });
	});

	// ── تم ──────────────────────────────────────────────────────────
	function applyScheme() {
		// تمِ تلگرام دیگر خوانده نمی‌شود: اپ یک تم دارد و آن تیره است.
		// تنها کاری که اینجا می‌ماند هم‌رنگ کردنِ نوارِ خودِ تلگرام با
		// زمینه است، وگرنه بالای صفحه یک نوارِ روشن می‌ماند.
		if (!tg) return;
		if (tg.setHeaderColor) {
			var st = getComputedStyle(document.documentElement);
			try { tg.setHeaderColor(st.getPropertyValue("--bg").trim()); } catch (e) { /* older clients */ }
		}
	}

	// ── راه‌اندازی ──────────────────────────────────────────────────
	loadPrefs();

	if (tg) {
		tg.ready();
		tg.expand();
		applyScheme();
		if (tg.onEvent) {
			try { tg.onEvent("themeChanged", applyScheme); } catch (e) { /* older clients */ }
		}
	}

	syncDock();

	if (!tg || !tg.initData) {
		state.failure = { msg: "این صفحه باید از داخل ربات تلگرام باز بشه.", retry: false };
		render();
	} else {
		render();
		load();
	}

	// ثانیه‌شمارها. یک تایمر برای همه، نه یکی برای هر عنصر.
	setInterval(function () {
		for (var i = 0; i < tickers.length; i++) {
			try { tickers[i](); } catch (e) { /* یک تیکِ خراب بقیه را نمی‌خواباند */ }
		}
	}, 1000);

	// هر پنج دقیقه داده تازه می‌شود، ولی فقط وقتی صفحه دیده می‌شود.
	setInterval(function () {
		if (document.visibilityState === "visible" && state.data && !state.failure) load();
	}, 5 * 60000);
})();
