(function (global) {
	"use strict";

	var API_BASE = "https://96825.7host.cloud/webhook";

	var REGISTRATION_MESSAGE_TEMPLATE = "سلام {نام} عزیز، وقت بخیر 🌷\nممنون از تماسی که داشتیم.\nشرایط ثبت‌نام مجموعه آموزشی به شرح زیره:\n\n📌 مدت دوره: ۳ ماه\n📌 نحوه برگزاری: آنلاین + پشتیبانی گروهی\n📌 امکان پرداخت اقساطی\n\nبرای ثبت‌نام نهایی از لینک زیر استفاده کنید:\nacademy.example.com/register\n\nهر سوالی داشتید در خدمتتون هستیم 🙏";

	function request(path, options) {
		options = options || {};
		var token = sessionStorage.getItem("crmToken");
		options.headers = Object.assign({}, options.headers, token ? { "Authorization": "Bearer " + token } : {});
		return fetch(API_BASE + path, options).then(function (res) {
			if (res.status === 401) {
				sessionStorage.removeItem("crmAuthed");
				sessionStorage.removeItem("crmToken");
				sessionStorage.removeItem("crmTokenExpiresAt");
				sessionStorage.removeItem("crmDisplayName");
				sessionStorage.removeItem("crmUsername");
				window.location.href = "login.html";
				throw new Error("نشست منقضی شده است، لطفاً دوباره وارد شوید.");
			}
			if (!res.ok) {
				return res.json().catch(function () { return null; }).then(function (body) {
					throw new Error((body && body.error) || ("درخواست ناموفق بود (" + res.status + ")"));
				});
			}
			return res.json();
		});
	}

	var LEADS_CACHE_TTL = 5000;
	var leadsCache = null;
	var leadsCacheTime = 0;
	var leadsInFlight = null;

	function fetchLeads() {
		var now = Date.now();
		if (leadsCache && (now - leadsCacheTime) < LEADS_CACHE_TTL) {
			return Promise.resolve(leadsCache);
		}
		if (leadsInFlight) {
			return leadsInFlight;
		}
		leadsInFlight = request("/crm/leads", { method: "GET" }).then(function (leads) {
			leadsCache = leads;
			leadsCacheTime = Date.now();
			leadsInFlight = null;
			return leads;
		}).catch(function (err) {
			leadsInFlight = null;
			throw err;
		});
		return leadsInFlight;
	}

	function fetchLead(leadId) {
		return request("/crm/lead?id=" + encodeURIComponent(leadId), { method: "GET" });
	}

	function updateLeadStatus(leadId, status) {
		return request("/crm/lead/status", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, status: status })
		});
	}

	function addLeadNote(leadId, note) {
		return request("/crm/lead/note", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, note: note })
		});
	}

	function sendRegistrationMessage(leadId, message) {
		return request("/crm/lead/send-message", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, message: message })
		});
	}

	function setLeadReminder(leadId, reminderDate) {
		return request("/crm/lead/reminder", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, reminder_date: reminderDate || "" })
		});
	}

	function fetchLeadActivity(leadId) {
		return request("/crm/lead/activity?id=" + encodeURIComponent(leadId), { method: "GET" });
	}

	function fetchSupportTickets() {
		return request("/crm/support-tickets", { method: "GET" });
	}

	function fetchSupportTicket(ticketId) {
		return request("/crm/support-ticket?id=" + encodeURIComponent(ticketId), { method: "GET" });
	}

	function replySupportTicket(ticketId, message) {
		return request("/crm/support-ticket/reply", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ticket_id: ticketId, message: message })
		});
	}

	function setSupportTicketStatus(ticketId, status) {
		return request("/crm/support-ticket/status", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ticket_id: ticketId, status: status })
		});
	}

	function changePassword(currentPassword, newPassword) {
		return request("/crm/auth/change-password", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
		});
	}

	function updateDisplayName(displayName) {
		return request("/crm/auth/update-name", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ display_name: displayName })
		});
	}

	function updateUsername(newUsername, currentPassword) {
		return request("/crm/auth/update-username", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ new_username: newUsername, current_password: currentPassword })
		});
	}

	// "YYYY-MM-DD" is parsed as UTC midnight by `new Date(str)`, which shifts
	// to the previous local day for any timezone behind UTC. Parse the parts
	// and build a local-midnight Date instead.
	function parseLocalDate(dateOnlyStr) {
		var parts = String(dateOnlyStr).split("-");
		return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
	}

	global.CrmData = {
		fetchLeads: fetchLeads,
		fetchLead: fetchLead,
		updateLeadStatus: updateLeadStatus,
		addLeadNote: addLeadNote,
		sendRegistrationMessage: sendRegistrationMessage,
		setLeadReminder: setLeadReminder,
		fetchLeadActivity: fetchLeadActivity,
		fetchSupportTickets: fetchSupportTickets,
		fetchSupportTicket: fetchSupportTicket,
		replySupportTicket: replySupportTicket,
		setSupportTicketStatus: setSupportTicketStatus,
		changePassword: changePassword,
		updateDisplayName: updateDisplayName,
		updateUsername: updateUsername,
		parseLocalDate: parseLocalDate,
		REGISTRATION_MESSAGE_TEMPLATE: REGISTRATION_MESSAGE_TEMPLATE
	};
})(window);
