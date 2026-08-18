(function () {
	"use strict";

	function isDark() {
		return document.body.classList.contains("dark");
	}

	function updateToggleUi() {
		var dark = isDark();
		$("#themeToggleLabel").text(dark ? "حالت روشن" : "حالت تاریک");
		$("#themeToggleIcon").removeClass("fa-moon fa-sun").addClass(dark ? "fa-sun" : "fa-moon");
	}

	function setTheme(dark) {
		document.body.classList.toggle("dark", dark);
		localStorage.setItem("crmTheme", dark ? "dark" : "light");
		updateToggleUi();
		$(document).trigger("crm:theme-changed", [dark]);
	}

	$(function () {
		updateToggleUi();
		$("#btnToggleTheme").on("click", function () {
			setTheme(!isDark());
		});

		// defensive: some browsers scroll .avam-container sideways when a
		// dropdown item that doesn't navigate away receives focus
		$(document).on("click", ".dropdown-item", function () {
			setTimeout(function () {
				var container = document.querySelector(".avam-container");
				if (container) container.scrollLeft = 0;
			}, 0);
		});
	});

	window.CrmTheme = { isDark: isDark, setTheme: setTheme };
})();
