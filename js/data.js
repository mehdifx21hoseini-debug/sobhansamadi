(function (global) {
	"use strict";

	// مقصد API.
	//
	// پیش‌فرض ورکر است. شرطش این بود که خودِ پروداکشن جواب بدهد، نه اینکه
	// کد پوش شده باشد - و /admin/crm-selftest همان را روی D1 واقعی سنجید:
	// ورود، نشست، رد شدنِ توکن جعلی، و خواندنِ ۱۱۸ لید.
	//
	// برای برگشتن به n8n - بدون دیپلوی، همان لحظه، در کنسول مرورگر:
	//
	//   localStorage.setItem("crmApiBase", "https://96825.7host.cloud/webhook")
	//
	// و برای برگشتن به حالت عادی:
	//
	//   localStorage.removeItem("crmApiBase")
	//
	// این کلید عمداً localStorage است نه sessionStorage: اگر وسط یک
	// خرابی لازم شد کلِ تیم برگردند، نباید با هر بار بستنِ تب دوباره
	// همان کار را تکرار کنند.
	var WORKER_BASE = "https://sobhansamadi.mehdifx21hoseini.workers.dev";
	var N8N_BASE = "https://96825.7host.cloud/webhook";

	function resolveApiBase() {
		try {
			var override = localStorage.getItem("crmApiBase");
			if (override) return override;
		} catch (e) {
			// حالت ناشناس یا مسدود بودن ذخیره‌سازی: پیش‌فرض کافی است.
		}
		return WORKER_BASE;
	}

	// هر بار خوانده می‌شود، نه یک بار موقع بارگذاری. وسط یک خرابی، آخرین
	// چیزی که کسی می‌خواهد این است که بعد از زدنِ کلیدِ برگشت، یادش
	// بماند صفحه را هم رفرش کند.
	function apiBase() { return resolveApiBase(); }

	var REGISTRATION_MESSAGE_TEMPLATE = "سلام {نام} عزیز، وقت بخیر 🌷\nممنون از تماسی که داشتیم.\nشرایط ثبت‌نام مجموعه آموزشی به شرح زیره:\n\n📌 مدت دوره: ۳ ماه\n📌 نحوه برگزاری: آنلاین + پشتیبانی گروهی\n📌 امکان پرداخت اقساطی\n\nبرای ثبت‌نام نهایی از لینک زیر استفاده کنید:\nacademy.example.com/register\n\nهر سوالی داشتید در خدمتتون هستیم 🙏";

	var MESSAGE_TEMPLATES = [
		{ id: "registration", label: "شرایط ثبت‌نام", text: REGISTRATION_MESSAGE_TEMPLATE },
		{ id: "followup", label: "یادآوری پیگیری", text: "سلام {نام} عزیز، وقت بخیر 🌷\nخواستم پیگیری کنم که به نتیجه‌ای رسیدید یا نه.\nهر سوالی داشتید در خدمتتون هستم 🙏" },
		{ id: "thanks_call", label: "تشکر بعد از تماس", text: "سلام {نام} عزیز 🌷\nاز وقتی که برای تماس گذاشتید ممنونم.\nاگه سوال دیگه‌ای داشتید در خدمتتون هستم 🙏" },
		{ id: "no_answer", label: "عدم پاسخ‌گویی", text: "سلام {نام} عزیز 🌷\nچند بار تماس گرفتم ولی متاسفانه پاسخ ندادید.\nهر زمان که وقت داشتید یه پیام بدید تا باهم هماهنگ کنیم 🙏" },
		{ id: "more_info", label: "اطلاعات بیشتر دوره", text: "سلام {نام} عزیز، وقت بخیر 🌷\nاطلاعات کامل‌تر دوره رو براتون می‌فرستم:\n\n📌 سرفصل‌ها و نحوه‌ی برگزاری\n📌 امکان مشاوره‌ی رایگان قبل از ثبت‌نام\n\nهر سوالی داشتید در خدمتتون هستم 🙏" },
		{ id: "special_offer", label: "پیشنهاد ویژه", text: "سلام {نام} عزیز 🌷\nیه پیشنهاد ویژه براتون در نظر گرفتیم که محدود به زمانه.\nاگه مایل بودید بیشتر توضیح بدم 🙏" }
	];

	// آینه‌ی خواندنی روی ورکر.
	//
	// هر بار که n8n می‌خوابد، کل پنل خالی می‌شود: نه لیدی، نه پیگیری‌ای.
	// تیم فروش دقیقاً در ساعتی که باید کار کند هیچ نمی‌بیند. این نگاشت
	// می‌گوید کدام مسیرها نسخه‌ی پشتیبان دارند.
	//
	// فقط خواندنی‌ها. نوشتن (تغییر وضعیت، یادداشت) نسخه‌ی پشتیبان ندارد و
	// نباید داشته باشد: نوشتنی که به مقصد نرسیده، اگر «موفق» اعلام شود از
	// خطا دادن بدتر است.
	var MIRROR_BASE = "https://sobhansamadi.mehdifx21hoseini.workers.dev/crm-mirror";
	var MIRRORED_PATHS = {
		"/crm/leads": "leads",
		"/crm/calls": "calls",
		"/crm/products": "products",
		"/crm/admins": "admins",
		"/crm/consultants": "consultants",
		"/crm/mentoring-requests": "mentoring-requests",
		"/crm/support-tickets": "support-tickets"
	};

	// آخرین باری که از آینه خوانده شد. صفحه‌ها می‌توانند از این بفهمند که
	// چیزی که نشان می‌دهند تازه نیست.
	var lastMirrorInfo = null;
	function mirrorInfo() { return lastMirrorInfo; }

	function fromMirror(path) {
		var name = MIRRORED_PATHS[path];
		if (!name) return Promise.reject(new Error("no mirror"));
		var token = sessionStorage.getItem("crmToken");
		if (!token) return Promise.reject(new Error("no session"));

		return fetch(MIRROR_BASE + "/" + name, {
			headers: { "Authorization": "Bearer " + token }
		}).then(function (res) {
			if (!res.ok) throw new Error("mirror " + res.status);
			return res.json().then(function (rows) {
				lastMirrorInfo = {
					at: res.headers.get("X-Mirror-Synced-At") || "",
					path: path
				};
				showStaleBanner(lastMirrorInfo.at);
				return rows;
			});
		});
	}

	// وقتی داده از آینه می‌آید، کاربر باید بداند.
	//
	// بدون این، مشاور یک فهرست چند دقیقه کهنه می‌بیند و فکر می‌کند زنده
	// است - و مثلاً لیدی را که همین حالا ثبت شده نمی‌بیند و نمی‌فهمد چرا.
	// نوار یک‌بار ساخته می‌شود و با هر مسیر دیگری تکرار نمی‌شود.
	function showStaleBanner(at) {
		if (document.getElementById("crmStaleBanner")) return;
		var when = "";
		var d = new Date(at);
		if (at && !isNaN(d.getTime())) {
			when = " (آخرین به‌روزرسانی: " + d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" }) + ")";
		}
		var el = document.createElement("div");
		el.id = "crmStaleBanner";
		el.className = "crm-stale-banner";
		el.textContent = "⚠️ ارتباط با سرور CRM برقرار نشد؛ این اطلاعات از نسخه‌ی پشتیبان است" + when +
			" — تغییرات جدید ممکن است دیده نشوند و ثبت تغییر هم فعلاً کار نمی‌کند.";
		if (document.body) document.body.appendChild(el);
	}

	function request(path, options) {
		options = options || {};
		var token = sessionStorage.getItem("crmToken");
		options.headers = Object.assign({}, options.headers, token ? { "Authorization": "Bearer " + token } : {});
		var base = apiBase();
		return fetch(base + path, options).then(function (res) {
			// ۵۰۱ یعنی «این مسیر هنوز به ورکر منتقل نشده».
			//
			// در دوره‌ی انتقال، بیشترِ مسیرها روی ورکرند و چندتایی هنوز
			// نه. بدون این برگشت، سوییچ یعنی «یا همه یا هیچ» و یک صفحه‌ی
			// جامانده کلِ سوییچ را عقب می‌اندازد. ۵۰۱ عمداً انتخاب شده،
			// نه ۴۰۴: فقط خودِ مسیریابِ ما آن را می‌دهد، پس هیچ خطای
			// واقعی‌ای اشتباهی به n8n نمی‌رود.
			if (res.status === 501 && base !== N8N_BASE) {
				return fetch(N8N_BASE + path, options).then(handle);
			}
			return handle(res);
		}).catch(function (err) {
			// ۴۰۱ از قبل کاربر را به صفحه‌ی ورود فرستاده؛ سراغ آینه رفتن
			// در آن حالت فقط یک درخواست بی‌فایده است.
			var isAuth = /نشست منقضی/.test(err.message || "");
			// آینه فقط برای قطعیِ n8n ساخته شده بود. وقتی مقصد اصلی خودِ
			// ورکر است، افتادن روی آینه‌ی همان ورکر چیزی را نجات نمی‌دهد و
			// فقط نوارِ «داده کهنه است» را برای خطایی نشان می‌دهد که ربطی
			// به کهنگی ندارد.
			var usingWorker = base.indexOf(WORKER_BASE) === 0;
			if (isAuth || usingWorker || !MIRRORED_PATHS[path]) throw err;
			return fromMirror(path).catch(function () {
				// آینه هم نبود: خطای اصلی مهم‌تر است، چون همان می‌گوید
				// مشکل از کجاست.
				throw err;
			});
		});

		function handle(res) {
			if (res.status === 401) {
				sessionStorage.removeItem("crmAuthed");
				sessionStorage.removeItem("crmToken");
				sessionStorage.removeItem("crmTokenExpiresAt");
				sessionStorage.removeItem("crmDisplayName");
				sessionStorage.removeItem("crmUsername");
				window.location.href = "login.html";
				throw new Error("نشست منقضی شده است، لطفاً دوباره وارد شوید.");
			}
			// ۴۰۳ یعنی نشست معتبر است ولی نقش اجازه ندارد. برخلاف ۴۰۱
			// نباید کاربر را بیرون بیندازد - فقط باید بفهمد چرا نشد.
			if (res.status === 403) {
				throw new Error("شما به این بخش دسترسی ندارید.");
			}
			if (!res.ok) {
				return res.json().catch(function () { return null; }).then(function (body) {
					throw new Error((body && body.error) || ("درخواست ناموفق بود (" + res.status + ")"));
				});
			}
			return res.json();
		}
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

	// Drops the 5-second cache so an explicit refresh really goes to the
	// server instead of replaying the response the page just rendered.
	function invalidateLeadsCache() {
		leadsCache = null;
		leadsCacheTime = 0;
	}

	// The mentoring questionnaire lives in its own table, so the page that
	// shows it reads it separately from the leads list.
	//
	// It is given a deadline because this page has a fallback path: if the
	// request never settles the page would sit on its loading state forever
	// instead of rendering what it can. A rejection is the useful outcome.
	function fetchMentoringRequests() {
		var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
		var timer;
		var timeout = new Promise(function (_resolve, reject) {
			timer = setTimeout(function () {
				if (controller) controller.abort();
				reject(new Error("پاسخی از سرویس منتورینگ دریافت نشد."));
			}, 12000);
		});
		var call = request("/crm/mentoring-requests", {
			method: "GET",
			signal: controller ? controller.signal : undefined
		});
		return Promise.race([call, timeout]).then(function (res) {
			clearTimeout(timer);
			return res;
		}, function (err) {
			clearTimeout(timer);
			throw err;
		});
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

	// Superseded by setLeadFollowup, which writes the unified next_followup_at.
	// Kept only because the /crm/lead/reminder endpoint still exists; nothing
	// in the CRM calls this any more.
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

	// مسیرهای هوش مصنوعی از اینجا برداشته شدند.
	//
	// پایگاه دانشی که ربات از آن جواب می‌دهد در D1 نشسته، نه در n8n.
	// این توابع نسخه‌ی n8n را ویرایش می‌کردند و ربات هرگز آن تغییرها را
	// نمی‌دید - یعنی صفحه کار می‌کرد، ذخیره می‌شد، و هیچ اثری نداشت.
	// جای‌شان js/ai-worker.js است که مستقیم با ورکر حرف می‌زند.

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

	// One call, one write. The endpoint also moves the lead's status and its
	// follow-up date, so the consultant never has to remember a second step.
	// followup: an ISO date to schedule, "" to leave the current one alone,
	// or null to close the follow-up ("no follow-up needed").
	function recordCall(leadId, result, note, followup) {
		return request("/crm/calls", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				lead_id: leadId,
				result: result,
				note: note || "",
				next_step: followup || "",
				clear_followup: followup === null
			})
		});
	}

	// The only way a lead that never touched the bot can enter the CRM:
	// an Instagram DM, a number a colleague passed on. Everything else
	// comes in through the bot or the site form.
	function createLead(payload) {
		return request("/crm/lead/create", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	// Payments happen on the website and never reach the CRM, so a sale only
	// exists here if the consultant records it. Without this, crm_orders stays
	// empty and every revenue number in the panel reads zero.
	function recordPurchase(leadId, payload) {
		return request("/crm/lead/purchase", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				lead_id: leadId,
				product_id: payload.productId || "",
				amount: payload.amount,
				payment_date: payload.paymentDate || "",
				transaction_id: payload.reference || ""
			})
		});
	}

	// Lead channels. The bot has always sent "telegram_direct"; the other keys
	// exist so a lead that actually came from Instagram or the site can be
	// marked as such. Stored as stable keys, displayed through this map, so
	// renaming a label never rewrites stored rows.
	// Written by WF-21 for every submission of the site's dedicated mentoring
	// form. These leads live on their own page and are deliberately kept out
	// of the sales leads list, so the rule is defined once, here.
	var MENTORING_SOURCE = "website_mentoring_form";

	function isMentoringLead(lead) {
		return !!lead && lead.source === MENTORING_SOURCE;
	}

	var LEAD_SOURCES = [
		{ key: "telegram_direct", label: "ربات تلگرام", icon: "fa-paper-plane" },
		{ key: "instagram", label: "اینستاگرام", icon: "fa-instagram" },
		{ key: "website", label: "سایت", icon: "fa-globe" },
		{ key: MENTORING_SOURCE, label: "فرم منتورینگ سایت", icon: "fa-graduation-cap" }
	];

	var DEFAULT_LEAD_SOURCE = "telegram_direct";

	// Rows written before source was persisted have no value, but every one of
	// them did come from the bot — so an empty source reads as the bot rather
	// than as "unknown". Nothing is rewritten in the table; this is display
	// only, and the moment someone picks a different channel it is stored.
	function normalizeSource(key) {
		return key || DEFAULT_LEAD_SOURCE;
	}

	function sourceLabel(key) {
		var k = normalizeSource(key);
		for (var i = 0; i < LEAD_SOURCES.length; i++) {
			if (LEAD_SOURCES[i].key === k) return LEAD_SOURCES[i].label;
		}
		return k;
	}

	// The one writer for a lead's follow-up. Pass an empty value to clear it
	// ("done"). The endpoint also clears the legacy reminder_date, so the old
	// field can never resurrect a follow-up that was just closed.
	function setLeadFollowup(leadId, nextFollowupAt, reason) {
		var payload = { lead_id: leadId, next_followup_at: nextFollowupAt || "" };
		if (reason !== undefined) payload.followup_reason = reason || "";
		return request("/crm/lead/followup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload)
		});
	}

	// دلیلِ یک پیگیریِ ثبت‌شده، بدون دست زدن به تاریخش. نوارِ اقدام سریع
	// اول تاریخ را می‌نویسد (یک کلیک، بدون تایید) و دلیل را بعد - اگر
	// مشاور بنویسد. جدا نگه داشتنشان یعنی آن یک‌کلیک دست‌نخورده می‌ماند.
	function setFollowupReason(leadId, reason) {
		return request("/crm/lead/followup", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, followup_reason: reason || "" })
		});
	}

	// ─── حالتِ «در حال بارگذاری» ───────────────────────────────────────
	//
	// هفت صفحه بینِ باز شدن و رسیدنِ داده کاملاً خالی بودند. روی
	// اینترنتِ کند این دقیقاً شبیهِ «چیزی ندارد» به نظر می‌رسد - و
	// مشاور فکر می‌کند تیکتی نیست، نه اینکه هنوز نیامده.
	//
	// اسکلتِ ردیف‌ها به‌جای یک اسپینرِ تنها: جای همان چیزی را می‌گیرد که
	// قرار است بیاید، پس وقتی داده رسید صفحه نمی‌پرد.

	function skeletonRows(cols, rows) {
		var out = "";
		for (var r = 0; r < (rows || 4); r++) {
			out += '<tr class="is-skeleton" aria-hidden="true">';
			for (var c = 0; c < cols; c++) out += '<td><span class="skeleton-bar"></span></td>';
			out += "</tr>";
		}
		return out;
	}

	// این فایل عمداً به jQuery وابسته نیست - بقیه‌اش هم با DOM خام کار
	// می‌کند. selector رشته‌ای یا خودِ المان، هر دو قبول است.
	function el(target) {
		return typeof target === "string" ? document.querySelector(target) : (target && target[0]) || target;
	}

	/** اسکلت را داخل tbody می‌گذارد. */
	function showTableLoading(target, cols, rows) {
		var node = el(target);
		if (node) node.innerHTML = skeletonRows(cols, rows);
	}

	/** برای جایی که جدول نیست: فهرست، کارت، نمودار. */
	function showBlockLoading(target, text) {
		var node = el(target);
		if (!node) return;
		node.innerHTML =
			'<div class="loading-block"><i class="fas fa-spinner fa-spin"></i><span></span></div>';
		node.querySelector(".loading-block span").textContent = text || "در حال بارگذاری…";
	}

	// ─── وضعیتِ لید، یک تعریف ─────────────────────────────────────────
	//
	// تا امروز این نگاشت در چهار فایل تکرار شده بود و از هم فاصله گرفته
	// بودند - فقط نسخه‌ی منتورینگ «جدید» را می‌شناخت. همان‌جور تکراری که
	// باعث شد ۱۴۵ لید در شمارنده‌ها نامرئی بمانند.
	var LEAD_STATUSES = [
		{ key: "پاسخ‌داده‌نشده", label: "در انتظار تماس", cls: "badge-pending", icon: "fa-clock" },
		{ key: "تماس گرفته شد", label: "تماس گرفته شد", cls: "badge-called", icon: "fa-phone" },
		{ key: "پاسخ نداد", label: "پاسخ نداد", cls: "badge-noanswer", icon: "fa-phone-slash" }
	];

	// نگهبانِ دوم. سرور از این به بعد وضعیت را نرمال‌شده می‌فرستد، ولی
	// یک ردیفِ قدیمی یا پاسخِ کش‌شده هنوز می‌تواند مقدارِ خام داشته باشد؛
	// هر چیزی که در فهرست نباشد «در انتظار تماس» است.
	function leadStatusMeta(status) {
		for (var i = 0; i < LEAD_STATUSES.length; i++) {
			if (LEAD_STATUSES[i].key === status) return LEAD_STATUSES[i];
		}
		return LEAD_STATUSES[0];
	}

	function leadStatusBadge(status) {
		var m = leadStatusMeta(status);
		return '<span class="status-badge ' + m.cls + '"><i class="fas ' + m.icon + '"></i>' + m.label + '</span>';
	}

	// The three answers the Telegram bot collects. They now have real
	// columns, filled by the bot on the way in and backfilled for older
	// rows, so the panel reads columns instead of re-parsing note text.
	//
	// The regex fallback only covers the gap between a bot write and the
	// backfill; without it such a row would claim the question was never
	// asked, which is worse than a slightly slower read.
	var ANSWER_KEYS = ["level", "topic", "experience", "has_real_account", "trade_status"];
	var ANSWER_LABELS = {
		level: "سطح",
		topic: "موضوع",
		experience: "مدت فعالیت",
		has_real_account: "حساب ریل",
		trade_status: "وضعیت ترید",
	};

	function botAnswers(lead) {
		var out = {};
		ANSWER_KEYS.forEach(function (k) { out[k] = lead ? lead[k] || "" : ""; });
		if (!lead) return out;
		// ستون‌ها منبع اصلی‌اند. متنِ یادداشت فقط برای ردیف‌های قدیمی
		// خوانده می‌شود - آن‌هایی که پیش از ساخته شدنِ ستون‌ها ثبت شده‌اند
		// و پاسخ‌هایشان هنوز داخل notes است.
		var missing = ANSWER_KEYS.filter(function (k) { return !out[k]; });
		if (missing.length === 0) return out;

		var notes = String(lead.notes || "");
		function grab(label) {
			var re = new RegExp(label + "\\s*:\\s*([^|\\n]+)", "g");
			var m, last = "";
			while ((m = re.exec(notes)) !== null) last = m[1].trim();
			return last;
		}
		missing.forEach(function (k) { out[k] = grab(ANSWER_LABELS[k]); });
		return out;
	}

	// Legacy rows only have reminder_date; new writes only set
	// next_followup_at. Every reader goes through this.
	function leadFollowupAt(lead) {
		if (!lead) return "";
		return lead.next_followup_at || lead.reminder_date || "";
	}

	function setLeadSource(leadId, source) {
		return request("/crm/lead/source", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ lead_id: leadId, source: source })
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

		// A follow-up was promised and the date has passed.
		var followUp = leadFollowupAt(lead);
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
		MENTORING_SOURCE: MENTORING_SOURCE,
		isMentoringLead: isMentoringLead,
		LEAD_SOURCES: LEAD_SOURCES,
		sourceLabel: sourceLabel,
		normalizeSource: normalizeSource,
		setLeadSource: setLeadSource,
		setLeadFollowup: setLeadFollowup,
		setFollowupReason: setFollowupReason,
		showTableLoading: showTableLoading,
		showBlockLoading: showBlockLoading,
		botAnswers: botAnswers,
		LEAD_STATUSES: LEAD_STATUSES,
		leadStatusMeta: leadStatusMeta,
		leadStatusBadge: leadStatusBadge,
		leadFollowupAt: leadFollowupAt,
		mirrorInfo: mirrorInfo,
		fetchLeads: fetchLeads,
		invalidateLeadsCache: invalidateLeadsCache,
		fetchMentoringRequests: fetchMentoringRequests,
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
		recordPurchase: recordPurchase,
		createLead: createLead,
		assignLead: assignLead,
		fetchFollowupsToday: fetchFollowupsToday,
		fetchSalesKpi: fetchSalesKpi,
		fetchConsultants: fetchConsultants,
		fetchProducts: fetchProducts,
		updateProductPrice: updateProductPrice,
		fetchConsultantPerformance: fetchConsultantPerformance,
		fetchSalesFunnel: fetchSalesFunnel,
		fetchSourcePerformance: fetchSourcePerformance,
		changePassword: changePassword,
		updateDisplayName: updateDisplayName,
		updateUsername: updateUsername,
		updateAvatar: updateAvatar,
		parseLocalDate: parseLocalDate,
		REGISTRATION_MESSAGE_TEMPLATE: REGISTRATION_MESSAGE_TEMPLATE,
		MESSAGE_TEMPLATES: MESSAGE_TEMPLATES
	};
})(window);
