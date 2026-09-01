(function () {
	"use strict";

	// The worklist answers one question: "who do I call next, and why?".
	// Every lead lands in exactly one bucket — the most urgent reason that
	// applies to it — so the same person can never appear twice and the
	// counts add up to the number of real actions waiting.
	var BUCKETS = [
		{
			key: "critical",
			title: "فوری",
			icon: "fa-fire",
			hint: "پیگیری عقب‌افتاده یا لیدی که دارد از دست می‌رود"
		},
		{
			key: "today",
			title: "امروز",
			icon: "fa-calendar-day",
			hint: "پیگیری‌هایی که برای امروز قرار گذاشته‌اید"
		},
		{
			key: "new",
			title: "تازه رسیده",
			icon: "fa-inbox",
			hint: "هنوز با این افراد تماس گرفته نشده"
		}
	];

	var state = {
		items: [],
		scope: "mine",
		query: "",
		loading: true,
		error: null
	};

	function username() {
		return sessionStorage.getItem("crmUsername") || "";
	}

	function displayName() {
		return sessionStorage.getItem("crmDisplayName") || "همکار";
	}

	function fa(n) {
		return Number(n || 0).toLocaleString("fa-IR");
	}

	function startOfToday() {
		var d = new Date();
		d.setHours(0, 0, 0, 0);
		return d.getTime();
	}

	function endOfToday() {
		var d = new Date();
		d.setHours(23, 59, 59, 999);
		return d.getTime();
	}

	// Follow-ups are stored either as a date-only string or a full timestamp.
	// Date-only values must be read as local midnight, otherwise anything
	// behind UTC lands on the previous day and reads as overdue a day early.
	function parseDue(value) {
		if (!value) return null;
		var raw = String(value).trim();
		var d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? CrmData.parseLocalDate(raw) : new Date(raw);
		return isNaN(d.getTime()) ? null : d;
	}

	function daysBetween(fromMs, toMs) {
		return Math.round((toMs - fromMs) / 86400000);
	}

	function agoLabel(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "";
		var mins = Math.floor((Date.now() - d.getTime()) / 60000);
		if (mins < 60) return fa(Math.max(mins, 1)) + " دقیقه پیش";
		var hours = Math.floor(mins / 60);
		if (hours < 24) return fa(hours) + " ساعت پیش";
		return fa(Math.floor(hours / 24)) + " روز پیش";
	}

	// The single ranking rule. Returns null for a lead that needs nothing
	// right now, so "no action" is an explicit outcome rather than a bucket
	// nobody looks at.
	function classify(lead) {
		var followup = CrmData.leadFollowupAt(lead);
		if (followup) {
			var due = parseDue(followup);
			if (due) {
				var dueMs = due.getTime();
				if (dueMs < startOfToday()) {
					var late = daysBetween(dueMs, startOfToday());
					return {
						bucket: "critical",
						icon: "fa-clock-rotate-left",
						reason: late > 0 ? fa(late) + " روز از پیگیری گذشته" : "پیگیری سررسید شده",
						followup: followup
					};
				}
				if (dueMs <= endOfToday()) {
					return {
						bucket: "today",
						icon: "fa-calendar-check",
						reason: "پیگیری برای امروز",
						followup: followup
					};
				}
				// Scheduled for a future day — nothing to do today.
				return null;
			}
		}

		if (CrmData.isAtRisk(lead)) {
			return {
				bucket: "critical",
				icon: "fa-triangle-exclamation",
				reason: "در ریسک از دست رفتن",
				followup: ""
			};
		}

		if (lead.status === "پاسخ‌داده‌نشده") {
			return {
				bucket: "new",
				icon: "fa-user-plus",
				reason: "هنوز تماس گرفته نشده",
				followup: ""
			};
		}

		return null;
	}

	// منتورینگ در کارتابل نمی‌آید.
	//
	// تماس با درخواست‌های منتورینگ کارِ شخص دیگری است، پس آوردنشان اینجا
	// یعنی مشاورِ مشاوره هر روز ردیف‌هایی را می‌بیند که مالِ او نیست و
	// باید از رویشان رد شود. صفحه‌ی منتورینگ خودش شمارنده‌ی پیگیری دارد.
	function buildItems(leads) {
		var out = [];
		(leads || []).forEach(function (lead) {
			if (CrmData.isMentoringLead(lead)) return;
			var verdict = classify(lead);
			if (!verdict) return;
			out.push({
				lead: lead,
				lead_id: lead.lead_id,
				name: lead.full_name || "(بدون نام)",
				phone: lead.phone || "",
				course: lead.course || "",
				assigned_to: lead.assigned_to || "",
				status: lead.status || "",
				created_at: lead.created_at,
				updated_at: lead.updated_at,
				followup_reason: lead.followup_reason || "",
				bucket: verdict.bucket,
				icon: verdict.icon,
				reason: verdict.reason,
				followup: verdict.followup
			});
		});
		return out;
	}

	function matches(item) {
		if (state.scope === "mine" && item.assigned_to !== username()) return false;
		var q = state.query.trim().toLowerCase();
		if (!q) return true;
		return [item.name, item.phone, item.course]
			.join(" ")
			.toLowerCase()
			.indexOf(q) !== -1;
	}

	function buildItemEl(item) {
		var $item = $("<article>").addClass("queue-item queue-" + item.bucket);

		var $main = $("<div>").addClass("queue-item-main");
		$main.append(
			$("<a>")
				.addClass("queue-item-name")
				.attr("href", "lead.html?id=" + encodeURIComponent(item.lead_id))
				.text(item.name)
		);

		var $meta = $("<div>").addClass("queue-item-meta");
		$meta.append(
			$("<span>").addClass("queue-reason")
				.append($("<i>").addClass("fas " + item.icon))
				.append(document.createTextNode(item.reason))
		);
		// دلیلِ پیگیری جای اسمِ دوره را می‌گیرد: سررسیدِ امروز یعنی مشاور
		// باید بداند قرار بوده چه بگوید، نه اینکه کدام دوره را دیده.
		if (item.followup_reason) {
			$meta.append($("<span>").addClass("queue-chip is-reason")
				.append($("<i>").addClass("fas fa-quote-right"))
				.append(document.createTextNode(item.followup_reason)));
		} else if (item.course) {
			$meta.append($("<span>").addClass("queue-chip").text(item.course));
		}
		if (state.scope === "all") {
			$meta.append(
				$("<span>").addClass("queue-chip is-quiet")
					.text(item.assigned_to ? "مشاور: " + item.assigned_to : "بدون مشاور")
			);
		}
		if (item.bucket === "new" && item.created_at) {
			$meta.append($("<span>").addClass("queue-chip is-quiet").text(agoLabel(item.created_at)));
		}
		$main.append($meta);
		$item.append($main);

		var $actions = $("<div>").addClass("queue-item-actions");
		if (item.phone) {
			$actions.append($("<span>").addClass("queue-phone mono").attr("dir", "ltr").text(item.phone));
			$actions.append(
				$("<a>").addClass("quick-call-btn")
					.attr({ href: "tel:" + item.phone.replace(/[^\d+]/g, ""), title: "تماس با " + item.name })
					.html('<i class="fas fa-phone"></i>')
			);
		}
		if (item.followup) {
			var $done = $('<button type="button" class="btn btn-sm btn-outline-success queue-done-btn">')
				.html('<i class="fas fa-check mr-1"></i>انجام شد');
			$done.on("click", function () {
				// تاییدِ قبلی برداشته شد: بستنِ پیگیری برگشت‌پذیر است و
				// «بازگرداندن» بعدی هم جلوی اشتباه را می‌گیرد و هم به هر
				// بارِ درست یک کلیک اضافه نمی‌کند.
				var previous = item.followup;
				$done.prop("disabled", true);
				CrmData.setLeadFollowup(item.lead_id, "")
					.then(function () {
						CrmData.invalidateLeadsCache();
						CrmToast.undo("پیگیری «" + item.name + "» بسته شد.", function () {
							CrmData.setLeadFollowup(item.lead_id, previous)
								.then(function () { CrmData.invalidateLeadsCache(); load(); })
								.catch(function (err) {
									CrmToast.error("بازگرداندن نشد: " + (err.message || "خطای نامشخص"));
								});
						});
						load();
					})
					.catch(function (err) {
						CrmToast.error("خطا در بستن پیگیری: " + (err.message || "خطای نامشخص"));
						$done.prop("disabled", false);
					});
			});
			$actions.append($done);
		}
		// نوارِ اقدام سریع - همان چیزی که در فهرست لیدها هست.
		//
		// بسته باز می‌شود تا صف کوتاه بماند: کارتابل جایی است که مشاور
		// از بالا به پایین می‌رود، و اگر هر مورد سه کشو را باز نشان بدهد
		// دیگر یک صف نیست. یک کلیک، همان‌جا، بدون رفتن به پرونده.
		var $toggle = $('<button type="button" class="btn btn-sm btn-outline-secondary queue-qa-toggle">')
			.html('<i class="fas fa-bolt mr-1"></i>اقدام سریع');
		$actions.append($toggle);
		$item.append($actions);

		var $qaWrap = $('<div class="queue-item-qa d-none">');
		var built = false;
		$toggle.on("click", function (e) {
			e.stopPropagation();
			if (!built) {
				built = true;
				$qaWrap.append(CrmQuickActions.bar(item.lead, {
					compact: true,
					refresh: function () { CrmData.invalidateLeadsCache(); load(); }
				}));
			}
			$qaWrap.toggleClass("d-none");
			var open = !$qaWrap.hasClass("d-none");
			$toggle.toggleClass("is-open", open);
			// موردِ باز باید روی گروه‌های بعدی بیفتد، وگرنه کشوها پشتِ
			// عنوانِ گروهِ بعدی می‌روند و کلیک به آن‌ها نمی‌رسد.
			$item.toggleClass("has-qa-open", open);
			// گروه هم بالا می‌آید: هر گروه به‌خاطر انیمیشنِ ورودش یک
			// لایه‌ی مستقل است، پس بالا بردنِ خودِ مورد از گروهِ بعدی رد
			// نمی‌شود.
			$item.closest(".queue-group").toggleClass("has-qa-open", open);
		});
		$item.append($qaWrap);

		return $item;
	}


	function renderSummary(visibleCount) {
		var $summary = $("#todayHeroSummary");
		if (state.loading) {
			$summary.text("در حال بررسی کارتابل…");
			return;
		}
		if (state.error) {
			$summary.text("خطا در دریافت اطلاعات: " + state.error);
			return;
		}
		if (visibleCount === 0) {
			$summary.text(state.scope === "mine"
				? "کارتابل شما خالی است — همه‌چیز پیگیری شده."
				: "هیچ موردی در انتظار اقدام نیست.");
			return;
		}
		$summary.text(fa(visibleCount) + " مورد در انتظار اقدام شماست.");
	}

	function renderNavBadge(criticalCount) {
		var $badge = $("#todayActionCount");
		if (criticalCount > 0) $badge.text(fa(criticalCount)).removeClass("d-none");
		else $badge.addClass("d-none");
	}

	function render() {
		var $queue = $("#todayQueue").empty();

		if (state.loading) {
			$queue.append('<div class="card shade"><div class="card-body"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>در حال بارگذاری…</p></div></div></div>');
			renderSummary(0);
			return;
		}
		if (state.error) {
			var $errState = $('<div class="empty-state">')
				.append('<i class="fas fa-triangle-exclamation"></i>')
				.append($("<p>").text("خطا در دریافت اطلاعات: " + state.error));
			$queue.append($('<div class="card shade">').append($('<div class="card-body">').append($errState)));
			renderSummary(0);
			return;
		}

		var visible = state.items.filter(matches);
		renderSummary(visible.length);

		var criticalCount = visible.filter(function (i) { return i.bucket === "critical"; }).length;
		renderNavBadge(criticalCount);

		if (visible.length === 0) {
			$queue.append(
				'<div class="card shade today-allclear animate-in">' +
				'<div class="card-body">' +
				'<i class="fas fa-mug-hot"></i>' +
				'<h4>کارتابل خالی است</h4>' +
				'<p>هیچ پیگیری عقب‌افتاده یا تماس انجام‌نشده‌ای باقی نمانده.</p>' +
				'<a class="btn btn-brand btn-sm" href="index.html"><i class="fas fa-users mr-1"></i>مشاهده همه لیدها</a>' +
				'</div></div>'
			);
			return;
		}

		BUCKETS.forEach(function (bucket, idx) {
			var rows = visible.filter(function (i) { return i.bucket === bucket.key; });
			if (rows.length === 0) return;

			var $section = $("<section>").addClass("queue-group queue-group-" + bucket.key + " animate-in d-" + Math.min(idx + 1, 4));

			var $head = $("<header>").addClass("queue-group-head");
			$head.append($("<span>").addClass("queue-group-icon").append($("<i>").addClass("fas " + bucket.icon)));
			var $titleWrap = $("<div>").addClass("queue-group-titles");
			$titleWrap.append($("<h4>").text(bucket.title));
			$titleWrap.append($("<p>").text(bucket.hint));
			$head.append($titleWrap);
			$head.append($("<span>").addClass("queue-group-count").text(fa(rows.length)));
			$section.append($head);

			var $items = $("<div>").addClass("queue-items");
			rows.forEach(function (item) { $items.append(buildItemEl(item)); });
			$section.append($items);

			$queue.append($section);
		});
	}

	function load() {
		state.loading = true;
		state.error = null;
		render();

		return CrmData.fetchLeads()
			.then(function (leads) {
				state.items = buildItems(leads).sort(function (a, b) {
					// Within a bucket the oldest thing waiting goes first —
					// that is the one closest to being lost.
					return new Date(a.updated_at || a.created_at || 0) - new Date(b.updated_at || b.created_at || 0);
				});
				state.loading = false;
				render();
			})
			.catch(function (err) {
				state.loading = false;
				state.error = (err && err.message) || "خطای نامشخص";
				render();
			});
	}

	$(function () {
		$("#todayUserName").text(displayName());
		$("#todayDate").text(new Date().toLocaleDateString("fa-IR", {
			weekday: "long", year: "numeric", month: "long", day: "numeric"
		}));

		// A manager has no personal queue to open on, so "all" is the useful
		// default for them and "mine" for everyone who actually works a list.
		if (sessionStorage.getItem("crmRole") !== "consultant") {
			state.scope = "all";
			$("#todayScopeTabs .filter-tab").removeClass("active");
			$('#todayScopeTabs .filter-tab[data-scope="all"]').addClass("active");
		}

		$("#todayScopeTabs").on("click", ".filter-tab", function () {
			$("#todayScopeTabs .filter-tab").removeClass("active");
			$(this).addClass("active");
			state.scope = $(this).data("scope");
			render();
		});

		$("#todaySearch").on("input", function () {
			state.query = this.value;
			render();
		});

		$("#btnRefreshToday").on("click", function () {
			CrmData.invalidateLeadsCache();
			load();
		});

		load();
	});
})();
