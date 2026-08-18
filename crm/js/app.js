(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status] || STATUS_META["پاسخ‌داده‌نشده"];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + status + '</span>';
	}

	function formatRelativeTime(iso) {
		if (!iso) return "-";
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
		leads: [],
		statusFilter: "همه",
		query: "",
		loading: true,
		error: null
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
		var $body = $("#leadsTableBody").empty();

		if (state.loading) {
			$body.append('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin mr-1"></i>در حال بارگذاری...</td></tr>');
			return;
		}
		if (state.error) {
			$body.append('<tr><td colspan="6" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + state.error + '</td></tr>');
			return;
		}

		var q = state.query.trim();
		var rows = state.leads
			.filter(function (l) { return state.statusFilter === "همه" ? true : l.status === state.statusFilter; })
			.filter(function (l) {
				if (!q) return true;
				return (l.full_name || "").indexOf(q) !== -1 || (l.phone || "").indexOf(q) !== -1;
			})
			.sort(function (a, b) { return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at); });

		if (rows.length === 0) {
			$body.append('<tr><td colspan="6" class="text-center text-muted py-4">موردی یافت نشد.</td></tr>');
			return;
		}

		rows.forEach(function (lead) {
			var $tr = $("<tr>").addClass("lead-row").attr("data-id", lead.lead_id);
			$tr.append($("<td>").append($("<a>").attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id)).addClass("lead-name-link").text(lead.full_name || "(بدون نام)")));
			$tr.append($("<td>").attr("dir", "ltr").addClass("mono").text(lead.phone || "-"));
			$tr.append($("<td>").text(lead.course || "-"));
			$tr.append($("<td>").text(lead.request_type || "-"));
			$tr.append($("<td>").html(statusBadgeHtml(lead.status)));
			$tr.append($("<td>").addClass("text-muted text-sm").text(formatRelativeTime(lead.updated_at || lead.created_at)));
			$body.append($tr);
		});
	}

	function render() {
		renderStats();
		renderTable();
	}

	function loadLeads() {
		state.loading = true;
		state.error = null;
		render();
		CrmData.fetchLeads()
			.then(function (leads) {
				state.leads = leads;
				state.loading = false;
				render();
			})
			.catch(function (err) {
				state.loading = false;
				state.error = err.message || "خطای نامشخص";
				render();
			});
	}

	$(function () {
		loadLeads();

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
	});
})();
