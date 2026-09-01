(function () {
	"use strict";

	var kbRows = [];
	var searchTerm = "";
	var categoryFilter = "";
	var needsCompletionOnly = false;
	var unusedOnly = false;
	var kbPageIndex = 0;
	var KB_PAGE_SIZE = 25;

	function normalizeForCompare(text) {
		return (text || "")
			.toString()
			.trim()
			.toLowerCase()
			.replace(/[‌\s]+/g, " ")
			.replace(/[؟?.!،,؛;«»"'()]/g, "");
	}

	function wordOverlapDetail(a, b) {
		var wordsA = normalizeForCompare(a).split(" ").filter(Boolean);
		var wordsB = normalizeForCompare(b).split(" ").filter(Boolean);
		if (wordsA.length === 0 || wordsB.length === 0) return { ratio: 0, common: 0 };
		var setB = {};
		wordsB.forEach(function (w) { setB[w] = true; });
		var common = wordsA.filter(function (w) { return setB[w]; }).length;
		return { ratio: common / Math.min(wordsA.length, wordsB.length), common: common };
	}

	function wordOverlapRatio(a, b) {
		return wordOverlapDetail(a, b).ratio;
	}

	// از کجا آمده. برای مدیر مهم است چون سرنوشت مدخل فرق می‌کند: مدخلی
	// که از متن بخش‌های ربات می‌آید تا وقتی دست‌نخورده است با /edit در
	// تلگرام عوض می‌شود، و ویرایشش از اینجا آن پیوند را می‌بُرد.
	var SOURCE_LABEL = {
		manual: { text: "دستی", cls: "kb-src-manual" },
		section: { text: "متن ربات", cls: "kb-src-section" },
		seed: { text: "پایه", cls: "kb-src-seed" }
	};

	function sourceBadge(row) {
		var info = SOURCE_LABEL[row.source];
		if (!info) return $();
		var $chip = $('<span class="kb-source-chip">').addClass(info.cls).text(info.text);
		if (row.pinned) {
			$chip = $chip.add(
				$('<span class="kb-source-chip kb-src-pinned" title="این متن را شما نوشته‌اید و همگام‌سازی رویش نمی‌نویسد">')
					.html('<i class="fas fa-thumbtack"></i>')
			);
		}
		return $chip;
	}

	function statusBadge(row) {
		if (row.needs_completion) {
			return '<span class="status-badge badge-ticket-open"><i class="fas fa-triangle-exclamation"></i>نیاز به تکمیل</span>';
		}
		if (row.active === false) {
			return '<span class="status-badge badge-ticket-closed"><i class="fas fa-ban"></i>غیرفعال</span>';
		}
		return '<span class="status-badge badge-ticket-answered"><i class="fas fa-check"></i>فعال</span>';
	}

	function populateCategoryOptions() {
		var counts = {};
		kbRows.forEach(function (r) {
			if (!r.category) return;
			counts[r.category] = (counts[r.category] || 0) + 1;
		});
		var categories = Object.keys(counts).sort();
		var $filter = $("#kbCategoryFilter");
		var current = $filter.val();
		$filter.find("option:not(:first)").remove();
		categories.forEach(function (c) {
			$filter.append($("<option>").val(c).text(c + " (" + counts[c] + ")"));
		});
		$filter.val(current || "");

		var $list = $("#kbCategoryList").empty();
		categories.forEach(function (c) {
			$list.append($("<option>").val(c));
		});
	}

	function getFilteredRows() {
		return kbRows.filter(function (r) {
			if (needsCompletionOnly && !r.needs_completion) return false;
			if (unusedOnly && r.usage_count) return false;
			if (categoryFilter && r.category !== categoryFilter) return false;
			if (searchTerm) {
				var haystack = ((r.question || "") + " " + (r.answer || "") + " " + (r.category || "")).toLowerCase();
				if (haystack.indexOf(searchTerm) === -1) return false;
			}
			return true;
		});
	}

	// Categories get a stable color so the eye can group rows without reading
	// them. Six tones, picked by a hash of the name, so the same category is
	// always the same color across reloads.
	var CATEGORY_TONE_COUNT = 6;

	function categoryChip(name) {
		if (!name) return $('<span class="kb-category-chip is-none">').text("بدون‌دسته");
		var hash = 0;
		for (var i = 0; i < name.length; i++) {
			hash = (hash * 31 + name.charCodeAt(i)) % 100000;
		}
		return $('<span class="kb-category-chip">').addClass("kb-cat-t" + (hash % CATEGORY_TONE_COUNT)).text(name);
	}

	function usageCell(row) {
		var count = row.usage_count || 0;
		// An entry the assistant has never used is the actionable case — either
		// the wording does not match how people actually ask, or it is dead
		// weight. Flag it instead of printing a quiet "هرگز".
		if (count === 0) {
			return $('<span class="kb-usage-never">').text("استفاده نشده");
		}
		var $wrap = $('<div class="kb-usage-cell">');
		$wrap.append($('<span class="kb-usage-count mono">').text(count.toLocaleString("fa-IR")));
		if (row.last_used_at) {
			var d = new Date(row.last_used_at);
			if (!isNaN(d.getTime())) {
				$wrap.append($('<span class="kb-usage-date">').text(d.toLocaleDateString("fa-IR")));
			}
		}
		return $wrap;
	}

	function hasActiveFilters() {
		return !!(searchTerm || categoryFilter || needsCompletionOnly || unusedOnly);
	}

	function clearFilters() {
		searchTerm = "";
		categoryFilter = "";
		needsCompletionOnly = false;
		unusedOnly = false;
		$("#kbSearchInput").val("");
		$("#kbCategoryFilter").val("");
		$("#kbNeedsCompletionOnly").prop("checked", false);
		$("#kbUnusedOnly").prop("checked", false);
		$("#cardKbNeeds, #cardKbUnused").removeClass("is-active");
		kbPageIndex = 0;
		renderKb();
	}

	function renderKbSkeleton() {
		var $body = $("#kbTableBody").empty();
		for (var i = 0; i < 5; i++) {
			var $tr = $('<tr class="kb-skeleton-row">');
			for (var c = 0; c < 6; c++) {
				$tr.append($("<td>").append('<span class="kb-skeleton-bar"></span>'));
			}
			$body.append($tr);
		}
		$("#kbPagination").addClass("d-none");
	}

	function renderKbPagination(totalRows, pageCount) {
		var $info = $("#kbPaginationInfo");
		var $pagination = $("#kbPagination");
		if (totalRows === 0) {
			$pagination.addClass("d-none");
			return;
		}
		$pagination.removeClass("d-none");
		var startIdx = totalRows === 0 ? 0 : (kbPageIndex * KB_PAGE_SIZE) + 1;
		var endIdx = Math.min(totalRows, (kbPageIndex + 1) * KB_PAGE_SIZE);
		$info.text(startIdx + "–" + endIdx + " از " + totalRows + " مدخل — صفحه " + (kbPageIndex + 1) + " از " + pageCount);
		$("#btnKbPrevPage").prop("disabled", kbPageIndex <= 0);
		$("#btnKbNextPage").prop("disabled", kbPageIndex >= pageCount - 1);
	}

	function renderKb() {
		var $body = $("#kbTableBody").empty();
		var allRows = getFilteredRows();
		var pageCount = Math.max(1, Math.ceil(allRows.length / KB_PAGE_SIZE));
		if (kbPageIndex >= pageCount) kbPageIndex = pageCount - 1;
		if (kbPageIndex < 0) kbPageIndex = 0;
		var rows = allRows.slice(kbPageIndex * KB_PAGE_SIZE, (kbPageIndex + 1) * KB_PAGE_SIZE);
		renderKbPagination(allRows.length, pageCount);
		if (rows.length === 0) {
			// "Nothing here yet" and "your filters matched nothing" are very
			// different situations; only the second one is fixable by a click.
			var $cell = $('<td colspan="6">');
			var $empty = $('<div class="empty-state">');
			if (hasActiveFilters()) {
				$empty.append('<i class="fas fa-filter"></i>');
				$empty.append("<p>با این فیلترها مدخلی پیدا نشد.</p>");
				$empty.append(
					$('<button type="button" class="btn btn-sm btn-outline-secondary">')
						.html('<i class="fas fa-xmark mr-1"></i>پاک کردن فیلترها')
						.on("click", clearFilters)
				);
			} else {
				$empty.append('<i class="fas fa-brain"></i>');
				$empty.append("<p>پایگاه دانش هنوز خالیه — با دکمه «افزودن به پایگاه دانش» اولین مدخل رو بساز.</p>");
			}
			$body.append($("<tr>").append($cell.append($empty)));
			return;
		}
		rows.forEach(function (r) {
			var $tr = $("<tr>").toggleClass("kb-row-inactive", r.active === false);
			$tr.append($("<td>").append(categoryChip(r.category)).append(sourceBadge(r)));
			$tr.append($("<td>").append($('<span class="kb-question-text">').text(r.question || "—")));
			var $answer = r.answer
				? $('<span class="kb-answer-preview">').text(r.answer)
				: $('<span class="kb-answer-empty">').text("بدون پاسخ");
			$tr.append($("<td>").append($answer));
			$tr.append($("<td>").html(statusBadge(r)));
			$tr.append($("<td>").append(usageCell(r)));

			var $editBtn = $('<button class="btn btn-sm btn-outline-secondary mr-1" title="ویرایش"><i class="fas fa-pen"></i></button>');
			$editBtn.on("click", function () { openKbModal(r); });

			var $deleteBtn = $('<button class="btn btn-sm btn-outline-danger" title="حذف"><i class="fas fa-trash"></i></button>');
			$deleteBtn.on("click", function () {
				CrmToast.confirm("مدخل «" + (r.question || "") + "» از پایگاه دانش پاک می‌شود.",
					{ title: "حذف مدخل؟", confirmLabel: "حذف کن", danger: true }
				).then(function (yes) {
					if (!yes) return;
					CrmAi.deleteKnowledge(r.id).then(loadKb).catch(function (err) {
						CrmToast.error("خطا در حذف: " + (err.message || "خطای نامشخص"));
					});
				});
			});

			var $actions = $('<td class="kb-actions-cell">').append($editBtn).append($deleteBtn);
			$tr.append($actions);
			$body.append($tr);
		});
	}

	function serializeKbText(rows) {
		return rows.map(function (r) {
			var head = "## دسته: " + (r.category || "بدون‌دسته") + (r.active === false ? " (غیرفعال)" : "");
			return head + "\nسوال: " + (r.question || "") + "\nپاسخ: " + (r.answer || "");
		}).join("\n\n");
	}

	function parseKbText(text) {
		var lines = text.split("\n");
		var entries = [];
		var current = null;
		var mode = null;
		lines.forEach(function (line) {
			var headMatch = line.match(/^##\s*دسته:\s*(.*)$/);
			if (headMatch) {
				if (current) entries.push(current);
				var catRaw = headMatch[1].trim();
				var active = true;
				var cat = catRaw;
				var inactiveMatch = catRaw.match(/^(.*)\(غیرفعال\)\s*$/);
				if (inactiveMatch) {
					cat = inactiveMatch[1].trim();
					active = false;
				}
				current = { category: cat, question: "", answer: "", active: active };
				mode = null;
				return;
			}
			if (!current) return;
			var qMatch = line.match(/^سوال:\s*(.*)$/);
			if (qMatch) {
				current.question = qMatch[1].trim();
				mode = null;
				return;
			}
			var aMatch = line.match(/^پاسخ:\s*(.*)$/);
			if (aMatch) {
				current.answer = aMatch[1];
				mode = "answer";
				return;
			}
			if (mode === "answer") {
				current.answer += "\n" + line;
			}
		});
		if (current) entries.push(current);
		return entries
			.filter(function (e) { return e.question; })
			.map(function (e) {
				e.answer = e.answer.trim();
				return e;
			});
	}

	function fillKbTextFromRows() {
		$("#kbFullText").val(serializeKbText(kbRows));
		updateKbTextEntryCount();
	}

	function updateKbTextEntryCount() {
		var parsed = parseKbText($("#kbFullText").val());
		$("#kbTextEntryCount").text(parsed.length + " مدخل شناسایی شد");
	}

	function saveKbText() {
		var text = $("#kbFullText").val();
		var entries = parseKbText(text);
		if (entries.length === 0) {
			$("#kbBulkSaveResult").removeClass("d-none text-success").addClass("text-danger").text("متن خالیه یا هیچ مدخل معتبری توش پیدا نشد؛ چیزی ذخیره نشد.");
			return;
		}
		CrmToast.confirm(
			"کلِ پایگاه دانش (" + kbRows.length + " مدخل فعلی) با این متن (" + entries.length + " مدخل) جای‌گزین می‌شود.",
			{ title: "جای‌گزینی کل پایگاه دانش؟", confirmLabel: "جای‌گزین کن", danger: true }
		).then(function (yes) {
			if (yes) doSaveKbText(entries);
		});
	}

	function doSaveKbText(entries) {
		var $btn = $("#btnSaveKbText").prop("disabled", true);
		CrmAi.bulkSaveKnowledge(entries)
			.then(function () {
				$("#kbBulkSaveResult").removeClass("d-none text-danger").addClass("text-success").text("ذخیره شد (" + entries.length + " مدخل).");
				loadKb().then(function () { fillKbTextFromRows(); });
				loadOverview();
			})
			.catch(function (err) {
				$("#kbBulkSaveResult").removeClass("d-none text-success").addClass("text-danger").text(err.message || "خطای نامشخص");
			})
			.finally(function () { $btn.prop("disabled", false); });
	}

	function loadKb() {
		renderKbSkeleton();
		return CrmAi.fetchKnowledge()
			.then(function (res) {
				kbRows = Array.isArray(res) ? res : [];
				kbPageIndex = 0;
				populateCategoryOptions();
				renderKb();
				// Not part of the overview endpoint; the rows are already here,
				// so count locally rather than adding a round-trip.
				$("#ai-kb-unused").text(kbRows.filter(function (r) { return !r.usage_count; }).length);
			})
			.catch(function (err) {
				// انصراف از پنجره‌ی کلید خطا نیست؛ نشان دادن «خطا در
				// بارگذاری» فقط کاربر را دنبال مشکلی می‌فرستاد که نیست.
				var msg = CrmAi.isCancelled(err)
					? "برای دیدن پایگاه دانش، کلید دسترسی لازم است. صفحه را دوباره باز کنید."
					: "خطا در بارگذاری: " + (err.message || "خطای نامشخص");
				$("#kbTableBody").html($("<tr>").append(
					$('<td colspan="6" class="text-center text-danger py-4">').text(msg)
				));
			});
	}

	function loadOverview() {
		if (typeof CrmAi.fetchOverview !== "function") return;
		CrmAi.fetchOverview()
			.then(function (res) {
				// «کل» و «فعال» از یک عدد می‌آیند: در این پایگاه دانش،
				// مدخل غیرفعال اصلاً برگردانده نمی‌شود — حذف یعنی حذف.
				$("#ai-kb-total").text(res.kb.total || 0);
				$("#ai-kb-active").text(res.kb.total || 0);
				$("#ai-kb-needs").text(kbRows.filter(function (r) { return r.needs_completion; }).length);
				$("#ai-escalations-week").text(res.stats.escalated || 0);
			})
			.catch(function (err) {
				if (CrmAi.isCancelled(err)) return;
				console.error("خطا در بارگذاری آمار هوش مصنوعی:", err);
			});
	}

	function openKbModal(r) {
		r = r || {};
		$("#editKbModal").data("rowId", r.id || "");
		$("#kbCategory").val(r.category || "");
		$("#kbQuestion").val(r.question || "");
		$("#kbAnswer").val(r.answer || "");
		$("#kbActive").prop("checked", r.active !== false);
		$("#kbSaveResult").addClass("d-none");
		$("#editKbModal").modal("show");
	}

	function saveKb() {
		var question = $("#kbQuestion").val().trim();
		var answer = $("#kbAnswer").val().trim();
		if (!question) {
			$("#kbSaveResult").removeClass("d-none text-success").addClass("text-danger").text("سوال الزامیه.");
			return;
		}
		var payload = {
			id: $("#editKbModal").data("rowId") || undefined,
			category: $("#kbCategory").val().trim(),
			question: question,
			answer: answer,
			active: $("#kbActive").is(":checked")
		};
		var $btn = $("#btnSaveKb").prop("disabled", true);
		CrmAi.saveKnowledge(payload)
			.then(function () {
				$("#kbSaveResult").removeClass("d-none text-danger").addClass("text-success").text("ذخیره شد.");
				loadKb();
				loadOverview();
				if (typeof window.__kbCuratorClear === "function") window.__kbCuratorClear();
				setTimeout(function () { $("#editKbModal").modal("hide"); }, 500);
			})
			.catch(function (err) {
				$("#kbSaveResult").removeClass("d-none text-success").addClass("text-danger").text(err.message || "خطای نامشخص");
			})
			.finally(function () { $btn.prop("disabled", false); });
	}

	var AUDIT_DUPLICATE_THRESHOLD = 0.6;
	var AUDIT_MIN_COMMON_WORDS = 3;

	function findDuplicatePairs() {
		var pairs = [];
		for (var i = 0; i < kbRows.length; i++) {
			for (var j = i + 1; j < kbRows.length; j++) {
				var detail = wordOverlapDetail(kbRows[i].question, kbRows[j].question);
				if (detail.ratio >= AUDIT_DUPLICATE_THRESHOLD && detail.common >= AUDIT_MIN_COMMON_WORDS) {
					pairs.push({ a: kbRows[i], b: kbRows[j], score: detail.ratio });
				}
			}
		}
		pairs.sort(function (x, y) { return y.score - x.score; });
		return pairs;
	}

	function renderDuplicatePair(pair) {
		var $card = $('<div class="kb-dup-pair">');
		$card.append($('<span class="kb-dup-score">').text("شباهت " + Math.round(pair.score * 100) + "٪"));
		[pair.a, pair.b].forEach(function (row) {
			var $entry = $('<div class="kb-dup-entry">');
			var $text = $('<div class="kb-dup-entry-text">')
				.append($("<span>").text(row.question || "—"))
				.append($('<span class="kb-dup-category">').text("دسته: " + (row.category || "بدون‌دسته")));
			var $editBtn = $('<button type="button" class="btn btn-sm btn-outline-secondary">')
				.text("ویرایش")
				.on("click", function () {
					$("#kbDuplicateAuditModal").modal("hide");
					openKbModal(row);
				});
			$entry.append($text).append($editBtn);
			$card.append($entry);
		});
		return $card;
	}

	function runDuplicateAudit() {
		var $result = $("#kbDuplicateAuditResult").empty();
		var pairs = findDuplicatePairs();
		if (pairs.length === 0) {
			$result.append('<div class="empty-state"><i class="fas fa-circle-check" style="color:#2e9e6d;opacity:.75"></i><p>هیچ مدخل تکراری یا خیلی شبیه پیدا نشد.</p></div>');
		} else {
			// The percentage has to come from the constant, not a literal — it
			// used to say ۷۰٪ while the threshold was actually 60٪.
			var thresholdPct = Math.round(AUDIT_DUPLICATE_THRESHOLD * 100).toLocaleString("fa-IR");
			$result.append($('<p class="text-muted text-sm mb-3">').text(pairs.length + " جفت مدخل مشابه پیدا شد (شباهت " + thresholdPct + "٪ یا بیشتر). هرکدوم رو بررسی کن و در صورت نیاز یکی رو ویرایش/حذف کن."));
			pairs.forEach(function (pair) {
				$result.append(renderDuplicatePair(pair));
			});
		}
		$("#kbDuplicateAuditModal").modal("show");
	}

	$(function () {
		loadKb();
		loadOverview();

		$("#btnAddKb").on("click", function () { openKbModal(null); });

		// The two actionable cards double as filters — clicking one shows
		// exactly the rows it counts, and clicking it again clears the filter.
		function showListView() {
			$(".filter-tab", "#kbViewTabs").removeClass("active");
			$('.filter-tab[data-view="list"]', "#kbViewTabs").addClass("active");
			$("#kbTextSection").addClass("d-none");
			$("#kbListSection").removeClass("d-none");
		}

		function toggleCardFilter($card, $checkbox, apply) {
			var next = !$checkbox.is(":checked");
			$checkbox.prop("checked", next);
			apply(next);
			$card.toggleClass("is-active", next);
			kbPageIndex = 0;
			showListView();
			renderKb();
		}

		$("#cardKbNeeds").on("click", function () {
			toggleCardFilter($(this), $("#kbNeedsCompletionOnly"), function (v) { needsCompletionOnly = v; });
		});

		$("#cardKbUnused").on("click", function () {
			toggleCardFilter($(this), $("#kbUnusedOnly"), function (v) { unusedOnly = v; });
		});
		$("#btnSaveKb").on("click", saveKb);
		$("#btnAuditDuplicates").on("click", runDuplicateAudit);

		$("#kbSearchInput").on("input", function () {
			searchTerm = $(this).val().trim().toLowerCase();
			kbPageIndex = 0;
			renderKb();
		});
		$("#kbCategoryFilter").on("change", function () {
			categoryFilter = $(this).val();
			kbPageIndex = 0;
			renderKb();
		});
		$("#kbNeedsCompletionOnly").on("change", function () {
			needsCompletionOnly = $(this).is(":checked");
			$("#cardKbNeeds").toggleClass("is-active", needsCompletionOnly);
			kbPageIndex = 0;
			renderKb();
		});
		$("#kbUnusedOnly").on("change", function () {
			unusedOnly = $(this).is(":checked");
			$("#cardKbUnused").toggleClass("is-active", unusedOnly);
			kbPageIndex = 0;
			renderKb();
		});
		$("#btnKbPrevPage").on("click", function () {
			if (kbPageIndex > 0) { kbPageIndex--; renderKb(); }
		});
		$("#btnKbNextPage").on("click", function () {
			kbPageIndex++;
			renderKb();
		});

		$("#kbViewTabs").on("click", ".filter-tab", function () {
			$(".filter-tab", "#kbViewTabs").removeClass("active");
			$(this).addClass("active");
			var view = $(this).data("view");
			if (view === "text") {
				fillKbTextFromRows();
				$("#kbListSection").addClass("d-none");
				$("#kbTextSection").removeClass("d-none");
			} else {
				$("#kbTextSection").addClass("d-none");
				$("#kbListSection").removeClass("d-none");
			}
		});

		$("#kbFullText").on("input", updateKbTextEntryCount);
		$("#btnSaveKbText").on("click", saveKbText);
		$("#btnReloadKbText").on("click", function () {
			CrmToast.confirm("هرچه در این متن ذخیره نشده از بین می‌رود و نسخه‌ی سرور دوباره خوانده می‌شود.",
				{ title: "خواندن دوباره از سرور؟", confirmLabel: "بخوان" }
			).then(function (yes) {
				if (yes) loadKb().then(fillKbTextFromRows);
			});
		});

		var curatorSuggestion = null;
		var curatorDuplicateRow = null;
		var LOW_CONFIDENCE_THRESHOLD = 0.5;
		var DUPLICATE_OVERLAP_THRESHOLD = 0.6;

		function confidenceTone(confidence) {
			if (confidence >= 0.7) return "tone-green";
			if (confidence >= 0.4) return "tone-gold";
			return "tone-red";
		}

		function findPossibleDuplicate(question) {
			var best = null;
			var bestScore = 0;
			kbRows.forEach(function (r) {
				var score = wordOverlapRatio(question, r.question || "");
				if (score > bestScore) {
					bestScore = score;
					best = r;
				}
			});
			return bestScore >= DUPLICATE_OVERLAP_THRESHOLD ? best : null;
		}

		function renderCuratorSuggestion(suggestion) {
			curatorSuggestion = suggestion;
			curatorDuplicateRow = null;
			var confidence = typeof suggestion.confidence === "number" ? suggestion.confidence : 0;
			var confidencePct = Math.round(confidence * 100);
			$("#kbCuratorConfidence").removeClass("tone-green tone-gold tone-red").addClass(confidenceTone(confidence)).text("اطمینان " + confidencePct + "٪");
			$("#kbCuratorCategory").text(suggestion.category || "بدون‌دسته");
			$("#kbCuratorQuestion").text(suggestion.question || "—");
			$("#kbCuratorAnswer").text(suggestion.answer || "—");

			var $warnings = $("#kbCuratorWarnings").empty();
			var hasWarning = false;

			if (confidence < LOW_CONFIDENCE_THRESHOLD) {
				hasWarning = true;
				$warnings.append(
					$('<div class="kb-curator-warning tone-gold">')
						.append('<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>')
						.append($("<span>").text("اطمینان هوش مصنوعی پایینه — قبل از ذخیره، پاسخ رو با دقت بررسی و در صورت نیاز تکمیل کن."))
				);
			}

			var duplicate = findPossibleDuplicate(suggestion.question);
			if (duplicate) {
				curatorDuplicateRow = duplicate;
				hasWarning = true;
				var $dupBody = $("<div>").append(
					$("<span>").text("یه مدخل مشابه از قبل تو پایگاه دانش هست: «" + (duplicate.question || "") + "» (دسته: " + (duplicate.category || "بدون‌دسته") + ")")
				);
				$dupBody.append(
					$('<button type="button" class="btn btn-sm btn-outline-secondary mt-1">')
						.text("ویرایش مدخل مشابه به‌جای ساخت مدخل جدید")
						.on("click", function () { openKbModal(curatorDuplicateRow); })
				);
				$warnings.append(
					$('<div class="kb-curator-warning tone-red">')
						.append('<i class="fas fa-clone" aria-hidden="true"></i>')
						.append($dupBody)
				);
			}

			$warnings.toggleClass("d-none", !hasWarning);
			$("#kbCuratorResult").removeClass("d-none");
		}

		$("#btnKbCuratorSuggest").on("click", function () {
			var rawText = $("#kbCuratorInput").val().trim();
			$("#kbCuratorError").addClass("d-none");
			if (!rawText) {
				$("#kbCuratorError").removeClass("d-none").text("یه متن بنویس تا هوش مصنوعی ازش پیشنهاد بسازه.");
				return;
			}
			var $btn = $(this).prop("disabled", true);
			var originalHtml = $btn.html();
			$btn.html('<i class="fas fa-spinner fa-spin mr-1"></i>در حال تحلیل...');
			$("#kbCuratorResult").addClass("d-none");
			CrmAi.suggestKnowledge(rawText)
				.then(function (suggestion) {
					renderCuratorSuggestion(suggestion || {});
				})
				.catch(function (err) {
					$("#kbCuratorError").removeClass("d-none").text(err.message || "خطا در دریافت پیشنهاد از هوش مصنوعی.");
				})
				.finally(function () {
					$btn.prop("disabled", false).html(originalHtml);
				});
		});

		$("#btnKbCuratorAccept").on("click", function () {
			if (!curatorSuggestion) return;
			openKbModal({
				category: curatorSuggestion.category || "",
				question: curatorSuggestion.question || "",
				answer: curatorSuggestion.answer || "",
				active: true
			});
		});

		$("#btnKbCuratorDismiss").on("click", function () {
			curatorSuggestion = null;
			$("#kbCuratorResult").addClass("d-none");
			$("#kbCuratorInput").val("");
		});

		// بخش «کارکرد دستیار» از این دو استفاده می‌کند: از روی یک سوالِ
		// بی‌جواب، همین فرم را باز می‌کند، و بعد از همگام‌سازی جدول را
		// تازه می‌کند. جدا نگه داشتنشان بهتر از این است که آن فایل دستش
		// را داخل جزئیات این یکی ببرد.
		window.__kbOpenModal = openKbModal;
		window.__kbReload = function () { loadKb(); loadOverview(); };

		window.__kbCuratorClear = function () {
			curatorSuggestion = null;
			$("#kbCuratorResult").addClass("d-none");
			$("#kbCuratorInput").val("");
		};
	});
})();
