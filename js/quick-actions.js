/**
 * نوارِ «اقدام سریع» - مشترکِ فهرست لیدها و کارتابل.
 *
 * هدف این است که کارِ روزمره بدون باز کردنِ پرونده انجام شود، ولی نوار
 * نباید به یک صفحه‌ی دوم تبدیل شود. پس هر کار یک دکمه است که فهرستش را
 * باز می‌کند، انتخاب می‌شود، و با دکمه‌ی کنارش انجام.
 *
 * «پیگیری» انتخاب‌شدنی-و-تمام است چون فقط یک تاریخ می‌نویسد و برگشت‌پذیر
 * است. تماس و پیام یک قدمِ تاییدِ صریح دارند: اولی شمارنده را بالا می‌برد
 * و دومی چیزی برای مشتری می‌فرستد که برگشت‌پذیر نیست.
 *
 * اول فقط در فهرست لیدها بود؛ کارتابل همان کارها را لازم داشت و کپی
 * کردنش یعنی دو نسخه که کم‌کم از هم دور می‌شوند. صفحه فقط دو چیز
 * می‌دهد: چطور پیام بدهد و چطور خودش را تازه کند.
 */
var CrmQuickActions = (function ($) {
	"use strict";

	var CALL_RESULTS = [
		{ label: "جواب نداد", tone: "bad" },
		{ label: "علاقه‌مند", tone: "" },
		{ label: "نیاز به پیگیری", tone: "warn" },
		{ label: "درخواست اطلاعات بیشتر", tone: "" },
		{ label: "مخالفت", tone: "bad" },
		{ label: "خرید کرد", tone: "good" },
		{ label: "نامرتبط", tone: "bad" }
	];

	var FOLLOWUP_CHOICES = [
		{ label: "فردا", days: 1 },
		{ label: "۳ روز دیگر", days: 3 },
		{ label: "هفته‌ی دیگر", days: 7 },
		// «آخر هفته‌ی بعد» یا «بعد از عید» در سه گزینه‌ی ثابت جا نمی‌شود، و
		// تا امروز یعنی باز کردن پرونده فقط برای یک تاریخ.
		{ label: "تاریخ دلخواه…", days: "custom" },
		{ label: "پیگیری لازم نیست", days: null }
	];

	/** تاریخِ n روز بعد، ساعت ۹ صبحِ محلی. */
	function inDays(n) {
		var d = new Date();
		d.setDate(d.getDate() + n);
		d.setHours(9, 0, 0, 0);
		return d.toISOString();
	}

	/** yyyy-mm-dd از یک input[type=date] به ساعت ۹ صبحِ همان روز. */
	function fromDateInput(v) {
		var parts = String(v || "").split("-");
		if (parts.length !== 3) return "";
		var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 9, 0, 0, 0);
		return isNaN(d.getTime()) ? "" : d.toISOString();
	}

	function closeMenus($except) {
		$(".qa-menu").not($except).removeClass("is-open");
	}

	/**
	 * یک دکمه‌ی کشویی: برچسب، فهرست گزینه‌ها، و آنچه با انتخاب می‌افتد.
	 *
	 * @param {object} opts
	 * @param {string} opts.label برچسبِ اولیه
	 * @param {string} opts.icon کلاس آیکون
	 * @param {Array} opts.items [{label, tone}]
	 * @param {function} opts.onPick (item, api) - api.setLabel و api.markChosen
	 */
	function menuButton(opts) {
		var $box = $('<div class="qa-menu">');
		var $btn = $('<button type="button" class="qa-menu-btn">')
			.append($('<i class="fas ' + opts.icon + ' ml-1">'))
			.append($('<span class="qa-menu-label">').text(opts.label))
			.append($('<i class="fas fa-chevron-down qa-menu-caret">'));
		var $list = $('<div class="qa-menu-list">');

		opts.items.forEach(function (item) {
			$('<button type="button" class="qa-menu-item">')
				.addClass(item.tone ? "tone-" + item.tone : "")
				.text(item.label)
				.on("click", function () {
					$box.removeClass("is-open");
					opts.onPick(item, {
						setLabel: function (text) { $box.find(".qa-menu-label").text(text); },
						markChosen: function () { $btn.addClass("is-chosen"); }
					});
				})
				.appendTo($list);
		});

		$btn.on("click", function (e) {
			e.stopPropagation();
			var willOpen = !$box.hasClass("is-open");
			closeMenus();
			$box.toggleClass("is-open", willOpen);
		});

		return $box.append($btn).append($list);
	}

	/**
	 * نوار را می‌سازد و برمی‌گرداند.
	 *
	 * @param {object} lead لیدی که نوار برایش است
	 * @param {object} opts
	 * @param {function} opts.notify (leadId, ok, text) - نمایش نتیجه
	 * @param {function} opts.refresh بعد از هر تغییرِ موفق روی داده
	 * @param {boolean} opts.compact نسخه‌ی جمع‌وجور (کارتابل)
	 */
	function bar(lead, opts) {
		opts = opts || {};
		// پیش‌فرض، همان توستِ مشترکِ صفحه است.
		//
		// پیش از این هر صفحه پیام را خودش نشان می‌داد و فهرست را دوباره
		// می‌ساخت - که یعنی فیلدِ «دلیل پیگیری» همان لحظه‌ی ظاهر شدن پاک
		// می‌شد. پیام باید بیرونِ چیزی باشد که بازسازی می‌شود.
		var notify = opts.notify || function (leadId, isOk, text) {
			if (isOk) CrmToast.ok(text); else CrmToast.error(text);
		};
		var refresh = opts.refresh || function () {};

		var $bar = $('<div class="quick-bar">');
		if (opts.compact) $bar.addClass("quick-bar-compact");
		else $bar.append($('<div class="quick-bar-title">').text("اقدام سریع"));
		var $row = $('<div class="quick-bar-row">');

		// ۱) نتیجه‌ی تماس
		var pickedResult = null;
		// یادداشتِ تماس، همان‌جا. بدون این، مشاور نتیجه را ثبت می‌کرد ولی
		// «چه گفت» هیچ‌جا نمی‌ماند مگر با باز کردن پرونده - یعنی دقیقاً
		// همان کاری که این نوار قرار بود لازم نکند.
		var $callNote = $('<input type="text" class="quick-note d-none">')
			.attr("placeholder", "چه گفت؟ (اختیاری)");
		var $callConfirm = $('<button type="button" class="btn btn-brand btn-sm quick-confirm d-none">').text("ثبت تماس");
		var $callMenu = menuButton({
			label: "ثبت نتیجه تماس", icon: "fa-phone-volume", items: CALL_RESULTS,
			onPick: function (item, api) {
				pickedResult = item.label;
				api.setLabel(item.label);
				api.markChosen();
				$callNote.removeClass("d-none");
				$callConfirm.removeClass("d-none");
			}
		});
		$callConfirm.on("click", function () {
			if (!pickedResult) return;
			var $b = $(this).prop("disabled", true).text("در حال ثبت…");
			CrmData.recordCall(lead.lead_id, pickedResult, $callNote.val().trim(), "")
				.then(function () { notify(lead.lead_id, true, "نتیجه تماس ثبت شد."); refresh(); })
				.catch(function (err) {
					notify(lead.lead_id, false, "خطا در ثبت تماس: " + (err.message || "خطای نامشخص"));
					$b.prop("disabled", false).text("ثبت تماس");
				});
		});
		$row.append($callMenu).append($callNote).append($callConfirm);

		// ۲) پیام آماده
		var pickedTemplate = null;
		var $sendBtn = $('<button type="button" class="btn btn-navy btn-sm quick-confirm d-none">').text("ارسال");
		var templates = (CrmData.MESSAGE_TEMPLATES || []).map(function (t) {
			return { label: t.label, text: t.text };
		});
		var $msgMenu = menuButton({
			label: "پیام آماده", icon: "fa-paper-plane", items: templates,
			onPick: function (item, api) {
				pickedTemplate = item;
				api.setLabel(item.label);
				api.markChosen();
				$sendBtn.removeClass("d-none");
			}
		});
		$sendBtn.on("click", function () {
			if (!pickedTemplate) return;
			var $b = $(this).prop("disabled", true).text("در حال ارسال…");
			var text = pickedTemplate.text.replace("{نام}", lead.full_name || "");
			CrmData.sendRegistrationMessage(lead.lead_id, text)
				.then(function (res) {
					if (res && res.success === false) throw new Error(res.error || "ارسال ناموفق بود");
					notify(lead.lead_id, true, "پیام ارسال شد.");
				})
				.catch(function (err) {
					notify(lead.lead_id, false, "ارسال نشد: " + (err.message || "خطای نامشخص"));
					$b.prop("disabled", false).text("ارسال");
				});
		});
		$row.append($msgMenu).append($sendBtn);

		// ۳) پیگیری - بدون قدمِ تایید
		//
		// تاریخ همان لحظه‌ی انتخاب ثبت می‌شود؛ «دلیل» بعدش می‌آید و اختیاری
		// است. اگر دلیل را هم شرطِ ثبت می‌کردیم، ساده‌ترین کارِ این نوار -
		// یک کلیک برای «فردا» - سه کلیک می‌شد.
		// کلاسِ خودش را دارد، نه quick-note: هر دو یک‌شکل‌اند ولی یکی
		// یادداشتِ تماس است و دیگری دلیلِ پیگیری، و قاطی شدنشان هم در
		// کد و هم در تست گیج‌کننده است.
		var $reason = $('<input type="text" class="quick-reason d-none">')
			.attr("placeholder", "دلیل پیگیری؟ (اختیاری)")
			.attr("maxlength", "200");
		var $customDate = $('<input type="date" class="quick-date d-none">');

		function saveFollowup(value, label) {
			CrmData.setLeadFollowup(lead.lead_id, value)
				.then(function () {
					notify(lead.lead_id, true, value === "" ? "پیگیری بسته شد." : "پیگیری روی «" + label + "» ثبت شد.");
					if (value === "") {
						$reason.addClass("d-none").val("");
						refresh();
						return;
					}
					// عمداً refresh نمی‌کنیم تا فیلدِ دلیل زیرِ دستِ مشاور
					// بماند. بازسازیِ فهرست، همان لحظه پاکش می‌کرد.
					$reason.removeClass("d-none").focus();
				})
				.catch(function (err) {
					notify(lead.lead_id, false, "خطا در ثبت پیگیری: " + (err.message || "خطای نامشخص"));
				});
		}

		$reason.on("keydown", function (e) {
			if (e.key !== "Enter") return;
			saveReason();
		}).on("blur", function () {
			if ($reason.val().trim()) saveReason();
		});

		function saveReason() {
			var text = $reason.val().trim();
			if (!text) return;
			$reason.prop("disabled", true);
			CrmData.setFollowupReason(lead.lead_id, text)
				.then(function () {
					notify(lead.lead_id, true, "دلیل پیگیری ثبت شد.");
					refresh();
				})
				.catch(function (err) {
					$reason.prop("disabled", false);
					notify(lead.lead_id, false, "دلیل ثبت نشد: " + (err.message || "خطای نامشخص"));
				});
		}

		$customDate.on("change", function () {
			var value = fromDateInput($customDate.val());
			if (!value) return;
			$customDate.addClass("d-none");
			saveFollowup(value, new Date(value).toLocaleDateString("fa-IR"));
		});

		$row.append(menuButton({
			label: "پیگیری", icon: "fa-bell", items: FOLLOWUP_CHOICES,
			onPick: function (item) {
				if (item.days === "custom") {
					$customDate.removeClass("d-none");
					// showPicker در همه‌ی مرورگرها نیست؛ نبودنش یعنی کاربر
					// خودش روی فیلد می‌زند، نه اینکه چیزی خراب شود.
					var el = $customDate[0];
					if (el && typeof el.showPicker === "function") {
						try { el.showPicker(); } catch (e) { /* تعاملِ کاربر لازم بوده */ }
					}
					return;
				}
				saveFollowup(item.days === null ? "" : inDays(item.days), item.label);
			}
		}));
		$row.append($customDate).append($reason);

		$bar.append($row);
		return $bar;
	}

	/**
	 * دکمه‌ی کپیِ شماره.
	 *
	 * tel: فقط روی گوشی کار می‌کند؛ مشاورِ پشتِ دسکتاپ تا امروز شماره را
	 * از روی صفحه می‌خواند و در نرم‌افزارِ تماس تایپ می‌کرد - جایی که یک
	 * رقمِ اشتباه یعنی زنگ زدن به غریبه.
	 */
	function copyPhoneButton(phone) {
		return $('<button type="button" class="quick-copy-btn">')
			.attr("title", "کپی شماره")
			.html('<i class="fas fa-copy"></i>')
			.on("click", function (e) {
				e.stopPropagation();
				var $b = $(this);
				copyText(phone).then(function () {
					$b.addClass("is-done").html('<i class="fas fa-check"></i>');
					CrmToast.ok("شماره کپی شد: " + phone);
					setTimeout(function () {
						$b.removeClass("is-done").html('<i class="fas fa-copy"></i>');
					}, 1600);
				}, function () {
					CrmToast.error("کپی نشد؛ شماره را دستی بردارید.");
				});
			});
	}

	// clipboard.writeText در context ناامن یا بدونِ اجازه رد می‌شود، پس
	// راهِ قدیمیِ textarea+execCommand هم می‌ماند - وگرنه دکمه بی‌صدا هیچ
	// کاری نمی‌کند و کاربر فکر می‌کند کپی شده.
	function copyText(text) {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text);
		}
		return new Promise(function (resolve, reject) {
			var ta = document.createElement("textarea");
			ta.value = text;
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			var okay = false;
			try { okay = document.execCommand("copy"); } catch (err) { okay = false; }
			document.body.removeChild(ta);
			if (okay) resolve(); else reject(new Error("copy failed"));
		});
	}

	// هر کلیکِ بیرون، همه‌ی کشوها را می‌بندد. یک‌بار برای کلِ صفحه بسته
	// می‌شود، نه یک‌بار به ازای هر نوار.
	$(document).on("click", function () { closeMenus(); });

	return {
		bar: bar,
		copyPhoneButton: copyPhoneButton,
		copyText: copyText,
		menuButton: menuButton,
		closeMenus: closeMenus,
		CALL_RESULTS: CALL_RESULTS,
		FOLLOWUP_CHOICES: FOLLOWUP_CHOICES
	};
})(jQuery);
