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
		sessionStorage.setItem("crmAccessDeniedNotice", "1");
		window.location.replace("index.html");
		return;
	}

	if (sessionStorage.getItem("crmAccessDeniedNotice") === "1") {
		sessionStorage.removeItem("crmAccessDeniedNotice");
		document.addEventListener("DOMContentLoaded", function () {
			alert("شما به این بخش دسترسی ندارید.");
		});
	}
})();
