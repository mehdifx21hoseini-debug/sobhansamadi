// موتورِ سشن‌های بازار.
//
// ─── چرا فایلِ جدا ──────────────────────────────────────────────────
//
// این ۱۵۰ خط تنها بخشِ اپ است که هیچ وابستگی‌ای به DOM ندارد: ورودی‌اش
// یک لحظه است و خروجی‌اش «کدام بازار باز است». یعنی دقیقاً همان چیزی
// که می‌شود بی‌مرورگر تستش کرد - و تا امروز نمی‌شد.
//
// تستِ engine برای رسیدن به این توابع، متنِ app.js را با indexOf
// می‌بُرید و با new Function اجرا می‌کرد. آن ترفند یک بار شکست: وقتی
// بازطراحی برگردانده شد فایلِ منبع جابه‌جا شد و تست ماه‌ها قرمز ماند،
// بی‌آنکه چیزی در محصول خراب باشد.
//
// ─── چطور به اپ می‌رسد ─────────────────────────────────────────────
//
// خروجی هنوز تک‌فایل است: scripts/build-econ-app.mjs این فایل را پیش
// از app.js می‌چسباند و «export » را برمی‌دارد. پس در مرورگر همان یک
// دامنه‌ی قبلی است، و در تست یک ماژولِ واقعی که import می‌شود.
//
// قاعده‌ی این پوشه: هیچ ارجاعی به document و window، و هیچ وابستگی به
// بقیه‌ی اپ. همین است که تست‌پذیرش می‌کند.

export var SESSIONS = [
	{ key: "sydney", name: "سیدنی", flag: "au", zone: "Australia/Sydney", open: 7, close: 16 },
	{ key: "tokyo", name: "توکیو", flag: "jp", zone: "Asia/Tokyo", open: 9, close: 18 },
	{ key: "london", name: "لندن", flag: "gb", zone: "Europe/London", open: 8, close: 17 },
	{ key: "newyork", name: "نیویورک", flag: "us", zone: "America/New_York", open: 8, close: 17 },
	// The stock exchange, not the forex session: a narrower window
	// inside it, and where the equity open drives the dollar.
	{ key: "nyse", name: "بورس نیویورک", sub: "NYSE", flag: "us", zone: "America/New_York", open: 9, openMin: 30, close: 16 }
];

export function sessionByKey(key) {
	for (var i = 0; i < SESSIONS.length; i++) {
		if (SESSIONS[i].key === key) return SESSIONS[i];
	}
	return null;
}

// Brokers stop trading for one hour at the daily rollover: 00:00–01:00
// on a GMT+3 server, which is 00:30–01:30 Tehran. Both clocks are
// fixed-offset, so the window is 21:00–22:00 UTC all year and does not
// move with anyone's DST.
var BREAK_START_UTC = 21 * 60;
var BREAK_END_UTC = 22 * 60;

export function inDailyBreak(instant) {
	var d = new Date(instant);
	var m = d.getUTCHours() * 60 + d.getUTCMinutes();
	return m >= BREAK_START_UTC && m < BREAK_END_UTC;
}

// The end of the break window containing or following `instant`.
export function breakEndAfter(instant) {
	var d = new Date(instant);
	var end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, BREAK_END_UTC);
	return end > instant ? end : end + 86400000;
}

export function breakStartAfter(instant) {
	var d = new Date(instant);
	var start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, BREAK_START_UTC);
	return start > instant ? start : start + 86400000;
}

export function tzParts(date, timeZone) {
	var dtf = new Intl.DateTimeFormat("en-US", {
		timeZone: timeZone, hour12: false,
		year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short"
	});
	var p = {};
	dtf.formatToParts(date).forEach(function (x) { if (x.type !== "literal") p[x.type] = x.value; });
	return p;
}

export function tzOffsetMinutes(date, timeZone) {
	var p = tzParts(date, timeZone);
	var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
	return Math.round((asUTC - date.getTime()) / 60000);
}

