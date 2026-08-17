(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + status + '</span>';
	}

	function formatRelativeTime(iso) {
		var date = new Date(iso);
		var now = new Date();
		var diffMins = Math.round((now - date) / 60000);
		if (diffMins < 1) return "همین الان";
		if (diffMins < 60) return diffMins + " دقیقه پیش";
		var diffHours = Math.round(diffMins / 60);
		if (diffHours < 24) return diffHours + " ساعت پیش";
		var diffDays = Math.round(diffHours / 24);
		if (diffDays === 1) return "دیروز";
		return diffDays + " روز پیش";
	}

	var state = {
		leads: CrmData.loadLeads(),
		statusFilter: "همه",
		query: ""
	};

	function renderStats() {
		var total = state.leads.length;
		var pending = state.leads.filter(function (l) { return l.status === "پاسخ‌داده‌نشده"; }).length;
		var called = state.leads.filter(function (l) { return l.status === "تماس گرفته شد"; }).length;
		var noAnswer = state.leads.filter(function (l) { return l.status === "پاسخ نداد"; }).length;
		$("#stat-total").text(total);
		$("#stat-pending").text(pending);
		$("#stat-called").text(called);
		$("#stat-noanswer").text(noAnswer);
	}

	function renderTable() {
		var q = state.query.trim();
		var rows = state.leads
			.filter(function (l) { return state.statusFilter === "همه" ? true : l.status === state.statusFilter; })
			.filter(function (l) { return !q || l.fullName.indexOf(q) !== -1 || l.phone.indexOf(q) !== -1; })
			.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });

		var $body = $("#leadsTableBody").empty();

		if (rows.length === 0) {
			$body.append('<tr><td colspan="6" class="text-center text-muted py-4">موردی یافت نشد.</td></tr>');
			return;
		}

		rows.forEach(function (lead) {
			var $tr = $("<tr>").addClass("lead-row").attr("data-id", lead.id);
			$tr.append($("<td>").append($("<a>").attr("href", "lead.html?id=" + encodeURIComponent(lead.id)).addClass("lead-name-link").text(lead.fullName)));
			$tr.append($("<td>").attr("dir", "ltr").addClass("mono").text(lead.phone));
			$tr.append($("<td>").text(lead.level));
			$tr.append($("<td>").text(lead.preferredTime));
			$tr.append($("<td>").html(statusBadgeHtml(lead.status)));
			$tr.append($("<td>").addClass("text-muted text-sm").text(formatRelativeTime(lead.createdAt)));
			$body.append($tr);
		});
	}

	function render() {
		renderStats();
		renderTable();
	}

	function exportCsv() {
		var q = state.query.trim();
		var rows = state.leads
			.filter(function (l) { return state.statusFilter === "همه" ? true : l.status === state.statusFilter; })
			.filter(function (l) { return !q || l.fullName.indexOf(q) !== -1 || l.phone.indexOf(q) !== -1; });

		var headers = ["نام", "شماره تماس", "سطح علمی", "وضعیت", "تاریخ ثبت"];
		var lines = [headers].concat(rows.map(function (l) {
			return [l.fullName, l.phone, l.level, l.status, new Date(l.createdAt).toLocaleDateString("fa-IR")];
		}));

		var csv = "﻿" + lines.map(function (row) {
			return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
		}).join("\r\n");

		var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
		var url = URL.createObjectURL(blob);
		var link = document.createElement("a");
		link.href = url;
		link.download = "لیدها-" + new Date().toLocaleDateString("fa-IR") + ".csv";
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}

	$(function () {
		render();

		$("#filterTabs").on("click", ".filter-tab", function () {
			$(".filter-tab").removeClass("active");
			$(this).addClass("active");
			state.statusFilter = $(this).data("status");
			renderTable();
		});

		$("#searchInput").on("input", function () {
			state.query = $(this).val();
			renderTable();
		});

		$("#exportBtn").on("click", exportCsv);
	});
})();
