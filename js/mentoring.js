(function () {
	"use strict";

	var MENTORING_SOURCE = "website_mentoring_form";

	// WF-21 records each submission as one line inside the lead's notes,
	// so the site's message is recovered by splitting on that marker.
	// Splitting rather than matching per line keeps multi-line messages
	// whole — people do press enter in a textarea.
	var NOTE_MARKER = "📩 درخواست منتورینگ اختصاصی (وبسایت) - ";
	var STAMPED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::\s*)?([\s\S]*)$/;

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock", label: "در انتظار تماس" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone", label: "تماس گرفته شد" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash", label: "پاسخ نداد" }
	};

	// Early mentoring leads were written with "جدید", which is not one of the
	// three statuses the rest of the CRM counts. Map it here so those rows
	// still read correctly on this page.
	function normalizeStatus(status) {
		if (!status || status === "جدید") return "پاسخ‌داده‌نشده";
		return status;
	}

	function statusBadgeHtml(status) {
		var meta = STATUS_META[normalizeStatus(status)] || STATUS_META["پاسخ‌داده‌نشده"];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + meta.label + '</span>';
	}

	function formatDate(iso) {
		if (!iso) return "-";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		return d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
	}

	// The note stamp is written from toISOString(), so it is UTC with the
	// zone designator dropped. Put it back before formatting, or every
	// submission reads an hour or three off.
	function formatStamp(stamp) {
		if (!stamp) return "";
		return formatDate(stamp.replace(" ", "T") + ":00Z");
	}

	function submissionsOf(lead) {
		var notes = lead && lead.notes;
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

	var state = { leads: [], query: "" };

	function matchesQuery(lead) {
		var q = state.query.trim().toLowerCase();
		if (!q) return true;
		var hay = [lead.full_name, lead.phone, lead.lead_id, lead.assigned_to, lead.notes]
			.map(function (v) { return String(v || "").toLowerCase(); })
			.join(" ");
		return hay.indexOf(q) !== -1;
	}

	function renderStats(leads) {
		var pending = 0, called = 0, week = 0;
		var weekAgo = Date.now() - 7 * 86400000;
		leads.forEach(function (l) {
			var s = normalizeStatus(l.status);
			if (s === "پاسخ‌داده‌نشده") pending++;
			if (s === "تماس گرفته شد") called++;
			var t = new Date(l.created_at).getTime();
			if (!isNaN(t) && t >= weekAgo) week++;
		});
		$("#mt-total").text(leads.length);
		$("#mt-pending").text(pending);
		$("#mt-called").text(called);
		$("#mt-week").text(week);
	}

	function messageCell(lead) {
		var subs = submissionsOf(lead);
		var $cell = $("<td>").addClass("mt-msg-cell");
		if (subs.length === 0) {
			$cell.append($("<span>").addClass("text-muted text-sm").text("بدون متن"));
			return $cell;
		}
		subs.slice().reverse().forEach(function (s, idx) {
			var $entry = $("<div>").addClass("mt-msg");
			if (idx > 0) $entry.addClass("mt-msg-older");
			if (s.at) {
				$entry.append($("<span>").addClass("mt-msg-time").text(formatStamp(s.at)));
			}
			$entry.append($("<span>").addClass("mt-msg-body").text(s.message || "— بدون متن —"));
			$cell.append($entry);
		});
		if (subs.length > 1) {
			$cell.prepend($("<span>").addClass("mt-repeat")
				.text(subs.length.toLocaleString("fa-IR") + " بار درخواست داده"));
		}
		return $cell;
	}

	function render() {
		var rows = state.leads.filter(matchesQuery);
		var $body = $("#mentoringBody").empty();

		$("#mt-shown").text(rows.length === state.leads.length
			? ""
			: "نمایش " + rows.length.toLocaleString("fa-IR") + " از " + state.leads.length.toLocaleString("fa-IR"));

		if (rows.length === 0) {
			var msg = state.leads.length === 0
				? "هنوز درخواستی از فرم منتورینگ سایت ثبت نشده است."
				: "موردی با این جستجو پیدا نشد.";
			$body.append($("<tr>").append($("<td>").attr("colspan", 6).html(
				'<div class="empty-state"><i class="fas fa-graduation-cap"></i><p>' + msg + "</p></div>"
			)));
			return;
		}

		rows.forEach(function (lead) {
			var $tr = $("<tr>");
			$tr.append($("<td>").append(
				$("<a>").attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
					.addClass("lead-name-link")
					.text(lead.full_name || "(بدون نام)")
			));
			$tr.append($("<td>").attr("dir", "ltr").addClass("mono").text(lead.phone || "-"));
			$tr.append(messageCell(lead));
			$tr.append($("<td>").addClass("text-muted text-sm").text(formatDate(lead.created_at)));
			$tr.append($("<td>").addClass("text-sm").text(lead.assigned_to || "—"));
			$tr.append($("<td>").html(statusBadgeHtml(lead.status)));
			$body.append($tr);
		});
	}

	function load() {
		$("#mentoringBody").html('<tr><td colspan="6" class="text-center py-4 text-muted">در حال بارگذاری…</td></tr>');
		CrmData.fetchLeads()
			.then(function (leads) {
				state.leads = (leads || [])
					.filter(function (l) { return l && l.source === MENTORING_SOURCE; })
					.sort(function (a, b) {
						return new Date(b.created_at || 0) - new Date(a.created_at || 0);
					});
				renderStats(state.leads);
				render();
			})
			.catch(function (err) {
				$("#mentoringBody").html('<tr><td colspan="6" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: '
					+ (err.message || "خطای نامشخص") + "</td></tr>");
			});
	}

	$(function () {
		$("#mentoringSearch").on("input", function () {
			state.query = this.value;
			render();
		});
		$("#btnRefreshMentoring").on("click", function () {
			CrmData.invalidateLeadsCache && CrmData.invalidateLeadsCache();
			load();
		});
		load();
	});
})();
