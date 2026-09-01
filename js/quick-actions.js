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

	// ─── نوارِ فشرده: همان کارها، اندازه‌ی یک ردیف ──────────────────
	//
	// نوارِ bar() برای وقتی است که فضا هست (کشو، کارتابل). این یکی داخلِ
	// خودِ ردیف می‌نشیند، پس سه کارِ اصلی دکمه‌ی مستقیم دارند و بقیه در
	// «⋯» جمع می‌شوند. تفاوت با bar فقط چیدمان نیست: اینجا هر کار در یک
	// popover باز می‌شود که با کلیکِ بیرون بسته می‌شود، چون ردیف جا ندارد
	// فیلد را همیشه نشان بدهد.
	//
	// روی موبایل همین popoverها با CSS به bottom sheet تبدیل می‌شوند -
	// همان مارکاپ، بدون یک نسخه‌ی دوم در جاوااسکریپت.

	function closePops($except) {
		$(".qa-pop").not($except).each(function () {
			if ($(this).hasClass("is-open")) $(this).trigger("qa-pop-closed");
		});
		$(".qa-pop").not($except).removeClass("is-open");
		if (!$(".qa-pop.is-open").length) $("body").removeClass("has-qa-sheet");
	}

	/**
	 * دکمه + popover. محتوای popover با build ساخته می‌شود و تا اولین باز
	 * شدن ساخته نمی‌شود: در فهرستی با ۱۵ ردیف، ساختنِ سه popover برای هر
	 * ردیف یعنی ۴۵ فرمِ نامرئی.
	 */
	function popButton(opts) {
		var $box = $('<div class="qa-pop">').addClass(opts.cls || "");
		var $btn = $('<button type="button" class="qa-act">')
			.addClass(opts.tone ? "tone-" + opts.tone : "")
			.attr("title", opts.title || opts.label)
			.append($('<i class="fas ' + opts.icon + '">'))
			.append($('<span class="qa-act-label">').text(opts.label));
		var $panel = $('<div class="qa-pop-panel">');
		var built = false;

		$btn.on("click", function (e) {
			e.stopPropagation();
			var willOpen = !$box.hasClass("is-open");
			closePops();
			closeMenus();
			if (willOpen && !built) {
				built = true;
				$panel.append($('<div class="qa-pop-title">').text(opts.title || opts.label));
				$panel.append(opts.build(function () { close(); }));
				$panel.append($('<button type="button" class="qa-pop-close" aria-label="بستن">')
					.html('<i class="fas fa-xmark">').on("click", function (ev) {
						ev.stopPropagation(); close();
					}));
			}
			if (willOpen) open(); else close();
			if (willOpen && opts.onOpen) opts.onOpen($panel);
		});

		// روی گوشی، پنل به body منتقل می‌شود.
		//
		// position: fixed نسبت به هر جدِ transform-داری قاب می‌گیرد، نه
		// نسبت به صفحه - و قالبِ پایه روی .bmd-layout-content یک
		// translateX می‌گذارد. نتیجه‌اش این بود که bottom sheet سی پیکسل
		// زیر لبه‌ی نمایشگر می‌افتاد. به‌جای جنگیدن با آن transform (که
		// خودِ چیدمانِ منو به آن وابسته است)، پنل از آن زیرمجموعه بیرون
		// می‌آید. با جابه‌جاییِ گره، شنونده‌های jQuery سرِ جایشان می‌مانند.
		function isSheet() {
			return window.matchMedia("(max-width: 900px)").matches;
		}

		function open() {
			if (isSheet()) $("body").append($panel);
			$box.addClass("is-open");
			$panel.addClass("is-open-panel");
			$("body").toggleClass("has-qa-sheet", isSheet());
		}

		function close() {
			$box.removeClass("is-open");
			$panel.removeClass("is-open-panel");
			if ($panel.parent().is("body")) $box.append($panel);
			$("body").removeClass("has-qa-sheet");
		}

		// بستنِ همگانی (کلیکِ بیرون، Escape) کلاس را از جعبه برمی‌دارد؛
		// پنلِ منتقل‌شده باید خودش بفهمد و برگردد.
		$box.on("qa-pop-closed", close);

		$panel.on("click", function (e) { e.stopPropagation(); });
		return $box.append($btn).append($panel);
	}

	/**
	 * نوارِ اقدامِ ردیف.
	 *
	 * @param {object} lead
	 * @param {object} opts
	 * @param {function} opts.refresh بعد از هر تغییرِ موفق روی داده
	 * @param {Array} opts.consultants [{username, display_name}] برای «تغییر مشاور»
	 */
	function compactBar(lead, opts) {
		opts = opts || {};
		var refresh = opts.refresh || function () {};
		var notify = opts.notify || function (isOk, text) {
			if (isOk) CrmToast.ok(text); else CrmToast.error(text);
		};
		var $bar = $('<div class="qa-bar">');

		// ۱) تماس - بدون هیچ واسطه‌ای. مهم‌ترین کارِ صفحه نباید حتی یک
		// کلیکِ اضافه داشته باشد.
		if (lead.phone) {
			$bar.append($('<a class="qa-act tone-call">')
				.attr({ href: "tel:" + String(lead.phone).replace(/[^\d+]/g, ""), title: "تماس با " + (lead.full_name || "این لید") })
				.append($('<i class="fas fa-phone">'))
				.append($('<span class="qa-act-label">').text("تماس")));
		}

		// ۲) نتیجه‌ی تماس
		$bar.append(popButton({
			label: "نتیجه", icon: "fa-circle-check", title: "نتیجه‌ی تماس چه بود؟", tone: "primary",
			build: function (close) { return callResultForm(lead, notify, refresh, close); }
		}));

		// ۳) پیگیری
		$bar.append(popButton({
			label: "پیگیری", icon: "fa-bell", title: "پیگیری بعدی",
			build: function (close) { return followupForm(lead, notify, refresh, close); }
		}));

		// ۴) بقیه
		$bar.append(popButton({
			label: "", icon: "fa-ellipsis", title: "کارهای دیگر", cls: "qa-pop-more",
			build: function (close) { return moreMenu(lead, opts, notify, refresh, close); }
		}));

		return $bar;
	}

	function callResultForm(lead, notify, refresh, close) {
		var $f = $('<div class="qa-form">');
		var picked = null;
		var $chips = $('<div class="qa-chips">');
		CALL_RESULTS.forEach(function (item) {
			$('<button type="button" class="qa-chip">')
				.addClass(item.tone ? "tone-" + item.tone : "")
				.text(item.label)
				.on("click", function () {
					picked = item.label;
					$chips.find(".qa-chip").removeClass("is-picked");
					$(this).addClass("is-picked");
					$save.prop("disabled", false);
				})
				.appendTo($chips);
		});
		$f.append($chips);

		var $note = $('<input type="text" class="qa-input qa-call-note">').attr({
			placeholder: "چه گفت؟ (اختیاری)", maxlength: "300"
		});
		$f.append($note);

		var $save = $('<button type="button" class="btn btn-brand btn-sm qa-form-save">')
			.text("ثبت تماس").prop("disabled", true)
			.on("click", function () {
				if (!picked) return;
				var $b = $(this).prop("disabled", true).text("در حال ثبت…");
				CrmData.recordCall(lead.lead_id, picked, $note.val().trim(), "")
					.then(function () {
						notify(true, "نتیجه‌ی تماس با «" + (lead.full_name || "لید") + "» ثبت شد.");
						close();
						refresh();
					})
					.catch(function (err) {
						notify(false, "خطا در ثبت تماس: " + (err.message || "خطای نامشخص"));
						$b.prop("disabled", false).text("ثبت تماس");
					});
			});
		$f.append($save);
		return $f;
	}

	function followupForm(lead, notify, refresh, close) {
		var $f = $('<div class="qa-form">');
		var $chips = $('<div class="qa-chips">');
		var $custom = $('<input type="date" class="qa-input qa-date d-none">');
		var $reason = $('<input type="text" class="qa-input qa-reason">')
			.attr({ placeholder: "دلیل پیگیری؟ (اختیاری)", maxlength: "200" })
			.val(lead.followup_reason || "");

		function save(value, label) {
			CrmData.setLeadFollowup(lead.lead_id, value, $reason.val().trim())
				.then(function () {
					notify(true, value === "" ? "پیگیری بسته شد." : "پیگیری روی «" + label + "» ثبت شد.");
					close();
					refresh();
				})
				.catch(function (err) {
					notify(false, "خطا در ثبت پیگیری: " + (err.message || "خطای نامشخص"));
				});
		}

		FOLLOWUP_CHOICES.forEach(function (item) {
			$('<button type="button" class="qa-chip">')
				.addClass(item.days === null ? "tone-quiet" : "")
				.text(item.label)
				.on("click", function () {
					if (item.days === "custom") {
						$chips.find(".qa-chip").removeClass("is-picked");
						$(this).addClass("is-picked");
						$custom.removeClass("d-none").focus();
						return;
					}
					save(item.days === null ? "" : inDays(item.days), item.label);
				})
				.appendTo($chips);
		});
		$custom.on("change", function () {
			var value = fromDateInput($custom.val());
			if (value) save(value, new Date(value).toLocaleDateString("fa-IR"));
		});

		$f.append($chips).append($custom).append($reason);
		return $f;
	}

	/** فهرستِ کارهای کم‌تکرار. هرکدام یا مستقیم انجام می‌شود یا فرمِ خودش را باز می‌کند. */
	function moreMenu(lead, opts, notify, refresh, close) {
		var $m = $('<div class="qa-more">');

		function item(icon, label, handler) {
			return $('<button type="button" class="qa-more-item">')
				.append($('<i class="fas ' + icon + '">'))
				.append($("<span>").text(label))
				.on("click", handler);
		}

		// پیام آماده
		var $msgWrap = $('<div class="qa-sub d-none">');
		(CrmData.MESSAGE_TEMPLATES || []).forEach(function (t) {
			$('<button type="button" class="qa-chip">').text(t.label).on("click", function () {
				var $c = $(this).prop("disabled", true).text("در حال ارسال…");
				CrmData.sendRegistrationMessage(lead.lead_id, t.text.replace("{نام}", lead.full_name || ""))
					.then(function (res) {
						if (res && res.success === false) throw new Error(res.error || "ارسال ناموفق بود");
						notify(true, "پیام ارسال شد.");
						close();
					})
					.catch(function (err) {
						notify(false, "ارسال نشد: " + (err.message || "خطای نامشخص"));
						$c.prop("disabled", false).text(t.label);
					});
			}).appendTo($msgWrap);
		});
		$m.append(item("fa-paper-plane", "ارسال پیام آماده", function () {
			$msgWrap.toggleClass("d-none");
		}));
		$m.append($msgWrap);

		// تغییر وضعیت - دستی، برای اصلاح. وضعیتِ عادی از ثبتِ تماس می‌آید.
		var $statusWrap = $('<div class="qa-sub d-none">');
		CrmData.LEAD_STATUSES.forEach(function (st) {
			$('<button type="button" class="qa-chip">')
				.addClass(st.key === lead.status ? "is-picked" : "")
				.text(st.label)
				.on("click", function () {
					CrmData.updateLeadStatus(lead.lead_id, st.key)
						.then(function () { notify(true, "وضعیت شد «" + st.label + "»."); close(); refresh(); })
						.catch(function (err) { notify(false, "خطا در ثبت وضعیت: " + (err.message || "خطای نامشخص")); });
				}).appendTo($statusWrap);
		});
		$m.append(item("fa-flag", "اصلاح وضعیت", function () { $statusWrap.toggleClass("d-none"); }));
		$m.append($statusWrap);

		// تغییر مشاور
		var list = opts.consultants || [];
		if (list.length) {
			var $asgWrap = $('<div class="qa-sub d-none">');
			[{ username: "", display_name: "بدون مشاور" }].concat(list).forEach(function (c) {
				$('<button type="button" class="qa-chip">')
					.addClass(String(lead.assigned_to || "") === c.username ? "is-picked" : "")
					.text(c.display_name || c.username)
					.on("click", function () {
						CrmData.assignLead(lead.lead_id, c.username)
							.then(function () { notify(true, "مشاور تغییر کرد."); close(); refresh(); })
							.catch(function (err) { notify(false, "خطا در ثبت مشاور: " + (err.message || "خطای نامشخص")); });
					}).appendTo($asgWrap);
			});
			$m.append(item("fa-user-tag", "تغییر مشاور", function () { $asgWrap.toggleClass("d-none"); }));
			$m.append($asgWrap);
		}

		// یادداشت سریع
		var $noteWrap = $('<div class="qa-sub d-none">');
		var $noteText = $('<input type="text" class="qa-input">').attr("placeholder", "یادداشت…");
		$noteWrap.append($noteText);
		$noteWrap.append($('<button type="button" class="btn btn-brand btn-sm qa-form-save">').text("ثبت یادداشت")
			.on("click", function () {
				var text = $noteText.val().trim();
				if (!text) return;
				var $b = $(this).prop("disabled", true).text("در حال ثبت…");
				CrmData.addLeadNote(lead.lead_id, text)
					.then(function () { notify(true, "یادداشت ثبت شد."); close(); refresh(); })
					.catch(function (err) {
						notify(false, "یادداشت ثبت نشد: " + (err.message || "خطای نامشخص"));
						$b.prop("disabled", false).text("ثبت یادداشت");
					});
			}));
		$m.append(item("fa-sticky-note", "یادداشت سریع", function () { $noteWrap.toggleClass("d-none"); }));
		$m.append($noteWrap);

		if (lead.phone) {
			$m.append(item("fa-copy", "کپی شماره", function () {
				copyText(lead.phone).then(function () {
					notify(true, "شماره کپی شد: " + lead.phone);
					close();
				}, function () { notify(false, "کپی نشد؛ شماره را دستی بردارید."); });
			}));
		}

		if (lead.telegram_username) {
			$m.append($('<a class="qa-more-item" target="_blank" rel="noopener">')
				.attr("href", "https://t.me/" + String(lead.telegram_username).replace(/^@/, ""))
				.append($('<i class="fas fa-paper-plane">'))
				.append($("<span>").text("@" + String(lead.telegram_username).replace(/^@/, ""))));
		}

		$m.append($('<a class="qa-more-item">')
			.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
			.append($('<i class="fas fa-folder-open">'))
			.append($("<span>").text("باز کردن پرونده")));

		return $m;
	}

	// هر کلیکِ بیرون، همه‌ی کشوها و popoverها را می‌بندد. یک‌بار برای کلِ
	// صفحه بسته می‌شود، نه یک‌بار به ازای هر نوار.
	$(document).on("click", function () { closeMenus(); closePops(); });
	$(document).on("keydown", function (e) {
		if (e.key === "Escape") { closeMenus(); closePops(); }
	});

	return {
		bar: bar,
		compactBar: compactBar,
		closePops: closePops,
		copyPhoneButton: copyPhoneButton,
		copyText: copyText,
		menuButton: menuButton,
		closeMenus: closeMenus,
		CALL_RESULTS: CALL_RESULTS,
		FOLLOWUP_CHOICES: FOLLOWUP_CHOICES
	};
})(jQuery);
