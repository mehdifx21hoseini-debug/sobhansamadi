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
			$body.append('<tr><td colspan="5" class="text-center text-muted py-4">موردی یافت نشد.</td></tr>');
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
	});
})();
