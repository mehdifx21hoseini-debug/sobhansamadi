(function () {
	"use strict";

	function toPersianPercent(n) {
		var digits = { 0: "۰", 1: "۱", 2: "۲", 3: "۳", 4: "۴", 5: "۵", 6: "۶", 7: "۷", 8: "۸", 9: "۹" };
		return String(n).replace(/[0-9]/g, function (d) { return digits[d]; }) + "٪";
	}

	$(function () {
		CrmData.fetchLeads()
			.then(function (leads) {
				var total = leads.length;
				var pending = leads.filter(function (l) { return l.status === "پاسخ‌داده‌نشده"; }).length;
				var called = leads.filter(function (l) { return l.status === "تماس گرفته شد"; }).length;
				var noAnswer = leads.filter(function (l) { return l.status === "پاسخ نداد"; }).length;

				var responded = called + noAnswer;
				var responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;

				var pendingPct = total > 0 ? Math.round((pending / total) * 100) : 0;
				var calledPct = total > 0 ? Math.round((called / total) * 100) : 0;
				var noAnswerPct = total > 0 ? Math.round((noAnswer / total) * 100) : 0;

				var attemptsSum = leads.reduce(function (sum, l) { return sum + (l.contact_attempts || 0); }, 0);
				var avgAttempts = total > 0 ? (attemptsSum / total).toFixed(1) : "0";

				$("#d-total").text(total);
				$("#d-pending").text(pending);
				$("#d-called").text(called);
				$("#d-noanswer").text(noAnswer);

				$("#d-response-rate").text(toPersianPercent(responseRate));

				$("#d-avg-attempts").text(avgAttempts);

				$("#d-bar-pending").css("width", pendingPct + "%");
				$("#d-bar-pending-label").text(pending + " (" + toPersianPercent(pendingPct) + ")");

				$("#d-bar-called").css("width", calledPct + "%");
				$("#d-bar-called-label").text(called + " (" + toPersianPercent(calledPct) + ")");

				$("#d-bar-noanswer").css("width", noAnswerPct + "%");
				$("#d-bar-noanswer-label").text(noAnswer + " (" + toPersianPercent(noAnswerPct) + ")");
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری آمار داشبورد:", err);
			});
	});
})();
