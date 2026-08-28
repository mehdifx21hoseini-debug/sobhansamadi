// دسترسی صفحه‌ی «هوش مصنوعی» به ورکر تلگرام.
//
// بقیه‌ی صفحه‌های CRM با n8n حرف می‌زنند، این یکی نه — و دلیلش این است
// که داده‌اش آنجا نیست. پایگاه دانشی که ربات واقعاً از آن جواب می‌دهد،
// بردارهایش و دفترچه‌ی پاسخ‌ها همه در D1 نشسته‌اند. تا امروز این صفحه
// نسخه‌ی n8n را ویرایش می‌کرد و ربات هرگز آن تغییرها را نمی‌دید؛ حالا
// همان جایی را ویرایش می‌کند که ربات از آن می‌خواند.
//
// کلید در این فایل نوشته نشده و نباید بشود: میزبانی CRM ایستاست، پس هر
// چیزی که اینجا بنویسیم با View Source خوانده می‌شود. صفحه یک‌بار از
// مدیر می‌پرسد و در sessionStorage نگه می‌دارد — با بستن تب می‌رود.
(function (global) {
	"use strict";

	var WORKER = "https://sobhansamadi.mehdifx21hoseini.workers.dev";
	var KEY_STORAGE = "crmAiKey";

	function storedKey() {
		try { return sessionStorage.getItem(KEY_STORAGE) || ""; } catch (e) { return ""; }
	}

	function rememberKey(key) {
		try { sessionStorage.setItem(KEY_STORAGE, key); } catch (e) { /* حالت خصوصی مرورگر */ }
	}

	function forgetKey() {
		try { sessionStorage.removeItem(KEY_STORAGE); } catch (e) { /* بی‌اهمیت */ }
	}

	// وقتی کلید نداریم یا کلید رد شد. برگرداندن رشته‌ی خالی یعنی مدیر
	// انصراف داد و صفحه نباید بی‌نهایت دوباره بپرسد.
	function askForKey(message) {
		var key = global.prompt(
			message ||
			"کلید دسترسی بخش هوش مصنوعی (ADMIN_KEY ورکر) را وارد کنید.\nفقط یک‌بار در هر نشست پرسیده می‌شود.",
			""
		);
		key = (key || "").trim();
		if (key) rememberKey(key);
		return key;
	}

	var CANCELLED = "AI_KEY_CANCELLED";

	function call(path, options, retried) {
		options = options || {};
		var key = storedKey();
		if (!key) {
			key = askForKey();
			if (!key) return Promise.reject(new Error(CANCELLED));
		}

		var headers = Object.assign({}, options.headers, { "x-admin-key": key });
		return fetch(WORKER + "/admin/ai/" + path, {
			method: options.method || "GET",
			headers: headers,
			body: options.body
		}).then(function (res) {
			if (res.status === 401 || res.status === 403) {
				// شاید درخواست دیگری که هم‌زمان رفته بود، همین حالا کلید
				// تازه گرفته باشد. بدون این چک، چند درخواست موازیِ ۴۰۱
				// چند پنجره‌ی prompt پشت سر هم باز می‌کردند.
				if (storedKey() && storedKey() !== key) return call(path, options, retried);

				forgetKey();
				// یک‌بار دوباره می‌پرسد، نه بیشتر: بدون این شرط، کلید غلط
				// یک حلقه‌ی بی‌پایان از پنجره‌ی prompt می‌ساخت.
				if (retried) throw new Error("کلید دسترسی درست نیست.");
				var again = askForKey("کلید قبلی پذیرفته نشد. کلید درست را وارد کنید:");
				if (!again) throw new Error(CANCELLED);
				return call(path, options, true);
			}
			return res.json().catch(function () {
				throw new Error("پاسخ ورکر خوانده نشد (" + res.status + ")");
			}).then(function (bodyJson) {
				if (!res.ok || bodyJson.ok === false) {
					throw new Error(bodyJson.error || ("درخواست ناموفق بود (" + res.status + ")"));
				}
				return bodyJson;
			});
		});
	}

	function post(path, payload) {
		return call(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload || {})
		});
	}

	// ── شکل‌دهی به آنچه صفحه انتظار دارد ─────────────────────────────
	//
	// صفحه با شکل قدیمیِ n8n نوشته شده. تبدیل اینجا انجام می‌شود تا
	// منطق صفحه دست‌نخورده بماند و تفاوت دو منبع فقط در یک لایه باشد.
	function toRow(r) {
		return {
			id: r.id,
			category: r.category,
			question: r.question,
			answer: r.answer,
			active: true,
			usage_count: r.usage_count || 0,
			last_used_at: r.last_used_at,
			// «نیاز به تکمیل» یعنی مدخلی که پاسخش عملاً خالی است — همان
			// تعریفی که نسخه‌ی n8n داشت.
			needs_completion: !r.answer || r.answer.trim().length < 10,
			source: r.source,
			pinned: r.pinned,
			has_vector: r.has_vector
		};
	}

	var API = {
		hasKey: function () { return !!storedKey(); },
		forgetKey: forgetKey,
		isCancelled: function (err) { return err && err.message === CANCELLED; },

		fetchOverview: function () {
			return call("overview");
		},

		// همه‌ی مدخل‌ها در یک درخواست: صفحه خودش جستجو و صفحه‌بندی را
		// در حافظه انجام می‌دهد و برای ۲۵۰ مدخل این ساده‌ترین راه است.
		fetchKnowledge: function () {
			return call("kb?limit=200&offset=0").then(function (first) {
				var rows = first.rows.slice();
				var pages = [];
				for (var off = 200; off < first.total; off += 200) {
					pages.push(call("kb?limit=200&offset=" + off));
				}
				return Promise.all(pages).then(function (rest) {
					rest.forEach(function (p) { rows = rows.concat(p.rows); });
					return rows.map(toRow);
				});
			});
		},

		saveKnowledge: function (payload) {
			if (payload.id) {
				return post("kb/update", {
					id: payload.id,
					category: payload.category,
					question: payload.question,
					answer: payload.answer
				});
			}
			return post("kb", {
				category: payload.category,
				question: payload.question,
				answer: payload.answer
			});
		},

		deleteKnowledge: function (id) { return post("kb/delete", { id: id }); },
		unpinKnowledge: function (id) { return post("kb/unpin", { id: id }); },
		bulkSaveKnowledge: function (entries) { return post("kb/bulk", { entries: entries }); },
		suggestKnowledge: function (rawText) {
			return post("suggest", { text: rawText }).then(function (res) { return res.suggestion; });
		},
		sync: function () { return post("sync", {}); },

		fetchLog: function (opts) {
			opts = opts || {};
			var qs = "log?filter=" + encodeURIComponent(opts.filter || "all") +
				"&limit=" + (opts.limit || 25) +
				"&offset=" + (opts.offset || 0);
			if (opts.q) qs += "&q=" + encodeURIComponent(opts.q);
			return call(qs);
		}
	};

	global.CrmAi = API;
})(window);
