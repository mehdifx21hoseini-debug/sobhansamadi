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
			$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-bullhorn"></i><p>هنوز پیامی ارسال نشده.</p></div></td></tr>');
			return;
		}
		broadcasts.forEach(function (b) {
			var $tr = $("<tr>").toggleClass("broadcast-row-deleted", !!b.deleted);
			$tr.append($("<td>").text(truncate(b.message, 60)));
			$tr.append($("<td>").text(AUDIENCE_LABELS[b.audience] || b.audience));
			$tr.append($("<td>").text(b.sent_count));
			$tr.append($("<td>").text(formatDate(b.created_at)));

			var $actionCell = $("<td>");
			if (b.deleted) {
				$actionCell.append('<span class="status-badge badge-ticket-closed"><i class="fas fa-trash"></i>حذف شده</span>');
			} else {
				// دکمه همیشه هست، حتی اگر تاریخِ ارسال قدیمی باشد.
				//
				// مهلتِ ۴۸ ساعته‌ی تلگرام از لحظه‌ی رسیدنِ پیام حساب می‌شود،
				// نه از تاریخِ ساخته شدنِ ارسال. اگر پیامی بعداً دوباره
				// فرستاده شده باشد، نسخه‌ی تازه‌اش قابلِ حذف است در حالی که
				// تاریخِ ردیف قدیمی است - و دکمه‌ی پنهان یعنی کاربر هیچ راهی
				// برای پاک کردنش ندارد.
				//
				// اگر واقعاً گذشته باشد، تلگرام خودش رد می‌کند و پیام
				// «۰ موفق» همین را می‌گوید. یک تلاشِ بی‌نتیجه از یک دکمه‌ی
				// غایب بهتر است.
				var old = hoursSince(b.created_at) >= DELETE_WINDOW_HOURS;
				var $btn = $('<button class="btn btn-sm btn-outline-secondary"><i class="fas fa-trash mr-1"></i>حذف برای همه</button>');
				$btn.on("click", function () {
					// حذفِ پیام از چتِ چند صد نفر برگشت‌پذیر نیست، پس این
					// یکی هنوز تایید می‌گیرد - ولی نه با پنجره‌ی مرورگر.
					CrmToast.confirm(
						"این پیام از چتِ همه‌ی " + b.sent_count + " گیرنده پاک می‌شود و برگشتی ندارد.",
						{ title: "حذف پیام همگانی؟", confirmLabel: "حذف کن", danger: true }
					).then(function (yes) {
						if (!yes) return;
						$btn.prop("disabled", true);
						// حذف هم مثل ارسال تکه‌تکه است: پاک کردن از چتِ هزاران
						// نفر در یک درخواست جا نمی‌شود.
						var removeStep = function () {
							return CrmData.deleteBroadcast(b.batch_id).then(function (res) {
								if (res.done) {
									CrmToast.ok("حذف شد — " + res.deleted + " موفق، " + res.failed + " ناموفق.");
									loadHistory();
									return;
								}
								$btn.text("در حال حذف… " + res.deleted + " از " + b.sent_count);
								return new Promise(function (r) {
									setTimeout(r, res.throttled ? 3000 : 300);
								}).then(removeStep);
							});
						};
						removeStep()
							.catch(function (err) {
								CrmToast.error("حذف نیمه‌کاره ماند: " + (err.message || "خطای نامشخص") +
									" - دوباره بزنید تا از همان‌جا ادامه دهد.");
								$btn.prop("disabled", false);
								loadHistory();
							});
					});
				});
				$actionCell.append($btn);
				if (old) {
					$actionCell.append(
						'<div class="text-muted text-sm mt-1">ارسال قدیمی - اگر تلگرام اجازه ندهد، «۰ موفق» می‌گوید</div>');
				}
			}
			$tr.append($actionCell);
			$body.append($tr);
		});
	}

	function loadHistory() {
		if (typeof CrmData.fetchBroadcasts !== "function") return;
		CrmData.showTableLoading("#broadcastHistoryBody", 5, 3);
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

		// ارسالِ همگانی هم برگشت‌ناپذیر است (حذفش فقط ۴۸ ساعت ممکن است و
		// همه را هم پاک نمی‌کند)، پس تایید می‌ماند.
		CrmToast.confirm(
			"این پیام همین الان برای «" + audienceLabel + "» فرستاده می‌شود.",
			{ title: "ارسال پیام همگانی؟", confirmLabel: "بفرست" }
		).then(function (yes) {
			if (yes) doSend(message, audience);
		});
	}

	function faNum(n) { return Number(n || 0).toLocaleString("fa-IR"); }

	function showProgress(res) {
		var pct = res.total ? Math.round(((res.sent + res.failed) / res.total) * 100) : 0;
		showResult(true,
			"در حال ارسال… " + faNum(res.sent) + " از " + faNum(res.total) +
			" (" + faNum(pct) + "٪)" + (res.failed ? " — " + faNum(res.failed) + " ناموفق" : ""));
	}

	/**
	 * ارسال تکه‌تکه تا تمام شدن.
	 *
	 * چرا حلقه: مخاطبِ «همه» هزاران نفر است و یک درخواست هرگز به آخرش
	 * نمی‌رسد - سرور وسط کار متوقف می‌شود. هر بار یک تکه می‌رود و سرور
	 * می‌گوید چقدر مانده.
	 *
	 * بستنِ تب ارسال را از بین نمی‌برد: صف در سرور است و کرانِ هر پنج
	 * دقیقه ادامه‌اش می‌دهد. این حلقه فقط تندترش می‌کند و پیشرفت را نشان
	 * می‌دهد.
	 */
	function doSend(message, audience) {
		var $btn = $("#btnSendBroadcast").prop("disabled", true);

		function step(batchId) {
			return CrmData.sendBroadcast(message, audience, batchId).then(function (res) {
				showProgress(res);
				if (res.done) {
					showResult(true,
						"ارسال کامل شد — " + faNum(res.sent) + " موفق" +
						(res.failed ? "، " + faNum(res.failed) + " ناموفق" : "") +
						" (از " + faNum(res.total) + " مخاطب).");
					$("#broadcastMessage").val("");
					updateCharCount();
					loadHistory();
					return;
				}
				// اگر سرور به سقفش خورده، کمی نفس بکشد؛ وگرنه بلافاصله
				// همان دیوار را دوباره می‌زنیم.
				var wait = res.throttled ? 3000 : 300;
				return new Promise(function (r) { setTimeout(r, wait); })
					.then(function () { return step(res.batch_id); });
			});
		}

		step("")
			.catch(function (err) {
				showResult(false,
					"ارسال نیمه‌کاره ماند: " + (err.message || "خطای نامشخص") +
					" — بقیه‌ی پیام‌ها خودکار در پس‌زمینه فرستاده می‌شوند.");
				loadHistory();
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
