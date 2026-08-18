(function () {
	"use strict";
	if (sessionStorage.getItem("crmAuthed") !== "1") {
		window.location.replace("login.html");
	}
})();
