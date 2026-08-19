(function () {
	"use strict";

	function updateCharCount() {
		$("#charCount").text($("#broadcastMessage").val().length);
	}

	function showResult(success, text) {
		$("#broadcastResult")
			.removeClass("d-none alert-success alert-danger")
			.addClass(success ? "alert alert-success" : "alert alert-danger")
			.text(text);
	}

	function sendBroadcast() {
		var message = $("#broadcastMessage").val().trim();
		if (!message) { showResult(false, "لطفاً متن پیام را وارد کنید."); return; }
		var audience = $("input[name='audience']:checked").val();
		var audienceLabel = audience === "econ_subscribers" ? "مشترکین هشدار تقویم اقتصادی" : "همه کاربران ربات";

		if (!confirm("این پیام همین الان برای «" + audienceLabel + "» ارسال می‌شود و قابل لغو نیست. مطمئنی؟")) {
			return;
		}

		var $btn = $("#btnSendBroadcast").prop("disabled", true);
		CrmData.sendBroadcast(message, audience)
			.then(function (res) {
				showResult(true, "ارسال شد — " + res.sent + " موفق، " + res.failed + " ناموفق (از " + res.total + " مخاطب).");
				$("#broadcastMessage").val("");
				updateCharCount();
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
		$("#broadcastMessage").on("input", updateCharCount);
		$("#btnSendBroadcast").on("click", sendBroadcast);
	});
})();
