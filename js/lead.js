/**
 * صفحه‌ی پرونده‌ی لید.
 *
 * ─── قاعده‌ی این صفحه ───────────────────────────────────────────────
 * یک اتفاق، یک جای ثبت. پیش از این، ثبتِ یک تماس بین چهار جا پخش بود:
 * دکمه‌های وضعیت، فرم نتیجه‌ی تماس، تاریخ پیگیری در ستون کناری، و
 * «افزودن یادداشت». مشاور معمولاً یکی‌شان را جا می‌انداخت و پرونده
 * نیمه‌کاره می‌ماند. حالا فرمِ تماس هر سه کار را با هم انجام می‌دهد و
 * وضعیت خودکار از روی نتیجه ست می‌شود.
 *
 * تاریخچه هم یکی شده: پیش از این سه فهرستِ زمانیِ جدا بود (یادداشت‌های
 * ربات، مکالمه‌ی هوش مصنوعی، لاگ فعالیت) و ترتیبِ واقعیِ اتفاق‌ها بین
 * آن‌ها گم می‌شد.
 */
(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock", label: "در انتظار تماس" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone", label: "تماس گرفته شد" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash", label: "پاسخ نداد" }
	};

	var leadId = getLeadId();
	var currentLead = null;
	var reminderPicker = null;
	var timelineItems = [];
	var timelineGroup = "all";
	var selectedCallResult = null;
	var callFollowup = "";      // "" یعنی دست نزن
	var clearFollowup = false;  // «پیگیری لازم نیست»

	function getLeadId() {
		return new URLSearchParams(window.location.search).get("id");
	}

	function pad2(n) { return (n < 10 ? "0" : "") + n; }

	function toIsoDate(date) {
		return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
	}

	function formatDate(iso) {
		if (!iso) return "-";
		var d = new Date(iso);
		return isNaN(d.getTime()) ? "-" : d.toLocaleString("fa-IR");
	}

	function formatDay(value) {
		if (!value) return "-";
		var d = /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())
			? CrmData.parseLocalDate(String(value).trim())
			: new Date(value);
		return isNaN(d.getTime()) ? "-" : d.toLocaleDateString("fa-IR");
	}

	function toman(amount) {
		var n = Number(amount);
		if (!isFinite(n)) return "-";
		return n.toLocaleString("fa-IR") + " تومان";
	}

	/**
	 * تاریخِ نوشته‌شده داخل متنِ یادداشت‌ها.
	 *
	 * دو شکل وجود دارد چون دو نسل کد آن‌ها را نوشته‌اند: مهرِ ISO که ربات
	 * می‌زند («2026-09-01 08:15»، به وقت UTC) و مهرِ شمسی که پنل می‌زند.
	 * چیزی که پارس نشود null برمی‌گرداند و متنِ اصلی‌اش نمایش داده
	 * می‌شود - حدس زدنِ تاریخ بدتر از نداشتنش است.
	 */
	function parseStamp(stamp) {
		var s = String(stamp || "").trim();
		if (!s) return null;

		var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
		if (iso) {
			return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5]));
		}

		var latin = s.replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); });
		var nums = latin.match(/\d+/g);
		if (!nums || nums.length < 3) return null;
		var y = +nums[0];
		if (y < 1300 || y > 1500) return null;
		if (typeof persianDate !== "function") return null;
		try {
			var parts = [y, +nums[1], +nums[2], +(nums[3] || 0), +(nums[4] || 0)];
			var d = new persianDate(parts).toDate();
			return isNaN(d.getTime()) ? null : d;
		} catch (e) {
			return null;
		}
	}

	// ─── خواندنِ متنِ یادداشت‌ها ────────────────────────────────────────
	//
	// این ستون چهار نسل قالب دارد و هیچ‌کدام حذف نشده‌اند. جداکننده هم
	// یکی نیست: قالب قدیمی «---» می‌گذاشت، ربات فقط خط تازه. برای همین
	// اول روی «---» و بعد روی خطی که با [ یا 📩 شروع می‌شود می‌شکنیم؛
	// وگرنه یک یادداشتِ دوخطی وسط یادداشتِ بعدی گم می‌شد.

	function splitNoteBlocks(notesText) {
		var blocks = [];
		String(notesText || "").split(/\n?---\n?/).forEach(function (chunk) {
			chunk.split("\n").forEach(function (line) {
				if (/^\s*(\[|📩)/.test(line) || blocks.length === 0) {
					if (line.trim()) blocks.push(line);
				} else if (line.trim()) {
					blocks[blocks.length - 1] += "\n" + line;
				}
			});
		});
		return blocks.filter(function (b) { return b.trim(); });
	}

	function parseNoteBlock(block) {
		var text = block.trim();

		var mentoring = text.match(/^📩\s*(.*?)\s*-\s*(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2})\s*:?\s*([\s\S]*)$/);
		if (mentoring) {
			return { kind: "bot", icon: "fa-graduation-cap", title: "درخواست منتورینگ (فرم سایت)",
				stamp: mentoring[2], body: mentoring[3] };
		}

		var head = text.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
		var stamp = head ? head[1] : "";
		var rest = head ? head[2] : text;

		if (/یادداشت مشاور/.test(stamp)) {
			return { kind: "note", icon: "fa-sticky-note", title: "یادداشت داخلی",
				stamp: stamp.replace(/\s*-\s*یادداشت مشاور\s*$/, ""), body: rest };
		}

		var esc = rest.match(/^([\s\S]*?)\n\n?🔎\s*دلیل ارجاع:\s*([\s\S]*)$/);
		if (esc) {
			return { kind: "bot", icon: "fa-robot", title: "سوال ارجاع‌شده از هوش مصنوعی",
				stamp: stamp, body: esc[1].trim(), note: esc[2].trim() };
		}

		// «سطح: … | موضوع: … | زمان مناسب تماس: …» — چه با پیشوندِ تازه‌ی
		// «از ربات تلگرام —» و چه بدون آن، همان درخواست مشاوره است.
		if (/(^|—|\|)\s*سطح:/.test(rest) || /از ربات تلگرام/.test(rest)) {
			var fields = rest.replace(/^از ربات تلگرام\s*—?\s*/, "").split("|").map(function (p) {
				return p.trim();
			}).filter(Boolean);
			return { kind: "bot", icon: "fa-user-tie", title: "درخواست مشاوره از ربات",
				stamp: stamp, kv: fields };
		}

		return { kind: "bot", icon: "fa-comment", title: "پیام ثبت‌شده", stamp: stamp, body: rest };
	}

	// ─── ساختنِ تایم‌لاین ───────────────────────────────────────────────

	// لاگ فعالیت هرچه را که جای دیگری کامل‌تر نشان داده می‌شود تکرار
	// می‌کند؛ آن‌ها اینجا کنار گذاشته می‌شوند تا هر اتفاق یک بار بیاید.
	var ACTIVITY_SHOWN = {
		"ارسال پیام": { icon: "fa-paper-plane", title: "پیام تلگرام ارسال شد", kind: "note" },
		"assign": { icon: "fa-user-tag", title: "ارجاع لید", kind: "note" },
		"source": { icon: "fa-signpost", title: "تغییر منبع", kind: "note" },
		"status": { icon: "fa-clock", title: "تغییر وضعیت", kind: "note" },
		"درخواست منتورینگ": { icon: "fa-graduation-cap", title: "درخواست منتورینگ", kind: "bot" }
	};

	var CALL_TONE = {
		"خرید کرد": "tl-buy",
		"جواب نداد": "tl-cold",
		"مخالفت": "tl-cold",
		"نامرتبط": "tl-cold"
	};

	function buildTimeline(lead, activity) {
		var items = [];
		var fallback = lead.created_at ? new Date(lead.created_at) : null;

		(lead.calls || []).forEach(function (c) {
			var kv = [];
			if (c.next_step) kv.push("پیگیری بعدی: " + formatDay(c.next_step));
			items.push({
				t: new Date(c.created_at), group: "team", kind: "call",
				icon: "fa-phone-volume", tone: CALL_TONE[c.result] || "",
				title: "تماس — " + (c.result || "بدون نتیجه"),
				actor: c.admin_username || "", body: c.note || "", kv: kv,
				time: formatDate(c.created_at)
			});
		});

		(lead.orders || []).forEach(function (o) {
			var kv = [];
			if (o.transaction_id) kv.push("پیگیری: " + o.transaction_id);
			kv.push(o.source === "manual" ? "ثبت دستی" : "از درگاه");
			items.push({
				t: new Date(o.payment_date || o.created_at), group: "team", kind: "purchase",
				icon: "fa-sack-dollar", tone: "tl-buy",
				title: "خرید — " + toman(o.amount),
				actor: "", body: o.product_name || "", kv: kv,
				time: formatDate(o.payment_date || o.created_at)
			});
		});

		(lead.tickets || []).forEach(function (t) {
			var kv = [];
			if (t.status) kv.push("وضعیت: " + t.status);
			if (t.assigned_to) kv.push("مسئول: " + t.assigned_to);
			items.push({
				t: new Date(t.created_at), group: "ticket", kind: "ticket",
				icon: "fa-headset", tone: "tl-ticket",
				title: "تیکت پشتیبانی " + (t.request_type ? "— " + t.request_type : ""),
				actor: "", body: t.message || "", kv: kv,
				time: formatDate(t.created_at)
			});
		});

		splitNoteBlocks(lead.notes).forEach(function (block) {
			var e = parseNoteBlock(block);
			var when = parseStamp(e.stamp);
			items.push({
				t: when || fallback, group: e.kind === "note" ? "team" : "bot", kind: e.kind,
				icon: e.icon, tone: e.kind === "bot" ? "tl-bot" : "",
				title: e.title, actor: "", body: e.body || "", note: e.note || "",
				kv: e.kv || [], time: when ? formatDate(when.toISOString()) : (e.stamp || "")
			});
		});

		(lead.ai_history || []).forEach(function (turn) {
			items.push({
				t: fallback, group: "bot", kind: "ai", icon: "fa-robot", tone: "tl-bot",
				title: "گفتگو با ربات هوشمند", actor: "",
				body: "— " + (turn.q || "") + "\n— " + (turn.a || ""), kv: [], time: ""
			});
		});

		(activity || []).forEach(function (a) {
			var meta = ACTIVITY_SHOWN[a.action];
			if (!meta) return;
			items.push({
				t: new Date(a.created_at), group: meta.kind === "bot" ? "bot" : "team", kind: "system",
				icon: meta.icon, tone: "", title: meta.title, actor: a.actor || "",
				body: a.detail || "", kv: [], time: formatDate(a.created_at)
			});
		});

		items.sort(function (a, b) {
			var ta = a.t && !isNaN(a.t.getTime()) ? a.t.getTime() : 0;
			var tb = b.t && !isNaN(b.t.getTime()) ? b.t.getTime() : 0;
			return tb - ta;
		});
		return items;
	}

	function renderTimeline() {
		var $box = $("#leadTimeline").empty();
		var items = timelineItems.filter(function (it) {
			return timelineGroup === "all" || it.group === timelineGroup;
		});
		if (items.length === 0) {
			$box.append('<div class="empty-state"><i class="fas fa-clock-rotate-left"></i><p>چیزی برای نمایش نیست.</p></div>');
			return;
		}
		items.forEach(function (it) {
			var $item = $('<div class="tl-item ' + (it.tone || "") + '">');
			$item.append($('<div class="tl-dot">').append($('<i class="fas ' + it.icon + '">')));
			var $head = $('<div class="tl-head">');
			$head.append($('<span class="tl-title">').text(it.title));
			if (it.time) $head.append($('<span class="tl-time">').text(it.time));
			if (it.actor) $head.append($('<span class="tl-actor">').text(it.actor));
			$item.append($head);
			if (it.body) $item.append($('<div class="tl-body">').text(it.body));
			if (it.note) $item.append($('<div class="tl-note">').text(it.note));
			if (it.kv && it.kv.length) {
				var $kv = $('<div class="tl-kv">');
				it.kv.forEach(function (k) { $kv.append($("<span>").text(k)); });
				$item.append($kv);
			}
			$box.append($item);
		});
	}

	// ─── هدر پرونده ────────────────────────────────────────────────────

	function renderBadges(lead) {
		var $box = $("#leadHeadBadges").empty();
		var meta = STATUS_META[lead.status] || STATUS_META["پاسخ‌داده‌نشده"];
		$box.append($('<span class="status-badge ' + meta.cls + '">')
			.append($('<i class="fas ' + meta.icon + '">'), document.createTextNode(meta.label)));

		if (CrmData.isAtRisk(lead)) {
			$box.append($('<span class="status-badge badge-noanswer">')
				.attr("title", "این لید مدتی است بدون پیگیری مانده")
				.append($('<i class="fas fa-triangle-exclamation">'), document.createTextNode("در ریسک")));
		}
		$box.append($('<span class="info-pill pill-source">')
			.append($('<i class="fas fa-signpost">'), document.createTextNode(CrmData.sourceLabel(lead.source))));
		if (lead.assigned_to) {
			$box.append($('<span class="info-pill">')
				.append($('<i class="fas fa-user-tag">'), document.createTextNode(lead.assigned_to)));
		}
	}

	/**
	 * نوارِ حقایق: هرچه مشاور پیش از برداشتنِ گوشی لازم دارد.
	 *
	 * پیگیری بعدی اینجا هم نمایش داده می‌شود هم ویرایش - تنها جایی که
	 * بدون ثبتِ تماس می‌شود تاریخ را عوض کرد.
	 */
	function renderFacts(lead) {
		var $box = $("#leadFacts").empty();
		var followUp = CrmData.leadFollowupAt(lead);
		var overdue = false;
		if (followUp) {
			var d = /^\d{4}-\d{2}-\d{2}$/.test(followUp.trim())
				? CrmData.parseLocalDate(followUp.trim()) : new Date(followUp);
			overdue = !isNaN(d.getTime()) && d.getTime() < Date.now();
		}

		var facts = [
			{ k: "پیگیری بعدی", v: followUp ? formatDay(followUp) : "ثبت نشده",
				warn: overdue, edit: true },
			{ k: "دفعات تماس", v: (lead.contact_attempts != null ? lead.contact_attempts : 0) + " بار" },
			{ k: "نتیجه آخرین تماس", v: lead.last_call_result || "—" },
			{ k: "امتیاز / کیفیت",
				v: (lead.score != null && lead.score !== "" ? lead.score : "—") + " · " + (lead.quality || "—") },
			{ k: "خرید ثبت‌شده", v: ordersTotalLabel(lead.orders) }
		];

		facts.forEach(function (f) {
			var $f = $('<div class="fact">');
			$f.append($('<div class="fact-k">').text(f.k));
			var $v = $('<div class="fact-v">').text(f.v);
			if (f.warn) $v.addClass("fact-warn");
			if (f.edit) {
				$v.append($('<button type="button" class="fact-edit" title="تغییر تاریخ پیگیری">')
					.append($('<i class="fas fa-pen">')));
			}
			$f.append($v);
			$box.append($f);
		});
	}

	function ordersTotalLabel(orders) {
		if (!orders || orders.length === 0) return "ندارد";
		var sum = orders.reduce(function (s, o) { return s + (Number(o.amount) || 0); }, 0);
		return toman(sum);
	}

	function renderOrders(orders) {
		var $box = $("#ordersBox").empty();
		if (!orders || orders.length === 0) {
			$box.append('<div class="empty-state"><i class="fas fa-sack-dollar"></i>' +
				'<p>خریدی ثبت نشده است. پرداخت روی سایت انجام می‌شود و به CRM نمی‌رسد؛ ' +
				'تا وصل شدن درگاه، فروش را از همین‌جا ثبت کنید.</p></div>');
			return;
		}
		var $table = $('<table class="orders-table">');
		$table.append('<thead><tr><th>محصول</th><th>مبلغ</th><th>تاریخ</th><th>ثبت از</th></tr></thead>');
		var $body = $("<tbody>");
		orders.forEach(function (o) {
			var $tr = $("<tr>");
			$tr.append($("<td>").text(o.product_name || "—"));
			$tr.append($('<td class="money">').text(toman(o.amount)));
			$tr.append($("<td>").text(formatDay(o.payment_date || o.created_at)));
			$tr.append($("<td>").text(o.source === "manual" ? "ثبت دستی" : (o.source || "—")));
			$body.append($tr);
		});
		$table.append($body);
		$box.append($table);
	}

	// ─── بارگذاری ──────────────────────────────────────────────────────

	function renderLead(lead, activity) {
		currentLead = lead;
		$("#leadName").text(lead.full_name || "(بدون نام)");
		$("#leadPhone").text(lead.phone || "-");
		if (lead.phone) {
			$("#btnCallLead").attr("href", "tel:" + lead.phone.replace(/[^\d+]/g, "")).removeClass("d-none");
		} else {
			$("#btnCallLead").addClass("d-none");
		}

		renderBadges(lead);
		renderFacts(lead);
		renderOrders(lead.orders);

		$("#leadCourse").text(lead.course || "-");
		$("#leadRequestType").text(lead.request_type || "-");
		$("#leadId").text(lead.lead_id || "-");
		$("#leadTelegram").text(lead.telegram_username ? "@" + String(lead.telegram_username).replace(/^@/, "") : "-");
		$("#leadCreatedAt").text(formatDate(lead.created_at));
		$("#leadUpdatedAt").text(formatDate(lead.updated_at));
		renderSourceSelect(lead.source);
		$("#assignSelect").val(lead.assigned_to || "");

		var lastCall = (lead.calls || [])[0];
		$("#lastCallHint").text(lastCall ? "آخرین تماس: " + formatDate(lastCall.created_at) : "تا حالا تماسی ثبت نشده");

		var followUp = CrmData.leadFollowupAt(lead);
		var followUpDate = null;
		if (followUp) {
			followUpDate = /^\d{4}-\d{2}-\d{2}$/.test(followUp.trim())
				? CrmData.parseLocalDate(followUp.trim()) : new Date(followUp);
			if (isNaN(followUpDate.getTime())) followUpDate = null;
		}
		$("#reminderDate").val(followUpDate ? toIsoDate(followUpDate) : "");
		if (followUpDate && reminderPicker) {
			reminderPicker.setDate(followUpDate.getTime());
		} else {
			$("#reminderDatePersian").val("");
		}

		timelineItems = buildTimeline(lead, activity);
		renderTimeline();

		$("#messageDraft").val(
			CrmData.REGISTRATION_MESSAGE_TEMPLATE.replace("{نام}", lead.full_name || ""));
	}

	function loadLead() {
		if (!leadId) {
			$("#leadContent").addClass("d-none");
			$("#leadNotFound").removeClass("d-none");
			return;
		}
		Promise.all([
			CrmData.fetchLead(leadId),
			// تاریخچه‌ی فعالیت اگر نیاید نباید کلِ پرونده را از کار بیندازد.
			CrmData.fetchLeadActivity(leadId).catch(function () { return []; })
		]).then(function (res) {
			var lead = res[0];
			if (!lead || lead.found === false) {
				$("#leadContent").addClass("d-none");
				$("#leadNotFound").removeClass("d-none");
				return;
			}
			renderLead(lead, res[1]);
		}).catch(function () {
			$("#leadContent").addClass("d-none");
			$("#leadNotFound").removeClass("d-none");
		});
	}

	// ─── ثبت تماس ──────────────────────────────────────────────────────

	function showCallResultMsg(success, text) {
		$("#callResultMsg")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	// تاریخِ انتخاب‌شده به ۹ صبحِ محلی - شروع روز کاری - لنگر می‌شود.
	// بدون آن، رشته‌ی فقط-تاریخ نیمه‌شبِ UTC خوانده می‌شود و در تهران
	// روزِ قبل می‌افتد.
	function followupIsoFromDateOnly(dateValue) {
		if (!dateValue) return "";
		var d = CrmData.parseLocalDate(dateValue);
		if (isNaN(d.getTime())) return "";
		d.setHours(9, 0, 0, 0);
		return d.toISOString();
	}

	function resetCallForm() {
		$("#callResultForm").addClass("d-none");
		$(".call-result-btn").removeClass("active");
		$("#callNextPicks .filter-tab").removeClass("active");
		$("#callNextStepPersian").addClass("d-none").val("");
		$("#callNextStep").val("");
		$("#callNextHint").text("");
		$("#callNote").val("");
		$("#purchaseBox").addClass("d-none");
		$("#purchaseAmount").val("");
		$("#purchaseRef").val("");
		$("#purchaseDate").val("");
		$("#purchaseDatePersian").val("");
		selectedCallResult = null;
		callFollowup = "";
		clearFollowup = false;
	}

	function parseAmount(raw) {
		var latin = String(raw || "").replace(/[۰-۹]/g, function (d) {
			return "۰۱۲۳۴۵۶۷۸۹".indexOf(d);
		}).replace(/[^\d]/g, "");
		return latin ? Number(latin) : NaN;
	}

	/**
	 * «قدم بعدی» را به یک مقدار تبدیل می‌کند:
	 * null یعنی پیگیری را ببند، "" یعنی دست نزن، و هر چیز دیگر یک تاریخ.
	 *
	 * تاریخِ دلخواه مستقیم از فیلد خوانده می‌شود، نه از یک متغیرِ کنار
	 * گذاشته‌شده - تقویم رویدادِ قابل‌اتکایی برای «انتخاب شد» نمی‌دهد.
	 */
	function pendingFollowup() {
		if (clearFollowup) return null;
		var custom = $("#callNextStepPersian").hasClass("d-none") ? "" : $("#callNextStep").val();
		var value = custom || callFollowup;
		return value ? followupIsoFromDateOnly(value) : "";
	}

	function submitCallResult() {
		if (!leadId || !selectedCallResult) return;

		var buying = selectedCallResult === "خرید کرد";
		var amount = parseAmount($("#purchaseAmount").val());
		if (buying && !(amount >= 0)) {
			showCallResultMsg(false, "برای ثبت خرید، مبلغ پرداختی لازم است.");
			return;
		}

		var $btn = $("#btnSubmitCallResult").prop("disabled", true);
		var followup = pendingFollowup();

		CrmData.recordCall(leadId, selectedCallResult, $("#callNote").val().trim(), followup)
			.then(function () {
				// خرید بعد از تماس ثبت می‌شود، نه با هم: اگر ثبت خرید شکست
				// بخورد، تماس نباید از دست برود. پیام هم همین را می‌گوید.
				if (!buying) return null;
				return CrmData.recordPurchase(leadId, {
					productId: $("#purchaseProduct").val() || "",
					amount: amount,
					paymentDate: followupIsoFromDateOnly($("#purchaseDate").val()),
					reference: $("#purchaseRef").val().trim()
				}).then(function (res) {
					if (res && res.ok === false) throw new Error(res.error || "ثبت خرید ناموفق بود");
					return res;
				});
			})
			.then(function () {
				showCallResultMsg(true, buying ? "تماس و خرید ثبت شد." : "نتیجه تماس ثبت شد.");
				resetCallForm();
				loadLead();
			})
			.catch(function (err) {
				showCallResultMsg(false, "خطا: " + (err.message || "خطای نامشخص"));
				loadLead();
			})
			.finally(function () {
				$btn.prop("disabled", false);
			});
	}

	function loadProducts() {
		if (typeof CrmData.fetchProducts !== "function") return;
		CrmData.fetchProducts().then(function (products) {
			var $sel = $("#purchaseProduct").empty();
			(products || []).forEach(function (p) {
				var label = p.name || p.product_id;
				if (p.price) label += " — " + toman(p.price);
				$sel.append($("<option>").val(p.product_id).text(label));
			});
			$sel.append($("<option>").val("").text("سایر / بدون محصول مشخص"));
		}).catch(function () {
			$("#purchaseProduct").empty().append($("<option>").val("").text("سایر / بدون محصول مشخص"));
		});
	}

	// ─── بقیه‌ی نوشتنی‌ها ───────────────────────────────────────────────

	function saveNote() {
		var note = $("#internalNote").val().trim();
		if (!note || !leadId) return;
		var $btn = $("#btnSaveNote").prop("disabled", true);
		CrmData.addLeadNote(leadId, note)
			.then(function () { $("#internalNote").val(""); loadLead(); })
			.catch(function (err) { alert("خطا در ثبت یادداشت: " + (err.message || "خطای نامشخص")); })
			.finally(function () { $btn.prop("disabled", false); });
	}

	function showSendResult(success, text) {
		$("#sendResult")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	function sendMessage() {
		var message = $("#messageDraft").val().trim();
		if (!message || !leadId) return;
		var $btn = $("#btnSendMessage").prop("disabled", true);
		CrmData.sendRegistrationMessage(leadId, message)
			.then(function (res) {
				if (res && res.success === false) {
					showSendResult(false, res.error || "ارسال پیام ناموفق بود.");
					return;
				}
				showSendResult(true, "پیام ارسال شد.");
				loadLead();
			})
			.catch(function (err) { showSendResult(false, err.message || "خطای نامشخص"); })
			.finally(function () { $btn.prop("disabled", false); });
	}

	function renderMessageTemplateButtons() {
		var $box = $("#messageTemplateButtons").empty();
		(CrmData.MESSAGE_TEMPLATES || []).forEach(function (tpl) {
			$('<button class="filter-tab">').text(tpl.label).on("click", function () {
				var name = (currentLead && currentLead.full_name) || "";
				$("#messageDraft").val(tpl.text.replace("{نام}", name));
				$("#sendResult").addClass("d-none");
			}).appendTo($box);
		});
	}

	function saveReminder(dateValue) {
		if (!leadId) return;
		// تنها نویسنده‌ی next_followup_at بیرون از فرمِ تماس. مقدارِ خالی
		// یعنی پیگیری بسته شد.
		CrmData.setLeadFollowup(leadId, followupIsoFromDateOnly(dateValue))
			.then(function () { $("#followupEditor").addClass("d-none"); loadLead(); })
			.catch(function (err) { alert("خطا در ثبت پیگیری: " + (err.message || "خطای نامشخص")); });
	}

	function renderSourceSelect(source) {
		var current = CrmData.normalizeSource(source);
		var $sel = $("#leadSourceSelect").empty();
		var known = false;
		CrmData.LEAD_SOURCES.forEach(function (s) {
			if (s.key === current) known = true;
			$sel.append($("<option>").val(s.key).text(s.label));
		});
		if (!known) $sel.append($("<option>").val(current).text(CrmData.sourceLabel(current)));
		$sel.val(current);
		$sel.attr("class", "source-select source-" + current);
	}

	function saveSource() {
		if (!leadId) return;
		var $sel = $("#leadSourceSelect");
		var value = $sel.val();
		var previous = currentLead ? (currentLead.source || "") : "";
		$sel.addClass("is-saving");
		CrmData.setLeadSource(leadId, value)
			.then(function () {
				if (currentLead) currentLead.source = value;
				renderSourceSelect(value);
				if (currentLead) renderBadges(currentLead);
			})
			.catch(function (err) {
				renderSourceSelect(previous);
				alert("خطا در ثبت منبع لید: " + (err.message || "خطای نامشخص"));
			})
			.finally(function () { $sel.removeClass("is-saving"); });
	}

	function loadConsultants() {
		if (typeof CrmData.fetchConsultants !== "function") return;
		CrmData.fetchConsultants().then(function (consultants) {
			var $sel = $("#assignSelect");
			(consultants || []).forEach(function (c) {
				$sel.append($("<option>").val(c.username).text(c.display_name || c.username));
			});
			if (currentLead && currentLead.assigned_to) $sel.val(currentLead.assigned_to);
		}).catch(function (err) {
			console.error("خطا در بارگذاری فهرست مشاوران:", err);
		});
	}

	function saveAssign() {
		if (!leadId) return;
		var $msg = $("#assignMsg");
		CrmData.assignLead(leadId, $("#assignSelect").val())
			.then(function () {
				$msg.removeClass("d-none text-danger").addClass("text-success").text("ارجاع ثبت شد.");
				loadLead();
			})
			.catch(function (err) {
				$msg.removeClass("d-none text-success").addClass("text-danger")
					.text("خطا در ثبت ارجاع: " + (err.message || "خطای نامشخص"));
			});
	}

	// ─── راه‌اندازی ────────────────────────────────────────────────────

	$(function () {
		reminderPicker = $("#reminderDatePersian").persianDatepicker({
			format: "YYYY/MM/DD", autoClose: true, initialValue: false,
			altField: "#reminderDate",
			altFieldFormatter: function (unixDate) { return toIsoDate(new Date(unixDate)); }
		});

		$("#callNextStepPersian").persianDatepicker({
			format: "YYYY/MM/DD", autoClose: true, initialValue: false,
			altField: "#callNextStep",
			altFieldFormatter: function (unixDate) { return toIsoDate(new Date(unixDate)); }
		});

		$("#purchaseDatePersian").persianDatepicker({
			format: "YYYY/MM/DD", autoClose: true, initialValue: false,
			altField: "#purchaseDate",
			altFieldFormatter: function (unixDate) { return toIsoDate(new Date(unixDate)); }
		});

		renderMessageTemplateButtons();
		loadProducts();
		loadLead();
		loadConsultants();

		$("#callResultButtons").on("click", ".call-result-btn", function () {
			$(".call-result-btn").removeClass("active");
			$(this).addClass("active");
			selectedCallResult = $(this).data("result");
			$("#callResultForm").removeClass("d-none");
			$("#callResultMsg").addClass("d-none");
			$("#purchaseBox").toggleClass("d-none", selectedCallResult !== "خرید کرد");
		});

		$("#btnCancelCallResult").on("click", resetCallForm);
		$("#btnSubmitCallResult").on("click", submitCallResult);

		$("#callNextPicks").on("click", ".filter-tab", function () {
			var $b = $(this);
			var days = String($b.data("days"));
			$("#callNextPicks .filter-tab").removeClass("active");
			$b.addClass("active");
			clearFollowup = false;

			if (days === "none") {
				callFollowup = "";
				clearFollowup = true;
				$("#callNextStepPersian").addClass("d-none");
				$("#callNextHint").text("پیگیری این لید بسته می‌شود.");
				return;
			}
			if (days === "custom") {
				$("#callNextStepPersian").removeClass("d-none").focus();
				$("#callNextHint").text("");
				return;
			}
			var d = new Date();
			d.setDate(d.getDate() + parseInt(days, 10));
			callFollowup = toIsoDate(d);
			$("#callNextStepPersian").addClass("d-none");
			$("#callNextHint").text("پیگیری روی " + formatDay(callFollowup) + " ثبت می‌شود.");
		});

		// دکمه‌ی «ثبت خرید» همان فرم تماس را باز می‌کند، نه یک فرم دوم:
		// خرید یک نتیجه‌ی تماس است و دو مسیر یعنی دو جای فراموش‌شدنی.
		$("#btnAddPurchase").on("click", function () {
			$('.call-result-btn[data-result="خرید کرد"]').trigger("click");
			$(".call-card")[0].scrollIntoView({ behavior: "smooth", block: "start" });
			$("#purchaseAmount").focus();
		});

		$("#timelineTabs").on("click", ".filter-tab", function () {
			$("#timelineTabs .filter-tab").removeClass("active");
			$(this).addClass("active");
			timelineGroup = $(this).data("group");
			renderTimeline();
		});

		$("#leadFacts").on("click", ".fact-edit", function () {
			$("#followupEditor").toggleClass("d-none");
		});

		$("#btnSaveReminder").on("click", function () {
			var val = $("#reminderDate").val();
			if (!val) { alert("لطفاً یک تاریخ انتخاب کنید."); return; }
			saveReminder(val);
		});
		$("#btnClearReminder").on("click", function () {
			$("#reminderDate").val("");
			$("#reminderDatePersian").val("");
			saveReminder("");
		});
		$("#reminderQuickPicks").on("click", "button", function () {
			var d = new Date();
			d.setDate(d.getDate() + parseInt($(this).data("days"), 10));
			var iso = toIsoDate(d);
			$("#reminderDate").val(iso);
			if (reminderPicker) reminderPicker.setDate(d.getTime());
			saveReminder(iso);
		});

		$("#assignSelect").on("change", saveAssign);
		$("#leadSourceSelect").on("change", saveSource);
		$("#btnSaveNote").on("click", saveNote);
		$("#btnSendMessage").on("click", sendMessage);
	});
})();
