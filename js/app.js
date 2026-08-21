(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock", label: "در انتظار تماس" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone", label: "تماس گرفته شد" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash", label: "پاسخ نداد" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status] || STATUS_META["پاسخ‌داده‌نشده"];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + meta.label + '</span>';
	}

	function statusSelectHtml(leadId, status) {
		var meta = STATUS_META[status] || STATUS_META["پاسخ‌داده‌نشده"];
		var options = Object.keys(STATUS_META).map(function (key) {
			var selected = key === status ? " selected" : "";
			return '<option value="' + key + '"' + selected + '>' + STATUS_META[key].label + '</option>';
		}).join("");
		return '<select class="status-select ' + meta.cls + '" data-lead-id="' + leadId + '">' + options + '</select>';
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

	var PAGE_SIZE = 15;

	var state = {
		leads: [],
		statusFilter: "همه",
		query: "",
		loading: true,
		error: null,
		page: 1
	};

	function isDueForFollowUp(lead) {
		if (!lead.reminder_date) return false;
		var today = new Date();
		today.setHours(0, 0, 0, 0);
		var reminder = CrmData.parseLocalDate(lead.reminder_date);
		return reminder <= today;
	}

	var AT_RISK_UNCONTACTED_HOURS = 48;
	var AT_RISK_FOLLOWUP_OVERDUE_HOURS = 24;

	function isAtRisk(lead) {
		var now = Date.now();
		if (lead.status === "پاسخ‌داده‌نشده" && lead.created_at) {
			var hoursSinceCreated = (now - new Date(lead.created_at).getTime()) / 3600000;
			if (hoursSinceCreated >= AT_RISK_UNCONTACTED_HOURS) return true;
		}
		if (lead.next_followup_at) {
			var hoursOverdue = (now - new Date(lead.next_followup_at).getTime()) / 3600000;
			if (hoursOverdue >= AT_RISK_FOLLOWUP_OVERDUE_HOURS) return true;
		}
		return false;
	}

	function getFilteredRows() {
		var q = state.query.trim();
		return state.leads
			.filter(function (l) {
				if (state.statusFilter === "همه") return true;
				if (state.statusFilter === "یادآوری") return isDueForFollowUp(l);
				if (state.statusFilter === "در_ریسک") return isAtRisk(l);
				return l.status === state.statusFilter;
			})
			.filter(function (l) {
				if (!q) return true;
				return (l.full_name || "").indexOf(q) !== -1 || (l.phone || "").indexOf(q) !== -1;
			})
			.sort(function (a, b) { return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at); });
	}

	function renderStats() {
		var total = state.leads.length;
		var pending = state.leads.filter(function (l) { return l.status === "پاسخ‌داده‌نشده"; }).length;
		var called = state.leads.filter(function (l) { return l.status === "تماس گرفته شد"; }).length;
		var noAnswer = state.leads.filter(function (l) { return l.status === "پاسخ نداد"; }).length;
		$("#stat-total").text(total);
		$("#stat-pending").text(pending);
		$("#stat-called").text(called);
		$("#stat-noanswer").text(noAnswer);

		var dueCount = state.leads.filter(isDueForFollowUp).length;
		$("#reminderTabCount").text(dueCount > 0 ? "(" + dueCount + ")" : "");

		var atRiskCount = state.leads.filter(isAtRisk).length;
		$("#atRiskTabCount").text(atRiskCount > 0 ? "(" + atRiskCount + ")" : "");
	}

	function renderTable() {
		var $body = $("#leadsTableBody").empty();
		$("#pagination").addClass("d-none");

		if (state.loading) {
			$body.append('<tr><td colspan="6"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>در حال بارگذاری...</p></div></td></tr>');
			return;
		}
		if (state.error) {
			$body.append('<tr><td colspan="6" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + state.error + '</td></tr>');
			return;
		}

		var rows = getFilteredRows();

		if (rows.length === 0) {
			$body.append('<tr><td colspan="6"><div class="empty-state"><i class="fas fa-inbox"></i><p>موردی یافت نشد.</p></div></td></tr>');
			return;
		}

		var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		if (state.page > totalPages) state.page = totalPages;
		var start = (state.page - 1) * PAGE_SIZE;
		var pageRows = rows.slice(start, start + PAGE_SIZE);

		pageRows.forEach(function (lead) {
			var $tr = $("<tr>").addClass("lead-row").attr("data-id", lead.lead_id);
			$tr.append($("<td>").append($("<a>").attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id)).addClass("lead-name-link").text(lead.full_name || "(بدون نام)")));
			$tr.append($("<td>").attr("dir", "ltr").addClass("mono").text(lead.phone || "-"));
			$tr.append($("<td>").text(lead.course || "-"));
			$tr.append($("<td>").text(lead.request_type || "-"));
			var $statusCell = $("<td>").html(statusSelectHtml(lead.lead_id, lead.status));
			if (isAtRisk(lead)) {
				$statusCell.append($('<span class="status-badge badge-noanswer ml-1" title="این لید مدتی است بدون پیگیری مانده"><i class="fas fa-triangle-exclamation"></i>در ریسک</span>'));
			}
			$tr.append($statusCell);
			$tr.append($("<td>").addClass("text-muted text-sm").text(formatRelativeTime(lead.updated_at || lead.created_at)));
			$body.append($tr);
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

		$("#leadsTableBody").on("change", ".status-select", function () {
			var $select = $(this);
			var leadId = $select.data("lead-id");
			var newStatus = $select.val();
			var lead = state.leads.find(function (l) { return String(l.lead_id) === String(leadId); });
			if (!lead) return;
			var previousStatus = lead.status;
			$select.addClass("is-saving");
			CrmData.updateLeadStatus(leadId, newStatus)
				.then(function () {
					lead.status = newStatus;
					lead.updated_at = new Date().toISOString();
					render();
				})
				.catch(function (err) {
					alert("خطا در ثبت وضعیت: " + (err.message || "خطای نامشخص"));
					$select.val(previousStatus);
				})
				.finally(function () {
					$select.removeClass("is-saving");
				});
		});
	});
})();
