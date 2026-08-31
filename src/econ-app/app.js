		(function () {
			"use strict";

			// The Worker, not n8n directly. Both the bot and this page now read
			// the same D1 mirror, so an n8n outage no longer empties the
			// calendar — it only makes the data a little stale. Alert settings
			// live in D1 too, in the same table the bot's buttons write to.
			//
			// There used to be a fallback to the old n8n endpoint here, for the
			// window where this page was deployed but the Worker was not. It has
			// been removed, and its removal matters: n8n still answers that URL,
			// but it reads and writes its own subscription table — the one that
			// nothing sends from any more. A user who saved a setting through
			// that fallback would see it accepted and would never get the alert.
			// A visible error is the honest answer; a write into an abandoned
			// table is not.
			var API = "https://sobhansamadi.mehdifx21hoseini.workers.dev/econ/miniapp";
			var tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

			// The palette is the academy's, not Telegram's; the only thing taken
			// from the client is whether the user is in light or dark mode. With
			// no stamp the stylesheet falls back to the OS preference.
			function applyScheme() {
				if (!tg || !tg.colorScheme) return;
				document.documentElement.setAttribute("data-theme", tg.colorScheme === "dark" ? "dark" : "light");
				// Match the Telegram title bar to our own ground so the app does
				// not sit in a differently coloured frame.
				if (tg.setHeaderColor) {
					var style = getComputedStyle(document.documentElement);
					try { tg.setHeaderColor(style.getPropertyValue("--bg").trim()); } catch (e) { /* older clients accept named values only */ }
				}
			}

			var state = {
				scope: "today",
				importance: "all",
				data: null,
				// The last load failure, kept so a tab switch can put the
				// message and its retry button back instead of a blank list.
				failure: null,
				open: {},
				saving: false,
				refreshing: false,
				monthOffset: 0,
				selectedDay: null,
				query: ""
			};

			// ---------- Jalali ----------
			function div(a, b) { return Math.floor(a / b); }

			function toJalali(gy, gm, gd) {
				var gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
				var jy = (gy <= 1600) ? 0 : 979;
				gy -= (gy <= 1600) ? 621 : 1600;
				var gy2 = (gm > 2) ? (gy + 1) : gy;
				var days = (365 * gy) + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + gdm[gm - 1];
				jy += 33 * div(days, 12053);
				days %= 12053;
				jy += 4 * div(days, 1461);
				days %= 1461;
				if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
				var jm, jd;
				if (days < 186) { jm = 1 + div(days, 31); jd = 1 + (days % 31); }
				else { jm = 7 + div(days - 186, 30); jd = 1 + ((days - 186) % 30); }
				return [jy, jm, jd];
			}

			// Jalali -> Gregorian, needed to lay out a Persian month on a grid.
			// Round-tripped against toJalali for every day of 2024-2028.
			function toGregorian(jy, jm, jd) {
				var gy = (jy <= 979) ? 621 : 1600;
				jy -= (jy <= 979) ? 0 : 979;
				var days = (365 * jy) + (div(jy, 33) * 8) + div((jy % 33) + 3, 4) + 78 + jd +
					((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
				gy += 400 * div(days, 146097);
				days %= 146097;
				if (days > 36524) {
					gy += 100 * div(--days, 36524);
					days %= 36524;
					if (days >= 365) days++;
				}
				gy += 4 * div(days, 1461);
				days %= 1461;
				if (days > 365) { gy += div(days - 1, 365); days = (days - 1) % 365; }
				var gd = days + 1;
				var leap = (gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0);
				var lengths = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
				var gm;
				for (gm = 0; gm < 13; gm++) {
					if (gd <= lengths[gm]) break;
					gd -= lengths[gm];
				}
				return [gy, gm, gd];
			}

			function isoOf(gy, gm, gd) {
				return gy + "-" + (gm < 10 ? "0" : "") + gm + "-" + (gd < 10 ? "0" : "") + gd;
			}

			var MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
				"مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
			var WEEKDAYS = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];

			function fa(n) {
				return String(n).replace(/[0-9]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹"[d]; });
			}

			function jalaliLabel(dateStr) {
				var p = dateStr.split("-").map(Number);
				var j = toJalali(p[0], p[1], p[2]);
				var wd = WEEKDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
				return wd + " " + fa(j[2]) + " " + MONTHS[j[1] - 1];
			}

			function relDay(dateStr) {
				var today = state.data ? state.data.today : new Date().toISOString().slice(0, 10);
				var a = new Date(today + "T00:00:00");
				var b = new Date(dateStr + "T00:00:00");
				var diff = Math.round((b - a) / 86400000);
				if (diff === 0) return "امروز";
				if (diff === 1) return "فردا";
				if (diff < 0) return "";
				return fa(diff) + " روز دیگر";
			}

			// ---------- helpers ----------
			function el(tag, cls, text) {
				var n = document.createElement(tag);
				if (cls) n.className = cls;
				if (text !== undefined && text !== null) n.textContent = text;
				return n;
			}

			function haptic(kind) {
				try {
					if (tg && tg.HapticFeedback) {
						if (kind === "select") tg.HapticFeedback.selectionChanged();
						else tg.HapticFeedback.impactOccurred("light");
					}
				} catch (e) { /* haptics are a nicety, never a failure */ }
			}

			// Persian text arrives with both Arabic and Persian forms of the same
			// letters, plus zero-width joiners, so a raw indexOf misses obvious
			// matches. Fold them before comparing.
			function normalize(s) {
				return String(s || "")
					// Arabic forms of Persian letters: a phone keyboard may emit
					// either, and the stored data mixes both.
					.replace(/[يىﻱﻲ]/g, "ی")
					.replace(/[كﻙﻚ]/g, "ک")
					.replace(/[أإآٱ]/g, "ا")
					.replace(/ة/g, "ه")
					.replace(/ـ/g, "")
					.replace(/[ً-ْ]/g, "")
					// Compound words are written with a zero-width joiner but
					// typed with a space, or with neither. Dropping every
					// separator makes all three spellings compare equal:
					// "مصرف‌کننده", "مصرف کننده" and "مصرفکننده".
					.replace(/[\s​-‏‪-‮]/g, "")
					.toLowerCase();
			}

			function matchesQuery(e) {
				if (!state.query) return true;
				var q = normalize(state.query);
				if (!q) return true;
				return normalize(e.title).indexOf(q) !== -1 ||
					normalize(e.short).indexOf(q) !== -1 ||
					normalize(e.en).indexOf(q) !== -1;
			}

			function visibleEvents() {
				if (!state.data) return [];
				var today = state.data.today;

				// A search is about finding one indicator, not about the tab the
				// reader happens to be on, so it looks across everything loaded.
				if (state.query) {
					return state.data.events.filter(function (e) {
						if (state.importance === "high" && e.importance !== "high") return false;
						if (state.importance === "medium" && e.importance === "low") return false;
						return matchesQuery(e);
					});
				}
				// The payload now reaches 45 days out for the month grid, so the
				// week tab has to cap its own range rather than show everything.
				var weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
				return state.data.events.filter(function (e) {
					if (state.scope === "today" && e.date !== today) return false;
					if (state.scope === "week" && e.date > weekEnd) return false;
					if (state.importance === "high" && e.importance !== "high") return false;
					if (state.importance === "medium" && e.importance === "low") return false;
					return true;
				});
			}

			// ---------- rendering ----------
			function todaysEvents() {
				if (!state.data) return [];
				var today = state.data.today;
				return state.data.events.filter(function (e) { return e.date === today; });
			}

			function renderHero() {
				var d = state.data;
				var todays = todaysEvents();
				var highs = todays.filter(function (e) { return e.importance === "high"; }).length;
				var sub;

				if (todays.length === 0) {
					// Weekends and US bank holidays have no releases at all. Say
					// that plainly and point at the next one, instead of leaving
					// the screen looking like it failed to load.
					var next = d.events.length > 0 ? d.events[0] : null;
					sub = "امروز خبری برای دلار نیست";
					if (next) sub += " — بعدی " + relDay(next.date) + "، " + (next.en || next.title);
				} else {
					// بدون خطاب. نامِ نمایشیِ تلگرام هرچیزی می‌تواند باشد - نام
					// یک کانال، یک اکانت کاری، یا رشته‌ای از ایموجی - و
					// «… عزیز» چسبیده به آن، جمله‌ای می‌ساخت که گاهی بی‌معنی
					// بود. تازه فرض می‌کرد خواننده دانشجوی ماست، که همیشه
					// درست نیست: این اپ را هرکسی می‌تواند باز کند.
					sub = "امروز " + fa(todays.length) + " رویداد برای دلار ثبت شده.";
				}
				document.getElementById("heroSub").textContent = sub;

				var pill = document.getElementById("riskPill");
				var txt = document.getElementById("riskText");
				var cls = "risk-pill ";
				if (highs === 0) { cls += "risk-low"; txt.textContent = todays.length === 0 ? "بدون خبر" : "نوسان کم"; }
				else if (highs <= 2) { cls += "risk-medium"; txt.textContent = "نوسان متوسط"; }
				else { cls += "risk-high"; txt.textContent = "نوسان بالا"; }
				pill.className = cls;
				pill.hidden = false;
			}

			function setScope(scope) {
				// Arriving at the markets tab is what earns the entrance
				// animation. The per-second redraws must not replay it.
				if (scope === "markets" && state.scope !== "markets") marketsEntering = true;
				state.scope = scope;
				document.getElementById("tabToday").setAttribute("aria-selected", scope === "today" ? "true" : "false");
				document.getElementById("tabWeek").setAttribute("aria-selected", scope === "week" ? "true" : "false");
				document.getElementById("tabMonth").setAttribute("aria-selected", scope === "month" ? "true" : "false");
				document.getElementById("tabMarkets").setAttribute("aria-selected", scope === "markets" ? "true" : "false");

				// The event search, importance filter, countdown and alert cards
				// are all about releases; none of them apply to session hours.
				var eventOnly = scope !== "markets";
				document.querySelector(".search-row").hidden = !eventOnly;
				document.querySelector(".chips").hidden = !eventOnly;
				document.getElementById("aiCard").hidden = !eventOnly || !state.data;
				document.getElementById("alertsCard").hidden =
					!eventOnly || !state.data || !state.data.subscription;
				if (!eventOnly) document.getElementById("nextCard").hidden = true;
			}

			// Remembering the tab is a convenience, so every failure mode here is
			// silent — private mode, blocked storage, a throwing accessor.
			var SCOPE_KEY = "econAppScope";

			function readStoredScope() {
				try {
					var v = localStorage.getItem(SCOPE_KEY);
					return (v === "today" || v === "week" || v === "month" || v === "markets") ? v : null;
				} catch (e) { return null; }
			}

			function storeScope(scope) {
				try { localStorage.setItem(SCOPE_KEY, scope); } catch (e) { /* not important enough to surface */ }
			}

			var countdownTimer = null;
			// After the release minute the card holds a live «در حال انتشار»
			// state for up to this long, refreshing the data once a minute
			// until the actual lands and the card moves to the next event.
			var RELEASE_HOLD_MS = 15 * 60000;
			var releaseReloadAt = 0;

			function renderNext() {
				var card = document.getElementById("nextCard");
				var now = Date.now();
				// An event stays "next" through its own release window (until
				// the actual arrives) so the card can show it going out.
				var upcoming = state.data.events.filter(function (e) {
					if (!e.at || e.importance === "low") return false;
					var t = new Date(e.at).getTime();
					return t > now || (!e.actual && t > now - RELEASE_HOLD_MS);
				});
				if (upcoming.length === 0) { card.hidden = true; card.classList.remove("is-releasing"); return; }

				var next = upcoming[0];
				document.getElementById("nextName").textContent = next.en || next.title;
				card.hidden = false;

				function tick() {
					var v = document.getElementById("nextValue");
					var u = document.getElementById("nextUnit");
					var secs = Math.floor((new Date(next.at).getTime() - Date.now()) / 1000);
					if (secs <= 0) {
						if (secs < -RELEASE_HOLD_MS / 1000) {
							// The hold expired without an actual: give up on this
							// event and let the filter pick the next one.
							card.classList.remove("is-releasing");
							renderNext();
							return;
						}
						card.classList.add("is-releasing");
						v.textContent = "در حال انتشار";
						u.textContent = "منتظر عدد واقعی…";
						if (Date.now() - releaseReloadAt > 60000) {
							releaseReloadAt = Date.now();
							load();
						}
						return;
					}
					card.classList.remove("is-releasing");
					if (secs < 3600) {
						// The last hour counts down live, to the second.
						var s = secs % 60;
						v.textContent = fa(Math.floor(secs / 60)) + ":" + fa(s < 10 ? "0" + s : s);
						u.textContent = "دقیقه مانده";
					} else if (secs < 86400) {
						var h = Math.floor(secs / 3600), m = Math.floor(secs / 60) % 60;
						v.textContent = fa(h) + ":" + fa(m < 10 ? "0" + m : m);
						u.textContent = "ساعت مانده";
					} else {
						v.textContent = fa(Math.round(secs / 86400));
						u.textContent = "روز مانده";
					}
				}
				tick();
				if (countdownTimer) clearInterval(countdownTimer);
				countdownTimer = setInterval(tick, 1000);
			}

			// Past releases as a small bar chart: how this indicator has actually
			// been behaving, not just its last print. Bars are coloured by
			// whether each release beat its own forecast. Returns null when
			// there is no history, so nothing empty is ever drawn.
			function historyChart(e) {
				var rows = (e.history || []).filter(function (h) { return typeof h.value === "number"; });
				if (rows.length < 2) return null;

				var ordered = rows.slice().reverse(); // oldest first, reads left to right
				var values = ordered.map(function (h) { return h.value; });
				var max = Math.max.apply(null, values);
				var min = Math.min.apply(null, values);
				// Scale across the series' own range, not from zero. Claims run
				// around 206K-211K: measured from zero every bar would clamp to
				// full height and the chart would say nothing.
				var flat = max === min;
				var span = flat ? 1 : (max - min);

				var wrap = el("div", "hist");
				wrap.appendChild(el("div", "hist-title", "۵ انتشار اخیر"));

				var bars = el("div", "hist-bars");
				ordered.forEach(function (h) {
					var col = el("div", "hist-col");
					var bar = el("div", "hist-bar " +
						(h.beat > 0 ? "hist-up" : h.beat < 0 ? "hist-down" : "hist-flat"));
					var pct = flat ? 55 : Math.round(((h.value - min) / span) * 72) + 18;
					bar.style.height = Math.max(10, Math.min(100, pct)) + "%";
					bar.title = h.actual + (h.forecast ? " (پیش‌بینی " + h.forecast + ")" : "");
					col.appendChild(bar);
					col.appendChild(el("span", "hist-val", fa(h.actual)));
					col.appendChild(el("span", "hist-date", fa(h.date.slice(5).replace("-", "/"))));
					bars.appendChild(col);
				});
				wrap.appendChild(bars);
				wrap.appendChild(el("div", "hist-legend", "سبز: بالاتر از پیش‌بینی · قرمز: پایین‌تر"));
				return wrap;
			}

			// عددِ خام از رشته‌ی فید، برای حساب کردن سورپرایز. واحدها («%»،
			// «K»، «M») و کاماها کنار گذاشته می‌شوند و علامت منفی می‌ماند.
			function numOf(v) {
				var n = parseFloat(String(v == null ? "" : v).replace(/,/g, "").replace(/[^0-9.\-]/g, ""));
				return isNaN(n) ? null : n;
			}

			function unitOf(v) {
				var m = String(v == null ? "" : v).match(/[%KMBTkmbt]+\s*$/);
				return m ? m[0].trim() : "";
			}

			/**
			 * فاصله‌ی عدد واقعی از پیش‌بینی - همان چیزی که بازار را تکان
			 * می‌دهد و کارت قبلی هرگز نشانش نمی‌داد.
			 *
			 * ترتیب کلمه‌ها عمدی است: اول عدد، بعد جهت. رشته‌ای که با فلش
			 * شروع شود در راست‌به‌چپ برعکس خوانده می‌شود - «▲ ۰.۱% از
			 * پیش‌بینی» به چشم «از پیش‌بینی ۰.۱% ▲» می‌رسد.
			 */
			function surpriseOf(e) {
				var a = numOf(e.actual), f = numOf(e.forecast);
				if (a === null || f === null) return null;
				var d = a - f;
				// به همان دقتی که خودِ فید نوشته گرد می‌شود، وگرنه
				// ۰.۴ منهای ۰.۳ به‌صورت ۰.۱۰۰۰۰۰۰۰۰۰۰۰۰۰۰۰۳ چاپ می‌شد.
				var dec = ((String(e.forecast).replace(/[^0-9.]/g, "").split(".")[1]) || "").length;
				if (Math.abs(d) < Math.pow(10, -(dec + 1))) return { dir: "flat", text: "مطابق پیش‌بینی" };
				// جهتِ «خوب برای دلار» را سرور در e.read گفته - جایی که
				// برچسبِ شاخص می‌داند معکوس است یا نه. اینجا فقط بزرگی و
				// بالا/پایین بودن گفته می‌شود.
				return {
					dir: d > 0 ? "up" : "down",
					text: fa(Math.abs(d).toFixed(dec)) + unitOf(e.forecast) + (d > 0 ? " بالاتر" : " پایین‌تر")
				};
			}

			function eventNode(e) {
				var node = el("button", "event imp-" + (e.importance || "low"));
				node.type = "button";
				if (e.at && new Date(e.at).getTime() < Date.now()) node.className += " is-past";
				if (state.open[e.event_id]) node.className += " is-open";

				var top = el("div", "event-top");
				var time = el("div", "event-time");
				time.appendChild(document.createTextNode(fa((e.time_tehran || "—").replace("+1", ""))));
				if ((e.time_tehran || "").indexOf("+1") !== -1) {
					time.appendChild(el("span", "plus", "فردا"));
				}
				top.appendChild(time);

				var nm = el("div", "event-nm");
				// نام انگلیسی همان تیتر می‌ماند؛ ترجمه‌ی فارسی که تا امروز
				// فقط با باز کردن ردیف دیده می‌شد، یک خط ریز زیرش آمد.
				nm.appendChild(el("div", "event-title-en", e.en || e.title || e.short || ""));
				if (e.title && e.title !== (e.en || "")) {
					nm.appendChild(el("div", "event-fa", e.title));
				}
				top.appendChild(nm);
				node.appendChild(top);

				var s = surpriseOf(e);
				if (e.actual) {
					var vals = el("div", "vals");
					// رنگِ عدد از قضاوتِ سرور می‌آید (e.read) نه از بالا/پایین
					// بودنِ خام: برای شاخص‌های معکوس مثل نرخ بیکاری، «بالاتر»
					// یعنی بدتر.
					var tone = e.read ? (e.read.good ? " is-up" : " is-down") : "";
					var big = el("div", "val-big" + tone);
					big.appendChild(el("b", null, fa(e.actual)));
					big.appendChild(el("span", null, "واقعی"));
					vals.appendChild(big);

					if (s) {
						var sTone = s.dir === "flat" ? "is-flat" : (e.read ? (e.read.good ? "is-up" : "is-down") : "is-flat");
						vals.appendChild(el("div", "surprise " + sTone, s.text));
					}

					if (e.forecast) {
						var sm = el("div", "val-small");
						sm.appendChild(el("b", null, fa(e.forecast)));
						sm.appendChild(el("span", null, "پیش‌بینی"));
						vals.appendChild(sm);
					}
					node.appendChild(vals);
				} else if (e.forecast || e.previous) {
					var pend = el("div", "pending");
					pend.appendChild(el("span", "k", "پیش‌بینی"));
					pend.appendChild(el("b", null, fa(e.forecast || "—")));
					pend.appendChild(el("span", "k", "· قبلی"));
					pend.appendChild(el("b", null, fa(e.previous || "—")));
					node.appendChild(pend);
				}

				var detail = el("div", "event-detail");
				if (e.read) {
					detail.appendChild(el("div", "read " + (e.read.good ? "read-good" : "read-bad"),
						(e.read.higher ? "▲ بالاتر از پیش‌بینی — " : "▼ پایین‌تر از پیش‌بینی — ") +
						(e.read.good ? "معمولاً مثبت برای دلار" : "معمولاً منفی برای دلار")));
				}
				var chart = historyChart(e);
				if (chart) detail.appendChild(chart);
				var meta = el("div", "event-meta");
				meta.appendChild(el("span", null, "قبلی: " + fa(e.previous || "—")));
				meta.appendChild(el("span", null, "پیش‌بینی: " + fa(e.forecast || "—")));
				detail.appendChild(meta);
				detail.appendChild(el("div", null, "اهمیت: " +
					(e.importance === "high" ? "خیلی مهم" : e.importance === "medium" ? "مهم" : "کم‌اهمیت")));
				if (e.source) detail.appendChild(el("div", null, "منبع: " + e.source));
				node.appendChild(detail);

				node.addEventListener("click", function () {
					state.open[e.event_id] = !state.open[e.event_id];
					node.classList.toggle("is-open");
					haptic("select");
				});
				return node;
			}

			// Walks an ordered slice of events and appends them to `list`,
			// wrapping every run that shares one date and one release minute
			// in a cluster tray. Untimed events never cluster.
			function appendClustered(list, evts) {
				var run = [];
				function flush() {
					if (run.length === 0) return;
					if (run.length === 1) {
						list.appendChild(eventNode(run[0]));
					} else {
						var box = el("div", "cluster");
						var head = el("div", "cluster-head");
						head.appendChild(el("b", null, fa((run[0].time_tehran || "").replace("+1", ""))));
						if ((run[0].time_tehran || "").indexOf("+1") !== -1) {
							head.appendChild(el("span", null, "فردا"));
						}
						head.appendChild(el("span", null, fa(run.length) + " رویداد هم‌زمان"));
						box.appendChild(head);
						run.forEach(function (e) { box.appendChild(eventNode(e)); });
						list.appendChild(box);
					}
					run = [];
				}
				evts.forEach(function (e) {
					if (!e.time_tehran) { flush(); list.appendChild(eventNode(e)); return; }
					if (run.length && (run[0].date !== e.date || run[0].time_tehran !== e.time_tehran)) flush();
					run.push(e);
				});
				flush();
			}

			// ---------- forex sessions ----------
			// Every zone calculation goes through the platform's own tz database
			// rather than hand-written DST rules, so New York moving a week
			// before London each March is handled for free — and so is any
			// future rule change, without shipping a new version of this page.
			var TEHRAN = "Asia/Tehran";

			// Hours are local to each zone. openMin/closeMin default to 0; NYSE
			// is the only one that needs them, since it rings in at 09:30.
			var SESSIONS = [
				{ key: "sydney", name: "سیدنی", flag: "au", zone: "Australia/Sydney", open: 7, close: 16 },
				{ key: "tokyo", name: "توکیو", flag: "jp", zone: "Asia/Tokyo", open: 9, close: 18 },
				{ key: "london", name: "لندن", flag: "gb", zone: "Europe/London", open: 8, close: 17 },
				{ key: "newyork", name: "نیویورک", flag: "us", zone: "America/New_York", open: 8, close: 17 },
				// The stock exchange, not the forex session: a narrower window
				// inside it, and where the equity open drives the dollar.
				{ key: "nyse", name: "بورس نیویورک", sub: "NYSE", flag: "us", zone: "America/New_York", open: 9, openMin: 30, close: 16 }
			];

			function sessionByKey(key) {
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

			function inDailyBreak(instant) {
				var d = new Date(instant);
				var m = d.getUTCHours() * 60 + d.getUTCMinutes();
				return m >= BREAK_START_UTC && m < BREAK_END_UTC;
			}

			// The end of the break window containing or following `instant`.
			function breakEndAfter(instant) {
				var d = new Date(instant);
				var end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, BREAK_END_UTC);
				return end > instant ? end : end + 86400000;
			}

			function breakStartAfter(instant) {
				var d = new Date(instant);
				var start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, BREAK_START_UTC);
				return start > instant ? start : start + 86400000;
			}

			function tzParts(date, timeZone) {
				var dtf = new Intl.DateTimeFormat("en-US", {
					timeZone: timeZone, hour12: false,
					year: "numeric", month: "2-digit", day: "2-digit",
					hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short"
				});
				var p = {};
				dtf.formatToParts(date).forEach(function (x) { if (x.type !== "literal") p[x.type] = x.value; });
				return p;
			}

			function tzOffsetMinutes(date, timeZone) {
				var p = tzParts(date, timeZone);
				var asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
				return Math.round((asUTC - date.getTime()) / 60000);
			}

			// The UTC instant of a wall-clock time on a local calendar date. Two
			// passes settle the case where the first guess lands on the far side
			// of a DST transition.
			function instantAt(y, m, d, hour, minute, timeZone) {
				var guess = Date.UTC(y, m - 1, d, hour, minute);
				for (var i = 0; i < 2; i++) {
					guess = Date.UTC(y, m - 1, d, hour, minute) - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
				}
				return guess;
			}

			function localDatePlus(now, timeZone, offset) {
				var p = tzParts(now, timeZone);
				var shifted = new Date(Date.UTC(+p.year, +p.month - 1, +p.day) + offset * 86400000);
				return {
					y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1,
					d: shifted.getUTCDate(), dow: shifted.getUTCDay()
				};
			}

			function occurrences(session, now, fromDay, toDay) {
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

			function sessionState(session, now) {
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
			function marketState(now) {
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

			function hhmmInZone(instant, timeZone) {
				var p = tzParts(new Date(instant), timeZone);
				return (p.hour % 24 < 10 ? "0" : "") + (p.hour % 24) + ":" + p.minute;
			}

			// A real ticking counter rather than prose. Beyond a day the seconds
			// stop meaning anything, so the day count leads and the clock follows.
			function countdownText(instant, nowMs) {
				var s = Math.max(0, Math.floor((instant - nowMs) / 1000));
				var d = Math.floor(s / 86400);
				var h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
				var pad = function (n) { return (n < 10 ? "0" : "") + n; };
				var clock = fa(pad(h) + ":" + pad(m) + ":" + pad(sec));
				return d > 0 ? fa(d) + " روز و " + clock : clock;
			}

			function untilText(instant, now) {
				var mins = Math.round((instant - now.getTime()) / 60000);
				if (mins <= 0) return "";
				if (mins < 60) return fa(mins) + " دقیقه";
				var h = Math.floor(mins / 60), m = mins % 60;
				if (h < 24) return fa(h) + " ساعت" + (m ? " و " + fa(m) + " دقیقه" : "");
				return fa(Math.round(h / 24)) + " روز";
			}

			// ---------- day timeline ----------
			// Answers the question the list cannot: when today is dangerous to
			// hold a position. Height of the strip is fixed; only positions vary.
			var DAY_START_HOUR = 6;   // before this, US releases essentially never land
			var DAY_END_HOUR = 24;
			var RISK_PAD_MINUTES = 30; // either side of a high-impact release

			// افق واقعیِ همان چیزی که سرور فرستاده. پیش از این «۴۵ روز» در
			// متن نوشته شده بود و عددش جای دیگری - در ورکر - تعریف شده؛ اگر
			// آن عوض می‌شد، این جمله بی‌صدا دروغ می‌گفت.
			// دقیقه‌ی روز به وقت تهران. عمداً از منطقه‌ی انتخابیِ کاربر جدا
			// است: ساعت‌های تقویم همه tehran-based‌اند و نوار زمانی هم روی
			// همان محور کشیده می‌شود، پس مارکرش هم باید از همان ساعت بیاید.
			function tehranMinutesOf(instant) {
				var t = hhmmInZone(instant, TEHRAN).split(":").map(Number);
				return t[0] * 60 + t[1];
			}

			function horizonDays() {
				if (!state.data || !state.data.today || !state.data.horizon_end) return 45;
				var a = Date.parse(state.data.today + "T00:00:00Z");
				var b = Date.parse(state.data.horizon_end + "T00:00:00Z");
				if (isNaN(a) || isNaN(b)) return 45;
				return Math.max(1, Math.round((b - a) / 86400000));
			}

			function minutesOfDay(e) {
				if (!e.time_tehran) return null;
				var t = e.time_tehran.replace("+1", "").split(":").map(Number);
				if (isNaN(t[0])) return null;
				// A "+1" time belongs to the next day; park it at the far edge
				// rather than drawing it in the middle of today.
				var m = t[0] * 60 + (t[1] || 0);
				if (e.time_tehran.indexOf("+1") !== -1) return DAY_END_HOUR * 60;
				return m;
			}

			function pctOfDay(mins) {
				var from = DAY_START_HOUR * 60, to = DAY_END_HOUR * 60;
				return Math.max(0, Math.min(100, ((mins - from) / (to - from)) * 100));
			}

			function renderTimeline(container) {
				var todays = todaysEvents().filter(function (e) { return minutesOfDay(e) !== null; });
				if (todays.length === 0) return;

				var wrap = el("div", "tl");
				var head = el("div", "tl-head");
				var highs = todays.filter(function (e) { return e.importance === "high"; });
				head.appendChild(el("span", "tl-title", "نوار زمانی امروز"));
				head.appendChild(el("span", "tl-count",
					highs.length > 0
						? fa(highs.length) + " پنجره پرریسک"
						: "بدون پنجره پرریسک"));
				wrap.appendChild(head);

				var track = el("div", "tl-track");

				// Risk bands first so ticks and the now-line draw on top.
				highs.forEach(function (e) {
					var m = minutesOfDay(e);
					var a = pctOfDay(m - RISK_PAD_MINUTES);
					var b = pctOfDay(m + RISK_PAD_MINUTES);
					var band = el("div", "tl-band");
					band.style.right = a + "%";
					band.style.width = Math.max(1.5, b - a) + "%";
					band.title = e.title;
					track.appendChild(band);
				});

				todays.forEach(function (e) {
					var tick = el("div", "tl-tick imp-" + (e.importance || "low"));
					tick.style.right = pctOfDay(minutesOfDay(e)) + "%";
					tick.title = (e.time_tehran || "") + " " + e.title;
					track.appendChild(tick);
				});

				// The marker only makes sense while the clock is inside the strip.
				//
				// تهران، نه ساعتِ دستگاه. نوارهای قرمز از ساعت‌های تهرانِ
				// رویدادها ساخته می‌شوند؛ اگر این خط از getHours بخواند، برای
				// هر کاربر بیرون از ایران به اندازه‌ی اختلافِ منطقه‌اش با
				// نوارها فاصله می‌گیرد - اندازه گرفته شد: با دستگاهِ نیویورک
				// خط روی ۱۱٪ می‌نشست، جایی که باید ۵۳٪ می‌بود.
				var nowMins = tehranMinutesOf(Date.now());
				if (nowMins >= DAY_START_HOUR * 60 && nowMins <= DAY_END_HOUR * 60) {
					var nowEl = el("div", "tl-now");
					nowEl.style.right = pctOfDay(nowMins) + "%";
					nowEl.title = "الان";
					track.appendChild(nowEl);
				}
				wrap.appendChild(track);

				var axis = el("div", "tl-axis");
				[6, 10, 14, 18, 22].forEach(function (h) {
					var lab = el("span", "tl-hour", fa(h < 10 ? "0" + h : h));
					lab.style.right = pctOfDay(h * 60) + "%";
					axis.appendChild(lab);
				});
				wrap.appendChild(axis);

				wrap.appendChild(el("div", "tl-legend",
					highs.length > 0
						? "نوار قرمز: ۳۰ دقیقه قبل و بعد از خبر خیلی مهم — پرنوسان‌ترین بازه‌ی روز."
						: "امروز خبر خیلی مهمی نیست؛ نوسان معمولاً محدودتر است."));
				container.appendChild(wrap);
			}

			// ---------- markets view ----------
			// ---------- world map ----------
			// The hero photo (earth-night.jpg, NASA Black Marble, public
			// domain) is pre-cropped offline to lon -180..180 and lat
			// 72..-55, so screen position is a plain linear mapping.
			var MAP_LAT_TOP = 72, MAP_LAT_BOT = -55;
			var PHOTO_ASPECT = 1600 / 565; // the shipped file's pixel size

			// One <use> pointing at a symbol in the sprite at the top of the
			// page, so the same flag can appear on several rows - New York
			// carries both the forex session and the exchange - while its
			// artwork is defined once. xlink:href is set alongside href for
			// webviews predating SVG2.
			var SVG_NS = "http://www.w3.org/2000/svg";
			var XLINK_NS = "http://www.w3.org/1999/xlink";

			// The badge is a span so the coin's border and rounding are plain
			// box decoration; the artwork sits inside it as SVG.
			function flagBadge(code, label) {
				var badge = el("span", "mk-m-flag");
				badge.setAttribute("role", "img");
				badge.setAttribute("aria-label", "پرچم " + label);
				var svg = document.createElementNS(SVG_NS, "svg");
				svg.setAttribute("viewBox", "0 0 512 512");
				svg.setAttribute("aria-hidden", "true");
				var use = document.createElementNS(SVG_NS, "use");
				use.setAttribute("href", "#fi-" + code);
				use.setAttributeNS(XLINK_NS, "xlink:href", "#fi-" + code);
				svg.appendChild(use);
				badge.appendChild(svg);
				return badge;
			}

			// Per-second updaters registered by renderMarkets. Only the text
			// nodes that actually change are touched; rebuilding the whole board
			// every second would throw away scroll position and any transition
			// mid-flight, for no gain.
			var tickers = [];

			// Set when the user arrives at the tab, cleared by the render that
			// consumes it, so the animation plays once per visit rather than on
			// every second-tick rebuild.
			var marketsEntering = true;

			function motionOK() {
				return !window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
			}

			// What a redraw is actually needed for: a market opening or closing.
			// Compared each second so a transition lands on time instead of
			// waiting out a coarse refresh interval.
			function marketsSignature(now) {
				var m = marketState(now);
				var sig = (m.open ? "o" : "c") + (m.onBreak ? "b" : "-");
				SESSIONS.forEach(function (s) { sig += sessionState(s, now).open ? "1" : "0"; });
				return sig;
			}
			var marketsSig = null;

			function spansOf(openM, closeM) {
				// A session running past Tehran midnight is drawn as two segments
				// rather than one bar wrapping off the edge of the track.
				return closeM > openM ? [[openM, closeM]] : [[openM, 1440], [0, closeM]];
			}

			// ---------- the viewing zone ----------
			// Every session already carried its own IANA zone, so the engine was
			// multi-zone from the start; only the axis was nailed to Tehran.
			// This makes that one choice a variable.
			//
			// It also absorbs what the broker-clock picker used to do. That
			// control put the server's time on a second line under each
			// session; picking the offset here puts the whole board on it,
			// which is the same answer given better. Etc/GMT-3 is UTC+3 - the
			// sign in those zone names is inverted, which is confusing enough
			// to be worth saying once.
			function deviceZone() {
				try {
					return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
				} catch (e) { return "UTC"; }
			}

			var VIEW_ZONES = [
				{ key: "tehran", zone: TEHRAN, name: "تهران" },
				{ key: "device", zone: deviceZone(), name: "وقت گوشی خودم", short: "گوشی شما" },
				{ key: "broker3", zone: "Etc/GMT-3", name: "بروکر GMT+۳", short: "بروکر" },
				{ key: "broker2", zone: "Europe/Berlin", name: "بروکر اروپا", short: "بروکر اروپا" },
				{ key: "gmt", zone: "UTC", name: "GMT" },
				{ key: "newyork", zone: "America/New_York", name: "نیویورک" }
			];

			var VIEW_KEY = "econAppViewZone";

			function storedViewZone() {
				try { return localStorage.getItem(VIEW_KEY); } catch (e) { return null; }
			}

			function viewZoneByKey(key) {
				for (var i = 0; i < VIEW_ZONES.length; i++) {
					if (VIEW_ZONES[i].key === key) return VIEW_ZONES[i];
				}
				return VIEW_ZONES[0];
			}

			var viewZone = viewZoneByKey(storedViewZone() || "tehran");
			function VIEW() { return viewZone.zone; }
			function viewName() { return viewZone.short || viewZone.name; }

			// "GMT+3:30" - the half-hour offsets are exactly why this is
			// computed rather than written down.
			function offsetLabel(zone, at) {
				var m = tzOffsetMinutes(at || new Date(), zone);
				if (m === 0) return "GMT";
				var sign = m < 0 ? "−" : "+";
				m = Math.abs(m);
				var h = Math.floor(m / 60), mm = m % 60;
				return "GMT" + sign + h + (mm ? ":" + (mm < 10 ? "0" + mm : mm) : "");
			}

			function viewMinutesOf(instant) {
				var t = hhmmInZone(instant, VIEW()).split(":").map(Number);
				return t[0] * 60 + t[1];
			}

			var DOW_FA = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"];

			function dayInZone(instant, zone) {
				var p = tzParts(new Date(instant), zone);
				return DOW_FA[new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()];
			}

			function isoDateInZone(instant, zone) {
				var p = tzParts(new Date(instant), zone);
				return p.year + "-" + p.month + "-" + p.day;
			}

			// ---------- bank holidays ----------
			// The holiday feed is United States only (date.nager.at .../US), so
			// this can only ever speak for the two American rows - and it is
			// keyed on New York's own calendar date, not Tehran's, because a
			// holiday is a New York day.
			//
			// No data is not "no holiday" in a way worth hiding: when the fetch
			// failed, holidays is simply absent and the board behaves exactly
			// as it did before this feature existed.
			function holidayFor(session, instant) {
				if (session.zone !== "America/New_York") return null;
				var list = (state.data && state.data.holidays) || [];
				var date = isoDateInZone(instant, session.zone);
				for (var i = 0; i < list.length; i++) {
					if (list[i] && list[i].date === date) return list[i];
				}
				return null;
			}

			// ---------- flags ----------
			// The same inline sprite the page already ships: no network request,
			// and emoji flags do not render on Windows at all.
			var SVG_NS = "http://www.w3.org/2000/svg";
			var XLINK_NS = "http://www.w3.org/1999/xlink";

			function flagBadge(code, label) {
				var badge = document.createElement("span");
				badge.className = "sb-flag";
				badge.setAttribute("role", "img");
				badge.setAttribute("aria-label", "پرچم " + label);
				var svg = document.createElementNS(SVG_NS, "svg");
				svg.setAttribute("viewBox", "0 0 512 512");
				// The sprite is square and the chip is not: slice crops the flag
				// instead of squashing it, which is what object-fit would do for
				// an <img> but does nothing for an inline svg.
				svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
				svg.setAttribute("aria-hidden", "true");
				var use = document.createElementNS(SVG_NS, "use");
				use.setAttribute("href", "#fi-" + code);
				use.setAttributeNS(XLINK_NS, "xlink:href", "#fi-" + code);
				svg.appendChild(use);
				badge.appendChild(svg);
				return badge;
			}

			var selectedSession = "london";

			function renderMarkets(container) {
				var now = new Date();
				var nowT = now.getTime();
				tickers = [];
				marketsSig = marketsSignature(now);
				var animate = marketsEntering && motionOK();
				marketsEntering = false;
				var step = 0;
				var enter = function (node) {
					if (!animate) return node;
					node.classList.add("mk-enter");
					node.style.animationDelay = (step++ * 45) + "ms";
					return node;
				};

				var board = el("div", "sb");
				var market = marketState(now);
				var nowM = viewMinutesOf(nowT);

				// marketState returns a nextOpen only when we are outside the
				// whole Monday-open..Friday-close window, so this flag *is* the
				// weekend - no second weekday calculation that could disagree
				// with the first.
				var weekend = !market.open && !market.onBreak && !!market.nextOpen;

				// ---- status
				var status = el("div", "sb-status " +
					(market.onBreak ? "is-break" : (market.open ? "is-open" : (weekend ? "is-weekend" : "is-closed"))));

				var st = el("div", "sb-state");
				st.appendChild(el("span", "sb-dot"));
				st.appendChild(el("span", null,
					market.onBreak ? "تسویه‌ی روزانه"
						: (market.open ? "بازار باز است" : (weekend ? "تعطیلات آخر هفته" : "بازار بسته است"))));
				status.appendChild(st);

				var clock = el("div", "sb-clock");
				// No seconds: they read as extra digits glued to the minutes, and
				// the only things here that need a second hand - the countdowns -
				// keep their own.
				var clockTime = el("div", "sb-time", fa(hhmmInZone(nowT, VIEW())));
				clock.appendChild(clockTime);
				var clockZone = el("div", "sb-zone", viewName());
				clock.appendChild(clockZone);
				status.appendChild(clock);
				tickers.push(function (t) { clockTime.textContent = fa(hhmmInZone(t, VIEW())); });

				var sub = el("div", "sb-sub");
				var target = market.onBreak ? market.resumesAt : (market.open ? null : market.nextOpen);
				if (target) {
					sub.appendChild(el("span", null,
						market.onBreak ? "از سر گرفته می‌شود " : (weekend ? "بازارها باز می‌شوند " : "باز می‌شود ")));
					var cd = el("b", null, countdownText(target, nowT));
					sub.appendChild(cd);
					sub.appendChild(el("span", null,
						" دیگر — " + dayInZone(target, VIEW()) + " ساعت " + fa(hhmmInZone(target, VIEW()))));
					tickers.push(function (t) { cd.textContent = countdownText(target, t); });
				} else if (market.open && market.until) {
					sub.appendChild(el("span", null, "تا جمعه ساعت "));
					sub.appendChild(el("b", null, fa(hhmmInZone(market.until, VIEW()))));
				}
				status.appendChild(sub);
				board.appendChild(enter(status));

				// ---- the board card
				var card = el("div", "sb-board");
				var head = el("div", "sb-head");
				head.appendChild(el("span", "sb-title",
					// On a weekend the bars already show each session's *next*
					// window, so the heading must stop claiming they are today's.
					weekend ? "سشن‌ها، در روز کاری بعد" : "امروز، سشن‌های بازار"));

				// وقتی منطقه تهران نیست، برچسب علامت می‌خورد. بدون این، یک
				// انتخابِ فراموش‌شده در این دکمه، کل ساعت‌های تابلو را
				// جابه‌جا می‌کند و از بیرون شبیه «ساعت‌ها اشتباه است» به
				// نظر می‌رسد - نه شبیه «تو منطقه را عوض کرده‌ای».
				var offZone = viewZone.key !== "tehran";
				var tzBtn = el("button", "sb-tz" + (offZone ? " is-off" : ""));
				tzBtn.type = "button";
				tzBtn.setAttribute("aria-expanded", "false");
				var tzLabel = el("span", null,
					"ساعت‌ها به وقت " + viewName() + " · " + offsetLabel(VIEW(), now));
				tzBtn.appendChild(tzLabel);
				tzBtn.appendChild(el("span", "sb-caret", "▼"));
				head.appendChild(tzBtn);
				card.appendChild(head);

				var menu = el("div", "sb-menu");
				menu.hidden = true;
				menu.setAttribute("role", "radiogroup");
				menu.setAttribute("aria-label", "منطقه‌ی زمانی");
				VIEW_ZONES.forEach(function (z) {
					var b = el("button", "sb-opt");
					b.type = "button";
					b.setAttribute("role", "radio");
					b.setAttribute("aria-checked", z.key === viewZone.key ? "true" : "false");
					b.appendChild(el("span", null, z.name));
					b.appendChild(el("span", "sb-off",
						offsetLabel(z.zone, now) + " · " + fa(hhmmInZone(nowT, z.zone))));
					b.addEventListener("click", function () {
						viewZone = z;
						try { localStorage.setItem(VIEW_KEY, z.key); } catch (e) { /* preference only */ }
						renderList();
					});
					menu.appendChild(b);
				});
				tzBtn.addEventListener("click", function () {
					var open = menu.hidden;
					menu.hidden = !open;
					tzBtn.setAttribute("aria-expanded", open ? "true" : "false");
				});
				card.appendChild(menu);

				// ---- each session's current or next window, resolved once
				var refs = {};
				SESSIONS.forEach(function (s) {
					var ss = sessionState(s, now);
					var r = ss.open ? { open: ss.since, close: ss.until } : { open: ss.nextOpen, close: ss.nextClose };
					refs[s.key] = { st: ss, ref: r, holiday: holidayFor(s, r.open || nowT) };
				});

				var grid = el("div", "sb-grid");

				// ---- hour axis
				var hours = el("div", "sb-hours");
				[0, 3, 6, 9, 12, 15, 18, 21].forEach(function (h) {
					var lab = el("span", "sb-hour", fa(h < 10 ? "0" + h : h));
					lab.style.right = (h * 60 / 1440 * 100) + "%";
					hours.appendChild(lab);
				});
				grid.appendChild(hours);

				// ---- the rollover band, in the viewed zone's minutes
				var brkStart = (BREAK_START_UTC + tzOffsetMinutes(now, VIEW()) + 1440) % 1440;
				var brkEnd = (BREAK_END_UTC + tzOffsetMinutes(now, VIEW()) + 1440) % 1440;

				// ---- rows
				var rows = el("div", "sb-rows");
				SESSIONS.forEach(function (s) {
					var ss = refs[s.key].st, ref = refs[s.key].ref, hol = refs[s.key].holiday;
					var paused = ss.open && !market.open;
					var live = ss.open && market.open;

					var row = el("button", "sb-row" +
						(live ? " is-live" : "") + (paused ? " is-paused" : "") + (hol ? " is-holiday" : ""));
					row.type = "button";
					// The hue lives on the row, so the flag ring, the bar and the
					// drawer's edge all read it from one place.
					row.style.setProperty("--seg", "var(--sb-" + s.key + ")");
					row.setAttribute("aria-pressed", s.key === selectedSession ? "true" : "false");
					row.addEventListener("click", function () { selectedSession = s.key; renderList(); });

					var who = el("div", "sb-who");
					who.appendChild(flagBadge(s.flag, s.name));
					var nm = el("div", "sb-nm");
					nm.appendChild(el("div", "sb-name", s.name));
					nm.appendChild(el("div", "sb-st",
						hol ? "تعطیل بانکی" : (live ? "باز" : (paused ? "استراحت" : "بسته"))));
					who.appendChild(nm);
					row.appendChild(who);

					var track = el("div", "sb-track");
					if (hol) {
						// The bar is struck through rather than merely dark: on a
						// bank holiday the session does not happen at all, which
						// is a different thing from "closed right now".
						var hb = el("div", "sb-holiday");
						hb.appendChild(el("span", null, "🏦 تعطیل بانکی — " + (hol.name || "آمریکا")));
						hb.title = "تعطیلی بانکی آمریکا: " + (hol.name || "");
						track.appendChild(hb);
					} else if (ref.open) {
						var openM = viewMinutesOf(ref.open), closeM = viewMinutesOf(ref.close);
						spansOf(openM, closeM).forEach(function (sp, idx) {
							var seg = el("div", "sb-seg");
							seg.style.right = (sp[0] / 1440 * 100) + "%";
							seg.style.width = Math.max(1, (sp[1] - sp[0]) / 1440 * 100) + "%";
							if (live && nowM >= sp[0] && nowM <= sp[1]) {
								var fill = el("div", "sb-fill");
								fill.style.width = ((nowM - sp[0]) / (sp[1] - sp[0]) * 100) + "%";
								seg.appendChild(fill);
							}
							// The hours ride inside the widest segment - one less
							// number to hunt for underneath the chart.
							if (idx === 0 && (sp[1] - sp[0]) > 300) {
								seg.appendChild(el("span", "sb-seg-lab",
									fa(hhmmInZone(ref.open, VIEW())) + "–" + fa(hhmmInZone(ref.close, VIEW()))));
							}
							track.appendChild(seg);
						});
					}
					if (!hol && brkEnd > brkStart) {
						var brk = el("div", "sb-break");
						brk.style.right = (brkStart / 1440 * 100) + "%";
						brk.style.width = ((brkEnd - brkStart) / 1440 * 100) + "%";
						track.appendChild(brk);
					}
					row.appendChild(track);
					rows.appendChild(row);
				});
				grid.appendChild(rows);

				// ---- the single now-line, over every row
				// The plot starts after the label rail, so the offset is measured
				// from the rail's inner edge and the percentage is of the plot
				// width, not of the whole grid. calc keeps that true at any size.
				var line = el("div", "sb-now");
				// Hidden on a weekend: the bars are showing the next working day,
				// so a needle at the current minute points at the wrong day.
				line.hidden = weekend;
				line.style.right = "calc(var(--off) + (100% - var(--off)) * " + (nowM / 1440).toFixed(5) + ")";
				grid.appendChild(line);
				card.appendChild(grid);

				// ---- the London / New York overlap, in one sentence
				// Intersected from the very spans the two bars are drawn from, so
				// it can never claim an hour the chart above does not show, and it
				// follows the DST gap in March and October on its own.
				var ovNote = el("div", "sb-ov");
				var lo = refs.london.ref, ny = refs.newyork.ref;
				var ovStart = null, ovEnd = null;
				if (lo.open && ny.open && !refs.newyork.holiday) {
					var a = Math.max(lo.open, ny.open), z = Math.min(lo.close, ny.close);
					if (z > a) { ovStart = a; ovEnd = z; }
				}
				if (ovStart) {
					var inNow = false;
					spansOf(viewMinutesOf(ovStart), viewMinutesOf(ovEnd)).forEach(function (sp) {
						if (nowM >= sp[0] && nowM < sp[1]) inNow = true;
					});
					ovNote.appendChild(document.createTextNode("هم‌پوشانی لندن و نیویورک، "));
					ovNote.appendChild(el("b", null,
						fa(hhmmInZone(ovStart, VIEW())) + "–" + fa(hhmmInZone(ovEnd, VIEW()))));
					ovNote.appendChild(document.createTextNode(
						inNow && market.open
							? " — همین حالا، پرنوسان‌ترین ساعت‌های روز"
							: " — پرنوسان‌ترین ساعت‌های روز"));
				} else if (refs.newyork.holiday) {
					ovNote.textContent = "امروز تعطیلی بانکی آمریکاست — هم‌پوشانی لندن و نیویورک در کار نیست.";
				} else {
					ovNote.textContent = "لندن و نیویورک امروز هم‌پوشانی ندارند.";
				}
				card.appendChild(ovNote);

				// ---- detail drawer for the selected row
				// Only the row you tapped: five rows each carrying three numbers
				// is a wall, and four of them are numbers you did not ask for.
				var sel = sessionByKey(selectedSession) || SESSIONS[0];
				var selRef = refs[sel.key];
				var live2 = selRef.st.open && market.open, paused2 = selRef.st.open && !market.open;
				var d = el("div", "sb-detail");
				d.style.setProperty("--seg", "var(--sb-" + sel.key + ")");
				var dhead = el("div", "sb-dhead");
				dhead.appendChild(el("b", null, sel.name));
				dhead.appendChild(el("span", null,
					selRef.holiday ? "— تعطیل بانکی"
						: (live2 ? "— باز است" : (paused2 ? "— در استراحت" : "— بسته است"))));
				d.appendChild(dhead);

				if (selRef.holiday) {
					var note = el("div", "sb-dnote");
					note.appendChild(document.createTextNode("🏦 امروز در آمریکا تعطیلی بانکی است: "));
					note.appendChild(el("b", null, selRef.holiday.name || "تعطیل رسمی"));
					note.appendChild(document.createTextNode("."));
					d.appendChild(note);
				} else if (selRef.ref.open) {
					var c1 = el("div", "sb-dt");
					c1.appendChild(el("div", "sb-dk", "به وقت " + viewName()));
					c1.appendChild(el("div", "sb-dv",
						fa(hhmmInZone(selRef.ref.open, VIEW())) + "–" + fa(hhmmInZone(selRef.ref.close, VIEW()))));
					d.appendChild(c1);

					var c2 = el("div", "sb-dt");
					c2.appendChild(el("div", "sb-dk", "به وقت محلی"));
					c2.appendChild(el("div", "sb-dv",
						fa(hhmmInZone(selRef.ref.open, sel.zone)) + "–" + fa(hhmmInZone(selRef.ref.close, sel.zone))));
					d.appendChild(c2);

					var c3 = el("div", "sb-dt");
					c3.appendChild(el("div", "sb-dk",
						live2 ? "تا بسته شدن" : (paused2 ? "تا از سرگیری" : "تا باز شدن")));
					var tgt = paused2 ? (market.resumesAt || market.nextOpen) : (live2 ? selRef.ref.close : selRef.ref.open);
					var dv = el("div", "sb-dv is-cd", countdownText(tgt, nowT));
					c3.appendChild(dv);
					d.appendChild(c3);
					tickers.push(function (t) { dv.textContent = countdownText(tgt, t); });
				}
				card.appendChild(d);
				board.appendChild(enter(card));

				// ---- city clocks
				var clocks = el("div", "sb-clocks");
				// NYSE is America/New_York, the same zone New York already shows.
				// A fifth card would have been a clock that can never differ.
				SESSIONS.filter(function (s) { return s.key !== "nyse"; }).forEach(function (s) {
					var ss = refs[s.key].st;
					var c = el("div", "sb-ck" + (ss.open && market.open && !refs[s.key].holiday ? " is-live" : ""));
					c.style.setProperty("--ck", "var(--sb-" + s.key + ")");
					c.appendChild(el("div", "sb-ck-city", s.name));
					var ct = el("div", "sb-ck-time", fa(hhmmInZone(nowT, s.zone)));
					c.appendChild(ct);
					c.appendChild(el("div", "sb-ck-day", dayInZone(nowT, s.zone)));
					clocks.appendChild(c);
					tickers.push(function (t) { ct.textContent = fa(hhmmInZone(t, s.zone)); });
				});
				board.appendChild(enter(clocks));

				container.appendChild(board);
			}

			// ---------- month grid ----------
			var WEEKDAY_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];
			var IMPORTANCE_RANK = { high: 3, medium: 2, low: 1 };

			// Persian weeks start on Saturday. JS getDay() is 0=Sunday, so
			// Saturday(6) has to map to column 0.
			function persianWeekday(dateStr) {
				var p = dateStr.split("-").map(Number);
				return (new Date(p[0], p[1] - 1, p[2]).getDay() + 1) % 7;
			}

			function jalaliMonthLength(jy, jm) {
				var start = toGregorian(jy, jm, 1);
				var nextY = jm === 12 ? jy + 1 : jy;
				var nextM = jm === 12 ? 1 : jm + 1;
				var next = toGregorian(nextY, nextM, 1);
				return Math.round((Date.UTC(next[0], next[1] - 1, next[2]) -
					Date.UTC(start[0], start[1] - 1, start[2])) / 86400000);
			}

			function eventsByDate() {
				var map = {};
				state.data.events.forEach(function (e) {
					if (state.importance === "high" && e.importance !== "high") return;
					if (state.importance === "medium" && e.importance === "low") return;
					if (!map[e.date]) map[e.date] = [];
					map[e.date].push(e);
				});
				return map;
			}

			function renderMonth(list) {
				var todayParts = state.data.today.split("-").map(Number);
				var todayJ = toJalali(todayParts[0], todayParts[1], todayParts[2]);

				// Month arithmetic in Jalali terms, so stepping never lands on a
				// nonexistent day.
				var jm = todayJ[1] + state.monthOffset;
				var jy = todayJ[0];
				while (jm > 12) { jm -= 12; jy++; }
				while (jm < 1) { jm += 12; jy--; }

				var byDate = eventsByDate();

				var head = el("div", "month-head");
				var prev = el("button", "month-nav", "‹");
				prev.type = "button";
				prev.addEventListener("click", function () {
					state.monthOffset--;
					state.selectedDay = null;
					haptic("select");
					renderList();
				});
				var next = el("button", "month-nav", "›");
				next.type = "button";
				next.addEventListener("click", function () {
					state.monthOffset++;
					state.selectedDay = null;
					haptic("select");
					renderList();
				});
				// In RTL the "next" chevron sits on the left, so it is appended
				// first for the arrows to point the way they move.
				head.appendChild(next);
				head.appendChild(el("span", "month-name", MONTHS[jm - 1] + " " + fa(jy)));
				head.appendChild(prev);
				list.appendChild(head);

				var grid = el("div", "month-grid");
				WEEKDAY_SHORT.forEach(function (w) {
					grid.appendChild(el("div", "month-wd", w));
				});

				var firstIso = (function () { var g = toGregorian(jy, jm, 1); return isoOf(g[0], g[1], g[2]); })();
				var lead = persianWeekday(firstIso);
				for (var i = 0; i < lead; i++) grid.appendChild(el("div", "month-cell is-blank"));

				var length = jalaliMonthLength(jy, jm);
				for (var d = 1; d <= length; d++) {
					var g = toGregorian(jy, jm, d);
					var iso = isoOf(g[0], g[1], g[2]);
					var dayEvents = byDate[iso] || [];

					var cell = el("button", "month-cell");
					cell.type = "button";
					if (iso === state.data.today) cell.className += " is-today";
					if (iso === state.selectedDay) cell.className += " is-selected";
					// Outside the range the server sent, "no events" would be a
					// lie — it is unknown. Show it as unknown.
					if (iso < state.data.today || iso > state.data.horizon_end) cell.className += " is-outside";

					cell.appendChild(el("span", "month-day", fa(d)));

					// یک خط، نه چند نقطه. نقطه‌ها تعداد را می‌گفتند و سه خبرِ
					// کم‌اهمیت شلوغ‌تر از یک بیانیه‌ی فدرال رزرو به نظر
					// می‌آمدند. حالا ضخامتِ خط مهم‌ترین خبرِ آن روز است و
					// تعداد، عددی ریز زیرش.
					var top = null;
					dayEvents.forEach(function (e) {
						if (!top || (IMPORTANCE_RANK[e.importance] || 0) > (IMPORTANCE_RANK[top] || 0)) {
							top = e.importance || "low";
						}
					});
					cell.appendChild(el("span", "month-bar" + (top ? " imp-" + top : "")));
					cell.appendChild(el("small", "month-n", dayEvents.length ? fa(dayEvents.length) : ""));

					if (dayEvents.length > 0) {
						(function (isoDate) {
							cell.addEventListener("click", function () {
								state.selectedDay = state.selectedDay === isoDate ? null : isoDate;
								haptic("select");
								renderList();
							});
						})(iso);
					} else {
						cell.disabled = true;
					}
					grid.appendChild(cell);
				}
				list.appendChild(grid);

				if (state.selectedDay) {
					var chosen = byDate[state.selectedDay] || [];
					var dayHead = el("div", "day-head");
					dayHead.appendChild(el("span", "date", jalaliLabel(state.selectedDay)));
					var rel = relDay(state.selectedDay);
					if (rel) dayHead.appendChild(el("span", "rel", rel));
					list.appendChild(dayHead);
					appendClustered(list, chosen);
				} else {
					list.appendChild(el("div", "month-hint", "روی یک روز بزن تا رویدادهایش را ببینی."));
				}
			}

			function renderList() {
				var list = document.getElementById("list");
				list.textContent = "";

				// Session hours are computed from the clock alone, so this tab
				// works whether or not the release data ever arrived.
				if (state.scope === "markets") {
					renderMarkets(list);
					return;
				}

				// Every other tab reads state.data. Reaching them before it
				// exists - a failed load, or a tab tapped while the first
				// request is still in flight - used to throw partway through
				// and leave the list empty.
				if (!state.data) {
					if (state.failure) paintError();
					else for (var i = 0; i < 3; i++) list.appendChild(el("div", "skel"));
					return;
				}

				// A search spans every loaded day, so the month grid would only
				// hide the results.
				if (state.scope === "month" && !state.query) {
					renderMonth(list);
					return;
				}

				// The timeline is about today specifically, so it belongs to the
				// today tab and not to a search across 45 days.
				if (state.scope === "today" && !state.query) renderTimeline(list);

				if (state.query) {
					var found = visibleEvents();
					var note = el("p", "search-note");
					note.textContent = found.length === 0
						? "چیزی پیدا نشد."
						: "‏" + fa(found.length) + " نتیجه در " + fa(horizonDays()) + " روز آینده";
					list.appendChild(note);
				}

				var events = visibleEvents();
				if (events.length === 0) {
					if (state.query) return; // the search note already said so
					var empty = el("div", "empty");
					empty.appendChild(el("span", "big", "🗓"));
					empty.appendChild(document.createTextNode(
						state.scope === "today"
							? "امروز رویدادی با این فیلتر ثبت نشده."
							: "در این هفته رویدادی با این فیلتر ثبت نشده."
					));
					// An empty day is normal at weekends and on US bank holidays,
					// so offer the way out rather than a dead end.
					if (state.scope === "today" && state.data.events.length > 0) {
						var jump = el("button", null, "نمایش کل هفته");
						jump.type = "button";
						jump.className = "chip";
						jump.style.marginTop = "12px";
						jump.addEventListener("click", function () {
							setScope("week");
							haptic("select");
							renderList();
						});
						empty.appendChild(document.createElement("br"));
						empty.appendChild(jump);
					}
					list.appendChild(empty);
					return;
				}

				// امروز، یک مرز میان «منتشر شده» و «پیش رو». اولین سؤال کسی که
				// ظهر اپ را باز می‌کند همین است: چه چیزی را از دست داده‌ام و
				// چه چیزی مانده - و فهرستی که فقط ردیف‌های گذشته را کم‌رنگ
				// می‌کرد جوابش را نمی‌داد.
				//
				// فقط روی تب امروز و بدون جستجو: در نمای هفته و ماه، هر روز
				// سرتیتر خودش را دارد و این مرز فقط شلوغی اضافه می‌کرد.
				// مرز از روی «جای» اولین رویدادِ نیامده پیدا می‌شود، نه از روی
				// «تعداد» رویدادهای گذشته. این دو همیشه یکی نیستند: خبری که
				// ساعتش «۰۰:۳۰ فردا» است در مرتب‌سازی اولِ فهرست می‌نشیند
				// ولی هنوز نیامده. شمردن، مرز را وسط بخش گذشته می‌انداخت.
				//
				// اگر فهرست دو تکه‌ی تمیز نبود، مرز اصلاً کشیده نمی‌شود -
				// خطی که جای اشتباه بیفتد بدتر از نبودنش است.
				var splitAt = null;
				if (state.scope === "today" && !state.query) {
					var now = Date.now();
					var isPast = function (e) { return !!e.at && new Date(e.at).getTime() < now; };
					var first = events.findIndex(function (e) { return !isPast(e); });
					if (first > 0 && events.slice(0, first).every(isPast)) splitAt = first;
				}

				var lastDate = null;
				var dayBuf = [];
				var flushDay = function () {
					if (dayBuf.length) { appendClustered(list, dayBuf); dayBuf = []; }
				};
				events.forEach(function (e, idx) {
					// سرتیتر روز اول می‌آید، بعد مرز. برعکسش «منتشر شده» را
					// بالای تاریخ می‌انداخت، انگار عنوانِ چیزی است که هنوز
					// شروع نشده.
					if (e.date !== lastDate) {
						flushDay();
						lastDate = e.date;
						var head = el("div", "day-head");
						head.appendChild(el("span", "date", jalaliLabel(e.date)));
						var rel = relDay(e.date);
						if (rel) head.appendChild(el("span", "rel", rel));
						list.appendChild(head);

						(state.data.holidays || []).forEach(function (h) {
							if (h.date === e.date) {
								list.appendChild(el("div", "holiday", "🏦 تعطیلی بانکی آمریکا — " + h.name));
							}
						});
					}
					if (splitAt !== null && idx === 0) {
						list.appendChild(el("div", "split", "منتشر شده (" + fa(splitAt) + ")"));
					}
					if (splitAt !== null && idx === splitAt) {
						flushDay();
						list.appendChild(el("div", "split", "پیش رو (" + fa(events.length - splitAt) + ")"));
					}
					dayBuf.push(e);
				});
				flushDay();
			}

			function renderAlerts() {
				var s = state.data.subscription;
				var card = document.getElementById("alertsCard");
				// Null when the alert settings could not be fetched. Showing the
				// switches in a guessed state would be worse than hiding them:
				// the next tap would write that guess back and could silently
				// unsubscribe someone who is subscribed.
				if (!s) { card.hidden = true; return; }
				card.hidden = false;

				document.getElementById("swSubscribed").setAttribute("aria-checked", s.subscribed ? "true" : "false");
				document.getElementById("swLow").setAttribute("aria-checked", s.show_low_importance ? "true" : "false");

				var btns = document.querySelectorAll("#minutes button");
				for (var i = 0; i < btns.length; i++) {
					btns[i].setAttribute("aria-pressed",
						Number(btns[i].getAttribute("data-m")) === Number(s.alert_minutes) ? "true" : "false");
				}
				document.getElementById("alertOptions").className = s.subscribed ? "" : "alerts-disabled";
			}

			function render() {
				renderHero();
				renderNext();
				renderList();
				renderAlerts();
				document.getElementById("aiCard").hidden = false;
				// renderNext and renderAlerts each reveal their own card, so the
				// visibility rules for the current tab are re-applied last.
				setScope(state.scope);
			}

			// ---------- network ----------
			function callOnce(url, payload) {
				return fetch(url, {
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

			function call(payload) {
				payload.initData = tg ? tg.initData : "";
				return callOnce(API, payload);
			}

			// Remembered so a later renderList can put the message back. Without
			// this, switching tabs after a failed load wiped the error box and
			// its retry button, leaving a blank screen with no way out.
			function showError(message, retryable) {
				state.failure = { message: message, retryable: retryable };
				paintError();
				document.getElementById("heroSub").textContent = "—";
			}

			function paintError() {
				var list = document.getElementById("list");
				list.textContent = "";
				var box = el("div", "error", state.failure.message);
				if (state.failure.retryable) {
					var btn = el("button", null, "تلاش دوباره");
					btn.addEventListener("click", load);
					box.appendChild(btn);
				}
				list.appendChild(box);
			}

			function load() {
				return call({ action: "data" })
					.then(function (body) {
						state.data = body;
						state.failure = null;
						// Landing on an empty "today" makes a working app look
						// broken, and today is empty every weekend. Fall to the
						// week whenever today has nothing — an empty screen is
						// worse than ignoring the remembered tab, and this
						// override is deliberately not persisted.
						if (state.scope === "today" && todaysEvents().length === 0) setScope("week");
						render();
					})
					.catch(function (err) {
						if (err.status === 401) {
							showError("تلگرام نتونست هویتت رو تأیید کنه. برنامه رو ببند و دوباره از دکمه‌ی داخل ربات بازش کن.", false);
						} else {
							showError("دریافت اطلاعات ناموفق بود.", true);
						}
					});
			}

			function saveSubscription() {
				if (state.saving) return;
				state.saving = true;
				var s = state.data.subscription;
				call({
					action: "subscribe",
					subscribed: s.subscribed,
					alert_minutes: s.alert_minutes,
					show_low_importance: s.show_low_importance
				})
					.catch(function () {
						// Put the switches back rather than leaving the UI claiming
						// something the server never stored.
						s.subscribed = !s.subscribed;
						renderAlerts();
						if (tg && tg.showAlert) tg.showAlert("ذخیره تنظیمات هشدار ناموفق بود.");
					})
					.finally(function () { state.saving = false; });
			}

			// ---------- wiring ----------
			document.getElementById("tabToday").addEventListener("click", function () {
				setScope("today");
				storeScope("today");
				haptic("select");
				renderList();
			});

			document.getElementById("tabWeek").addEventListener("click", function () {
				setScope("week");
				storeScope("week");
				haptic("select");
				renderList();
			});

			// The analysis itself is produced by the bot and shared through one
			// cache, so the app never runs a second copy of the prompt that
			// could drift from it.
			document.getElementById("btnExplain").addEventListener("click", function () {
				var btn = this;
				var box = document.getElementById("aiBody");
				btn.disabled = true;
				btn.textContent = "در حال دریافت…";
				haptic();
				call({ action: "explain" })
					.then(function (body) {
						box.hidden = false;
						box.textContent = "";
						if (body.available) {
							box.className = "ai-body";
							box.textContent = body.answer;
							if (body.created_at) {
								var d = new Date(body.created_at);
								if (!isNaN(d.getTime())) {
									box.appendChild(el("span", "ai-stamp",
										"تهیه‌شده در " + fa(d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" }))));
								}
							}
							btn.textContent = "بروزرسانی تحلیل";
						} else {
							box.className = "ai-body is-empty";
							box.textContent = "تحلیل امروز هنوز ساخته نشده. یک بار از دکمه‌ی «🤖 توضیح AI» داخل ربات استفاده کن، بعد اینجا هم نشان داده می‌شود.";
							btn.textContent = "بررسی دوباره";
						}
					})
					.catch(function () {
						box.hidden = false;
						box.className = "ai-body is-empty";
						box.textContent = "دریافت تحلیل ناموفق بود.";
						btn.textContent = "تلاش دوباره";
					})
					.finally(function () { btn.disabled = false; });
			});

			document.getElementById("tabMonth").addEventListener("click", function () {
				setScope("month");
				storeScope("month");
				haptic("select");
				renderList();
			});

			document.getElementById("tabMarkets").addEventListener("click", function () {
				setScope("markets");
				storeScope("markets");
				haptic("select");
				renderList();
			});

			var searchInput = document.getElementById("searchInput");
			var clearSearch = document.getElementById("btnClearSearch");

			function applyQuery(value) {
				state.query = value;
				clearSearch.hidden = !value;
				if (state.data) renderList();
			}

			searchInput.addEventListener("input", function () {
				applyQuery(this.value);
			});

			clearSearch.addEventListener("click", function () {
				searchInput.value = "";
				applyQuery("");
				haptic("select");
				searchInput.focus();
			});

			document.getElementById("btnRefresh").addEventListener("click", function () {
				if (state.refreshing) return;
				var btn = this;
				state.refreshing = true;
				btn.classList.add("is-busy");
				haptic();
				load().finally(function () {
					state.refreshing = false;
					btn.classList.remove("is-busy");
				});
			});

			var chips = document.querySelectorAll(".chip");
			for (var i = 0; i < chips.length; i++) {
				chips[i].addEventListener("click", function () {
					state.importance = this.getAttribute("data-imp");
					for (var j = 0; j < chips.length; j++) {
						chips[j].setAttribute("aria-pressed", chips[j] === this ? "true" : "false");
					}
					haptic("select");
					renderList();
				});
			}

			document.getElementById("swSubscribed").addEventListener("click", function () {
				if (!state.data || !state.data.subscription) return;
				state.data.subscription.subscribed = !state.data.subscription.subscribed;
				haptic();
				renderAlerts();
				saveSubscription();
			});

			document.getElementById("swLow").addEventListener("click", function () {
				if (!state.data || !state.data.subscription) return;
				state.data.subscription.show_low_importance = !state.data.subscription.show_low_importance;
				haptic();
				renderAlerts();
				saveSubscription();
			});

			var mBtns = document.querySelectorAll("#minutes button");
			for (var k = 0; k < mBtns.length; k++) {
				mBtns[k].addEventListener("click", function () {
					if (!state.data || !state.data.subscription) return;
					state.data.subscription.alert_minutes = Number(this.getAttribute("data-m"));
					haptic("select");
					renderAlerts();
					saveSubscription();
				});
			}

			// ---------- boot ----------
			// The markets view carries a live clock and second-resolution
			// countdowns, so it ticks every second. The tick only rewrites the
			// digits; a full redraw happens when a market actually opens or
			// closes, which the signature detects.
			// No state.data check: the markets view is computed entirely from the
			// clock, so it must keep running even when the API is unreachable.
			setInterval(function () {
				if (state.scope !== "markets" || !tickers.length) return;
				var now = new Date();
				if (marketsSignature(now) !== marketsSig) { renderList(); return; }
				var t = now.getTime();
				for (var i = 0; i < tickers.length; i++) tickers[i](t);
			}, 1000);

			if (tg) {
				tg.ready();
				tg.expand();
				applyScheme();
				// A user can flip Telegram's theme while the app is open.
				if (tg.onEvent) {
					try { tg.onEvent("themeChanged", applyScheme); } catch (e) { /* older clients */ }
				}
			}

			if (!tg || !tg.initData) {
				// Opened outside Telegram: there is no identity to verify, so say
				// so plainly instead of failing with a signature error.
				showError("این صفحه باید از داخل ربات تلگرام باز بشه.", false);
				document.getElementById("riskPill").hidden = true;
			} else {
				var remembered = readStoredScope();
				if (remembered) setScope(remembered);
				load();
			}
		})();
