(function () {
	"use strict";

	// تعریفِ وضعیت یک جاست، در data.js. تا امروز در چهار فایل تکرار شده
	// بود و از هم فاصله گرفته بودند.
	function statusMeta(status) { return CrmData.leadStatusMeta(status); }

	// Consultants are fetched once and reused for the row chip and the
	// "تغییر مشاور" menu, so the table does not fire one request per lead.
	var consultants = [];

	function formatRelativeTime(iso) {
		if (!iso) return "-";
		var date = new Date(iso);
		var now = new Date();
		var diffMins = Math.round((now - date) / 60000);
		if (diffMins < 1) return "همین الان";
		if (diffMins < 60) return faNum(diffMins) + " دقیقه پیش";
		var diffHours = Math.round(diffMins / 60);
		if (diffHours < 24) return faNum(diffHours) + " ساعت پیش";
		var diffDays = Math.round(diffHours / 24);
		if (diffDays === 1) return "دیروز";
		return faNum(diffDays) + " روز پیش";
	}

	var PAGE_SIZE = 15;

	var state = {
		leads: [],
		statusFilter: "همه",
		statusValue: "",
		sourceFilter: "",
		query: "",
		loading: true,
		error: null,
		page: 1
	};

	// Reads through the shared helper so this tab and the "پیگیری‌های امروز"
	// page can no longer disagree about which field holds the follow-up.
	function isDueForFollowUp(lead) {
		var value = CrmData.leadFollowupAt(lead);
		if (!value) return false;
		var due = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
			? CrmData.parseLocalDate(value.trim())
			: new Date(value);
		if (isNaN(due.getTime())) return false;
		var endOfToday = new Date();
		endOfToday.setHours(23, 59, 59, 999);
		return due <= endOfToday;
	}

	// Shared rule, defined once in js/data.js. Called through a wrapper because
	// this file is included before data.js, so CrmData does not exist yet here.
	function isAtRisk(lead) {
		return CrmData.isAtRisk(lead);
	}

	function currentUser() {
		try {
			return sessionStorage.getItem("crmUsername") || "";
		} catch (e) {
			return "";
		}
	}

	function isMine(lead) {
		var me = currentUser();
		return !!me && String(lead.assigned_to || "") === me;
	}

	/**
	 * ترتیبِ فهرست از فیلترِ فعال می‌آید، نه یک قاعده‌ی ثابت.
	 *
	 * پیش از این همه‌جا بر اساس آخرین تغییر مرتب می‌شد. یعنی حتی در تبِ
	 * «نیاز به پیگیری»، لیدی که ده روز عقب افتاده می‌توانست صفحه‌ی سوم
	 * باشد - درست همان‌جایی که فوریت باید ترتیب را تعیین کند.
	 */
	function sortRows(rows) {
		if (state.statusFilter === "امروز" || state.statusFilter === "عقب‌افتاده") {
			return rows.sort(function (a, b) {
				var da = followupDate(a), db = followupDate(b);
				return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
			});
		}
		if (state.statusFilter === "تازه") {
			// قدیمی‌ترین اول: لیدی که بیشتر منتظر مانده، بیشتر در خطر است.
			return rows.sort(function (a, b) {
				return new Date(a.created_at || 0) - new Date(b.created_at || 0);
			});
		}
		return rows.sort(function (a, b) {
			return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
		});
	}

	/**
	 * صف‌های کار.
	 *
	 * تب‌ها تا امروز فیلترِ وضعیت بودند («تماس گرفته شد» چه کاری از من
	 * می‌خواهد؟ هیچ). حالا هر تب یک سوالِ واقعیِ روزِ کاری است. فیلترِ
	 * وضعیت و منبع نرفته‌اند - به منوی «فیلترها» منتقل شده‌اند، پس هیچ
	 * توانایی‌ای کم نشده.
	 */
	var QUEUES = {
		"همه": function () { return true; },
		"مالِ_من": isMine,
		"تازه": function (l) {
			return (Number(l.contact_attempts) || 0) === 0 && !CrmData.leadFollowupAt(l);
		},
		"امروز": function (l) {
			var d = followupDate(l);
			if (!d) return false;
			var day = new Date(d); day.setHours(0, 0, 0, 0);
			return day.getTime() === startOfToday().getTime();
		},
		"عقب‌افتاده": function (l) {
			var d = followupDate(l);
			if (d) {
				var day = new Date(d); day.setHours(0, 0, 0, 0);
				if (day < startOfToday()) return true;
			}
			return isAtRisk(l);
		},
		"بی‌صاحب": function (l) { return !String(l.assigned_to || "").trim(); }
	};

	function getFilteredRows() {
		var q = state.query.trim();
		var queue = QUEUES[state.statusFilter] || QUEUES["همه"];
		return sortRows(state.leads
			.filter(queue)
			.filter(function (l) {
				if (!state.statusValue) return true;
				return l.status === state.statusValue;
			})
			.filter(function (l) {
				if (!state.sourceFilter) return true;
				return CrmData.normalizeSource(l.source) === state.sourceFilter;
			})
			.filter(function (l) {
				if (!q) return true;
				// جستجو پاسخ‌های ربات و شناسه را هم می‌گیرد: از وقتی «سطح»
				// و «هدف» ستون واقعی شدند، جستجوی «مدیریت سرمایه» هیچ
				// نتیجه‌ای نمی‌داد در حالی که داده‌اش موجود بود.
				var answers = CrmData.botAnswers(l);
				var hay = [l.full_name, l.phone, l.lead_id, answers.level, answers.topic,
					answers.experience, answers.trade_status, l.followup_reason]
					.map(function (x) { return String(x || ""); }).join(" ");
				return hay.indexOf(q) !== -1;
			}));
	}

	// ─── ستون‌های تصمیم‌ساز ───────────────────────────────────────────
	//
	// «چه کسی امروز باید زنگ بخورد» اولین سوالِ هر روزِ کاری است و تا
	// امروز جوابش فقط در صفحه‌ی پیگیری‌ها و داخل پرونده بود. سه حالت
	// از هم جدا می‌مانند: عقب‌افتاده، امروز، و آینده - چون سه کارِ
	// متفاوت‌اند.

	// ارقام فارسی، همان‌طور که تاریخ‌ها نمایش داده می‌شوند. یک سطر با
	// «۱۴۰۵/۰۶/۰۹» کنارِ «2 روز» دو زبانِ عددی در یک خط است.
	function faNum(n) {
		return Number(n).toLocaleString("fa-IR");
	}

	function startOfToday() {
		var d = new Date();
		d.setHours(0, 0, 0, 0);
		return d;
	}

	function followupDate(lead) {
		var value = CrmData.leadFollowupAt(lead);
		if (!value) return null;
		var d = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
			? CrmData.parseLocalDate(value.trim())
			: new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}

	/**
	 * «قدم بعدی» - جوابِ سوالی که مشاور واقعاً می‌پرسد.
	 *
	 * تا امروز سه ستونِ جدا بود (وضعیت، پیگیری بعدی، تماس‌ها) و مشاور
	 * باید خودش از کنارِ هم گذاشتنشان نتیجه می‌گرفت. حالا یک ستون است و
	 * خودش می‌گوید چه کاری مانده. ترتیبِ شرط‌ها همان ترتیبِ فوریت است.
	 *
	 * @returns {{key, label, sub, tone}} tone فقط برای رنگ است؛ متن
	 *          همیشه معنا را کامل می‌گوید، پس رنگ تنها حاملِ اطلاعات نیست.
	 */
	function nextStep(lead) {
		var due = followupDate(lead);
		var attempts = Number(lead.contact_attempts) || 0;
		var reason = String(lead.followup_reason || "").trim();

		if (due) {
			var dayStart = new Date(due);
			dayStart.setHours(0, 0, 0, 0);
			var days = Math.round((dayStart - startOfToday()) / 86400000);
			if (days < 0) {
				return { key: "overdue", tone: "danger",
					label: "پیگیری " + faNum(Math.abs(days)) + " روز عقب",
					sub: reason || due.toLocaleDateString("fa-IR") };
			}
			if (days === 0) {
				return { key: "today", tone: "warn", label: "پیگیری امروز",
					sub: reason || timeLabel(due) };
			}
			if (days === 1) {
				return { key: "soon", tone: "", label: "پیگیری فردا", sub: reason || "" };
			}
			return { key: "later", tone: "quiet",
				label: "پیگیری " + faNum(days) + " روز دیگر", sub: reason || "" };
		}

		if (attempts === 0) {
			// لیدی که هرگز زنگ نخورده، مهم‌ترین کارِ نکرده‌ی این صفحه است.
			return { key: "new", tone: "call", label: "تماس گرفته نشده",
				sub: leadAge(lead.created_at) + " از ثبتش گذشته" };
		}

		if (isAtRisk(lead)) {
			return { key: "risk", tone: "danger", label: "رها شده",
				sub: lead.last_call_at ? "آخرین تماس " + sinceLabel(lead.last_call_at) : "" };
		}

		return { key: "idle", tone: "quiet", label: "پیگیری ثبت نشده",
			sub: lead.last_call_at ? "آخرین تماس " + sinceLabel(lead.last_call_at) : "" };
	}

	function timeLabel(d) {
		var h = d.getHours(), m = d.getMinutes();
		if (!h && !m) return "";
		return "ساعت " + faNum(h) + ":" + (m < 10 ? "۰" : "") + faNum(m);
	}

	function nextStepCell(lead) {
		var step = nextStep(lead);
		var $td = $("<td>").attr("data-label", "قدم بعدی").addClass("next-cell");
		$td.append($('<span class="next-label">').addClass("tone-" + (step.tone || "plain")).text(step.label));
		if (step.sub) $td.append($('<div class="next-sub">').attr("title", step.sub).text(step.sub));
		return $td;
	}

	/** «۲ روز پیش» برای تاریخِ آخرین تماس. */
	function sinceLabel(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		var days = Math.floor((startOfToday() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
		if (days <= 0) return "امروز";
		if (days === 1) return "دیروز";
		if (days < 30) return faNum(days) + " روز پیش";
		return d.toLocaleDateString("fa-IR");
	}

	// سنِ لید، نه «آخرین به‌روزرسانی». آن یکی با هر تغییرِ کوچکی تازه
	// می‌شد، پس لیدِ ده‌روزه‌ای که همین حالا مشاورش عوض شده «۲ دقیقه
	// پیش» نشان می‌داد - دقیقاً برعکسِ چیزی که باید هشدار می‌داد.
	function leadAge(createdAt) {
		if (!createdAt) return "-";
		var d = new Date(createdAt);
		if (isNaN(d.getTime())) return "-";
		var days = Math.floor((startOfToday() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
		if (days <= 0) return "امروز";
		if (days === 1) return "دیروز";
		return faNum(days) + " روز";
	}

	// ─── کشوی پاسخ‌های ربات ──────────────────────────────────────────
	//
	// چیزی که مشاور پیش از برداشتن گوشی لازم دارد و تا امروز فقط داخل
	// صفحه‌ی پرونده بود: سطح معامله‌گری و هدف از مشاوره، همان دو پرسشی
	// که ربات می‌پرسد. چند ردیف می‌توانند هم‌زمان باز باشند.

	var expanded = {};

	function formatDay(value) {
		if (!value) return "";
		var d = /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())
			? CrmData.parseLocalDate(String(value).trim())
			: new Date(value);
		return isNaN(d.getTime()) ? "" : d.toLocaleDateString("fa-IR");
	}

	function qaCard(question, answer) {
		var $box = $('<div class="qa-card">');
		$box.append($('<div class="qa-q">').text(question));
		// خالی بودن، «پرسیده نشده» است نه «داده گم شده»: لید اینستاگرام و
		// سایت هرگز از ربات رد نشده‌اند. یک خانه‌ی خالی این تفاوت را
		// پنهان می‌کند.
		$box.append(
			answer
				? $('<div class="qa-a">').text(answer)
				: $('<div class="qa-a is-empty">').text("پرسیده نشده")
		);
		return $box;
	}

	function metaCell(key, value, warn) {
		var $m = $('<div class="qa-meta">');
		$m.append($('<div class="qa-meta-k">').text(key));
		$m.append($('<div class="qa-meta-v">').addClass(warn ? "warn" : "").text(value));
		return $m;
	}

	// ─── اقدام سریع ──────────────────────────────────────────────────
	//
	// خودِ نوار در js/quick-actions.js است چون کارتابل هم همان را نشان
	// می‌دهد. اینجا فقط وصلش می‌کنیم: نتیجه کجا نوشته شود و بعدش چه
	// چیزی تازه شود.

	function quickActionBar(lead) {
		// نتیجه با توستِ مشترکِ صفحه گفته می‌شود، نه داخل خودِ کشو: پیامی
		// که در ردیف بنشیند با اولین بازسازیِ جدول پاک می‌شود - و بدتر،
		// خودِ آن بازسازی فیلدهای نیمه‌پرشده‌ی کشو را هم می‌برد.
		return CrmQuickActions.bar(lead, { refresh: loadLeads });
	}

	/**
	 * حالتِ باز شده‌ی ردیف.
	 *
	 * چیزی که در ردیف جا نشد اینجاست - نه یک نسخه‌ی دومِ ردیف. اقدام‌ها
	 * در خودِ ردیف بالای همین کشو هستند، پس اینجا فقط اطلاعات می‌آید.
	 */
	function drawerRow(lead) {
		var answers = CrmData.botAnswers(lead);
		var $wrap = $('<div class="lead-drawer">');

		var $grid = $('<div class="qa-grid">');
		$grid.append(qaCard("📊 دانش در مارکت", answers.level));
		$grid.append(qaCard("⏳ مدت فعالیت", answers.experience));
		$grid.append(qaCard("💼 حساب ریل", answers.has_real_account));
		$grid.append(qaCard("📈 وضعیت ترید", answers.trade_status));
		// «هدف از مشاوره» دیگر پرسیده نمی‌شود؛ فقط برای پرونده‌های قدیمی
		// که جوابش را دارند نشان داده می‌شود.
		if (answers.topic) $grid.append(qaCard("💬 هدف از مشاوره", answers.topic));
		if (lead.course) $grid.append(qaCard("🎯 دوره‌ی انتخاب‌شده", lead.course));
		$wrap.append($grid);

		var $meta = $('<div class="qa-meta-strip">');
		$meta.append(metaCell("نوع درخواست", lead.request_type || "—"));
		$meta.append(metaCell("منبع", CrmData.sourceLabel(lead.source)));
		$meta.append(metaCell("دفعات تماس", faNum(Number(lead.contact_attempts) || 0)));
		$meta.append(metaCell("آخرین تماس", lead.last_call_at ? sinceLabel(lead.last_call_at) : "—"));
		$meta.append(metaCell("نتیجه آخرین تماس", lead.last_call_result || "—"));
		$meta.append(metaCell("سن لید", leadAge(lead.created_at)));
		$meta.append(metaCell("آخرین تغییر", formatRelativeTime(lead.updated_at || lead.created_at)));
		$meta.append(metaCell("شناسه لید", lead.lead_id || "—"));
		if (lead.telegram_username) {
			$meta.append(metaCell("تلگرام", "@" + String(lead.telegram_username).replace(/^@/, "")));
		}
		$wrap.append($meta);

		$wrap.append($('<div class="lead-drawer-actions">')
			.append($("<a>").addClass("btn btn-brand btn-sm")
				.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
				.html('<i class="fas fa-folder-open mr-1"></i>پرونده و تاریخچه‌ی کامل')));

		return $('<tr class="lead-drawer-row">').append($("<td>").attr("colspan", 5).append($wrap));
	}

	/**
	 * یک ردیفِ لید - پنج ستون، به‌ترتیبِ سوالی که مشاور می‌پرسد:
	 * کیست و شماره‌اش چند است / چرا آمده / کجای کار است / قدم بعدی چیست /
	 * چه کاری می‌توانم بکنم / مالِ کیست.
	 *
	 * ستون‌های قبلی که رفتند جایی نرفته‌اند: سن لید و شمارنده‌ی تماس زیرِ
	 * نام و در «قدم بعدی» آمده‌اند، و منوی وضعیت به «⋯ ← اصلاح وضعیت»
	 * رفته - چون وضعیت از ثبتِ تماس می‌آید و تغییرِ دستی فقط برای اصلاح
	 * است.
	 */
	function leadRow(lead) {
		var meta = statusMeta(lead.status);
		var step = nextStep(lead);
		var open = expanded[lead.lead_id] === true;

		var $tr = $("<tr>").addClass("lead-row row-" + meta.cls + " urg-" + step.key)
			.attr("data-id", lead.lead_id);
		if (open) $tr.addClass("is-open");

		// ─── لید: نام، شماره، و «چرا» ───────────────────────────────
		var $who = $("<td>").addClass("who-cell");
		var $top = $('<div class="who-top">');
		$top.append($('<button type="button" class="drawer-toggle">')
			.attr({ "aria-expanded": String(open), title: "جزئیات بیشتر", "data-lead-id": lead.lead_id })
			.html('<i class="fas fa-chevron-down"></i>'));
		$top.append($("<a>")
			.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
			.addClass("lead-name-link")
			.text(lead.full_name || "(بدون نام)"));
		if (lead.request_type) $top.append($('<span class="row-tag">').text(lead.request_type));
		$who.append($top);

		if (lead.phone) {
			var $phone = $('<div class="who-phone">');
			$phone.append($('<span class="phone-num mono" dir="ltr">').text(lead.phone));
			$phone.append(CrmQuickActions.copyPhoneButton(lead.phone));
			$who.append($phone);
		}

		// «چرا آمده» - تنها چیزی که پیش از برداشتنِ گوشی واقعاً لازم است و
		// تا امروز فقط داخل کشو بود.
		var answers = CrmData.botAnswers(lead);
		var why = answers.level || answers.topic || lead.course || "";
		if (why) {
			$who.append($('<div class="who-why">').attr("title", why)
				.append($('<i class="fas fa-quote-right">'))
				.append(document.createTextNode(why)));
		}
		$tr.append($who);

		// ─── وضعیت ──────────────────────────────────────────────────
		var $statusCell = $("<td>").attr("data-label", "وضعیت").addClass("status-cell");
		$statusCell.append($('<span class="lead-badge">').addClass(meta.cls)
			.append($('<i class="fas ' + meta.icon + '">'))
			.append($("<span>").text(meta.label)));
		if (lead.last_call_result) {
			$statusCell.append($('<div class="row-subline">').text(lead.last_call_result));
		}
		var attempts = Number(lead.contact_attempts) || 0;
		if (attempts) {
			$statusCell.append($('<div class="row-subline is-quiet">')
				.text(faNum(attempts) + " تماس" + (lead.last_call_at ? " · " + sinceLabel(lead.last_call_at) : "")));
		}
		$tr.append($statusCell);

		// ─── قدم بعدی ───────────────────────────────────────────────
		$tr.append(nextStepCell(lead));

		// ─── اقدام ──────────────────────────────────────────────────
		$tr.append($("<td>").attr("data-label", "اقدام").addClass("act-cell")
			.append(CrmQuickActions.compactBar(lead, {
				refresh: reloadKeepingScroll,
				consultants: consultants
			})));

		// ─── مشاور ──────────────────────────────────────────────────
		var $owner = $("<td>").attr("data-label", "مشاور").addClass("owner-cell");
		var name = ownerName(lead.assigned_to);
		var $dot = $('<span class="owner-dot">');
		// حرفِ اولِ «بدون مشاور» یعنی «ب» - که هیچ معنایی ندارد؛ نبودنِ
		// صاحب با یک آیکون گفته می‌شود نه با حرفِ اولِ یک جمله.
		if (lead.assigned_to) $dot.text(name.slice(0, 1));
		else $dot.html('<i class="fas fa-user-slash"></i>');
		$owner.append($('<span class="owner-chip">').addClass(lead.assigned_to ? "" : "is-unassigned")
			.attr("title", lead.assigned_to ? name : "این لید هنوز صاحب ندارد")
			.append($dot)
			.append($("<span>").text(name)));
		$tr.append($owner);

		return $tr;
	}

	function ownerName(username) {
		if (!username) return "بدون مشاور";
		var found = consultants.find(function (c) { return c.username === username; });
		return (found && found.display_name) || username;
	}

	// تازه‌سازی بعد از یک اقدام، بدون پریدنِ صفحه به بالا: مشاور وسطِ
	// فهرست است و هر بار برگشتن به اولِ لیست یعنی گم کردنِ جای کار.
	function reloadKeepingScroll() {
		var y = window.scrollY;
		CrmData.invalidateLeadsCache();
		loadLeads(function () { window.scrollTo(0, y); });
	}

	// شمارنده‌ی هر صف روی خودِ تب. کارت‌های آمارِ بالای صفحه همین چهار
	// عدد را می‌گفتند، دو برابرِ ارتفاعِ یک صفحه‌ی موبایل می‌گرفتند و
	// کلیک‌پذیر هم نبودند؛ عددها اینجا آمدند و کارت‌ها رفتند.
	function renderStats() {
		Object.keys(QUEUES).forEach(function (key) {
			var n = key === "همه" ? state.leads.length : state.leads.filter(QUEUES[key]).length;
			var $badge = $('.filter-tab[data-status="' + key + '"] .tab-count');
			if (!$badge.length) return;
			$badge.text(n ? faNum(n) : "").toggleClass("d-none", !n);
		});
	}

	var EMPTY_TEXT = {
		"مالِ_من": "لیدی به نام شما ثبت نشده",
		"تازه": "همه‌ی لیدها یک بار تماس گرفته‌اند",
		"امروز": "پیگیریِ امروز تمام شد",
		"عقب‌افتاده": "هیچ پیگیریِ عقب‌افتاده‌ای نمانده",
		"بی‌صاحب": "همه‌ی لیدها مشاور دارند"
	};

	function renderTable() {
		var $body = $("#leadsTableBody").empty();
		$("#pagination").addClass("d-none");

		if (state.loading) {
			// اسکلت، نه اسپینر: جای همان ردیف‌هایی را می‌گیرد که قرار است
			// بیایند، پس فهرست موقع رسیدنِ داده نمی‌پرد.
			CrmData.showTableLoading("#leadsTableBody", 5, 6);
			return;
		}
		if (state.error) {
			$body.append($("<tr>").append($("<td>").attr("colspan", 5).append(
				$('<div class="leads-empty">')
					.append('<i class="fas fa-triangle-exclamation"></i>')
					.append($("<h4>").text("اطلاعات نیامد"))
					.append($("<p>").text(state.error))
					.append($('<button type="button" class="btn btn-brand btn-sm" id="btnRetryLeads">').text("تلاش دوباره"))
			)));
			return;
		}

		var rows = getFilteredRows();

		if (rows.length === 0) {
			// پیامِ خالی به همان صفی که کاربر باز کرده اشاره می‌کند. یک
			// «موردی یافت نشد» عمومی نمی‌گوید صف خالی است یا فیلتر همه را
			// گرفته.
			var hasFilter = !!(state.query || state.statusValue || state.sourceFilter);
			$body.append($("<tr>").append($("<td>").attr("colspan", 5).append(
				$('<div class="leads-empty">')
					.append('<i class="fas ' + (hasFilter ? "fa-magnifying-glass" : "fa-mug-hot") + '"></i>')
					.append($("<h4>").text(hasFilter ? "چیزی با این فیلترها پیدا نشد" : EMPTY_TEXT[state.statusFilter] || "این صف خالی است"))
					.append($("<p>").text(hasFilter
						? "جستجو یا فیلترها را بردارید تا دوباره ببینید."
						: "کارِ این بخش تمام است."))
					.append(hasFilter
						? $('<button type="button" class="btn btn-outline-secondary btn-sm" id="btnClearAll">').text("پاک کردن جستجو و فیلترها")
						: $())
			)));
			return;
		}

		var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		if (state.page > totalPages) state.page = totalPages;
		var start = (state.page - 1) * PAGE_SIZE;
		var pageRows = rows.slice(start, start + PAGE_SIZE);

		pageRows.forEach(function (lead) {
			$body.append(leadRow(lead));
			if (expanded[lead.lead_id] === true) $body.append(drawerRow(lead));
		});

		if (rows.length > PAGE_SIZE) {
			$("#pagination").removeClass("d-none");
			$("#paginationInfo").text("صفحه " + state.page + " از " + totalPages + " (" + rows.length + " لید)");
			$("#btnPrevPage").prop("disabled", state.page <= 1);
			$("#btnNextPage").prop("disabled", state.page >= totalPages);
		}
	}

	function render() {
		renderStats();
		renderTable();
	}

	function loadLeads(done) {
		state.loading = true;
		state.error = null;
		render();
		CrmData.fetchLeads()
			.then(function (leads) {
				// Mentoring-form requests have their own page. Filtering here
				// rather than at render time keeps the counters, the tab
				// badges and the pagination agreeing with the visible rows.
				state.leads = leads.filter(function (l) { return !CrmData.isMentoringLead(l); });
				state.loading = false;
				render();
				if (typeof done === "function") done();
			})
			.catch(function (err) {
				state.loading = false;
				state.error = err.message || "خطای نامشخص";
				render();
			});
	}

	function loadConsultants() {
		if (typeof CrmData.fetchConsultants !== "function") return;
		CrmData.fetchConsultants()
			.then(function (list) {
				consultants = list || [];
				// The table may already be on screen; redraw so the dropdowns
				// get their options.
				if (!state.loading) renderTable();
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری فهرست مشاوران:", err);
			});
	}

	function populateFilters() {
		var $src = $("#sourceFilter");
		CrmData.LEAD_SOURCES.forEach(function (s) {
			// The mentoring source is excluded from this list entirely, so
			// offering it here would only ever select nothing.
			if (s.key === CrmData.MENTORING_SOURCE) return;
			$src.append($("<option>").val(s.key).text(s.label));
		});
		var $st = $("#statusFilter");
		CrmData.LEAD_STATUSES.forEach(function (st) {
			$st.append($("<option>").val(st.key).text(st.label));
		});
	}

	// نقطه‌ی کنارِ «فیلترها» تنها نشانه‌ی این است که فهرست دارد چیزی را
	// پنهان می‌کند. بدونش، مشاور می‌تواند نیم ساعت دنبالِ لیدی بگردد که
	// یک فیلترِ فراموش‌شده کنارش گذاشته.
	function syncFilterDot() {
		var on = !!(state.statusValue || state.sourceFilter);
		$(".filters-dot").toggleClass("d-none", !on);
		$("#btnFilters").toggleClass("is-on", on);
	}

	$(function () {
		populateFilters();
		loadLeads();
		loadConsultants();

		$("#sourceFilter").on("change", function () {
			state.sourceFilter = $(this).val();
			state.page = 1;
			syncFilterDot();
			renderTable();
		});

		$("#statusFilter").on("change", function () {
			state.statusValue = $(this).val();
			state.page = 1;
			syncFilterDot();
			renderTable();
		});

		$("#btnResetFilters").on("click", function () {
			state.statusValue = "";
			state.sourceFilter = "";
			$("#statusFilter, #sourceFilter").val("");
			state.page = 1;
			syncFilterDot();
			renderTable();
		});

		// منوی فیلترها همان popoverِ کامپوننتِ مشترک است، پس با کلیکِ
		// بیرون و Escape بسته می‌شود بدون کدِ تازه.
		$("#btnFilters").on("click", function (e) {
			e.stopPropagation();
			var $box = $("#filtersPop");
			var willOpen = !$box.hasClass("is-open");
			CrmQuickActions.closePops();
			$box.toggleClass("is-open", willOpen);
		});
		$("#filtersPop .qa-pop-panel").on("click", function (e) { e.stopPropagation(); });

		$("#searchInput").on("input", function () {
			$("#btnClearSearch").toggleClass("d-none", !$(this).val());
		});
		$("#btnClearSearch").on("click", function () {
			$("#searchInput").val("").trigger("input").focus();
			state.query = "";
			state.page = 1;
			renderTable();
		});

		$("#filterTabs").on("click", ".filter-tab", function () {
			$(".filter-tab").removeClass("active");
			$(this).addClass("active");
			state.statusFilter = $(this).data("status");
			state.page = 1;
			renderTable();
		});

		$("#searchInput").on("input", function () {
			state.query = $(this).val();
			state.page = 1;
			renderTable();
		});

		$("#btnPrevPage").on("click", function () {
			if (state.page > 1) {
				state.page -= 1;
				renderTable();
			}
		});

		$("#btnNextPage").on("click", function () {
			state.page += 1;
			renderTable();
		});

		// ─── لید جدید ────────────────────────────────────────────────
		CrmData.LEAD_SOURCES.forEach(function (src) {
			// فرم منتورینگ سایت را خودِ سایت پر می‌کند؛ انتخابش اینجا
			// یعنی لیدی که در صفحه‌ی منتورینگ دیده می‌شود ولی از آنجا
			// نیامده.
			if (src.key === CrmData.MENTORING_SOURCE) return;
			$("#nlSource").append($("<option>").val(src.key).text(src.label));
		});
		$("#nlSource").val("instagram");

		$("#btnNewLead").on("click", function () {
			$("#newLeadResult").addClass("d-none").empty();
			$("#newLeadModal").modal("show");
			setTimeout(function () { $("#nlName").focus(); }, 250);
		});

		$("#btnSaveNewLead").on("click", function () {
			var $btn = $(this);
			var $out = $("#newLeadResult").removeClass("d-none text-success text-danger");
			var payload = {
				full_name: $("#nlName").val().trim(),
				phone: $("#nlPhone").val().trim(),
				source: $("#nlSource").val(),
				request_type: $("#nlRequestType").val(),
				course: $("#nlCourse").val(),
				level: $("#nlLevel").val().trim(),
				topic: $("#nlTopic").val().trim(),
				note: $("#nlNote").val().trim()
			};
			if (!payload.full_name || !payload.phone) {
				$out.addClass("text-danger").text("نام و شماره لازم است.");
				return;
			}
			$btn.prop("disabled", true).text("در حال ثبت…");
			CrmData.createLead(payload)
				.then(function (res) {
					if (res && res.ok === false) {
						// شماره‌ی تکراری: به‌جای خطای خشک، راهِ رفتن به
						// پرونده‌ی موجود داده می‌شود.
						$out.addClass("text-danger").text(res.error || "ثبت نشد.");
						if (res.existing_lead_id) {
							$out.append($("<a>").addClass("mr-2")
								.attr("href", "lead.html?id=" + encodeURIComponent(res.existing_lead_id))
								.text("باز کردن پرونده‌ی موجود"));
						}
						return;
					}
					$out.addClass("text-success").text("لید ثبت شد.");
					["#nlName", "#nlPhone", "#nlLevel", "#nlTopic", "#nlNote"].forEach(function (sel) {
						$(sel).val("");
					});
					CrmData.invalidateLeadsCache();
					loadLeads();
					setTimeout(function () { $("#newLeadModal").modal("hide"); }, 900);
				})
				.catch(function (err) {
					$out.addClass("text-danger").text("خطا: " + (err.message || "خطای نامشخص"));
				})
				.finally(function () {
					$btn.prop("disabled", false).text("ثبت لید");
				});
		});

		$("#leadsTableBody").on("click", "#btnRetryLeads", function () {
			CrmData.invalidateLeadsCache();
			loadLeads();
		});

		$("#leadsTableBody").on("click", "#btnClearAll", function () {
			state.query = "";
			state.statusValue = "";
			state.sourceFilter = "";
			$("#searchInput").val("").trigger("input");
			$("#statusFilter, #sourceFilter").val("");
			state.page = 1;
			syncFilterDot();
			renderTable();
		});

		$("#leadsTableBody").on("click", ".drawer-toggle", function () {
			var leadId = $(this).data("lead-id");
			expanded[leadId] = !expanded[leadId];
			renderTable();
		});

		// کلیک بیرون، منوهای باز را می‌بندد. بدون این، دو منوی باز روی
		// هم می‌افتند و کاربر نمی‌داند کدام‌یک را انتخاب می‌کند.
	});
})();
