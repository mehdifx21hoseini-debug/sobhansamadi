(function () {
	"use strict";

	function formatDate(iso) {
		if (!iso) return "-";
		return new Date(iso).toLocaleString("fa-IR");
	}

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock", label: "در انتظار تماس" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone", label: "تماس گرفته شد" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash", label: "پاسخ نداد" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status] || STATUS_META["پاسخ‌داده‌نشده"];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + meta.label + '</span>';
	}

	function renderBucket($body, leads) {
		$body.empty();
		if (!leads || leads.length === 0) {
			$body.append('<tr><td colspan="4"><div class="empty-state"><i class="fas fa-inbox"></i><p>موردی وجود ندارد.</p></div></td></tr>');
			return;
		}
		leads.forEach(function (lead) {
			var $tr = $("<tr>");
			$tr.append($("<td>").append($("<a>").attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id)).addClass("lead-name-link").text(lead.full_name || "(بدون نام)")));
			$tr.append($("<td>").attr("dir", "ltr").addClass("mono").text(lead.phone || "-"));
			$tr.append($("<td>").addClass("text-muted text-sm").text(formatDate(lead.next_followup_at)));
			$tr.append($("<td>").html(statusBadgeHtml(lead.status)));
			$body.append($tr);
		});
	}

	function load() {
		CrmData.fetchFollowupsToday()
			.then(function (res) {
				res = res || {};
				$("#fu-overdue-count").text(res.overdue_count || 0);
				$("#fu-urgent-count").text(res.urgent_count || 0);
				$("#fu-normal-count").text(res.normal_count || 0);
				renderBucket($("#fuOverdueBody"), res.overdue);
				renderBucket($("#fuUrgentBody"), res.urgent);
				renderBucket($("#fuNormalBody"), res.normal);

				var totalDue = (res.overdue_count || 0) + (res.urgent_count || 0);
				if (totalDue > 0) {
					$("#followupsTodayCount").text(totalDue).removeClass("d-none");
				}
			})
			.catch(function (err) {
				$("#fuOverdueBody, #fuUrgentBody, #fuNormalBody").html('<tr><td colspan="4" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + (err.message || "خطای نامشخص") + '</td></tr>');
			});
	}

	$(function () {
		load();
	});
})();
