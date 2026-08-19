(function () {
	"use strict";

	var DELETE_WINDOW_HOURS = 48;
	var AUDIENCE_LABELS = {
		all: "همه کاربران",
		econ_subscribers: "مشترکین تقویم اقتصادی"
	};

	function updateCharCount() {
		$("#charCount").text($("#broadcastMessage").val().length);
	}

	function showResult(success, text) {
		$("#broadcastResult")
			.removeClass("d-none alert-success alert-danger")
			.addClass(success ? "alert alert-success" : "alert alert-danger")
			.text(text);
	}

	function truncate(s, n) {
		s = s || "";
		return s.length > n ? s.slice(0, n) + "…" : s;
	}

	function formatDate(iso) {
		if (!iso) return "-";
		return new Date(iso).toLocaleString("fa-IR");
	}

	function hoursSince(iso) {
		return (Date.now() - new Date(iso).getTime()) / 3600000;
	}

	function renderHistory(broadcasts) {
		var $body = $("#broadcastHistoryBody").empty();
		if (broadcasts.length === 0) {
			$body.append('<tr><td colspan="5" class="text-center text-muted py-4">هنوز پیامی ارسال نشده.</td></tr>');
			return;
		}
		broadcasts.forEach(function (b) {
			var $tr = $("<tr>");
			$tr.append($("<td>").text(truncate(b.message, 60)));
			$tr.append($("<td>").text(AUDIENCE_LABELS[b.audience] || b.audience));
			$tr.append($("<td>").text(b.sent_count));
			$tr.append($("<td>").text(formatDate(b.created_at)));

			var $actionCell = $("<td>");
			if (hoursSince(b.created_at) < DELETE_WINDOW_HOURS) {
				var $btn = $('<button class="btn btn-sm btn-outline-secondary"><i class="fas fa-trash mr-1"></i>حذف برای همه</button>');
				$btn.on("click", function () {
					if (!confirm("این پیام برای همه‌ی " + b.sent_count + " گیرنده حذف بشه؟ این کار قابل بازگشت نیست.")) return;
					$btn.prop("disabled", true);
					CrmData.deleteBroadcast(b.batch_id)
						.then(function (res) {
							alert("حذف شد — " + res.deleted + " موفق، " + res.failed + " ناموفق.");
							loadHistory();
						})
						.catch(function (err) {
							alert("خطا در حذف: " + (err.message || "خطای نامشخص"));
							$btn.prop("disabled", false);
						});
				});
				$actionCell.append($btn);
			} else {
				$actionCell.append('<span class="text-muted text-sm">بیش از ۴۸ ساعت گذشته</span>');
			}
			$tr.append($actionCell);
			$body.append($tr);
		});
	}

	function loadHistory() {
		if (typeof CrmData.fetchBroadcasts !== "function") return;
		CrmData.fetchBroadcasts()
			.then(renderHistory)
			.catch(function () {
				$("#broadcastHistoryBody").html('<tr><td colspan="5" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	function sendBroadcast() {
		var message = $("#broadcastMessage").val().trim();
		if (!message) { showResult(false, "لطفاً متن پیام را وارد کنید."); return; }
		var audience = $("input[name='audience']:checked").val();
		var audienceLabel = AUDIENCE_LABELS[audience] || audience;

		if (!confirm("این پیام همین الان برای «" + audienceLabel + "» ارسال می‌شود. مطمئنی؟")) {
			return;
		}

		var $btn = $("#btnSendBroadcast").prop("disabled", true);
		CrmData.sendBroadcast(message, audience)
			.then(function (res) {
				showResult(true, "ارسال شد — " + res.sent + " موفق، " + res.failed + " ناموفق (از " + res.total + " مخاطب).");
				$("#broadcastMessage").val("");
				updateCharCount();
				loadHistory();
			})
			.catch(function (err) {
				showResult(false, "خطا در ارسال: " + (err.message || "خطای نامشخص"));
			})
			.finally(function () {
				$btn.prop("disabled", false);
			});
	}

	$(function () {
		updateCharCount();
		loadHistory();
		$("#broadcastMessage").on("input", updateCharCount);
		$("#btnSendBroadcast").on("click", sendBroadcast);
	});
})();
