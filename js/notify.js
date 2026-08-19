(function () {
	"use strict";

	var POLL_INTERVAL = 45000;
	var SEEN_KEY = "crmSeenLeadIds";
	var seeded = false;

	function getSeen() {
		try {
			return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
		} catch (e) {
			return new Set();
		}
	}

	function saveSeen(set) {
		localStorage.setItem(SEEN_KEY, JSON.stringify(Array.from(set)));
	}

	function showToast(count) {
		var text = count === 1 ? "یک لید جدید ثبت شد" : count + " لید جدید ثبت شد";
		var $toast = $('<div class="new-lead-toast">');
		$toast.append($('<i class="fas fa-bell mr-2">'));
		$toast.append($('<span>').text(text));
		$toast.append($('<a href="index.html" class="btn btn-sm btn-brand mr-2">').text("مشاهده"));
		$("body").append($toast);
		setTimeout(function () {
			$toast.addClass("hide");
			setTimeout(function () { $toast.remove(); }, 400);
		}, 8000);
	}

	function poll() {
		if (typeof CrmData === "undefined") return;
		CrmData.fetchLeads().then(function (leads) {
			var currentIds = leads.map(function (l) { return l.lead_id; });
			var seen = getSeen();

			if (!seeded) {
				currentIds.forEach(function (id) { seen.add(id); });
				saveSeen(seen);
				seeded = true;
				return;
			}

			var newOnes = currentIds.filter(function (id) { return !seen.has(id); });
			currentIds.forEach(function (id) { seen.add(id); });
			saveSeen(seen);

			if (newOnes.length > 0) {
				showToast(newOnes.length);
			}
		}).catch(function () { });
	}

	var TICKET_SEEN_KEY = "crmSeenTicketIds";
	var ticketSeeded = false;

	function getSeenTickets() {
		try {
			return new Set(JSON.parse(localStorage.getItem(TICKET_SEEN_KEY) || "[]"));
		} catch (e) {
			return new Set();
		}
	}

	function saveSeenTickets(set) {
		localStorage.setItem(TICKET_SEEN_KEY, JSON.stringify(Array.from(set)));
	}

	function showTicketToast(count) {
		var text = count === 1 ? "یک ارجاع پشتیبانی جدید" : count + " ارجاع پشتیبانی جدید";
		var $toast = $('<div class="new-lead-toast">');
		$toast.append($('<i class="fas fa-headset mr-2">'));
		$toast.append($('<span>').text(text));
		$toast.append($('<a href="support.html" class="btn btn-sm btn-brand mr-2">').text("مشاهده"));
		$("body").append($toast);
		setTimeout(function () {
			$toast.addClass("hide");
			setTimeout(function () { $toast.remove(); }, 400);
		}, 8000);
	}

	function updateSupportBadge(tickets) {
		var openCount = tickets.filter(function (t) { return t.status === "باز"; }).length;
		var $badge = $("#supportOpenCount");
		if (openCount > 0) {
			$badge.text(openCount).removeClass("d-none");
		} else {
			$badge.addClass("d-none");
		}
	}

	function pollTickets() {
		if (sessionStorage.getItem("crmRole") === "consultant") return;
		if (typeof CrmData === "undefined" || typeof CrmData.fetchSupportTickets !== "function") return;
		CrmData.fetchSupportTickets(true).then(function (tickets) {
			updateSupportBadge(tickets);

			var currentIds = tickets.map(function (t) { return t.ticket_id; });
			var seen = getSeenTickets();

			if (!ticketSeeded) {
				currentIds.forEach(function (id) { seen.add(id); });
				saveSeenTickets(seen);
				ticketSeeded = true;
				return;
			}

			var newOnes = currentIds.filter(function (id) { return !seen.has(id); });
			currentIds.forEach(function (id) { seen.add(id); });
			saveSeenTickets(seen);

			if (newOnes.length > 0) {
				showTicketToast(newOnes.length);
			}
		}).catch(function () { });
	}

	$(function () {
		poll();
		pollTickets();
		setInterval(poll, POLL_INTERVAL);
		setInterval(pollTickets, POLL_INTERVAL);
	});
})();
