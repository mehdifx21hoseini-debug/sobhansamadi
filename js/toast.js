/**
 * پیام‌های کوتاه و پرسش‌های تایید، به‌جای alert() و confirm() مرورگر.
 *
 * چیزی که جای‌گزین می‌شود: پنجره‌ی مسدودکننده‌ی مرورگر - چپ‌چین،
 * انگلیسی‌قالب، بدونِ هویتِ محصول، و کاربر تا نزند «باشه» هیچ کاری
 * نمی‌تواند بکند. برای گفتنِ «ذخیره شد» این خیلی زیاد است.
 *
 * سه چیز اینجاست:
 *
 *   CrmToast.ok / .error / .info  — پیامِ گذرا، بدون مسدود کردن
 *   CrmToast.undo                 — کارِ برگشت‌پذیر: انجام شد + «بازگرداندن»
 *   CrmToast.confirm              — فقط برای کارِ برگشت‌ناپذیر
 *
 * قاعده‌ی انتخاب: اگر بشود کار را برگرداند، نپرس - انجام بده و راهِ
 * برگشت را نشان بده. تاییدِ قبلی، جلوی اشتباه را نمی‌گیرد؛ فقط یک کلیک
 * به هر بارِ درست هم اضافه می‌کند.
 */
var CrmToast = (function ($) {
	"use strict";

	var DEFAULT_MS = 5000;
	var UNDO_MS = 8000;

	function stack() {
		var el = document.getElementById("crmToastStack");
		if (!el) {
			el = document.createElement("div");
			el.id = "crmToastStack";
			el.className = "crm-toast-stack";
			document.body.appendChild(el);
		}
		return el;
	}

	function show(text, opts) {
		opts = opts || {};
		var $t = $('<div class="crm-toast" role="status">').addClass("tone-" + (opts.tone || "info"));
		var icon = opts.tone === "ok" ? "fa-circle-check"
			: opts.tone === "bad" ? "fa-circle-exclamation" : "fa-circle-info";
		$t.append($('<i class="fas ' + icon + ' crm-toast-icon">'));
		$t.append($('<span class="crm-toast-text">').text(text));

		var timer = null;
		function close() {
			clearTimeout(timer);
			$t.addClass("is-leaving");
			setTimeout(function () { $t.remove(); }, 220);
		}

		if (typeof opts.undo === "function") {
			$t.append($('<button type="button" class="crm-toast-undo">')
				.text(opts.undoLabel || "بازگرداندن")
				.on("click", function () { close(); opts.undo(); }));
		}
		$t.append($('<button type="button" class="crm-toast-close" aria-label="بستن">')
			.append($('<i class="fas fa-xmark">'))
			.on("click", close));

		$(stack()).append($t);
		timer = setTimeout(close, opts.ms || (opts.undo ? UNDO_MS : DEFAULT_MS));
		return { close: close };
	}

	/**
	 * کارِ برگشت‌پذیر: خودش انجام شده، اینجا فقط گفته می‌شود - با راهِ
	 * برگشت. پنجره‌ی «مطمئنی؟» قبلش لازم نیست.
	 */
	function undo(text, undoFn) {
		return show(text, { tone: "ok", undo: undoFn });
	}

	/**
	 * تاییدِ کارِ برگشت‌ناپذیر. Promise<boolean> برمی‌گرداند و - برخلاف
	 * confirm - رشته‌ی جاوااسکریپت را متوقف نمی‌کند.
	 */
	function confirmDialog(text, opts) {
		opts = opts || {};
		return new Promise(function (resolve) {
			var $back = $('<div class="crm-modal-back">');
			var $box = $('<div class="crm-modal" role="dialog" aria-modal="true">');
			$box.append($('<div class="crm-modal-title">').text(opts.title || "تایید می‌کنید؟"));
			$box.append($('<div class="crm-modal-body">').text(text));

			var $actions = $('<div class="crm-modal-actions">');
			var $no = $('<button type="button" class="btn btn-outline-secondary btn-sm">')
				.text(opts.cancelLabel || "انصراف");
			var $yes = $('<button type="button" class="btn btn-sm">')
				.addClass(opts.danger ? "btn-danger" : "btn-brand")
				.text(opts.confirmLabel || "تایید");
			// دکمه‌ی اصلی اول می‌آید تا در RTL سمتِ راست بنشیند - همان‌جا که
			// چشم اول نگاه می‌کند.
			$actions.append($yes).append($no);
			$box.append($actions);
			$back.append($box);
			$(document.body).append($back);
			$yes.focus();

			function done(answer) {
				$back.remove();
				$(document).off("keydown.crmModal");
				resolve(answer);
			}
			$yes.on("click", function () { done(true); });
			$no.on("click", function () { done(false); });
			$back.on("click", function (e) { if (e.target === $back[0]) done(false); });
			$(document).on("keydown.crmModal", function (e) {
				if (e.key === "Escape") done(false);
			});
		});
	}

	return {
		show: show,
		ok: function (text, opts) { return show(text, $.extend({ tone: "ok" }, opts)); },
		error: function (text, opts) { return show(text, $.extend({ tone: "bad" }, opts)); },
		info: function (text, opts) { return show(text, $.extend({ tone: "info" }, opts)); },
		undo: undo,
		confirm: confirmDialog
	};
})(jQuery);
