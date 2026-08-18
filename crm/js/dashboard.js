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

	var state = {
		leads: [],
		chart: null,
		exportRange: "all"
	};

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
		$("#d-pending").text(pending);
		$("#d-called").text(called);
		$("#d-noanswer").text(noAnswer);
		$("#d-response-rate").text(toPersianPercent(responseRate));
		$("#d-avg-attempts").text(avgAttempts);

		renderChart(pending, called, noAnswer, total);
	}

	function renderChart(pending, called, noAnswer, total) {
		var ctx = document.getElementById("statusChart").getContext("2d");
		var data = [pending, called, noAnswer];
		var labels = ["پاسخ‌داده‌نشده", "تماس گرفته شد", "پاسخ نداد"];
		var colors = labels.map(function (l) { return STATUS_COLORS[l]; });

		if (state.chart) {
			state.chart.data.datasets[0].data = data;
			state.chart.update();
		} else {
			state.chart = new Chart(ctx, {
				type: "doughnut",
				data: {
					labels: labels,
					datasets: [{ data: data, backgroundColor: colors, borderWidth: 0 }]
				},
				options: {
					cutout: "68%",
					plugins: { legend: { display: false } }
				}
			});
		}

		var $legend = $("#chartLegend").empty();
		labels.forEach(function (label, i) {
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
			return [l.full_name || "", l.phone || "", l.course || "", l.status, l.created_at ? new Date(l.created_at).toLocaleDateString("fa-IR") : ""];
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

	$(function () {
		loadLeads();

		$("#exportRangeButtons").on("click", ".filter-tab", function () {
			$(".filter-tab", "#exportRangeButtons").removeClass("active");
			$(this).addClass("active");
			state.exportRange = $(this).data("range");
			$("#exportCustomDates").toggleClass("d-none", state.exportRange !== "custom");
			updateExportCount();
		});

		$("#exportFrom, #exportTo").on("change", updateExportCount);
		$("#btnExportCsv").on("click", exportCsv);
	});
})();
