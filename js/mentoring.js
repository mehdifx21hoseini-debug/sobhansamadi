(function () {
	"use strict";

	// The questionnaire, in the order the site's form asks it. Everything
	// the page shows is driven from here, so adding a question later means
	// adding one line rather than touching the markup.
	var QUESTIONS = [
		{ key: "market_experience", label: "مدت فعالیت در بازارهای مالی", icon: "fa-hourglass-half", quick: true },
		{ key: "has_real_account", label: "سابقه حساب ریل", icon: "fa-wallet", quick: true },
		{ key: "real_account_duration", label: "مدت معامله در حساب ریل", icon: "fa-clock-rotate-left" },
		{ key: "capital_traded", label: "میزان سرمایه‌ی معامله‌شده", icon: "fa-coins", quick: true },
		{ key: "styles_learned", label: "سبک‌هایی که آموزش دیده", icon: "fa-book-open" },
		{ key: "teacher_name", label: "استاد", icon: "fa-user-tie" },
		{ key: "trading_goal", label: "هدف از معامله‌گر شدن", icon: "fa-bullseye" },
		{ key: "has_strategy", label: "استراتژی معاملاتی", icon: "fa-chess", quick: true },
		{ key: "strategy_performance", label: "بازدهی استراتژی", icon: "fa-chart-line" },
		{ key: "strategy_image_url", label: "تصویر استراتژی", icon: "fa-image", isLink: true }
	];
	var KNOWN = {};
	QUESTIONS.forEach(function (q) { KNOWN[q.key] = q; });

	// Legacy rows: before the questionnaire existed, WF-21 recorded each
	// submission as one line inside the lead's notes. Split on the marker
	// rather than per line, so multi-line messages survive intact.
	var NOTE_MARKER = "📩 درخواست منتورینگ اختصاصی (وبسایت) - ";
	var STAMPED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::\s*)?([\s\S]*)$/;

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock", label: "در انتظار تماس" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone", label: "تماس گرفته شد" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash", label: "پاسخ نداد" }
	};

	function normalizeStatus(s) {
		if (!s || s === "جدید") return "پاسخ‌داده‌نشده";
		return s;
	}

	function fa(n) { return Number(n || 0).toLocaleString("fa-IR"); }

	function formatDate(iso) {
		if (!iso) return "-";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return String(iso);
		return d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
	}

	// A relative age reads faster than a date when triaging a queue.
	function timeAgo(iso) {
		var t = new Date(iso).getTime();
		if (isNaN(t)) return "";
		var mins = Math.floor((Date.now() - t) / 60000);
		if (mins < 1) return "همین الان";
		if (mins < 60) return fa(mins) + " دقیقه پیش";
		var hours = Math.floor(mins / 60);
		if (hours < 24) return fa(hours) + " ساعت پیش";
		var days = Math.floor(hours / 24);
		if (days < 30) return fa(days) + " روز پیش";
		return formatDate(iso);
	}

	function legacyEntries(notes) {
		if (!notes) return [];
		var parts = String(notes).split(NOTE_MARKER);
		var out = [];
		for (var i = 1; i < parts.length; i++) {
			var chunk = parts[i].replace(/\s+$/, "");
			var m = chunk.match(STAMPED);
			if (m) out.push({ at: m[1], message: (m[2] || "").trim() });
			else out.push({ at: "", message: chunk.trim() });
		}
		return out;
	}

	// Note stamps come from toISOString() with the zone dropped; put it back
	// before formatting or every legacy row reads hours off.
	function stampToIso(stamp) {
		return stamp ? stamp.replace(" ", "T") + ":00Z" : "";
	}

	var state = { items: [], query: "", statusFilter: "", expanded: {} };

	// One record per submission, whether it came from the questionnaire
	// table or from the older notes format, so the page renders one shape.
	function buildItems(requests, leads) {
		var leadById = {};
		(leads || []).forEach(function (l) { if (l && l.lead_id) leadById[l.lead_id] = l; });

		if (requests && requests.length) {
			return requests.map(function (r) {
				var lead = leadById[r.lead_id] || {};
				return {
					id: r.request_id,
					lead_id: r.lead_id,
					name: r.full_name || lead.full_name || "(بدون نام)",
					phone: r.phone || lead.phone || "",
					telegram: r.telegram_id || "",
					email: r.email || "",
					goal: r.consultation_goal || "",
					answers: r.answers || {},
					created_at: r.created_at,
					status: normalizeStatus(lead.status),
					assigned_to: lead.assigned_to || "",
					hasLead: !!lead.lead_id
				};
			});
		}

		// No questionnaire rows yet: fall back to what the notes hold, so the
		// page still shows the requests that arrived before this table existed.
		var out = [];
		(leads || []).filter(CrmData.isMentoringLead).forEach(function (l) {
			var entries = legacyEntries(l.notes);
			if (entries.length === 0) {
				entries = [{ at: "", message: "" }];
			}
			entries.forEach(function (e, idx) {
				out.push({
					id: l.lead_id + "-" + idx,
					lead_id: l.lead_id,
					name: l.full_name || "(بدون نام)",
					phone: l.phone || "",
					telegram: "",
					email: "",
					goal: e.message,
					answers: {},
					created_at: stampToIso(e.at) || l.created_at,
					status: normalizeStatus(l.status),
					assigned_to: l.assigned_to || "",
					hasLead: true
				});
			});
		});
		return out;
	}

	function matches(item) {
		if (state.statusFilter && item.status !== state.statusFilter) return false;
		var q = state.query.trim().toLowerCase();
		if (!q) return true;
		var hay = [item.name, item.phone, item.telegram, item.goal, item.lead_id]
			.concat(Object.keys(item.answers).map(function (k) { return item.answers[k]; }))
			.map(function (v) { return String(v || "").toLowerCase(); })
			.join(" ");
		return hay.indexOf(q) !== -1;
	}

	function renderStats(items) {
		var pending = 0, week = 0, withAnswers = 0;
		var weekAgo = Date.now() - 7 * 86400000;
		items.forEach(function (i) {
			if (i.status === "پاسخ‌داده‌نشده") pending++;
			var t = new Date(i.created_at).getTime();
			if (!isNaN(t) && t >= weekAgo) week++;
			if (Object.keys(i.answers).length > 0) withAnswers++;
		});
		$("#mt-total").text(items.length);
		$("#mt-pending").text(pending);
		$("#mt-week").text(week);
		$("#mt-answered").text(withAnswers);
	}

	function answerRow(key, value) {
		var meta = KNOWN[key];
		var label = meta ? meta.label : key;
		var icon = meta ? meta.icon : "fa-circle-question";
		var $row = $("<div>").addClass("mr-answer");
		$row.append($("<span>").addClass("mr-answer-label")
			.append($("<i>").addClass("fas " + icon))
			.append(document.createTextNode(label)));
		var $val = $("<span>").addClass("mr-answer-value");
		if (meta && meta.isLink && /^https?:\/\//i.test(value)) {
			$val.append($("<a>").attr({ href: value, target: "_blank", rel: "noopener noreferrer" })
				.append($("<i>").addClass("fas fa-arrow-up-right-from-square mr-1"))
				.append(document.createTextNode("مشاهده تصویر")));
		} else {
			$val.text(value);
		}
		$row.append($val);
		return $row;
	}

	function buildCard(item) {
		var $card = $("<article>").addClass("mr-card").toggleClass("is-new", item.status === "پاسخ‌داده‌نشده");

		// --- header
		var $head = $("<header>").addClass("mr-head");
		$head.append($("<span>").addClass("mr-avatar").text((item.name || "?").trim().charAt(0)));

		var $who = $("<div>").addClass("mr-who");
		var $name = item.hasLead
			? $("<a>").attr("href", "lead.html?id=" + encodeURIComponent(item.lead_id)).addClass("mr-name")
			: $("<span>").addClass("mr-name");
		$name.text(item.name);
		$who.append($name);

		var $meta = $("<div>").addClass("mr-meta");
		if (item.phone) {
			$meta.append($("<a>").attr("href", "tel:" + item.phone).addClass("mr-chip mono").attr("dir", "ltr")
				.append($("<i>").addClass("fas fa-phone"))
				.append(document.createTextNode(item.phone)));
		}
		if (item.telegram) {
			$meta.append($("<span>").addClass("mr-chip mono").attr("dir", "ltr")
				.append($("<i>").addClass("fab fa-telegram"))
				.append(document.createTextNode(item.telegram)));
		}
		$meta.append($("<span>").addClass("mr-chip is-quiet")
			.append($("<i>").addClass("fas fa-clock"))
			.append(document.createTextNode(timeAgo(item.created_at))));
		$who.append($meta);
		$head.append($who);

		var $side = $("<div>").addClass("mr-head-side");
		var sm = STATUS_META[item.status] || STATUS_META["پاسخ‌داده‌نشده"];
		$side.append($("<span>").addClass("status-badge " + sm.cls)
			.append($("<i>").addClass("fas " + sm.icon))
			.append(document.createTextNode(sm.label)));
		$side.append($("<span>").addClass("mr-assignee")
			.text(item.assigned_to ? "مشاور: " + item.assigned_to : "بدون مشاور"));
		$head.append($side);
		$card.append($head);

		// --- the applicant's own words, given the most weight on the card
		if (item.goal) {
			$card.append($("<blockquote>").addClass("mr-goal").text(item.goal));
		}

		var keys = Object.keys(item.answers);
		if (keys.length === 0) {
			$card.append($("<p>").addClass("mr-empty-answers")
				.text("پاسخ‌های فرم برای این درخواست ثبت نشده است."));
			return $card;
		}

		// --- the four facts that decide whether this person is a fit
		var $quick = $("<div>").addClass("mr-quick");
		QUESTIONS.filter(function (q) { return q.quick && item.answers[q.key]; }).forEach(function (q) {
			$quick.append($("<div>").addClass("mr-quick-item")
				.append($("<span>").addClass("mr-quick-label").text(q.label))
				.append($("<span>").addClass("mr-quick-value").text(item.answers[q.key])));
		});
		if ($quick.children().length) $card.append($quick);

		// --- everything else, folded away until asked for
		var rest = [];
		QUESTIONS.forEach(function (q) {
			if (!q.quick && item.answers[q.key]) rest.push([q.key, item.answers[q.key]]);
		});
		keys.forEach(function (k) {
			if (!KNOWN[k]) rest.push([k, item.answers[k]]);
		});

		if (rest.length) {
			var open = !!state.expanded[item.id];
			var $body = $("<div>").addClass("mr-answers").toggleClass("d-none", !open);
			rest.forEach(function (pair) { $body.append(answerRow(pair[0], pair[1])); });

			var $toggle = $("<button type='button'>").addClass("mr-toggle")
				.html('<i class="fas fa-chevron-' + (open ? "up" : "down") + ' ml-1"></i>'
					+ (open ? "بستن پاسخ‌ها" : "نمایش " + fa(rest.length) + " پاسخ دیگر"));
			$toggle.on("click", function () {
				state.expanded[item.id] = !state.expanded[item.id];
				render();
			});
			$card.append($toggle).append($body);
		}

		return $card;
	}

	function render() {
		var rows = state.items.filter(matches);
		var $list = $("#mentoringList").empty();

		$("#mt-shown").text(rows.length === state.items.length
			? ""
			: "نمایش " + fa(rows.length) + " از " + fa(state.items.length));

		if (rows.length === 0) {
			var msg = state.items.length === 0
				? "هنوز درخواستی از فرم منتورینگ سایت ثبت نشده است."
				: "موردی با این فیلترها پیدا نشد.";
			$list.append($("<div>").addClass("empty-state")
				.append($("<i>").addClass("fas fa-graduation-cap"))
				.append($("<p>").text(msg)));
			return;
		}
		rows.forEach(function (item) { $list.append(buildCard(item)); });
	}

	function load() {
		$("#mentoringList").html('<div class="text-center py-5 text-muted">در حال بارگذاری…</div>');
		// The questionnaire endpoint is new; if it is not reachable the page
		// still renders from the leads' notes rather than showing an error.
		Promise.all([
			CrmData.fetchMentoringRequests().catch(function () { return null; }),
			CrmData.fetchLeads().catch(function () { return []; })
		]).then(function (res) {
			var requests = Array.isArray(res[0]) ? res[0] : null;
			state.items = buildItems(requests, res[1]).sort(function (a, b) {
				return new Date(b.created_at || 0) - new Date(a.created_at || 0);
			});
			renderStats(state.items);
			render();
		}).catch(function (err) {
			$("#mentoringList").html('<div class="text-center py-5" style="color:#c81e4b">خطا در دریافت اطلاعات: '
				+ (err.message || "خطای نامشخص") + "</div>");
		});
	}

	$(function () {
		$("#mentoringSearch").on("input", function () { state.query = this.value; render(); });
		$("#mentoringStatus").on("change", function () { state.statusFilter = this.value; render(); });
		$("#btnRefreshMentoring").on("click", function () {
			if (CrmData.invalidateLeadsCache) CrmData.invalidateLeadsCache();
			load();
		});
		load();
	});
})();
