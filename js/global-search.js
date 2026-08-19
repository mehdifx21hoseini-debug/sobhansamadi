(function () {
	"use strict";

	var leadsCache = null;
	var leadsCacheTime = 0;
	var ticketsCache = null;
	var ticketsCacheTime = 0;
	var CACHE_TTL = 30000;
	var debounceTimer = null;

	function getLeads() {
		var now = Date.now();
		if (leadsCache && (now - leadsCacheTime) < CACHE_TTL) {
			return Promise.resolve(leadsCache);
		}
		return CrmData.fetchLeads().then(function (leads) {
			leadsCache = leads;
			leadsCacheTime = Date.now();
			return leads;
		});
	}

	function getTickets() {
		if (sessionStorage.getItem("crmRole") === "consultant") return Promise.resolve([]);
		if (typeof CrmData.fetchSupportTickets !== "function") return Promise.resolve([]);
		var now = Date.now();
		if (ticketsCache && (now - ticketsCacheTime) < CACHE_TTL) {
			return Promise.resolve(ticketsCache);
		}
		return CrmData.fetchSupportTickets().then(function (tickets) {
			ticketsCache = tickets;
			ticketsCacheTime = Date.now();
			return tickets;
		}).catch(function () { return []; });
	}

	function ticketName(t) {
		var name = ((t.first_name || "") + " " + (t.last_name || "")).trim();
		return name || (t.telegram_username ? "@" + t.telegram_username : t.telegram_user_id);
	}

	function renderResults(leads, tickets, query) {
		var $box = $("#globalSearchResults").empty();
		var leadMatches = leads.filter(function (l) {
			return (l.full_name || "").indexOf(query) !== -1 || (l.phone || "").indexOf(query) !== -1;
		}).slice(0, 5);

		var ticketMatches = tickets.filter(function (t) {
			return ticketName(t).indexOf(query) !== -1 ||
				(t.telegram_username || "").indexOf(query) !== -1 ||
				(t.telegram_user_id || "").indexOf(query) !== -1 ||
				(t.message || "").indexOf(query) !== -1;
		}).slice(0, 5);

		if (leadMatches.length === 0 && ticketMatches.length === 0) {
			$box.append('<div class="global-search-empty">موردی یافت نشد.</div>');
		} else {
			leadMatches.forEach(function (lead) {
				var $item = $("<a>")
					.addClass("global-search-item")
					.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
					.append($("<span>").append($('<i class="fas fa-user text-muted mr-1">'), document.createTextNode(lead.full_name || "(بدون نام)")))
					.append($("<span>").attr("dir", "ltr").addClass("mono text-muted").text(lead.phone || ""));
				$box.append($item);
			});
			ticketMatches.forEach(function (t) {
				var $item = $("<a>")
					.addClass("global-search-item")
					.attr("href", "support.html?open=" + encodeURIComponent(t.ticket_id))
					.append($("<span>").append($('<i class="fas fa-headset text-muted mr-1">'), document.createTextNode(ticketName(t))))
					.append($("<span>").addClass("text-muted").text(t.status || ""));
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
				Promise.all([getLeads(), getTickets()]).then(function (res) {
					renderResults(res[0], res[1], q);
				});
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
