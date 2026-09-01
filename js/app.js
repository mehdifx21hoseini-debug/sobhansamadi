(function () {
	"use strict";

	// تعریفِ وضعیت یک جاست، در data.js. تا امروز در چهار فایل تکرار شده
	// بود و از هم فاصله گرفته بودند.
	function statusMeta(status) { return CrmData.leadStatusMeta(status); }

	function statusSelectHtml(leadId, status) {
		var meta = statusMeta(status);
		var options = CrmData.LEAD_STATUSES.map(function (s) {
			var selected = s.key === meta.key ? " selected" : "";
			return '<option value="' + s.key + '"' + selected + '>' + s.label + '</option>';
		}).join("");
		return '<select class="status-select ' + meta.cls + '" data-lead-id="' + leadId + '">' + options + '</select>';
	}

	// Consultants are fetched once and reused for every row's dropdown, so the
	// table does not fire one request per lead.
	var consultants = [];

	function consultantSelectHtml(leadId, assignedTo) {
		var current = assignedTo || "";
		var options = ['<option value=""' + (current ? "" : " selected") + ">بدون مشاور</option>"];
		var known = false;
		consultants.forEach(function (c) {
			var selected = c.username === current ? " selected" : "";
			if (selected) known = true;
			options.push('<option value="' + c.username + '"' + selected + ">" + (c.display_name || c.username) + "</option>");
		});
		// A lead can be assigned to someone who is no longer in the list; keep
		// the value visible instead of silently showing "بدون مشاور".
		if (current && !known) {
			options.push('<option value="' + current + '" selected>' + current + "</option>");
		}
		return '<select class="assign-select' + (current ? "" : " is-unassigned") + '" data-lead-id="' + leadId + '">' + options.join("") + "</select>";
	}

	function formatRelativeTime(iso) {
		if (!iso) return "-";
		var date = new Date(iso);
		var now = new Date();
		var diffMins = Math.round((now - date) / 60000);
		if (diffMins < 1) return "همین الان";
		if (diffMins < 60) return faNum(diffMins) + " دقیقه پیش";
		var diffHours = Math.round(diffMins / 60);
		if (diffHours < 24) return faNum(diffHours) + " ساعت پیش";
		var diffDays = Math.round(diffHours / 24);
		if (diffDays === 1) return "دیروز";
		return faNum(diffDays) + " روز پیش";
	}

	var PAGE_SIZE = 15;

	var state = {
		leads: [],
		statusFilter: "همه",
		sourceFilter: "",
		query: "",
		loading: true,
		error: null,
		page: 1
	};

	// Reads through the shared helper so this tab and the "پیگیری‌های امروز"
	// page can no longer disagree about which field holds the follow-up.
	function isDueForFollowUp(lead) {
		var value = CrmData.leadFollowupAt(lead);
		if (!value) return false;
		var due = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
			? CrmData.parseLocalDate(value.trim())
			: new Date(value);
		if (isNaN(due.getTime())) return false;
		var endOfToday = new Date();
		endOfToday.setHours(23, 59, 59, 999);
		return due <= endOfToday;
	}

	// Shared rule, defined once in js/data.js. Called through a wrapper because
	// this file is included before data.js, so CrmData does not exist yet here.
	function isAtRisk(lead) {
		return CrmData.isAtRisk(lead);
	}

	function currentUser() {
		try {
			return sessionStorage.getItem("crmUsername") || "";
		} catch (e) {
			return "";
		}
	}

	function isMine(lead) {
		var me = currentUser();
		return !!me && String(lead.assigned_to || "") === me;
	}

	/**
	 * ترتیبِ فهرست از فیلترِ فعال می‌آید، نه یک قاعده‌ی ثابت.
	 *
	 * پیش از این همه‌جا بر اساس آخرین تغییر مرتب می‌شد. یعنی حتی در تبِ
	 * «نیاز به پیگیری»، لیدی که ده روز عقب افتاده می‌توانست صفحه‌ی سوم
	 * باشد - درست همان‌جایی که فوریت باید ترتیب را تعیین کند.
	 */
	function sortRows(rows) {
		if (state.statusFilter === "یادآوری") {
			return rows.sort(function (a, b) {
				var da = followupDate(a), db = followupDate(b);
				return (da ? da.getTime() : Infinity) - (db ? db.getTime() : Infinity);
			});
		}
		if (state.statusFilter === "در_ریسک") {
			// قدیمی‌ترین اول: لیدی که بیشتر منتظر مانده، بیشتر در خطر است.
			return rows.sort(function (a, b) {
				return new Date(a.created_at || 0) - new Date(b.created_at || 0);
			});
		}
		return rows.sort(function (a, b) {
			return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
		});
	}

	function getFilteredRows() {
		var q = state.query.trim();
		return sortRows(state.leads
			.filter(function (l) {
				if (state.statusFilter === "همه") return true;
				if (state.statusFilter === "مالِ_من") return isMine(l);
				if (state.statusFilter === "یادآوری") return isDueForFollowUp(l);
				if (state.statusFilter === "در_ریسک") return isAtRisk(l);
				return l.status === state.statusFilter;
			})
			.filter(function (l) {
				if (!state.sourceFilter) return true;
				return CrmData.normalizeSource(l.source) === state.sourceFilter;
			})
			.filter(function (l) {
				if (!q) return true;
				// جستجو حالا پاسخ‌های ربات و شناسه را هم می‌گیرد: از وقتی
				// «سطح» و «هدف» ستون واقعی شدند، جستجوی «مدیریت سرمایه»
				// هیچ نتیجه‌ای نمی‌داد در حالی که داده‌اش موجود بود.
				var answers = CrmData.botAnswers(l);
				var hay = [l.full_name, l.phone, l.lead_id, answers.level, answers.topic]
					.map(function (x) { return String(x || ""); }).join(" ");
				return hay.indexOf(q) !== -1;
			}));
	}

	// ─── ستون‌های تصمیم‌ساز ───────────────────────────────────────────
	//
	// «چه کسی امروز باید زنگ بخورد» اولین سوالِ هر روزِ کاری است و تا
	// امروز جوابش فقط در صفحه‌ی پیگیری‌ها و داخل پرونده بود. سه حالت
	// از هم جدا می‌مانند: عقب‌افتاده، امروز، و آینده - چون سه کارِ
	// متفاوت‌اند.

	// ارقام فارسی، همان‌طور که تاریخ‌ها نمایش داده می‌شوند. یک سطر با
	// «۱۴۰۵/۰۶/۰۹» کنارِ «2 روز» دو زبانِ عددی در یک خط است.
	function faNum(n) {
		return Number(n).toLocaleString("fa-IR");
	}

	function startOfToday() {
		var d = new Date();
		d.setHours(0, 0, 0, 0);
		return d;
	}

	function followupDate(lead) {
		var value = CrmData.leadFollowupAt(lead);
		if (!value) return null;
		var d = /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
			? CrmData.parseLocalDate(value.trim())
			: new Date(value);
		return isNaN(d.getTime()) ? null : d;
	}

	function followupCell(lead) {
		var $td = $("<td>").attr("data-label", "پیگیری بعدی").addClass("followup-cell");
		var due = followupDate(lead);
		if (!due) {
			$td.append($('<span class="text-muted text-sm">').text("ثبت نشده"));
			return $td;
		}
		var dayStart = new Date(due);
		dayStart.setHours(0, 0, 0, 0);
		var days = Math.round((dayStart - startOfToday()) / 86400000);

		var label;
		var cls = "";
		if (days < 0) {
			label = faNum(Math.abs(days)) + " روز عقب";
			cls = "is-overdue";
		} else if (days === 0) {
			label = "امروز";
			cls = "is-today";
		} else if (days === 1) {
			label = "فردا";
		} else {
			label = faNum(days) + " روز دیگر";
		}
		$td.append($('<span class="followup-label">').addClass(cls).text(label));
		// دلیل جای تاریخِ کامل را می‌گیرد وقتی هست: «چرا» بیشتر از «کِی»
		// به کار می‌آید، و هر دو در یک سلولِ باریک جا نمی‌شوند.
		var reason = String(lead.followup_reason || "").trim();
		$td.append($('<div class="row-subline">')
			.addClass(reason ? "followup-reason" : "")
			.attr("title", reason || "")
			.text(reason || due.toLocaleDateString("fa-IR")));
		return $td;
	}

	/** «۲ روز پیش» برای تاریخِ آخرین تماس. */
	function sinceLabel(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		var days = Math.floor((startOfToday() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
		if (days <= 0) return "امروز";
		if (days === 1) return "دیروز";
		if (days < 30) return faNum(days) + " روز پیش";
		return d.toLocaleDateString("fa-IR");
	}

	// سنِ لید، نه «آخرین به‌روزرسانی». آن یکی با هر تغییرِ کوچکی تازه
	// می‌شد، پس لیدِ ده‌روزه‌ای که همین حالا مشاورش عوض شده «۲ دقیقه
	// پیش» نشان می‌داد - دقیقاً برعکسِ چیزی که باید هشدار می‌داد.
	function leadAge(createdAt) {
		if (!createdAt) return "-";
		var d = new Date(createdAt);
		if (isNaN(d.getTime())) return "-";
		var days = Math.floor((startOfToday() - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
		if (days <= 0) return "امروز";
		if (days === 1) return "دیروز";
		return faNum(days) + " روز";
	}

	// ─── کشوی پاسخ‌های ربات ──────────────────────────────────────────
	//
	// چیزی که مشاور پیش از برداشتن گوشی لازم دارد و تا امروز فقط داخل
	// صفحه‌ی پرونده بود: سطح معامله‌گری و هدف از مشاوره، همان دو پرسشی
	// که ربات می‌پرسد. چند ردیف می‌توانند هم‌زمان باز باشند.

	var expanded = {};

	function formatDay(value) {
		if (!value) return "";
		var d = /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())
			? CrmData.parseLocalDate(String(value).trim())
			: new Date(value);
		return isNaN(d.getTime()) ? "" : d.toLocaleDateString("fa-IR");
	}

	function qaCard(question, answer) {
		var $box = $('<div class="qa-card">');
		$box.append($('<div class="qa-q">').text(question));
		// خالی بودن، «پرسیده نشده» است نه «داده گم شده»: لید اینستاگرام و
		// سایت هرگز از ربات رد نشده‌اند. یک خانه‌ی خالی این تفاوت را
		// پنهان می‌کند.
		$box.append(
			answer
				? $('<div class="qa-a">').text(answer)
				: $('<div class="qa-a is-empty">').text("پرسیده نشده")
		);
		return $box;
	}

	function metaCell(key, value, warn) {
		var $m = $('<div class="qa-meta">');
		$m.append($('<div class="qa-meta-k">').text(key));
		$m.append($('<div class="qa-meta-v">').addClass(warn ? "warn" : "").text(value));
		return $m;
	}

	// ─── اقدام سریع ──────────────────────────────────────────────────
	//
	// خودِ نوار در js/quick-actions.js است چون کارتابل هم همان را نشان
	// می‌دهد. اینجا فقط وصلش می‌کنیم: نتیجه کجا نوشته شود و بعدش چه
	// چیزی تازه شود.

	function quickActionBar(lead) {
		// نتیجه با توستِ مشترکِ صفحه گفته می‌شود، نه داخل خودِ کشو: پیامی
		// که در ردیف بنشیند با اولین بازسازیِ جدول پاک می‌شود - و بدتر،
		// خودِ آن بازسازی فیلدهای نیمه‌پرشده‌ی کشو را هم می‌برد.
		return CrmQuickActions.bar(lead, { refresh: loadLeads });
	}

	function drawerRow(lead) {
		var answers = CrmData.botAnswers(lead);
		var followUp = CrmData.leadFollowupAt(lead);
		var $wrap = $('<div class="lead-drawer">');

		var $head = $('<div class="lead-drawer-head">');
		if (answers.level || answers.topic) {
			$head.append($('<span class="info-pill pill-source">').text("پاسخ‌های ثبت‌شده در ربات"));
		} else {
			$head.append($('<span class="info-pill">').text("بدون پاسخ ربات"));
			$head.append($("<span>").text("این لید فرم ربات را پر نکرده است."));
		}
		if (lead.telegram_username) {
			$head.append($('<span class="info-pill mono">').text("@" + String(lead.telegram_username).replace(/^@/, "")));
		}
		$wrap.append($head);

		var $grid = $('<div class="qa-grid">');
		$grid.append(qaCard("📊 سطح فعلی معامله‌گری", answers.level));
		$grid.append(qaCard("💬 هدف از مشاوره", answers.topic));
		if (lead.course) $grid.append(qaCard("🎯 دوره‌ی انتخاب‌شده", lead.course));
		$wrap.append($grid);

		// آنچه از سطر برداشته شد اینجاست: چیزی گم نمی‌شود، فقط پشت یک
		// کلیک می‌رود.
		var $meta = $('<div class="qa-meta-strip">');
		$meta.append(metaCell("نوع درخواست", lead.request_type || "—"));
		$meta.append(metaCell("منبع", CrmData.sourceLabel(lead.source)));
		$meta.append(metaCell("پیگیری بعدی", followUp ? formatDay(followUp) : "ثبت نشده", isDueForFollowUp(lead)));
		$meta.append(metaCell("نتیجه آخرین تماس", lead.last_call_result || "—"));
		$meta.append(metaCell("آخرین تغییر", formatRelativeTime(lead.updated_at || lead.created_at)));
		$meta.append(metaCell("شناسه لید", lead.lead_id || "—"));
		$wrap.append($meta);

		$wrap.append(quickActionBar(lead));

		var $actions = $('<div class="lead-drawer-actions">');
		$actions.append($("<a>").addClass("btn btn-brand btn-sm")
			.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
			.text("باز کردن پرونده"));
		if (lead.phone) {
			$actions.append($("<a>").addClass("btn btn-outline-secondary btn-sm")
				.attr("href", "tel:" + lead.phone.replace(/[^\d+]/g, ""))
				.html('<i class="fas fa-phone mr-1"></i>تماس'));
		}
		$wrap.append($actions);

		return $('<tr class="lead-drawer-row">').append($("<td>").attr("colspan", 8).append($wrap));
	}

	function renderStats() {
		var total = state.leads.length;
		var pending = state.leads.filter(function (l) { return l.status === "پاسخ‌داده‌نشده"; }).length;
		var called = state.leads.filter(function (l) { return l.status === "تماس گرفته شد"; }).length;
		var noAnswer = state.leads.filter(function (l) { return l.status === "پاسخ نداد"; }).length;
		$("#stat-total").text(total);
		$("#stat-pending").text(pending);
		$("#stat-called").text(called);
		$("#stat-noanswer").text(noAnswer);

		var dueCount = state.leads.filter(isDueForFollowUp).length;
		$("#reminderTabCount").text(dueCount > 0 ? "(" + dueCount + ")" : "");

		var mineCount = state.leads.filter(isMine).length;
		$("#mineTabCount").text(mineCount > 0 ? "(" + faNum(mineCount) + ")" : "");

		var atRiskCount = state.leads.filter(isAtRisk).length;
		$("#atRiskTabCount").text(atRiskCount > 0 ? "(" + atRiskCount + ")" : "");
	}

	function renderTable() {
		var $body = $("#leadsTableBody").empty();
		$("#pagination").addClass("d-none");

		if (state.loading) {
			$body.append('<tr><td colspan="8"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>در حال بارگذاری...</p></div></td></tr>');
			return;
		}
		if (state.error) {
			$body.append('<tr><td colspan="8" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + state.error + '</td></tr>');
			return;
		}

		var rows = getFilteredRows();

		if (rows.length === 0) {
			$body.append('<tr><td colspan="8"><div class="empty-state"><i class="fas fa-inbox"></i><p>موردی یافت نشد.</p></div></td></tr>');
			return;
		}

		var totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
		if (state.page > totalPages) state.page = totalPages;
		var start = (state.page - 1) * PAGE_SIZE;
		var pageRows = rows.slice(start, start + PAGE_SIZE);

		pageRows.forEach(function (lead) {
			var meta = statusMeta(lead.status);
			var $tr = $("<tr>").addClass("lead-row row-" + meta.cls).attr("data-id", lead.lead_id);
			if (isAtRisk(lead)) $tr.addClass("row-at-risk");

			// The drawer opens from its own button, not from the row.
			// The row carries a status menu, a consultant menu and a call
			// link; if the whole row toggled, every one of those clicks
			// would open a drawer nobody asked for.
			var open = expanded[lead.lead_id] === true;
			$tr.append($("<td>").addClass("drawer-cell").append(
				$('<button type="button" class="drawer-toggle">')
					.attr({ "aria-expanded": String(open), title: "پاسخ‌های ثبت‌شده در ربات", "data-lead-id": lead.lead_id })
					.html('<i class="fas fa-chevron-down"></i>')
			));

			// نام، و زیرش دو نشانِ ریز: نوع درخواست و منبع. هر دو تا امروز
			// ستونِ کامل می‌گرفتند (یا اصلاً دیده نمی‌شدند) در حالی که یک
			// نگاهِ گذرا برایشان کافی است.
			var $nameCell = $("<td>");
			$nameCell.append($("<a>")
				.attr("href", "lead.html?id=" + encodeURIComponent(lead.lead_id))
				.addClass("lead-name-link")
				.text(lead.full_name || "(بدون نام)"));
			var $tags = $('<div class="row-tags">');
			if (lead.request_type) $tags.append($('<span class="row-tag">').text(lead.request_type));
			$tags.append($('<span class="row-tag tag-source">').text(CrmData.sourceLabel(lead.source)));
			$nameCell.append($tags);
			$tr.append($nameCell);

			// بدون برچسب: شماره خودش پیداست و دکمه‌ی تماس کنارش است. برچسبِ
			// فارسی داخل سلولی که dir="ltr" است حروفش درست به هم نمی‌چسبد.
			var $phoneCell = $("<td>").attr("dir", "ltr").addClass("mono phone-cell text-center");
			$phoneCell.append($("<span>").text(lead.phone || "-"));
			if (lead.phone) {
				$phoneCell.append($("<a>").addClass("quick-call-btn").attr({
					href: "tel:" + lead.phone.replace(/[^\d+]/g, ""),
					title: "تماس با " + (lead.full_name || "این لید")
				}).on("click", function (e) { e.stopPropagation(); }).html('<i class="fas fa-phone"></i>'));
				// tel: فقط روی گوشی کار می‌کند. مشاورِ پشتِ دسکتاپ تا امروز
				// شماره را از روی صفحه می‌خواند و در نرم‌افزار تماس تایپ
				// می‌کرد - جایی که یک رقمِ اشتباه یعنی زنگ زدن به غریبه.
				$phoneCell.append(CrmQuickActions.copyPhoneButton(lead.phone));
			}
			$tr.append($phoneCell);

			var $statusWrap = $("<div>").addClass("status-cell-wrap").append(statusSelectHtml(lead.lead_id, lead.status));
			if (isAtRisk(lead)) {
				$statusWrap.append('<span class="risk-icon" title="این لید مدتی است بدون پیگیری مانده"><i class="fas fa-triangle-exclamation"></i></span>');
			}
			var $statusCell = $("<td>").attr("data-label", "وضعیت").addClass("text-center").append($statusWrap);
			// «تماس گرفته شد» می‌گوید کاری کرده‌ایم؛ نتیجه‌اش می‌گوید چه
			// کرده‌ایم - و تصمیمِ بعدی از دومی می‌آید.
			if (lead.last_call_result) {
				$statusCell.append($('<div class="row-subline">').text(lead.last_call_result));
			}
			$tr.append($statusCell);

			$tr.append(followupCell(lead));

			var attempts = Number(lead.contact_attempts) || 0;
			var $tries = $("<td>").attr("data-label", "تماس‌ها").addClass("text-center").append(
				$('<span class="tries-count">').addClass(attempts ? "" : "is-zero").text(faNum(attempts))
			);
			// «سه تماس» به‌تنهایی گمراه‌کننده است: سه تماسِ دیروز و سه
			// تماسِ ماه پیش دو وضعیتِ کاملاً متفاوت‌اند.
			if (attempts && lead.last_call_at) {
				$tries.append($('<div class="row-subline">').text(sinceLabel(lead.last_call_at)));
			}
			$tr.append($tries);

			$tr.append($("<td>").attr("data-label", "مشاور").addClass("text-center").html(consultantSelectHtml(lead.lead_id, lead.assigned_to)));
			$tr.append($("<td>").attr("data-label", "سن لید").addClass("text-muted text-sm").text(leadAge(lead.created_at)));
			$body.append($tr);
			if (open) $body.append(drawerRow(lead));
		});

		if (rows.length > PAGE_SIZE) {
			$("#pagination").removeClass("d-none");
			$("#paginationInfo").text("صفحه " + state.page + " از " + totalPages + " (" + rows.length + " لید)");
			$("#btnPrevPage").prop("disabled", state.page <= 1);
			$("#btnNextPage").prop("disabled", state.page >= totalPages);
		}
	}

	function render() {
		renderStats();
		renderTable();
	}

	function loadLeads() {
		state.loading = true;
		state.error = null;
		render();
		CrmData.fetchLeads()
			.then(function (leads) {
				// Mentoring-form requests have their own page. Filtering here
				// rather than at render time keeps the counters, the tab
				// badges and the pagination agreeing with the visible rows.
				state.leads = leads.filter(function (l) { return !CrmData.isMentoringLead(l); });
				state.loading = false;
				render();
			})
			.catch(function (err) {
				state.loading = false;
				state.error = err.message || "خطای نامشخص";
				render();
			});
	}

	function loadConsultants() {
		if (typeof CrmData.fetchConsultants !== "function") return;
		CrmData.fetchConsultants()
			.then(function (list) {
				consultants = list || [];
				// The table may already be on screen; redraw so the dropdowns
				// get their options.
				if (!state.loading) renderTable();
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری فهرست مشاوران:", err);
			});
	}

	function populateSourceFilter() {
		var $sel = $("#sourceFilter");
		CrmData.LEAD_SOURCES.forEach(function (s) {
			// The mentoring source is excluded from this list entirely, so
			// offering it here would only ever select nothing.
			if (s.key === CrmData.MENTORING_SOURCE) return;
			$sel.append($("<option>").val(s.key).text(s.label));
		});
	}

	$(function () {
		populateSourceFilter();
		loadLeads();
		loadConsultants();

		$("#sourceFilter").on("change", function () {
			state.sourceFilter = $(this).val();
			state.page = 1;
			renderTable();
		});

		$("#filterTabs").on("click", ".filter-tab", function () {
			$(".filter-tab").removeClass("active");
			$(this).addClass("active");
			state.statusFilter = $(this).data("status");
			state.page = 1;
			renderTable();
		});

		$("#searchInput").on("input", function () {
			state.query = $(this).val();
			state.page = 1;
			renderTable();
		});

		$("#btnPrevPage").on("click", function () {
			if (state.page > 1) {
				state.page -= 1;
				renderTable();
			}
		});

		$("#btnNextPage").on("click", function () {
			state.page += 1;
			renderTable();
		});

		// ─── لید جدید ────────────────────────────────────────────────
		CrmData.LEAD_SOURCES.forEach(function (src) {
			// فرم منتورینگ سایت را خودِ سایت پر می‌کند؛ انتخابش اینجا
			// یعنی لیدی که در صفحه‌ی منتورینگ دیده می‌شود ولی از آنجا
			// نیامده.
			if (src.key === CrmData.MENTORING_SOURCE) return;
			$("#nlSource").append($("<option>").val(src.key).text(src.label));
		});
		$("#nlSource").val("instagram");

		$("#btnNewLead").on("click", function () {
			$("#newLeadResult").addClass("d-none").empty();
			$("#newLeadModal").modal("show");
			setTimeout(function () { $("#nlName").focus(); }, 250);
		});

		$("#btnSaveNewLead").on("click", function () {
			var $btn = $(this);
			var $out = $("#newLeadResult").removeClass("d-none text-success text-danger");
			var payload = {
				full_name: $("#nlName").val().trim(),
				phone: $("#nlPhone").val().trim(),
				source: $("#nlSource").val(),
				request_type: $("#nlRequestType").val(),
				course: $("#nlCourse").val(),
				level: $("#nlLevel").val().trim(),
				topic: $("#nlTopic").val().trim(),
				note: $("#nlNote").val().trim()
			};
			if (!payload.full_name || !payload.phone) {
				$out.addClass("text-danger").text("نام و شماره لازم است.");
				return;
			}
			$btn.prop("disabled", true).text("در حال ثبت…");
			CrmData.createLead(payload)
				.then(function (res) {
					if (res && res.ok === false) {
						// شماره‌ی تکراری: به‌جای خطای خشک، راهِ رفتن به
						// پرونده‌ی موجود داده می‌شود.
						$out.addClass("text-danger").text(res.error || "ثبت نشد.");
						if (res.existing_lead_id) {
							$out.append($("<a>").addClass("mr-2")
								.attr("href", "lead.html?id=" + encodeURIComponent(res.existing_lead_id))
								.text("باز کردن پرونده‌ی موجود"));
						}
						return;
					}
					$out.addClass("text-success").text("لید ثبت شد.");
					["#nlName", "#nlPhone", "#nlLevel", "#nlTopic", "#nlNote"].forEach(function (sel) {
						$(sel).val("");
					});
					CrmData.invalidateLeadsCache();
					loadLeads();
					setTimeout(function () { $("#newLeadModal").modal("hide"); }, 900);
				})
				.catch(function (err) {
					$out.addClass("text-danger").text("خطا: " + (err.message || "خطای نامشخص"));
				})
				.finally(function () {
					$btn.prop("disabled", false).text("ثبت لید");
				});
		});

		$("#leadsTableBody").on("click", ".drawer-toggle", function () {
			var leadId = $(this).data("lead-id");
			expanded[leadId] = !expanded[leadId];
			renderTable();
		});

		// کلیک بیرون، منوهای باز را می‌بندد. بدون این، دو منوی باز روی
		// هم می‌افتند و کاربر نمی‌داند کدام‌یک را انتخاب می‌کند.

		$("#leadsTableBody").on("change", ".status-select", function () {
			var $select = $(this);
			var leadId = $select.data("lead-id");
			var newStatus = $select.val();
			var lead = state.leads.find(function (l) { return String(l.lead_id) === String(leadId); });
			if (!lead) return;
			var previousStatus = lead.status;
			$select.addClass("is-saving");
			CrmData.updateLeadStatus(leadId, newStatus)
				.then(function () {
					lead.status = newStatus;
					lead.updated_at = new Date().toISOString();
					render();
				})
				.catch(function (err) {
					CrmToast.error("خطا در ثبت وضعیت: " + (err.message || "خطای نامشخص"));
					$select.val(previousStatus);
				})
				.finally(function () {
					$select.removeClass("is-saving");
				});
		});

		$("#leadsTableBody").on("change", ".assign-select", function () {
			var $select = $(this);
			var leadId = $select.data("lead-id");
			var newAssignee = $select.val();
			var lead = state.leads.find(function (l) { return String(l.lead_id) === String(leadId); });
			if (!lead) return;
			var previous = lead.assigned_to || "";
			$select.addClass("is-saving");
			CrmData.assignLead(leadId, newAssignee)
				.then(function () {
					lead.assigned_to = newAssignee;
					lead.updated_at = new Date().toISOString();
					render();
				})
				.catch(function (err) {
					CrmToast.error("خطا در ثبت مشاور: " + (err.message || "خطای نامشخص"));
					$select.val(previous);
				})
				.finally(function () {
					$select.removeClass("is-saving");
				});
		});
	});
})();
