(function () {
	"use strict";
	var token = sessionStorage.getItem("crmToken");
	var expiresAt = sessionStorage.getItem("crmTokenExpiresAt");
	var expired = !expiresAt || new Date(expiresAt).getTime() <= Date.now();
	if (!token || expired) {
		sessionStorage.removeItem("crmAuthed");
		sessionStorage.removeItem("crmToken");
		sessionStorage.removeItem("crmTokenExpiresAt");
		sessionStorage.removeItem("crmDisplayName");
		sessionStorage.removeItem("crmUsername");
		sessionStorage.removeItem("crmRole");
		window.location.replace("login.html");
		return;
	}

	var RESTRICTED_PAGES = ["dashboard.html", "support.html", "content.html", "ai.html", "broadcast.html", "econ-subscribers.html", "admins.html"];
	var role = sessionStorage.getItem("crmRole");
	var currentPage = location.pathname.split("/").pop();

	if (role === "consultant" && RESTRICTED_PAGES.indexOf(currentPage) !== -1) {
		// Direct URL access (not via nav click) to a restricted page: no way to
		// intercept this before load, so silently bounce back instead of letting
		// a page full of 401'ing widgets render.
		window.location.replace("index.html");
		return;
	}

	// منو برای مشاور کوتاه می‌شود، نه اینکه پر از آیتمِ قفل باشد.
	//
	// تا امروز آیتم‌های ممنوع دیده می‌شدند و با کلیک پیامِ «دسترسی ندارید»
	// می‌دادند - یعنی هر روز شش گزینه‌ای که هیچ‌وقت به کارش نمی‌آیند.
	// حالا که تصمیم سمت سرور هم گرفته می‌شود (panelApi.js)، پنهان کردنشان
	// امن است: مسیرِ مستقیم هم بالاتر به index برمی‌گردد.
	//
	// گروهِ خالی‌شده هم می‌رود، وگرنه یک عنوانِ بی‌آیتم می‌ماند.
	if (role === "consultant") {
		document.addEventListener("DOMContentLoaded", function () {
			document.querySelectorAll(".side-item a[href]").forEach(function (link) {
				var href = link.getAttribute("href").split("?")[0].split("#")[0];
				if (RESTRICTED_PAGES.indexOf(href) === -1) return;
				var item = link.closest(".side-item");
				if (item) item.remove();
			});
			document.querySelectorAll(".side-group").forEach(function (group) {
				var next = group.nextElementSibling;
				if (!next || next.classList.contains("side-group")) group.remove();
			});
		});
	}
})();
