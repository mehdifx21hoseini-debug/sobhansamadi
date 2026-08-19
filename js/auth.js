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

	if (role === "consultant") {
		document.addEventListener("DOMContentLoaded", function () {
			document.querySelectorAll(".side-item a[href]").forEach(function (link) {
				var href = link.getAttribute("href").split("?")[0].split("#")[0];
				if (RESTRICTED_PAGES.indexOf(href) === -1) return;
				link.addEventListener("click", function (e) {
					e.preventDefault();
					showAccessDeniedToast();
				});
			});
		});
	}

	function showAccessDeniedToast() {
		var existing = document.querySelector(".access-denied-toast");
		if (existing) existing.remove();
		var toast = document.createElement("div");
		toast.className = "new-lead-toast access-denied-toast";
		toast.innerHTML = '<i class="fas fa-lock mr-2"></i><span>شما به این بخش دسترسی ندارید.</span>';
		document.body.appendChild(toast);
		setTimeout(function () {
			toast.classList.add("hide");
			setTimeout(function () { toast.remove(); }, 400);
		}, 3000);
	}
})();
