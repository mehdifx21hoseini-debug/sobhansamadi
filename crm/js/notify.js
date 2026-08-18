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

	$(function () {
		poll();
		setInterval(poll, POLL_INTERVAL);
	});
})();
