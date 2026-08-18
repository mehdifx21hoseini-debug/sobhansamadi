(function (global) {
	"use strict";

	var API_BASE = "https://96825.7host.cloud/webhook";

	var REGISTRATION_MESSAGE_TEMPLATE = "سلام {نام} عزیز، وقت بخیر 🌷\nممنون از تماسی که داشتیم.\nشرایط ثبت‌نام مجموعه آموزشی به شرح زیره:\n\n📌 مدت دوره: ۳ ماه\n📌 نحوه برگزاری: آنلاین + پشتیبانی گروهی\n📌 امکان پرداخت اقساطی\n\nبرای ثبت‌نام نهایی از لینک زیر استفاده کنید:\nacademy.example.com/register\n\nهر سوالی داشتید در خدمتتون هستیم 🙏";

	function request(path, options) {
		return fetch(API_BASE + path, options).then(function (res) {
			if (!res.ok) {
				throw new Error("درخواست ناموفق بود (" + res.status + ")");
			}
			return res.json();
		});
	}

	function fetchLeads() {
		return request("/crm/leads", { method: "GET" });
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

	global.CrmData = {
		fetchLeads: fetchLeads,
		fetchLead: fetchLead,
		updateLeadStatus: updateLeadStatus,
		addLeadNote: addLeadNote,
		sendRegistrationMessage: sendRegistrationMessage,
		setLeadReminder: setLeadReminder,
		REGISTRATION_MESSAGE_TEMPLATE: REGISTRATION_MESSAGE_TEMPLATE
	};
})(window);
