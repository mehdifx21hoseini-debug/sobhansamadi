(function () {
	"use strict";

	// دو پوسته کنار هم زندگی می‌کنند: «تیل» (طراحی فعلی، پیش‌فرض) و «امبر»
	// (زغالی + نارنجی، برگرفته از ویوآی). امبر فقط یک لایه‌ی روکش روی همان
	// CSS است، پس هر دو پوسته دقیقاً همان امکانات را دارند - هیچ صفحه‌ای
	// دوباره نوشته نشده و هیچ قابلیتی مخصوص یکی نیست.
	//
	// انتخاب پوسته جدا از انتخاب روشن/تاریک ذخیره می‌شود، پس چهار ترکیب
	// ممکن است و هرکدام مستقل یادش می‌ماند.
	var KEY = "crmSkin";
	var EMBER = "ember";

	function current() {
		return document.documentElement.getAttribute("data-skin") === EMBER ? EMBER : "teal";
	}

	function updateToggleUi() {
		var ember = current() === EMBER;
		$("#skinToggleLabel").text(ember ? "طرح فیروزه‌ای" : "طرح نارنجی");
		$("#skinToggleIcon")
			.removeClass("fa-fire fa-droplet fa-tint")
			.addClass(ember ? "fa-tint" : "fa-fire");
	}

	function setSkin(skin) {
		var ember = skin === EMBER;
		if (ember) {
			document.documentElement.setAttribute("data-skin", EMBER);
		} else {
			document.documentElement.removeAttribute("data-skin");
		}
		try {
			localStorage.setItem(KEY, ember ? EMBER : "teal");
		} catch (e) {
			// حالت ناشناس یا مسدود بودن ذخیره‌سازی: پوسته برای همین صفحه
			// عوض می‌شود ولی یادش نمی‌ماند. این بهتر از خطا دادن است.
		}
		updateToggleUi();
		$(document).trigger("crm:skin-changed", [ember ? EMBER : "teal"]);
	}

	$(function () {
		updateToggleUi();
		$("#btnToggleSkin").on("click", function () {
			setSkin(current() === EMBER ? "teal" : EMBER);
		});
	});

	window.CrmSkin = { current: current, setSkin: setSkin };
})();
