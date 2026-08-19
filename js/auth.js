(function () {
	"use strict";
	var token = sessionStorage.getItem("crmToken");
	var expiresAt = sessionStorage.getItem("crmTokenExpiresAt");
	var expired = !expiresAt || new Date(expiresAt).getTime() <= Date.now();
	if (!token || expired) {
		sessionStorage.removeItem("crmAuthed");
		sessionStorage.removeItem("crmToken");
		sessionStorage.removeItem("crmTokenExpiresAt");
		window.location.replace("login.html");
	}
})();