// The UTC instant of a wall-clock time on a local calendar date. Two
// passes settle the case where the first guess lands on the far side
// of a DST transition.
export function instantAt(y, m, d, hour, minute, timeZone) {
	var guess = Date.UTC(y, m - 1, d, hour, minute);
	for (var i = 0; i < 2; i++) {
		guess = Date.UTC(y, m - 1, d, hour, minute) - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
	}
	return guess;
}

export function localDatePlus(now, timeZone, offset) {
	var p = tzParts(now, timeZone);
	var shifted = new Date(Date.UTC(+p.year, +p.month - 1, +p.day) + offset * 86400000);
	return {
		y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1,
		d: shifted.getUTCDate(), dow: shifted.getUTCDay()
	};
}

export function occurrences(session, now, fromDay, toDay) {
	var out = [];
	for (var off = fromDay; off <= toDay; off++) {
		var dt = localDatePlus(now, session.zone, off);
		if (dt.dow === 0 || dt.dow === 6) continue; // markets rest at the weekend
		out.push({
			open: instantAt(dt.y, dt.m, dt.d, session.open, session.openMin || 0, session.zone),
			close: instantAt(dt.y, dt.m, dt.d, session.close, session.closeMin || 0, session.zone),
			dow: dt.dow
		});
	}
	return out.sort(function (a, b) { return a.open - b.open; });
}

export function sessionState(session, now) {
	var t = now.getTime();
	var occ = occurrences(session, now, -2, 5);
	for (var i = 0; i < occ.length; i++) {
		if (t >= occ[i].open && t < occ[i].close) return { open: true, since: occ[i].open, until: occ[i].close };
	}
	for (var j = 0; j < occ.length; j++) {
		if (occ[j].open > t) return { open: false, nextOpen: occ[j].open, nextClose: occ[j].close };
	}
	return { open: false };
}

// The forex week runs from the Sydney open on Monday to the New York
// close on Friday. Quiet gaps between sessions inside that week are
// not closures, so they must not be reported as one.
export function marketState(now) {
	var t = now.getTime();
	// Looked up by key, not index: the list is edited from time to
	// time and a shifted index would silently redefine the week.
	// The week does not begin with the Sydney bell: the first hour
	// of Monday's server day is the daily settlement window, so the
	// broker starts quoting when that window ends - 01:30 Tehran -
	// even though Sydney itself rings in earlier.
	var mondayOpens = occurrences(sessionByKey("sydney"), now, -9, 9)
		.filter(function (o) { return o.dow === 1; })
		.map(function (o) { return { open: Math.max(o.open, breakEndAfter(o.open - 1)), dow: o.dow }; });
	var fridayCloses = occurrences(sessionByKey("newyork"), now, -9, 9).filter(function (o) { return o.dow === 5; });

	var lastOpen = null;
	mondayOpens.forEach(function (o) { if (o.open <= t) lastOpen = o.open; });
	var matchingClose = null;
	for (var j = 0; j < fridayCloses.length; j++) {
		if (lastOpen !== null && fridayCloses[j].close > lastOpen) { matchingClose = fridayCloses[j].close; break; }
	}
	if (lastOpen !== null && matchingClose !== null && t >= lastOpen && t < matchingClose) {
		// Inside the trading week, but the broker still shuts for the
		// daily rollover hour. Report that as its own state: it is not
		// the weekend close, and it ends within the hour.
		if (inDailyBreak(t)) {
			return { open: false, onBreak: true, until: matchingClose, resumesAt: breakEndAfter(t) };
		}
		return { open: true, until: matchingClose };
	}
	var nextOpen = null;
	for (var k = 0; k < mondayOpens.length; k++) {
		if (mondayOpens[k].open > t) { nextOpen = mondayOpens[k].open; break; }
	}
	return { open: false, nextOpen: nextOpen };
}

export function hhmmInZone(instant, timeZone) {
	var p = tzParts(new Date(instant), timeZone);
	return (p.hour % 24 < 10 ? "0" : "") + (p.hour % 24) + ":" + p.minute;
}

// A real ticking counter rather than prose. Beyond a day the seconds
// stop meaning anything, so the day count leads and the clock follows.
