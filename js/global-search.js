(function () {
	"use strict";

	var leadsCache = null;
	var cacheTime = 0;
	var CACHE_TTL = 30000;
	var debounceTimer = null;

	function getLeads() {
		var now = Date.now();
		if (leadsCache && (now - cacheTime) < CACHE_TTL) {
			return Promise.resolve(leadsCache);
		}
		return CrmData.fetchLeads().then(function (leads) {
			leadsCache = leads;
			cacheTime = Date.now();
			return leads;
		});
	}

	function renderResults(leads, query) {
		var $box = $("#globalSearchResults").empty();
		var matches = leads.filter(function (l) {
			return (l.full_name || "").indexOf(query) !== -1 || (l.phone || "").indexOf(query) !== -1;
		}).slice(0, 6);

		if (matches.length === 0) {
			$box.append('<div class="global-search-empty">موردی یافت نشد.</div>');
		} else {
			matches.forEach(function (lead) {
				var $item = $("<a>")
					.addClass("global-search-item")
					.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
					.append($("<span>").text(lead.full_name || "(بدون نام)"))
					.append($("<span>").attr("dir", "ltr").addClass("mono text-muted").text(lead.phone || ""));
				$box.append($item);
			});
		}
		$box.removeClass("d-none");
	}

	$(function () {
		var $input = $("#globalSearchInput");
		if (!$input.length) return;

		$input.on("input", function () {
			var q = $(this).val().trim();
			clearTimeout(debounceTimer);
			if (!q) {
				$("#globalSearchResults").addClass("d-none").empty();
				return;
			}
			debounceTimer = setTimeout(function () {
				getLeads().then(function (leads) { renderResults(leads, q); });
			}, 200);
		});

		$input.on("focus", function () {
			if ($(this).val().trim() && $("#globalSearchResults").children().length) {
				$("#globalSearchResults").removeClass("d-none");
			}
		});

		$(document).on("click", function (e) {
			if (!$(e.target).closest("#globalSearch").length) {
				$("#globalSearchResults").addClass("d-none");
			}
		});
	});
})();
