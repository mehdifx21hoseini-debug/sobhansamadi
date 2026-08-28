// «کارکرد دستیار» — چه پرسیدند، چه گرفتند، کجا کم آورد.
//
// این بخش برای تماشا نیست، برای عمل است. هر سطری که به پشتیبانی رفته یا
// کاربر ردش کرده، یک مدخلِ نوشته‌نشده‌ی پایگاه دانش است — پس کنار هر
// کدام دکمه‌ای هست که همان سوال را در فرم افزودن باز می‌کند.
(function () {
	"use strict";

	var PAGE_SIZE = 20;
	var state = { filter: "all", q: "", page: 0, total: 0 };

	function fa(n) { return Number(n || 0).toLocaleString("fa-IR"); }

	function pct(n, of) {
		if (!of) return "—";
		return Math.round((n / of) * 100).toLocaleString("fa-IR") + "٪";
	}

	// چرا دستیار به انسان پاس داد. کدهای انگلیسی از خود مدل می‌آیند و
	// برای کسی که این صفحه را می‌خواند معنایی ندارند.
	var REASONS = {
		off_topic: "بی‌ربط به آکادمی",
		ai_flagged_sensitive: "خودش انسان خواست",
		no_answer: "در پایگاه دانش نبود"
	};

	function when(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return "—";
		return d.toLocaleDateString("fa-IR") + " " +
			d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
	}

	function renderStats(stats) {
		$("#ai-log-total").text(fa(stats.total));
		$("#ai-log-answered").text(fa(stats.answered));
		$("#ai-log-answered-pct").text(pct(stats.answered, stats.total));
		$("#ai-log-escalated").text(fa(stats.escalated));
		$("#ai-log-escalated-pct").text(pct(stats.escalated, stats.total));

		var votes = (stats.up || 0) + (stats.down || 0);
		$("#ai-log-votes").text(votes ? fa(stats.up) + " / " + fa(stats.down) : "—");
		$("#ai-log-votes-pct").text(votes ? pct(stats.up, votes) + " مثبت" : "هنوز رأیی ثبت نشده");

		var $reasons = $("#ai-log-reasons").empty();
		if (!stats.reasons || stats.reasons.length === 0) {
			$reasons.append($('<span class="text-muted text-sm">').text("هیچ سوالی به پشتیبانی نرفته."));
			return;
		}
		stats.reasons.forEach(function (r) {
			$reasons.append(
				$('<span class="ai-reason-chip">')
					.append($("<span>").text(REASONS[r.reason] || r.reason))
					.append($('<b class="mono">').text(fa(r.n)))
			);
		});
	}

	function statusCell(row) {
		var $wrap = $('<div class="ai-log-status">');
		if (row.needs_human) {
			$wrap.append($('<span class="status-badge badge-ticket-open">')
				.html('<i class="fas fa-user-check"></i>')
				.append(document.createTextNode("به پشتیبانی")));
			if (row.reason) {
				$wrap.append($('<span class="ai-log-reason">').text(REASONS[row.reason] || row.reason));
			}
		} else {
			$wrap.append($('<span class="status-badge badge-ticket-answered">')
				.html('<i class="fas fa-robot"></i>')
				.append(document.createTextNode("خودش جواب داد")));
		}
		if (row.vote === 1) $wrap.append($('<span class="ai-vote up" title="کاربر پسندید">👍</span>'));
		if (row.vote === -1) $wrap.append($('<span class="ai-vote down" title="کاربر رد کرد">👎</span>'));
		return $wrap;
	}

	function renderRows(rows) {
		var $body = $("#aiLogBody").empty();
		if (rows.length === 0) {
			$body.append($("<tr>").append(
				$('<td colspan="4">').append(
					$('<div class="empty-state">')
						.append('<i class="fas fa-comments"></i>')
						.append($("<p>").text(
							state.filter === "all" && !state.q
								? "هنوز سوالی از دستیار پرسیده نشده."
								: "با این فیلتر چیزی پیدا نشد."
						))
				)
			));
			return;
		}

		rows.forEach(function (row) {
			var $tr = $("<tr>");
			$tr.append($('<td class="ai-log-when mono">').text(when(row.created_at)));
			$tr.append($("<td>").append($('<span class="kb-question-text">').text(row.question || "—")));
			$tr.append($("<td>").append($('<span class="kb-answer-preview">').text(row.answer || "—")));

			var $actions = $('<td class="kb-actions-cell">').append(statusCell(row));

			// فقط جایی که واقعاً کاری هست: سوالی که جواب نگرفته یا جوابش
			// رد شده. گذاشتن این دکمه کنار هر سطر، آن را بی‌معنی می‌کرد.
			if (row.needs_human || row.vote === -1) {
				$actions.append(
					$('<button class="btn btn-sm btn-brand mt-1" title="این سوال را به پایگاه دانش اضافه کن">')
						.html('<i class="fas fa-plus mr-1"></i>افزودن پاسخ')
						.on("click", function () {
							if (typeof window.__kbOpenModal === "function") {
								window.__kbOpenModal({ question: row.question, answer: "", category: "" });
							}
						})
				);
			}
			$tr.append($actions);
			$body.append($tr);
		});
	}

	function renderPagination() {
		var pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
		if (state.page >= pages) state.page = pages - 1;
		var from = state.total === 0 ? 0 : state.page * PAGE_SIZE + 1;
		var to = Math.min(state.total, (state.page + 1) * PAGE_SIZE);
		$("#aiLogPaginationInfo").text(
			state.total === 0 ? "" : from + "–" + to + " از " + state.total + " گفتگو"
		);
		$("#btnAiLogPrev").prop("disabled", state.page <= 0);
		$("#btnAiLogNext").prop("disabled", state.page >= pages - 1);
	}

	function loadLog() {
		$("#aiLogBody").html(
			'<tr><td colspan="4" class="text-center text-muted py-4">' +
			'<i class="fas fa-spinner fa-spin"></i></td></tr>'
		);
		return CrmAi.fetchLog({
			filter: state.filter,
			q: state.q,
			limit: PAGE_SIZE,
			offset: state.page * PAGE_SIZE
		}).then(function (res) {
			state.total = res.total;
			renderRows(res.rows || []);
			renderPagination();
		}).catch(function (err) {
			if (CrmAi.isCancelled(err)) {
				$("#aiLogBody").html("");
				return;
			}
			$("#aiLogBody").html($("<tr>").append(
				$('<td colspan="4" class="text-center text-danger py-4">')
					.text("خطا در بارگذاری: " + (err.message || "خطای نامشخص"))
			));
		});
	}

	function loadStats() {
		return CrmAi.fetchOverview()
			.then(function (res) { renderStats(res.stats); })
			.catch(function (err) {
				if (CrmAi.isCancelled(err)) return;
				console.error("خطا در بارگذاری آمار دستیار:", err);
			});
	}

	// همگام‌سازی چند ثانیه طول می‌کشد (بردارها ساخته می‌شوند). بدون
	// نشانه، مدیر فکر می‌کند دکمه کار نکرده و دوباره می‌زند.
	function runSync() {
		var $btn = $("#btnAiSync").prop("disabled", true);
		var original = $btn.html();
		$btn.html('<i class="fas fa-spinner fa-spin mr-1"></i>در حال همگام‌سازی…');
		$("#aiSyncResult").addClass("d-none");

		CrmAi.sync()
			.then(function (res) {
				var parts = ["پایگاه دانش ساخته شد: " + fa(res.mirrored) + " مدخل"];
				if (res.stale > 0) parts.push(fa(res.stale) + " بردار قدیمی بازسازی شد");
				if (res.embedded > 0) parts.push(fa(res.embedded) + " بردار تازه");
				if (res.pending > 0) {
					parts.push(fa(res.pending) + " مدخل بردار نگرفت — یک‌بار دیگر بزنید");
				}
				$("#aiSyncResult").removeClass("d-none text-danger").addClass("text-success")
					.text(parts.join(" · "));
				if (typeof window.__kbReload === "function") window.__kbReload();
			})
			.catch(function (err) {
				if (CrmAi.isCancelled(err)) return;
				$("#aiSyncResult").removeClass("d-none text-success").addClass("text-danger")
					.text(err.message || "خطای نامشخص");
			})
			.finally(function () { $btn.prop("disabled", false).html(original); });
	}

	$(document).ready(function () {
		$("#aiLogTabs").on("click", ".filter-tab", function () {
			$("#aiLogTabs .filter-tab").removeClass("active");
			$(this).addClass("active");
			state.filter = $(this).data("filter");
			state.page = 0;
			loadLog();
		});

		var searchTimer = null;
		$("#aiLogSearch").on("input", function () {
			var value = $(this).val();
			// هر ضربه‌ی کلید یک درخواست نمی‌شود؛ منتظر می‌ماند تا تایپ تمام شود.
			clearTimeout(searchTimer);
			searchTimer = setTimeout(function () {
				state.q = value.trim();
				state.page = 0;
				loadLog();
			}, 350);
		});

		$("#btnAiLogPrev").on("click", function () {
			if (state.page > 0) { state.page--; loadLog(); }
		});
		$("#btnAiLogNext").on("click", function () {
			state.page++; loadLog();
		});
		$("#btnAiLogRefresh").on("click", function () { loadStats(); loadLog(); });
		$("#btnAiSync").on("click", runSync);

		loadStats();
		loadLog();
	});
})();
