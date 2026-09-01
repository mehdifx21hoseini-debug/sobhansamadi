(function () {
	"use strict";

	// The questionnaire, in the order the site's form asks it. Everything
	// the page shows is driven from here, so adding a question later means
	// adding one line rather than touching the markup.
	var QUESTIONS = [
		{ key: "market_experience", label: "مدت فعالیت در بازارهای مالی", icon: "fa-hourglass-half" },
		{ key: "has_real_account", label: "سابقه حساب ریل", icon: "fa-wallet" },
		{ key: "real_account_duration", label: "مدت معامله در حساب ریل", icon: "fa-clock-rotate-left" },
		{ key: "capital_traded", label: "میزان سرمایه‌ی معامله‌شده", icon: "fa-coins" },
		{ key: "styles_learned", label: "سبک‌هایی که آموزش دیده", icon: "fa-book-open" },
		{ key: "teacher_name", label: "استاد", icon: "fa-user-tie" },
		{ key: "trading_goal", label: "هدف از معامله‌گر شدن", icon: "fa-bullseye" },
		{ key: "has_strategy", label: "استراتژی معاملاتی", icon: "fa-chess" },
		{ key: "strategy_performance", label: "بازدهی استراتژی", icon: "fa-chart-line" },
		{ key: "strategy_image_url", label: "تصویر استراتژی", icon: "fa-image", isLink: true }
	];
	var KNOWN = {};
	QUESTIONS.forEach(function (q) { KNOWN[q.key] = q; });

	// Legacy rows: before the questionnaire existed, WF-21 recorded each
	// submission as one line inside the lead's notes. Split on the marker
	// rather than per line, so multi-line messages survive intact.
	var NOTE_MARKER = "📩 درخواست منتورینگ اختصاصی (وبسایت) - ";
	var NOTE_SIGN = "📩 درخواست منتورینگ اختصاصی";
	var STAMPED = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(?::\s*)?([\s\S]*)$/;

	function hasMentoringRequest(lead) {
		if (!lead) return false;
		if (CrmData.isMentoringLead(lead)) return true;
		return String(lead.notes || "").indexOf(NOTE_SIGN) !== -1;
	}

	function normalizeStatus(s) {
		if (!s || s === "جدید") return "پاسخ‌داده‌نشده";
		return s;
	}

	function fa(n) { return Number(n || 0).toLocaleString("fa-IR"); }

	function formatDate(iso) {
		if (!iso) return "-";
		var d = new Date(iso);
		if (isNaN(d.getTime())) return String(iso);
		return d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
	}

	function timeAgo(iso) {
		var t = new Date(iso).getTime();
		if (isNaN(t)) return "-";
		var mins = Math.floor((Date.now() - t) / 60000);
		if (mins < 1) return "همین الان";
		if (mins < 60) return fa(mins) + " دقیقه پیش";
		var hours = Math.floor(mins / 60);
		if (hours < 24) return fa(hours) + " ساعت پیش";
		var days = Math.floor(hours / 24);
		if (days < 30) return fa(days) + " روز پیش";
		return formatDate(iso);
	}

	function legacyEntries(notes) {
		if (!notes) return [];
		var parts = String(notes).split(NOTE_MARKER);
		var out = [];
		for (var i = 1; i < parts.length; i++) {
			var chunk = parts[i].replace(/\s+$/, "");
			var m = chunk.match(STAMPED);
			if (m) out.push({ at: m[1], message: (m[2] || "").trim() });
			else out.push({ at: "", message: chunk.trim() });
		}
		return out;
	}

	function stampToIso(stamp) {
		return stamp ? stamp.replace(" ", "T") + ":00Z" : "";
	}

	var PAGE_SIZE = 15;
	var state = { items: [], query: "", statusFilter: "", expanded: {}, page: 1, requestsError: "" };
	var consultants = [];

	function buildItems(requests, leads) {
		var leadById = {};
		(leads || []).forEach(function (l) { if (l && l.lead_id) leadById[l.lead_id] = l; });

		var out = [];
		var covered = {};

		(requests || []).forEach(function (r) {
			var lead = leadById[r.lead_id] || {};
			covered[r.lead_id] = true;
			out.push({
				id: r.request_id,
				lead_id: r.lead_id,
				name: r.full_name || lead.full_name || "(بدون نام)",
				phone: r.phone || lead.phone || "",
				telegram: r.telegram_id || "",
				email: r.email || "",
				goal: r.consultation_goal || "",
				answers: r.answers || {},
				created_at: r.created_at,
				updated_at: lead.updated_at || r.created_at,
				status: normalizeStatus(lead.status),
				assigned_to: lead.assigned_to || "",
				followup: CrmData.leadFollowupAt(lead),
				hasLead: !!lead.lead_id
			});
		});

		(leads || []).filter(hasMentoringRequest).forEach(function (l) {
			if (covered[l.lead_id]) return;
			var entries = legacyEntries(l.notes);
			if (entries.length === 0) entries = [{ at: "", message: "" }];
			entries.forEach(function (e, idx) {
				out.push({
					id: l.lead_id + "-" + idx,
					lead_id: l.lead_id,
					name: l.full_name || "(بدون نام)",
					phone: l.phone || "",
					telegram: "",
					email: "",
					goal: e.message,
					answers: {},
					created_at: stampToIso(e.at) || l.created_at,
					updated_at: l.updated_at || l.created_at,
					status: normalizeStatus(l.status),
					assigned_to: l.assigned_to || "",
					hasLead: true
				});
			});
		});
		return out;
	}

	function matches(item) {
		if (state.statusFilter && item.status !== state.statusFilter) return false;
		var q = state.query.trim().toLowerCase();
		if (!q) return true;
		var hay = [item.name, item.phone, item.telegram, item.goal, item.lead_id]
			.concat(Object.keys(item.answers).map(function (k) { return item.answers[k]; }))
			.map(function (v) { return String(v || "").toLowerCase(); })
			.join(" ");
		return hay.indexOf(q) !== -1;
	}

	// شمارشِ پیگیری‌های سررسیدشده.
	//
	// کارتابل امروز از این پس فقط لیدهای مشاوره را نشان می‌دهد، چون تماس
	// با منتورینگ کارِ شخص دیگری است. ولی اگر این شمارنده اینجا نبود،
	// پیگیریِ یک درخواست منتورینگ هیچ‌جا دیده نمی‌شد - نه در کارتابل، نه
	// اینجا - و بی‌صدا از دست می‌رفت.
	function dueCount(items) {
		var endOfToday = new Date();
		endOfToday.setHours(23, 59, 59, 999);
		var n = 0;
		items.forEach(function (i) {
			if (!i.followup) return;
			var t = new Date(i.followup).getTime();
			if (!isNaN(t) && t <= endOfToday.getTime()) n++;
		});
		return n;
	}

	function renderStats(items) {
		var pending = 0, week = 0, withAnswers = 0;
		var weekAgo = Date.now() - 7 * 86400000;
		items.forEach(function (i) {
			if (i.status === "پاسخ‌داده‌نشده") pending++;
			var t = new Date(i.created_at).getTime();
			if (!isNaN(t) && t >= weekAgo) week++;
			if (Object.keys(i.answers).length > 0) withAnswers++;
		});
		$("#mt-total").text(items.length);
		$("#mt-pending").text(pending);
		$("#mt-week").text(week);
		$("#mt-answered").text(withAnswers);

		var due = dueCount(items);
		var $due = $("#mt-due-wrap");
		$("#mt-due").text(due);
		if ($due.length) $due.toggleClass("d-none", due === 0);
	}

	function statusSelectHtml(id, status, disabled) {
		var meta = CrmData.leadStatusMeta(status);
		var options = CrmData.LEAD_STATUSES.map(function (s) {
			var selected = s.key === meta.key ? " selected" : "";
			return '<option value="' + s.key + '"' + selected + '>' + s.label + '</option>';
		}).join("");
		return '<select class="status-select ' + meta.cls + '" data-id="' + id + '"' + (disabled ? " disabled" : "") + '>' + options + '</select>';
	}

	function consultantSelectHtml(id, assignedTo, disabled) {
		var current = assignedTo || "";
		var options = ['<option value=""' + (current ? "" : " selected") + ">بدون مشاور</option>"];
		var known = false;
		consultants.forEach(function (c) {
			var selected = c.username === current ? " selected" : "";
			if (selected) known = true;
			options.push('<option value="' + c.username + '"' + selected + ">" + (c.display_name || c.username) + "</option>");
		});
		if (current && !known) options.push('<option value="' + current + '" selected>' + current + "</option>");
		return '<select class="assign-select' + (current ? "" : " is-unassigned") + '" data-id="' + id + '"' + (disabled ? " disabled" : "") + '>' + options.join("") + "</select>";
	}

	function answerRow(key, value) {
		var meta = KNOWN[key];
		var label = meta ? meta.label : key;
		var icon = meta ? meta.icon : "fa-circle-question";
		var $row = $("<div>").addClass("mr-answer");
		$row.append($("<span>").addClass("mr-answer-label")
			.append($("<i>").addClass("fas " + icon))
			.append(document.createTextNode(label)));
		var $val = $("<span>").addClass("mr-answer-value");
		if (meta && meta.isLink && /^https?:\/\//i.test(value)) {
			$val.append($("<a>").attr({ href: value, target: "_blank", rel: "noopener noreferrer" })
				.append($("<i>").addClass("fas fa-arrow-up-right-from-square mr-1"))
				.append(document.createTextNode("مشاهده تصویر")));
		} else {
			$val.text(value);
		}
		$row.append($val);
		return $row;
	}

	function truncate(s, n) {
		s = String(s || "").replace(/\s+/g, " ").trim();
		if (!s) return "-";
		return s.length > n ? s.slice(0, n) + "…" : s;
	}

	function buildRow(item) {
		var $tr = $("<tr>").addClass("mt-row");
		var hasDetails = !!item.goal || Object.keys(item.answers).length > 0;

		var $toggleCell = $("<td>").addClass("mt-toggle-cell");
		if (hasDetails) {
			$toggleCell.append($("<button type='button'>").addClass("btn btn-link btn-sm p-0 mt-toggle-btn")
				.html('<i class="fas fa-chevron-' + (state.expanded[item.id] ? "up" : "down") + '"></i>'));
		}
		$tr.append($toggleCell);

		var $nameCell = $("<td>");
		var $name = item.hasLead
			? $("<a>").attr("href", "lead.html?id=" + encodeURIComponent(item.lead_id)).addClass("lead-name-link")
			: $("<span>");
		$name.text(item.name);
		$nameCell.append($name);
		$tr.append($nameCell);

		var $phoneCell = $("<td>").attr("dir", "ltr").addClass("mono phone-cell text-center");
		$phoneCell.append($("<span>").text(item.phone || "-"));
		if (item.phone) {
			$phoneCell.append($("<a>").addClass("quick-call-btn").attr({
				href: "tel:" + item.phone.replace(/[^\d+]/g, ""),
				title: "تماس با " + (item.name || "این فرد")
			}).on("click", function (e) { e.stopPropagation(); }).html('<i class="fas fa-phone"></i>'));
		}
		$tr.append($phoneCell);
		$tr.append($("<td>").addClass("mt-goal-cell").attr("title", item.goal || "").text(truncate(item.goal, 42)));
		$tr.append($("<td>").addClass("text-center").html(statusSelectHtml(item.id, item.status, !item.hasLead)));
		$tr.append($("<td>").addClass("text-center").html(consultantSelectHtml(item.id, item.assigned_to, !item.hasLead)));
		$tr.append($("<td>").addClass("text-muted text-sm").text(timeAgo(item.updated_at || item.created_at)));

		var $rows = $tr;

		if (hasDetails) {
			var $detail = $("<tr>").addClass("mt-detail-row").toggleClass("d-none", !state.expanded[item.id]);
			var $td = $("<td>").attr("colspan", 7);
			var $wrap = $("<div>").addClass("mt-detail-wrap");

			if (item.goal) $wrap.append($("<blockquote>").addClass("mr-goal").text(item.goal));

			var keys = Object.keys(item.answers);
			if (keys.length) {
				var $answers = $("<div>").addClass("mr-answers mt-answers-open");
				QUESTIONS.forEach(function (q) {
					if (item.answers[q.key]) $answers.append(answerRow(q.key, item.answers[q.key]));
				});
				keys.forEach(function (k) {
					if (!KNOWN[k]) $answers.append(answerRow(k, item.answers[k]));
				});
				$wrap.append($answers);
			} else if (!item.goal) {
				$wrap.append($("<p>").addClass("mr-empty-answers").text("پاسخ‌های فرم برای این درخواست ثبت نشده است."));
			}

			$td.append($wrap);
			$detail.append($td);
			$rows = $tr.add($detail);

			$toggleCell.find(".mt-toggle-btn").on("click", function () {
				state.expanded[item.id] = !state.expanded[item.id];
				render();
			});
		}

		return $rows;
	}

	function render() {
		var rows = state.items.filter(matches);
		var $body = $("#mentoringTableBody").empty();

		if (state.items.length === 0) {
			var $cell = $('<td colspan="7">');
			var $empty = $('<div class="empty-state">');
			if (state.requestsError) {
				// خالی بودنِ جدول اینجا یک واقعیت نیست، یک ندانستن است.
				// گفتنِ «هنوز درخواستی نیست» در این حالت یعنی فرستادن
				// کاربر دنبال مشکلی که وجود ندارد، در حالی که مشکل واقعی
				// جای دیگری است.
				$empty.append('<i class="fas fa-plug-circle-xmark"></i>');
				$empty.append($("<p>").text("سرویس منتورینگ پاسخ نداد، پس معلوم نیست درخواستی هست یا نه."));
				$empty.append($('<p class="text-sm text-muted mono">').text(state.requestsError));
				$empty.append($('<p class="text-sm text-muted">').text(
					"یعنی گردش‌کار مربوطه در n8n خاموش یا خطادار است. تا وقتی این پیام هست، درخواست‌های تازه‌ی سایت هم اینجا نمی‌آیند."
				));
			} else {
				$empty.append('<i class="fas fa-graduation-cap"></i>');
				$empty.append($("<p>").text("هنوز درخواستی از فرم منتورینگ سایت ثبت نشده است."));
				$empty.append($('<p class="text-sm text-muted">').text(
					"سرویس پاسخ داد و فهرستش خالی بود — یعنی فرم سایت هنوز چیزی به CRM نفرستاده."
				));
			}
			$body.append($("<tr>").append($cell.append($empty)));
			$("#mentoringPagination").addClass("d-none");
			return;
		}

		// جدول پر است ولی سرویس خطا داده: یعنی این سطرها فقط از لیدهای
		// قدیمی‌اند و ممکن است درخواست‌های تازه جا افتاده باشند.
		if (state.requestsError) {
			$body.append($("<tr>").append(
				$('<td colspan="7" class="text-sm" style="color:#c81e4b">')
					.text("هشدار: سرویس منتورینگ پاسخ نداد (" + state.requestsError + ") — این فهرست ممکن است ناقص باشد.")
			));
		}
		if (rows.length === 0) {
			$body.append('<tr><td colspan="7"><div class="empty-state"><i class="fas fa-inbox"></i><p>موردی با این فیلترها پیدا نشد.</p></div></td></tr>');
			$("#mentoringPagination").addClass("d-none");
			return;
		}

		var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		if (state.page > totalPages) state.page = totalPages;
		var start = (state.page - 1) * PAGE_SIZE;
		var pageRows = rows.slice(start, start + PAGE_SIZE);
		pageRows.forEach(function (item) { $body.append(buildRow(item)); });

		if (rows.length > PAGE_SIZE) {
			$("#mentoringPagination").removeClass("d-none");
			$("#mentoringPaginationInfo").text("صفحه " + fa(state.page) + " از " + fa(totalPages) + " (" + fa(rows.length) + " مورد)");
			$("#btnMentoringPrevPage").prop("disabled", state.page <= 1);
			$("#btnMentoringNextPage").prop("disabled", state.page >= totalPages);
		} else {
			$("#mentoringPagination").addClass("d-none");
		}
	}

	function findItem(id) {
		return state.items.find(function (i) { return String(i.id) === String(id); });
	}

	// «درخواستی نیست» و «نتوانستم بپرسم» دو چیزند.
	//
	// نسخه‌ی قبلی هر خطایی را می‌بلعید و null برمی‌گرداند، و صفحه بعدش
	// می‌نوشت «هنوز درخواستی ثبت نشده است» - چه واقعاً نبود، چه سرویس
	// ۴۰۴ می‌داد، چه گردش‌کار n8n خاموش بود. یعنی سه حالتِ کاملاً متفاوت
	// از بیرون یک شکل داشتند و هیچ راهی برای تشخیص‌شان نبود.
	//
	// حالا خطا نگه داشته می‌شود تا صفحه بتواند بگوید کدام است.
	function requestsPromise() {
		if (!window.CrmData || typeof CrmData.fetchMentoringRequests !== "function") {
			return Promise.resolve({ rows: null, error: "سرویس منتورینگ در این نسخه از صفحه تعریف نشده است." });
		}
		try {
			return CrmData.fetchMentoringRequests().then(
				function (rows) { return { rows: rows, error: "" }; },
				function (err) { return { rows: null, error: (err && err.message) || "خطای نامشخص" }; }
			);
		} catch (e) {
			return Promise.resolve({ rows: null, error: (e && e.message) || "خطای نامشخص" });
		}
	}

	function loadConsultants() {
		if (!window.CrmData || typeof CrmData.fetchConsultants !== "function") return;
		CrmData.fetchConsultants().then(function (list) {
			consultants = list || [];
			render();
		}).catch(function () {});
	}

	function load() {
		$("#mentoringTableBody").html('<tr><td colspan="7"><div class="text-center py-5 text-muted">در حال بارگذاری…</div></td></tr>');
		Promise.all([
			requestsPromise(),
			CrmData.fetchLeads().catch(function () { return []; })
		]).then(function (res) {
			var requests = Array.isArray(res[0].rows) ? res[0].rows : null;
			state.requestsError = res[0].error || "";
			state.items = buildItems(requests, res[1]).sort(function (a, b) {
				return new Date(b.created_at || 0) - new Date(a.created_at || 0);
			});
			renderStats(state.items);
			render();
		}).catch(function (err) {
			$("#mentoringTableBody").html('<tr><td colspan="7" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: '
				+ (err.message || "خطای نامشخص") + "</td></tr>");
		});
	}

	function safeLoad() {
		try {
			load();
		} catch (err) {
			$("#mentoringTableBody").html('<tr><td colspan="7"><div class="text-center py-5" style="color:#c81e4b">خطا در بارگذاری صفحه: '
				+ ((err && err.message) || "خطای نامشخص")
				+ '<br><span class="text-muted text-sm">یک بار صفحه را با Ctrl+Shift+R تازه کنید.</span></div></td></tr>');
		}
	}

	$(function () {
		$("#mentoringSearch").on("input", function () { state.query = this.value; state.page = 1; render(); });
		$("#mentoringStatusTabs").on("click", ".filter-tab", function () {
			$(".filter-tab", "#mentoringStatusTabs").removeClass("active");
			$(this).addClass("active");
			state.statusFilter = $(this).data("status") || "";
			state.page = 1;
			render();
		});
		$("#btnRefreshMentoring").on("click", function () {
			if (window.CrmData && CrmData.invalidateLeadsCache) CrmData.invalidateLeadsCache();
			safeLoad();
			loadConsultants();
		});
		$("#btnMentoringPrevPage").on("click", function () { if (state.page > 1) { state.page--; render(); } });
		$("#btnMentoringNextPage").on("click", function () { state.page++; render(); });

		$("#mentoringTableBody").on("change", ".status-select", function () {
			var $select = $(this);
			var item = findItem($select.data("id"));
			if (!item || !item.hasLead) return;
			var newStatus = $select.val();
			var previous = item.status;
			$select.addClass("is-saving");
			CrmData.updateLeadStatus(item.lead_id, newStatus).then(function () {
				item.status = newStatus;
				item.updated_at = new Date().toISOString();
				renderStats(state.items);
				render();
			}).catch(function (err) {
				alert("خطا در ثبت وضعیت: " + (err.message || "خطای نامشخص"));
				$select.val(previous);
			}).finally(function () { $select.removeClass("is-saving"); });
		});

		$("#mentoringTableBody").on("change", ".assign-select", function () {
			var $select = $(this);
			var item = findItem($select.data("id"));
			if (!item || !item.hasLead) return;
			var newAssignee = $select.val();
			var previous = item.assigned_to || "";
			$select.addClass("is-saving");
			CrmData.assignLead(item.lead_id, newAssignee).then(function () {
				item.assigned_to = newAssignee;
				item.updated_at = new Date().toISOString();
				render();
			}).catch(function (err) {
				alert("خطا در ثبت مشاور: " + (err.message || "خطای نامشخص"));
				$select.val(previous);
			}).finally(function () { $select.removeClass("is-saving"); });
		});

		safeLoad();
		loadConsultants();
	});
})();
