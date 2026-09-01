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

	function drawerRow(lead) {
		var answers = CrmData.botAnswers(lead);
		var followUp = CrmData.leadFollowupAt(lead);
		var $wrap = $('<div class="lead-drawer">');

		var $head = $('<div class="lead-drawer-head">');
		if (answers.level || answers.topic) {
			$head.append($('<span class="info-pill pill-source">').text("پاسخ‌های ثبت‌شده در ربات"));
		} else {
			$head.append($('<span class="info-pill">').text("بدون پاسخ ربات"));
			$head.append($("<span>").text("این لید فرم ربات را پر نکرده است."));
		}
		if (lead.telegram_username) {
			$head.append($('<span class="info-pill mono">').text("@" + String(lead.telegram_username).replace(/^@/, "")));
		}
		$wrap.append($head);

		var $grid = $('<div class="qa-grid">');
		$grid.append(qaCard("📊 سطح فعلی معامله‌گری", answers.level));
		$grid.append(qaCard("💬 هدف از مشاوره", answers.topic));
		if (lead.course) $grid.append(qaCard("🎯 دوره‌ی انتخاب‌شده", lead.course));
		$wrap.append($grid);

		var $meta = $('<div class="qa-meta-strip">');
		$meta.append(metaCell("پیگیری بعدی", followUp ? formatDay(followUp) : "ثبت نشده", isDueForFollowUp(lead)));
		$meta.append(metaCell("دفعات تماس", (lead.contact_attempts != null ? lead.contact_attempts : 0) + " بار"));
		$meta.append(metaCell("نتیجه آخرین تماس", lead.last_call_result || "—"));
		$meta.append(metaCell("منبع", CrmData.sourceLabel(lead.source)));
		$meta.append(metaCell("شناسه لید", lead.lead_id || "—"));
		$wrap.append($meta);

		var $actions = $('<div class="lead-drawer-actions">');
		$actions.append($("<a>").addClass("btn btn-brand btn-sm")
			.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
			.text("باز کردن پرونده"));
		if (lead.phone) {
			$actions.append($("<a>").addClass("btn btn-outline-secondary btn-sm")
				.attr("href", "tel:" + lead.phone.replace(/[^\d+]/g, ""))
				.html('<i class="fas fa-phone mr-1"></i>تماس'));
		}
		$actions.append($('<button type="button" class="btn btn-outline-secondary btn-sm followup-tomorrow">')
			.attr("data-lead-id", lead.lead_id)
			.text("پیگیری برای فردا"));
		$wrap.append($actions);

		return $('<tr class="lead-drawer-row">').append($("<td>").attr("colspan", 8).append($wrap));
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
			$body.append('<tr><td colspan="8"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>در حال بارگذاری...</p></div></td></tr>');
			return;
		}
		if (state.error) {
			$body.append('<tr><td colspan="8" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + state.error + '</td></tr>');
			return;
		}

		var rows = getFilteredRows();

		if (rows.length === 0) {
			$body.append('<tr><td colspan="8"><div class="empty-state"><i class="fas fa-inbox"></i><p>موردی یافت نشد.</p></div></td></tr>');
			return;
		}

		var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		if (state.page > totalPages) state.page = totalPages;
		var start = (state.page - 1) * PAGE_SIZE;
		var pageRows = rows.slice(start, start + PAGE_SIZE);

		pageRows.forEach(function (lead) {
			var statusMeta = STATUS_META[lead.status] || STATUS_META["پاسخ‌داده‌نشده"];
			var $tr = $("<tr>").addClass("lead-row row-" + statusMeta.cls).attr("data-id", lead.lead_id);
			if (isAtRisk(lead)) $tr.addClass("row-at-risk");

			// The drawer opens from its own button, not from the row.
			// The row carries a status menu, a consultant menu and a call
			// link; if the whole row toggled, every one of those clicks
			// would open a drawer nobody asked for.
			var open = expanded[lead.lead_id] === true;
			$tr.append($("<td>").addClass("drawer-cell").append(
				$('<button type="button" class="drawer-toggle">')
					.attr({ "aria-expanded": String(open), title: "پاسخ‌های ثبت‌شده در ربات", "data-lead-id": lead.lead_id })
					.html('<i class="fas fa-chevron-down"></i>')
			));

			$tr.append($("<td>").append($("<a>").attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id)).addClass("lead-name-link").text(lead.full_name || "(بدون نام)")));

			var $phoneCell = $("<td>").attr("dir", "ltr").addClass("mono phone-cell text-center");
			$phoneCell.append($("<span>").text(lead.phone || "-"));
			if (lead.phone) {
				$phoneCell.append($("<a>").addClass("quick-call-btn").attr({
					href: "tel:" + lead.phone.replace(/[^\d+]/g, ""),
					title: "تماس با " + (lead.full_name || "این لید")
				}).on("click", function (e) { e.stopPropagation(); }).html('<i class="fas fa-phone"></i>'));
			}
			$tr.append($phoneCell);

			$tr.append($("<td>").text(lead.course || "-"));
			$tr.append($("<td>").text(lead.request_type || "-"));
			var $statusWrap = $("<div>").addClass("status-cell-wrap").append(statusSelectHtml(lead.lead_id, lead.status));
			if (isAtRisk(lead)) {
				$statusWrap.append('<span class="risk-icon" title="این لید مدتی است بدون پیگیری مانده"><i class="fas fa-triangle-exclamation"></i></span>');
			}
			var $statusCell = $("<td>").addClass("text-center").append($statusWrap);
			$tr.append($statusCell);
			$tr.append($("<td>").addClass("text-center").html(consultantSelectHtml(lead.lead_id, lead.assigned_to)));
			$tr.append($("<td>").addClass("text-muted text-sm").text(formatRelativeTime(lead.updated_at || lead.created_at)));
			$body.append($tr);
			if (open) $body.append(drawerRow(lead));
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

		$("#leadsTableBody").on("click", ".drawer-toggle", function () {
			var leadId = $(this).data("lead-id");
			expanded[leadId] = !expanded[leadId];
			renderTable();
		});

		// پیگیری برای فردا، بدون خروج از فهرست. ساعت ۹ صبحِ محلی - شروع
		// روز کاری - وگرنه رشته‌ی فقط-تاریخ نیمه‌شبِ UTC خوانده می‌شود و
		// در تهران روزِ قبل می‌افتد.
		$("#leadsTableBody").on("click", ".followup-tomorrow", function () {
			var $btn = $(this).prop("disabled", true);
			var leadId = $btn.data("lead-id");
			var lead = state.leads.find(function (l) { return String(l.lead_id) === String(leadId); });
			var d = new Date();
			d.setDate(d.getDate() + 1);
			d.setHours(9, 0, 0, 0);
			CrmData.setLeadFollowup(leadId, d.toISOString())
				.then(function () {
					if (lead) {
						lead.next_followup_at = d.toISOString();
						lead.reminder_date = "";
						lead.updated_at = new Date().toISOString();
					}
					render();
				})
				.catch(function (err) {
					alert("خطا در ثبت پیگیری: " + (err.message || "خطای نامشخص"));
					$btn.prop("disabled", false);
				});
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
