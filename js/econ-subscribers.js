(function () {
	"use strict";

	function formatDate(iso) {
		if (!iso) return "-";
		return new Date(iso).toLocaleString("fa-IR");
	}

	function renderSubs(subs) {
		var $body = $("#econSubsTableBody").empty();
		var active = subs.filter(function (s) { return s.subscribed; }).length;
		$("#econ-active-count").text(active);
		$("#econ-inactive-count").text(subs.length - active);
		$("#econ-total-count").text(subs.length);

		if (subs.length === 0) {
			$body.append('<tr><td colspan="6"><div class="empty-state"><i class="fas fa-calendar-days"></i><p>هنوز مشترکی ثبت نشده.</p></div></td></tr>');
			return;
		}

		subs.forEach(function (s) {
			var $tr = $("<tr>");
			$tr.append($("<td>").addClass("mono").text(s.telegram_user_id));
			$tr.append($("<td>").text((s.alert_minutes || 15) + " دقیقه قبل"));
			$tr.append($("<td>").text(s.show_low_importance ? "بله" : "خیر"));
			$tr.append($("<td>").html(
				s.subscribed
					? '<span class="status-badge badge-ticket-answered"><i class="fas fa-check"></i>فعال</span>'
					: '<span class="status-badge badge-ticket-closed"><i class="fas fa-ban"></i>لغوشده</span>'
			));
			$tr.append($("<td>").text(formatDate(s.updated_at)));

			var $actionCell = $("<td>");
			if (s.subscribed) {
				var $btn = $('<button class="btn btn-sm btn-outline-secondary">لغو عضویت</button>');
				$btn.on("click", function () {
					if (!confirm("عضویت این کاربر در هشدارهای تقویم اقتصادی لغو شود؟")) return;
					CrmData.unsubscribeEconSubscriber(s.telegram_user_id)
						.then(loadSubs)
						.catch(function (err) { alert("خطا: " + (err.message || "خطای نامشخص")); });
				});
				$actionCell.append($btn);
			}
			$tr.append($actionCell);

			$body.append($tr);
		});
	}

	function loadSubs() {
		CrmData.fetchEconSubscribers()
			.then(renderSubs)
			.catch(function () {
				$("#econSubsTableBody").html('<tr><td colspan="6" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	$(function () {
		loadSubs();
	});
})();
