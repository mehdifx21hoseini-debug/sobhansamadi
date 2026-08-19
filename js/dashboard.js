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

		var responded = called + noAnswer;
		var responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;

		var attemptsSum = leads.reduce(function (sum, l) { return sum + (l.contact_attempts || 0); }, 0);
		var avgAttempts = total > 0 ? (attemptsSum / total).toFixed(1) : "0";

		$("#d-total").text(total);
		$("#d-response-rate").text(toPersianPercent(responseRate));
		$("#d-avg-attempts").text(avgAttempts);

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
						backgroundColor: "#29386c",
						borderRadius: 4,
						maxBarThickness: 28
					}]
				},
				options: {
					plugins: { legend: { display: false } },
					scales: {
						y: { beginAtZero: true, ticks: { precision: 0 } }
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
					datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }]
				},
				options: {
					cutout: "68%",
					plugins: { legend: { display: false } }
				}
			});
		}

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
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری آمار داشبورد:", err);
			});
	}

	var reportRange = "ALL";

	function renderBreakdownList($el, counts) {
		$el.empty();
		var keys = Object.keys(counts || {});
		if (keys.length === 0) {
			$el.text("داده‌ای در این بازه نیست.");
			return;
		}
		keys.forEach(function (k) {
			var $row = $('<div class="info-row">');
			$row.append($('<span>').text(k));
			$row.append($('<span class="font-weight-bold">').text(counts[k]));
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
				renderBreakdownList($("#reportStatusList"), res.status_counts);
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
			$list.append('<div class="activity-log-empty">هیچ خطای بررسی‌نشده‌ای وجود ندارد. ✅</div>');
			return;
		}
		errors.forEach(function (e) {
			var meta = ERROR_SEVERITY_META[e.severity] || { icon: "fa-circle-question", label: e.severity || "-" };
			var $item = $('<div class="activity-log-item">');
			$item.append($('<div class="activity-log-icon">').append($('<i class="fas ' + meta.icon + '">')));
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

	$(function () {
		loadLeads();
		loadAdminDashboard(reportRange);
		loadErrors();

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
