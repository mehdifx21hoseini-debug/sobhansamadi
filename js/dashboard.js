(function () {
	"use strict";

	function toPersianPercent(n) {
		var digits = { 0: "۰", 1: "۱", 2: "۲", 3: "۳", 4: "۴", 5: "۵", 6: "۶", 7: "۷", 8: "۸", 9: "۹" };
		return String(n).replace(/[0-9]/g, function (d) { return digits[d]; }) + "٪";
	}

	var STATUS_COLORS = {
		"پاسخ‌داده‌نشده": "#f0b033",
		"تماس گرفته شد": "#0d8a4f",
		"پاسخ نداد": "#c81e4b"
	};

	var STATUS_LABELS = {
		"پاسخ‌داده‌نشده": "در انتظار تماس",
		"تماس گرفته شد": "تماس گرفته شد",
		"پاسخ نداد": "پاسخ نداد"
	};

	var state = {
		leads: [],
		chart: null,
		trendChart: null,
		exportRange: "all"
	};

	function dateKey(date) {
		return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
	}

	function renderStats() {
		var leads = state.leads;
		var total = leads.length;
		var pending = leads.filter(function (l) { return l.status === "پاسخ‌داده‌نشده"; }).length;
		var called = leads.filter(function (l) { return l.status === "تماس گرفته شد"; }).length;
		var noAnswer = leads.filter(function (l) { return l.status === "پاسخ نداد"; }).length;

		$("#d-total").text(total);

		renderChart(pending, called, noAnswer, total);
		renderTrendChart();
	}

	function renderTrendChart() {
		var days = [];
		var counts = [];
		var today = startOfDay(new Date());
		for (var i = 13; i >= 0; i--) {
			var d = new Date(today);
			d.setDate(d.getDate() - i);
			days.push(d);
		}

		var countsByKey = {};
		state.leads.forEach(function (l) {
			if (!l.created_at) return;
			var key = dateKey(new Date(l.created_at));
			countsByKey[key] = (countsByKey[key] || 0) + 1;
		});

		days.forEach(function (d) {
			counts.push(countsByKey[dateKey(d)] || 0);
		});

		var labels = days.map(function (d) {
			return d.toLocaleDateString("fa-IR", { day: "numeric", month: "numeric" });
		});

		var ctx = document.getElementById("trendChart").getContext("2d");
		var gradient = ctx.createLinearGradient(0, 0, 0, 260);
		gradient.addColorStop(0, "#29386c");
		gradient.addColorStop(1, "#3d54a0");

		if (state.trendChart) {
			state.trendChart.data.labels = labels;
			state.trendChart.data.datasets[0].data = counts;
			state.trendChart.update();
		} else {
			state.trendChart = new Chart(ctx, {
				type: "bar",
				data: {
					labels: labels,
					datasets: [{
						data: counts,
						backgroundColor: gradient,
						hoverBackgroundColor: "#d2ae6d",
						borderRadius: 5,
						maxBarThickness: 26
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						legend: { display: false },
						tooltip: {
							callbacks: {
								label: function (item) { return item.parsed.y + " لید"; }
							}
						}
					},
					scales: {
						y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "rgba(0,0,0,.05)" } },
						x: { grid: { display: false } }
					}
				}
			});
		}
	}

	function renderChart(pending, called, noAnswer, total) {
		var ctx = document.getElementById("statusChart").getContext("2d");
		var data = [pending, called, noAnswer];
		var labels = ["پاسخ‌داده‌نشده", "تماس گرفته شد", "پاسخ نداد"];
		var colors = labels.map(function (l) { return STATUS_COLORS[l]; });
		var displayLabels = labels.map(function (l) { return STATUS_LABELS[l] || l; });

		if (state.chart) {
			state.chart.data.datasets[0].data = data;
			state.chart.update();
		} else {
			state.chart = new Chart(ctx, {
				type: "doughnut",
				data: {
					labels: displayLabels,
					datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					cutout: "68%",
					plugins: {
						legend: { display: false },
						tooltip: {
							callbacks: {
								label: function (item) {
									var pct = total > 0 ? Math.round((item.parsed / total) * 100) : 0;
									return item.parsed + " (" + pct + "٪)";
								}
							}
						}
					}
				}
			});
		}

		$("#chartCenterTotal").html('<span class="num">' + total + '</span><span class="label">کل لید</span>');

		var $legend = $("#chartLegend").empty();
		displayLabels.forEach(function (label, i) {
			var count = data[i];
			var pct = total > 0 ? Math.round((count / total) * 100) : 0;
			var $row = $('<div class="chart-legend-row">');
			$row.append(
				$('<span>').append(
					$('<span class="chart-legend-dot">').css("background", colors[i]),
					document.createTextNode(label)
				)
			);
			$row.append($('<span>').text(count + " (" + toPersianPercent(pct) + ")"));
			$legend.append($row);
		});
	}

	function startOfDay(date) {
		var d = new Date(date);
		d.setHours(0, 0, 0, 0);
		return d;
	}

	function endOfDay(date) {
		var d = new Date(date);
		d.setHours(23, 59, 59, 999);
		return d;
	}

	function getRangeDates() {
		var now = new Date();
		if (state.exportRange === "today") {
			return { from: startOfDay(now), to: endOfDay(now) };
		}
		if (state.exportRange === "week") {
			var weekAgo = new Date(now);
			weekAgo.setDate(weekAgo.getDate() - 7);
			return { from: startOfDay(weekAgo), to: endOfDay(now) };
		}
		if (state.exportRange === "month") {
			var monthAgo = new Date(now);
			monthAgo.setDate(monthAgo.getDate() - 30);
			return { from: startOfDay(monthAgo), to: endOfDay(now) };
		}
		if (state.exportRange === "custom") {
			var fromVal = $("#exportFrom").val();
			var toVal = $("#exportTo").val();
			return {
				from: fromVal ? startOfDay(new Date(fromVal)) : null,
				to: toVal ? endOfDay(new Date(toVal)) : null
			};
		}
		return { from: null, to: null };
	}

	function filterLeadsByRange() {
		var range = getRangeDates();
		return state.leads.filter(function (l) {
			if (!l.created_at) return false;
			var created = new Date(l.created_at);
			if (range.from && created < range.from) return false;
			if (range.to && created > range.to) return false;
			return true;
		});
	}

	function updateExportCount() {
		$("#exportCount").text(filterLeadsByRange().length);
	}

	function exportCsv() {
		var rows = filterLeadsByRange();
		var headers = ["نام", "شماره تماس", "دوره", "وضعیت", "تاریخ ثبت"];
		var lines = [headers].concat(rows.map(function (l) {
			return [l.full_name || "", l.phone || "", l.course || "", STATUS_LABELS[l.status] || l.status, l.created_at ? new Date(l.created_at).toLocaleDateString("fa-IR") : ""];
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

	function loadLeads() {
		CrmData.fetchLeads()
			.then(function (leads) {
				state.leads = leads;
				renderStats();
				updateExportCount();
				refreshActionCenter();
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری آمار داشبورد:", err);
			});
	}

	// Shared rule, defined once in js/data.js.
	function isAtRisk(lead) {
		return CrmData.isAtRisk(lead);
	}

	var actionCenterState = { atRisk: 0, overdueFollowups: 0, errors: 0, openTickets: 0 };

	function renderActionCenter() {
		var items = [
			{ key: "atRisk", count: actionCenterState.atRisk, label: "لید در ریسک", icon: "fa-triangle-exclamation", tone: "tone-red", href: "index.html" },
			{ key: "overdueFollowups", count: actionCenterState.overdueFollowups, label: "پیگیری عقب‌افتاده", icon: "fa-bell", tone: "tone-gold", href: "followups.html" },
			{ key: "errors", count: actionCenterState.errors, label: "خطای بررسی‌نشده", icon: "fa-circle-exclamation", tone: "tone-red", href: "javascript:void(0)", action: "openErrors" },
			{ key: "openTickets", count: actionCenterState.openTickets, label: "تیکت پشتیبانی باز", icon: "fa-headset", tone: "tone-navy", href: "support.html" }
		].filter(function (i) { return i.count > 0; });

		var totalCount = items.reduce(function (sum, i) { return sum + i.count; }, 0);
		var $badge = $("#alertsTabBadge");
		if (totalCount > 0) {
			$badge.text(totalCount).removeClass("d-none");
		} else {
			$badge.addClass("d-none");
		}

		var $grid = $("#alertCenterGrid").empty();
		if (items.length === 0) {
			$grid.addClass("d-none");
			$("#alertCenterEmpty").removeClass("d-none");
			return;
		}
		$("#alertCenterEmpty").addClass("d-none");
		$grid.removeClass("d-none");
		items.forEach(function (i) {
			var $card = $("<a>").addClass("alert-card animate-in " + i.tone).attr("href", i.href);
			$card.append($('<div class="alert-card-icon">').append($('<i class="fas ' + i.icon + '" aria-hidden="true">')));
			$card.append(
				$('<div class="alert-card-body">')
					.append($('<div class="alert-card-value">').text(i.count))
					.append($('<div class="alert-card-label">').text(i.label))
			);
			$card.append('<i class="fas fa-chevron-left alert-card-arrow" aria-hidden="true"></i>');
			if (i.action === "openErrors") {
				$card.on("click", function (e) {
					e.preventDefault();
					switchDashboardTab("reports");
					$("#errorsCollapse").collapse("show");
					setTimeout(function () {
						$("html, body").animate({ scrollTop: $("#errorsCollapse").offset().top - 80 }, 300);
					}, 150);
				});
			}
			$grid.append($card);
		});
	}

	function refreshActionCenter() {
		actionCenterState.atRisk = state.leads.filter(isAtRisk).length;
		renderActionCenter();

		if (typeof CrmData.fetchFollowupsToday === "function") {
			CrmData.fetchFollowupsToday()
				.then(function (res) {
					actionCenterState.overdueFollowups = (res && res.overdue_count) || 0;
					renderActionCenter();
				})
				.catch(function (err) { console.error("خطا در بارگذاری پیگیری‌های عقب‌افتاده:", err); });
		}

		if (typeof CrmData.fetchErrors === "function") {
			CrmData.fetchErrors()
				.then(function (errors) {
					actionCenterState.errors = (errors || []).length;
					renderActionCenter();
				})
				.catch(function (err) { console.error("خطا در بارگذاری خطاهای سیستم:", err); });
		}

		if (typeof CrmData.fetchSupportTickets === "function") {
			CrmData.fetchSupportTickets()
				.then(function (tickets) {
					actionCenterState.openTickets = (tickets || []).filter(function (t) { return t.status === "باز"; }).length;
					renderActionCenter();
				})
				.catch(function (err) { console.error("خطا در بارگذاری تیکت‌های پشتیبانی:", err); });
		}
	}

	var reportRange = "ALL";

	var BREAKDOWN_PALETTE = ["#3b5bdb", "#0d8a4f", "#d2ae6d", "#c81e4b", "#7c5cbf", "#0f9aa6"];

	function renderBreakdownList($el, counts, colorMap) {
		$el.empty();
		var keys = Object.keys(counts || {});
		if (keys.length === 0) {
			$el.html('<div class="empty-state"><i class="fas fa-inbox"></i><p>داده‌ای در این بازه نیست.</p></div>');
			return;
		}
		var total = keys.reduce(function (sum, k) { return sum + (counts[k] || 0); }, 0) || 1;
		keys.forEach(function (k, idx) {
			var color = (colorMap && colorMap[k]) || BREAKDOWN_PALETTE[idx % BREAKDOWN_PALETTE.length];
			var value = counts[k] || 0;
			var pct = Math.round((value / total) * 100);
			var $row = $('<div class="breakdown-row">');
			$row.append($('<div class="breakdown-row-head">')
				.append($('<span class="breakdown-dot">').css("background", color))
				.append($('<span class="breakdown-label">').text(k))
				.append($('<span class="breakdown-value">').text(value)));
			$row.append($('<div class="breakdown-track">').append($('<div class="breakdown-fill">').css({ width: pct + "%", background: color })));
			$el.append($row);
		});
	}

	function loadAdminDashboard(range) {
		if (typeof CrmData.fetchAdminDashboard !== "function") return;
		CrmData.fetchAdminDashboard(range)
			.then(function (res) {
				$("#bot-total-users").text(res.bot_users_total || 0);
				$("#bot-dau").text(res.bot_users_dau || 0);
				$("#bot-wau").text(res.bot_users_wau || 0);
				$("#d-today").text(res.leads_today || 0);
				$("#report-lead-count").text(res.leads_in_range || 0);
				renderBreakdownList($("#reportStatusList"), res.status_counts, STATUS_COLORS);
				renderBreakdownList($("#reportTypeList"), res.type_counts);
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری آمار ربات:", err);
			});
	}

	var ERROR_SEVERITY_META = {
		critical: { icon: "fa-circle-exclamation", label: "بحرانی" },
		error: { icon: "fa-triangle-exclamation", label: "خطا" }
	};

	function renderErrors(errors) {
		var $list = $("#errorsList").empty();
		$("#errorsCount").text(errors.length);
		if (errors.length === 0) {
			$list.append('<div class="empty-state"><i class="fas fa-circle-check" style="color:#2e9e6d;opacity:.7"></i><p>هیچ خطای بررسی‌نشده‌ای وجود ندارد.</p></div>');
			return;
		}
		errors.forEach(function (e) {
			var meta = ERROR_SEVERITY_META[e.severity] || { icon: "fa-circle-question", label: e.severity || "-" };
			var toneClass = e.severity === "critical" ? "tone-critical" : "tone-error";
			var $item = $('<div class="activity-log-item">');
			$item.append($('<div class="activity-log-icon">').addClass(toneClass).append($('<i class="fas ' + meta.icon + '">')));
			var $body = $('<div class="activity-log-body">');
			$body.append($('<div>').append(
				$('<strong>').text((e.workflow_name || "-") + " — " + (e.node_name || "-")),
				$('<span class="activity-log-detail">').text(" " + (e.error_message || ""))
			));
			var $actions = $('<div class="mt-1">');
			$actions.append($('<button class="btn btn-sm btn-outline-secondary">').text("علامت به‌عنوان بررسی‌شده").on("click", function () {
				CrmData.resolveError(e.log_id).then(function () { loadErrors(); }).catch(function (err) {
					alert("خطا در ثبت: " + (err.message || "خطای نامشخص"));
				});
			}));
			$body.append($actions);
			$item.append($body);
			$list.append($item);
		});
	}

	function loadErrors() {
		if (typeof CrmData.fetchErrors !== "function") return;
		CrmData.fetchErrors()
			.then(renderErrors)
			.catch(function (err) {
				console.error("خطا در بارگذاری فهرست خطاها:", err);
			});
	}

	function renderSalesKpi(kpi) {
		kpi = kpi || {};
		$("#kpi-leads-today").text(kpi.leads_today || 0);
		$("#kpi-calls-today").text(kpi.calls_today || 0);
		$("#kpi-purchases-today").text(kpi.purchases_today || 0);
		$("#kpi-overdue-followups").text(kpi.overdue_followups || 0);
		$("#kpi-revenue-today").text((kpi.revenue_today || 0).toLocaleString("fa-IR"));
		$("#kpi-conversion-rate").text(toPersianPercent(kpi.conversion_rate || 0));
		$("#kpi-total-purchases").text(kpi.total_purchases || 0);
	}

	function loadSalesKpi() {
		if (typeof CrmData.fetchSalesKpi !== "function") return;
		CrmData.fetchSalesKpi()
			.then(renderSalesKpi)
			.catch(function (err) {
				console.error("خطا در بارگذاری KPI فروش:", err);
			});
	}

	function renderConsultantPerformance(rows) {
		var $body = $("#consultantPerfTableBody").empty();
		if (!rows || rows.length === 0) {
			$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-user-tie"></i><p>کارشناسی ثبت نشده.</p></div></td></tr>');
			return;
		}
		var maxRevenue = Math.max.apply(null, rows.map(function (r) { return r.revenue || 0; }).concat([1]));
		rows.forEach(function (r, idx) {
			var name = r.display_name || r.username || "";
			var initials = name.trim().charAt(0) || "؟";
			var $rank = idx < 3
				? $('<span class="rank-badge">').addClass("rank-" + (idx + 1)).append('<i class="fas fa-trophy"></i>')
				: $('<span class="rank-num">').text(idx + 1);
			var pct = Math.round(((r.revenue || 0) / maxRevenue) * 100);
			var $tr = $("<tr>");
			var $nameCell = $('<div class="consultant-cell">')
				.append($rank)
				.append($('<span class="avatar-badge">').text(initials))
				.append($("<span>").text(name));
			$tr.append($("<td>").append($nameCell));
			$tr.append($("<td>").text(r.leads_assigned || 0));
			$tr.append($("<td>").text(r.calls_made || 0));
			$tr.append($("<td>").text(r.purchases || 0));
			var $revCell = $('<div class="revenue-cell">')
				.append($('<span class="rev-amount">').text((r.revenue || 0).toLocaleString("fa-IR")))
				.append($('<div class="mini-bar-track">').append($('<div class="mini-bar-fill">').css("width", pct + "%")));
			$tr.append($("<td>").append($revCell));
			$body.append($tr);
		});
	}

	function loadConsultantPerformance() {
		if (typeof CrmData.fetchConsultantPerformance !== "function") return;
		CrmData.fetchConsultantPerformance()
			.then(renderConsultantPerformance)
			.catch(function (err) {
				$("#consultantPerfTableBody").html('<tr><td colspan="5" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + (err.message || "خطای نامشخص") + '</td></tr>');
			});
	}

	function toPersianDigits(n) {
		var digits = { 0: "۰", 1: "۱", 2: "۲", 3: "۳", 4: "۴", 5: "۵", 6: "۶", 7: "۷", 8: "۸", 9: "۹" };
		return String(n).replace(/[0-9]/g, function (d) { return digits[d]; });
	}

	function renderFunnel(funnel) {
		funnel = funnel || {};
		$("#funnel-new-leads").text(funnel.new_leads || 0);
		$("#funnel-contacted").text(funnel.contacted || 0);
		$("#funnel-contacted-pct").text(toPersianDigits(funnel.contacted_pct || 0));
		$("#funnel-contacted-bar").css("width", (funnel.contacted_pct || 0) + "%");
		$("#funnel-interested").text(funnel.interested || 0);
		$("#funnel-interested-pct").text(toPersianDigits(funnel.interested_pct || 0));
		$("#funnel-interested-bar").css("width", (funnel.interested_pct || 0) + "%");
		$("#funnel-purchased").text(funnel.purchased || 0);
		$("#funnel-purchased-pct").text(toPersianDigits(funnel.purchased_pct || 0));
		$("#funnel-purchased-bar").css("width", (funnel.purchased_pct || 0) + "%");
	}

	function loadSalesFunnel() {
		if (typeof CrmData.fetchSalesFunnel !== "function") return;
		CrmData.fetchSalesFunnel()
			.then(renderFunnel)
			.catch(function (err) {
				console.error("خطا در بارگذاری Funnel فروش:", err);
			});
	}

	function renderSourcePerformance(rows) {
		var $body = $("#sourcePerfTableBody").empty();
		if (!rows || rows.length === 0) {
			$body.append('<tr><td colspan="4"><div class="empty-state"><i class="fas fa-map-location-dot"></i><p>داده‌ای وجود ندارد.</p></div></td></tr>');
			return;
		}
		var maxRevenue = Math.max.apply(null, rows.map(function (r) { return r.revenue || 0; }).concat([1]));
		rows.forEach(function (r) {
			var $tr = $("<tr>");
			var $srcCell = $('<div class="source-cell">')
				.append('<span class="row-icon-badge"><i class="fas fa-signal"></i></span>')
				.append($("<span>").text(CrmData.sourceLabel(r.source)));
			$tr.append($("<td>").append($srcCell));
			$tr.append($("<td>").text(r.leads || 0));
			$tr.append($("<td>").text(r.purchases || 0));
			var pct = Math.round(((r.revenue || 0) / maxRevenue) * 100);
			var $revCell = $('<div class="revenue-cell">')
				.append($('<span class="rev-amount">').text((r.revenue || 0).toLocaleString("fa-IR")))
				.append($('<div class="mini-bar-track">').append($('<div class="mini-bar-fill">').css("width", pct + "%")));
			$tr.append($("<td>").append($revCell));
			$body.append($tr);
		});
	}

	function loadSourcePerformance() {
		if (typeof CrmData.fetchSourcePerformance !== "function") return;
		CrmData.fetchSourcePerformance()
			.then(renderSourcePerformance)
			.catch(function (err) {
				$("#sourcePerfTableBody").html('<tr><td colspan="4" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + (err.message || "خطای نامشخص") + '</td></tr>');
			});
	}

	function renderHeroDate() {
		var $el = $("#heroTodayDate");
		if ($el.length === 0) return;
		var text = new Date().toLocaleDateString("fa-IR", { weekday: "long", day: "numeric", month: "long" });
		$el.text(text);
	}

	function switchDashboardTab(tab) {
		$(".dashboard-tab-btn", "#dashboardTabs").removeClass("active");
		$(".dashboard-tab-btn[data-tab='" + tab + "']", "#dashboardTabs").addClass("active");
		$(".dashboard-tab-pane").addClass("d-none");
		$(".dashboard-tab-pane[data-tab-pane='" + tab + "']").removeClass("d-none");
		if (tab === "leads") {
			if (state.chart) state.chart.resize();
			if (state.trendChart) state.trendChart.resize();
		}
	}

	$(function () {
		renderHeroDate();
		loadLeads();
		loadAdminDashboard(reportRange);
		loadErrors();
		loadSalesKpi();
		loadConsultantPerformance();
		loadSalesFunnel();
		loadSourcePerformance();

		$("#dashboardTabs").on("click", ".dashboard-tab-btn", function () {
			switchDashboardTab($(this).data("tab"));
		});

		$("#exportRangeButtons").on("click", ".filter-tab", function () {
			$(".filter-tab", "#exportRangeButtons").removeClass("active");
			$(this).addClass("active");
			state.exportRange = $(this).data("range");
			$("#exportCustomDates").toggleClass("d-none", state.exportRange !== "custom");
			updateExportCount();
		});

		$("#reportRangeTabs").on("click", ".filter-tab", function () {
			$(".filter-tab", "#reportRangeTabs").removeClass("active");
			$(this).addClass("active");
			reportRange = $(this).data("range");
			loadAdminDashboard(reportRange);
		});

		$("#exportFrom, #exportTo").on("change", updateExportCount);
		$("#btnExportCsv").on("click", exportCsv);
	});
})();
