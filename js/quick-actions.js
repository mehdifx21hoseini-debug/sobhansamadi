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
		{ label: "پیگیری لازم نیست", days: null }
	];

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
		var notify = opts.notify || function () {};
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
		$row.append(menuButton({
			label: "پیگیری", icon: "fa-bell", items: FOLLOWUP_CHOICES,
			onPick: function (item) {
				var value = "";
				if (item.days !== null) {
					var d = new Date();
					d.setDate(d.getDate() + item.days);
					d.setHours(9, 0, 0, 0);
					value = d.toISOString();
				}
				CrmData.setLeadFollowup(lead.lead_id, value)
					.then(function () {
						notify(lead.lead_id, true, item.days === null ? "پیگیری بسته شد." : "پیگیری روی «" + item.label + "» ثبت شد.");
						refresh();
					})
					.catch(function (err) {
						notify(lead.lead_id, false, "خطا در ثبت پیگیری: " + (err.message || "خطای نامشخص"));
					});
			}
		}));

		$bar.append($row);
		return $bar;
	}

	// هر کلیکِ بیرون، همه‌ی کشوها را می‌بندد. یک‌بار برای کلِ صفحه بسته
	// می‌شود، نه یک‌بار به ازای هر نوار.
	$(document).on("click", function () { closeMenus(); });

	return {
		bar: bar,
		menuButton: menuButton,
		closeMenus: closeMenus,
		CALL_RESULTS: CALL_RESULTS,
		FOLLOWUP_CHOICES: FOLLOWUP_CHOICES
	};
})(jQuery);
