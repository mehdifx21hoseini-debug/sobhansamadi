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

	// Consultants are fetched once and reused for every row's dropdown, so the
	// table does not fire one request per lead.
	var consultants = [];

	function consultantSelectHtml(leadId, assignedTo) {
		var current = assignedTo || "";
		var options = ['<option value=""' + (current ? "" : " selected") + ">بدون مشاور</option>"];
		var known = false;
		consultants.forEach(function (c) {
			var selected = c.username === current ? " selected" : "";
			if (selected) known = true;
			options.push('<option value="' + c.username + '"' + selected + ">" + (c.display_name || c.username) + "</option>");
		});
		// A lead can be assigned to someone who is no longer in the list; keep
		// the value visible instead of silently showing "بدون مشاور".
		if (current && !known) {
			options.push('<option value="' + current + '" selected>' + current + "</option>");
		}
		return '<select class="assign-select' + (current ? "" : " is-unassigned") + '" data-lead-id="' + leadId + '">' + options.join("") + "</select>";
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
				if (!state.sourceFilter) return true;
				return CrmData.normalizeSource(l.source) === state.sourceFilter;
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
			$body.append('<tr><td colspan="7"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>در حال بارگذاری...</p></div></td></tr>');
			return;
		}
		if (state.error) {
			$body.append('<tr><td colspan="7" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + state.error + '</td></tr>');
			return;
		}

		var rows = getFilteredRows();

		if (rows.length === 0) {
			$body.append('<tr><td colspan="7"><div class="empty-state"><i class="fas fa-inbox"></i><p>موردی یافت نشد.</p></div></td></tr>');
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
			$tr.append($("<td>").html(consultantSelectHtml(lead.lead_id, lead.assigned_to)));
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
				// Mentoring-form requests have their own page. Filtering here
				// rather than at render time keeps the counters, the tab
				// badges and the pagination agreeing with the visible rows.
				state.leads = leads.filter(function (l) { return !CrmData.isMentoringLead(l); });
				state.loading = false;
				render();
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

	function populateSourceFilter() {
		var $sel = $("#sourceFilter");
		CrmData.LEAD_SOURCES.forEach(function (s) {
			// The mentoring source is excluded from this list entirely, so
			// offering it here would only ever select nothing.
			if (s.key === CrmData.MENTORING_SOURCE) return;
			$sel.append($("<option>").val(s.key).text(s.label));
		});
	}

	$(function () {
		populateSourceFilter();
		loadLeads();
		loadConsultants();

		$("#sourceFilter").on("change", function () {
			state.sourceFilter = $(this).val();
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

		$("#leadsTableBody").on("change", ".assign-select", function () {
			var $select = $(this);
			var leadId = $select.data("lead-id");
			var newAssignee = $select.val();
			var lead = state.leads.find(function (l) { return String(l.lead_id) === String(leadId); });
			if (!lead) return;
			var previous = lead.assigned_to || "";
			$select.addClass("is-saving");
			CrmData.assignLead(leadId, newAssignee)
				.then(function () {
					lead.assigned_to = newAssignee;
					lead.updated_at = new Date().toISOString();
					render();
				})
				.catch(function (err) {
					alert("خطا در ثبت مشاور: " + (err.message || "خطای نامشخص"));
					$select.val(previous);
				})
				.finally(function () {
					$select.removeClass("is-saving");
				});
		});
	});
})();
