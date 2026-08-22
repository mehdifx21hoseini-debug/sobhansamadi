(function (global) {
	"use strict";

	var API_BASE = "https://96825.7host.cloud/webhook";

	var REGISTRATION_MESSAGE_TEMPLATE = "سلام {نام} عزیز، وقت بخیر 🌷\nممنون از تماسی که داشتیم.\nشرایط ثبت‌نام مجموعه آموزشی به شرح زیره:\n\n📌 مدت دوره: ۳ ماه\n📌 نحوه برگزاری: آنلاین + پشتیبانی گروهی\n📌 امکان پرداخت اقساطی\n\nبرای ثبت‌نام نهایی از لینک زیر استفاده کنید:\nacademy.example.com/register\n\nهر سوالی داشتید در خدمتتون هستیم 🙏";

	var MESSAGE_TEMPLATES = [
		{ id: "registration", label: "شرایط ثبت‌نام", text: REGISTRATION_MESSAGE_TEMPLATE },
		{ id: "followup", label: "یادآوری پیگیری", text: "سلام {نام} عزیز، وقت بخیر 🌷\nخواستم پیگیری کنم که به نتیجه‌ای رسیدید یا نه.\nهر سوالی داشتید در خدمتتون هستم 🙏" },
		{ id: "thanks_call", label: "تشکر بعد از تماس", text: "سلام {نام} عزیز 🌷\nاز وقتی که برای تماس گذاشتید ممنونم.\nاگه سوال دیگه‌ای داشتید در خدمتتون هستم 🙏" },
		{ id: "no_answer", label: "عدم پاسخ‌گویی", text: "سلام {نام} عزیز 🌷\nچند بار تماس گرفتم ولی متاسفانه پاسخ ندادید.\nهر زمان که وقت داشتید یه پیام بدید تا باهم هماهنگ کنیم 🙏" },
		{ id: "more_info", label: "اطلاعات بیشتر دوره", text: "سلام {نام} عزیز، وقت بخیر 🌷\nاطلاعات کامل‌تر دوره رو براتون می‌فرستم:\n\n📌 سرفصل‌ها و نحوه‌ی برگزاری\n📌 امکان مشاوره‌ی رایگان قبل از ثبت‌نام\n\nهر سوالی داشتید در خدمتتون هستم 🙏" },
		{ id: "special_offer", label: "پیشنهاد ویژه", text: "سلام {نام} عزیز 🌷\nیه پیشنهاد ویژه براتون در نظر گرفتیم که محدود به زمانه.\nاگه مایل بودید بیشتر توضیح بدم 🙏" }
	];

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

	var TICKETS_CACHE_TTL = 5000;
	var ticketsCache = null;
	var ticketsCacheTime = 0;
	var ticketsInFlight = null;

	function fetchSupportTickets(force) {
		var now = Date.now();
		if (!force && ticketsCache && (now - ticketsCacheTime) < TICKETS_CACHE_TTL) {
			return Promise.resolve(ticketsCache);
		}
		if (!force && ticketsInFlight) {
			return ticketsInFlight;
		}
		ticketsInFlight = request("/crm/support-tickets", { method: "GET" }).then(function (tickets) {
			ticketsCache = tickets;
			ticketsCacheTime = Date.now();
			ticketsInFlight = null;
			return tickets;
		}).catch(function (err) {
			ticketsInFlight = null;
			throw err;
		});
		return ticketsInFlight;
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

	function fetchAdminDashboard(range) {
		return request("/crm/admin-dashboard?range=" + encodeURIComponent(range || "ALL"), { method: "GET" });
	}

	function fetchErrors() {
		return request("/crm/errors", { method: "GET" });
	}

	function resolveError(logId) {
		return request("/crm/error/resolve", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ log_id: logId })
		});
	}

	function fetchContentTexts() {
		return request("/crm/content-texts", { method: "GET" });
	}

	function saveContentText(payload) {
		return request("/crm/content-text/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	function fetchContentFiles() {
		return request("/crm/content-files", { method: "GET" });
	}

	function saveContentFile(payload) {
		return request("/crm/content-file/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	function sendBroadcast(message, audience) {
		return request("/crm/broadcast", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: message, audience: audience })
		});
	}

	function fetchEconSubscribers() {
		return request("/crm/econ-subscribers", { method: "GET" });
	}

	function unsubscribeEconSubscriber(telegramUserId) {
		return request("/crm/econ-subscriber/unsubscribe", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ telegram_user_id: telegramUserId })
		});
	}

	function fetchAdmins() {
		return request("/crm/admins", { method: "GET" });
	}

	function saveAdmin(payload) {
		return request("/crm/admin/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	function fetchBroadcasts() {
		return request("/crm/broadcasts", { method: "GET" });
	}

	function deleteBroadcast(batchId) {
		return request("/crm/broadcast/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ batch_id: batchId })
		});
	}

	function fetchAiOverview() {
		return request("/crm/ai-overview", { method: "GET" });
	}

	function fetchAiKnowledge() {
		return request("/crm/ai-knowledge", { method: "GET" });
	}

	function saveAiKnowledge(payload) {
		return request("/crm/ai-knowledge/save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	function deleteAiKnowledge(id) {
		return request("/crm/ai-knowledge/delete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: id })
		});
	}

	function bulkSaveAiKnowledge(entries) {
		return request("/crm/ai-knowledge/bulk-save", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ entries: entries })
		});
	}

	function suggestAiKnowledge(rawText) {
		return request("/crm/ai/kb-suggest", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ raw_text: rawText })
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

	function recordCall(leadId, result, note, nextStep) {
		return request("/crm/calls", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, result: result, note: note || "", next_step: nextStep || "" })
		});
	}

	function assignLead(leadId, assignedTo) {
		return request("/crm/lead/assign", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, assigned_to: assignedTo })
		});
	}

	function fetchFollowupsToday() {
		return request("/crm/followups/today", { method: "GET" });
	}

	function fetchSalesKpi() {
		return request("/crm/dashboard/sales-kpi", { method: "GET" });
	}

	function fetchConsultants() {
		return request("/crm/consultants", { method: "GET" });
	}

	function fetchProducts() {
		return request("/crm/products", { method: "GET" });
	}

	function fetchConsultantPerformance() {
		return request("/crm/dashboard/consultant-performance", { method: "GET" });
	}

	function fetchSalesFunnel() {
		return request("/crm/dashboard/funnel", { method: "GET" });
	}

	function fetchSourcePerformance() {
		return request("/crm/dashboard/source-performance", { method: "GET" });
	}

	function updateProductPrice(productId, price) {
		return request("/crm/product/price", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ product_id: productId, price: price })
		});
	}

	function updateAvatar(dataUri) {
		return request("/crm/auth/update-avatar", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ avatar: dataUri })
		});
	}

	// "YYYY-MM-DD" is parsed as UTC midnight by `new Date(str)`, which shifts
	// to the previous local day for any timezone behind UTC. Parse the parts
	// and build a local-midnight Date instead.
	function parseLocalDate(dateOnlyStr) {
		var parts = String(dateOnlyStr).split("-");
		return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
	}

	// Single source of truth for the at-risk rule. Every page that shows the
	// badge or counts at-risk leads calls this, so the thresholds can never
	// drift apart between the list, the dashboard and the lead detail page.
	// These are counted in working hours, not calendar hours — see
	// workingHoursBetween below, which skips Fridays.
	var AT_RISK_UNCONTACTED_HOURS = 48;
	var AT_RISK_FOLLOWUP_OVERDUE_HOURS = 24;
	var AT_RISK_NO_FOLLOWUP_HOURS = 24 * 7;

	// Fridays do not count toward the thresholds — nobody is on the phones, so
	// a lead that arrives Thursday evening should not be "at risk" on Saturday
	// morning. Walks day boundaries in the browser's local timezone and only
	// adds the hours that fell on a working day.
	var FRIDAY = 5;
	var WORKING_HOURS_MAX_DAYS = 400;

	function workingHoursBetween(startMs, endMs) {
		if (endMs <= startMs) return 0;
		var total = 0;
		var cursor = new Date(startMs);
		var guard = 0;
		while (cursor.getTime() < endMs && guard++ < WORKING_HOURS_MAX_DAYS) {
			var nextMidnight = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
			var segmentEnd = Math.min(nextMidnight.getTime(), endMs);
			if (cursor.getDay() !== FRIDAY) {
				total += (segmentEnd - cursor.getTime()) / 3600000;
			}
			cursor = new Date(segmentEnd);
		}
		return total;
	}

	function hoursSince(value) {
		if (!value) return null;
		// reminder_date is a date-only string, which `new Date` reads as UTC
		// midnight and so lands on the wrong local day for any timezone behind
		// UTC. Route those through the local-midnight parser.
		var d = /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())
			? parseLocalDate(String(value).trim())
			: new Date(value);
		var t = d.getTime();
		if (isNaN(t)) return null;
		return workingHoursBetween(t, Date.now());
	}

	function isAtRisk(lead) {
		if (!lead) return false;

		// Never contacted and sitting there for too long.
		if (lead.status === "پاسخ‌داده‌نشده") {
			var sinceCreated = hoursSince(lead.created_at);
			if (sinceCreated !== null && sinceCreated >= AT_RISK_UNCONTACTED_HOURS) return true;
		}

		// A follow-up was promised and the date has passed. The list endpoint
		// used to expose only reminder_date, so accept either field name.
		var followUp = lead.next_followup_at || lead.reminder_date;
		if (followUp) {
			var overdue = hoursSince(followUp);
			if (overdue !== null && overdue >= AT_RISK_FOLLOWUP_OVERDUE_HOURS) return true;
			return false;
		}

		// No follow-up ever scheduled: an open lead can otherwise go stale
		// forever without ever being flagged.
		if (lead.status !== "تماس گرفته شد") {
			var untouched = hoursSince(lead.updated_at || lead.created_at);
			if (untouched !== null && untouched >= AT_RISK_NO_FOLLOWUP_HOURS) return true;
		}

		return false;
	}

	global.CrmData = {
		isAtRisk: isAtRisk,
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
		fetchAdminDashboard: fetchAdminDashboard,
		fetchErrors: fetchErrors,
		resolveError: resolveError,
		fetchContentTexts: fetchContentTexts,
		saveContentText: saveContentText,
		fetchContentFiles: fetchContentFiles,
		saveContentFile: saveContentFile,
		sendBroadcast: sendBroadcast,
		fetchBroadcasts: fetchBroadcasts,
		deleteBroadcast: deleteBroadcast,
		fetchEconSubscribers: fetchEconSubscribers,
		unsubscribeEconSubscriber: unsubscribeEconSubscriber,
		fetchAdmins: fetchAdmins,
		saveAdmin: saveAdmin,
		recordCall: recordCall,
		assignLead: assignLead,
		fetchFollowupsToday: fetchFollowupsToday,
		fetchSalesKpi: fetchSalesKpi,
		fetchConsultants: fetchConsultants,
		fetchProducts: fetchProducts,
		updateProductPrice: updateProductPrice,
		fetchConsultantPerformance: fetchConsultantPerformance,
		fetchSalesFunnel: fetchSalesFunnel,
		fetchSourcePerformance: fetchSourcePerformance,
		fetchAiOverview: fetchAiOverview,
		fetchAiKnowledge: fetchAiKnowledge,
		saveAiKnowledge: saveAiKnowledge,
		deleteAiKnowledge: deleteAiKnowledge,
		bulkSaveAiKnowledge: bulkSaveAiKnowledge,
		suggestAiKnowledge: suggestAiKnowledge,
		changePassword: changePassword,
		updateDisplayName: updateDisplayName,
		updateUsername: updateUsername,
		updateAvatar: updateAvatar,
		parseLocalDate: parseLocalDate,
		REGISTRATION_MESSAGE_TEMPLATE: REGISTRATION_MESSAGE_TEMPLATE,
		MESSAGE_TEMPLATES: MESSAGE_TEMPLATES
	};
})(window);
