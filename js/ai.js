(function () {
	"use strict";

	var kbRows = [];
	var searchTerm = "";
	var categoryFilter = "";
	var needsCompletionOnly = false;

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
		var categories = Array.from(new Set(kbRows.map(function (r) { return r.category; }).filter(Boolean))).sort();
		var $filter = $("#kbCategoryFilter");
		var current = $filter.val();
		$filter.find("option:not(:first)").remove();
		categories.forEach(function (c) {
			$filter.append($("<option>").val(c).text(c));
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
			if (categoryFilter && r.category !== categoryFilter) return false;
			if (searchTerm) {
				var haystack = ((r.question || "") + " " + (r.answer || "") + " " + (r.category || "")).toLowerCase();
				if (haystack.indexOf(searchTerm) === -1) return false;
			}
			return true;
		});
	}

	function renderKb() {
		var $body = $("#kbTableBody").empty();
		var rows = getFilteredRows();
		if (rows.length === 0) {
			$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-brain"></i><p>موردی یافت نشد.</p></div></td></tr>');
			return;
		}
		rows.forEach(function (r) {
			var $tr = $("<tr>");
			$tr.append($("<td>").text(r.category || "-"));
			$tr.append($("<td>").text(r.question || "-"));
			$tr.append($("<td>").append($('<span class="kb-answer-preview">').text(r.answer || "—")));
			$tr.append($("<td>").html(statusBadge(r)));

			var $editBtn = $('<button class="btn btn-sm btn-outline-secondary mr-1" title="ویرایش"><i class="fas fa-pen"></i></button>');
			$editBtn.on("click", function () { openKbModal(r); });

			var $deleteBtn = $('<button class="btn btn-sm btn-outline-danger" title="حذف"><i class="fas fa-trash"></i></button>');
			$deleteBtn.on("click", function () {
				if (!confirm('مدخل «' + (r.question || "") + '» از پایگاه دانش حذف بشه؟')) return;
				CrmData.deleteAiKnowledge(r.id).then(loadKb).catch(function (err) {
					alert("خطا در حذف: " + (err.message || "خطای نامشخص"));
				});
			});

			var $actions = $("<td>").append($editBtn).append($deleteBtn);
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
		if (!confirm("کل پایگاه دانش (" + kbRows.length + " مدخل فعلی) با این متن (" + entries.length + " مدخل) جایگزین می‌شه. مطمئنی؟")) return;
		var $btn = $("#btnSaveKbText").prop("disabled", true);
		CrmData.bulkSaveAiKnowledge(entries)
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
		return CrmData.fetchAiKnowledge()
			.then(function (res) {
				kbRows = Array.isArray(res) ? res : [];
				populateCategoryOptions();
				renderKb();
			})
			.catch(function () {
				$("#kbTableBody").html('<tr><td colspan="5" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	function loadOverview() {
		if (typeof CrmData.fetchAiOverview !== "function") return;
		CrmData.fetchAiOverview()
			.then(function (res) {
				$("#ai-kb-total").text(res.kb_total || 0);
				$("#ai-kb-active").text(res.kb_active || 0);
				$("#ai-kb-needs").text(res.kb_needs_completion || 0);
				$("#ai-escalations-week").text(res.escalations_week || 0);
			})
			.catch(function (err) {
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
		CrmData.saveAiKnowledge(payload)
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

	$(function () {
		loadKb();
		loadOverview();

		$("#btnAddKb").on("click", function () { openKbModal(null); });
		$("#btnSaveKb").on("click", saveKb);

		$("#kbSearchInput").on("input", function () {
			searchTerm = $(this).val().trim().toLowerCase();
			renderKb();
		});
		$("#kbCategoryFilter").on("change", function () {
			categoryFilter = $(this).val();
			renderKb();
		});
		$("#kbNeedsCompletionOnly").on("change", function () {
			needsCompletionOnly = $(this).is(":checked");
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
			if (!confirm("تغییرات ذخیره‌نشده توی این متن از بین می‌ره و دوباره از سرور خونده می‌شه. ادامه بدم؟")) return;
			loadKb().then(fillKbTextFromRows);
		});

		var curatorSuggestion = null;

		function confidenceTone(confidence) {
			if (confidence >= 0.7) return "tone-green";
			if (confidence >= 0.4) return "tone-gold";
			return "tone-red";
		}

		function renderCuratorSuggestion(suggestion) {
			curatorSuggestion = suggestion;
			var confidence = typeof suggestion.confidence === "number" ? suggestion.confidence : 0;
			var confidencePct = Math.round(confidence * 100);
			$("#kbCuratorConfidence").removeClass("tone-green tone-gold tone-red").addClass(confidenceTone(confidence)).text("اطمینان " + confidencePct + "٪");
			$("#kbCuratorCategory").text(suggestion.category || "بدون‌دسته");
			$("#kbCuratorQuestion").text(suggestion.question || "—");
			$("#kbCuratorAnswer").text(suggestion.answer || "—");
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
			CrmData.suggestAiKnowledge(rawText)
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

		window.__kbCuratorClear = function () {
			curatorSuggestion = null;
			$("#kbCuratorResult").addClass("d-none");
			$("#kbCuratorInput").val("");
		};
	});
})();
