(function () {
	"use strict";

	var texts = [];
	var files = [];
	var activeTab = "texts";

	function truncate(s, n) {
		s = s || "";
		return s.length > n ? s.slice(0, n) + "…" : s;
	}

	function activeBadge(isActive) {
		return isActive
			? '<span class="status-badge badge-ticket-answered"><i class="fas fa-check"></i>فعال</span>'
			: '<span class="status-badge badge-ticket-closed"><i class="fas fa-eye-slash"></i>غیرفعال</span>';
	}

	function renderTexts() {
		var $body = $("#textsTableBody").empty();
		if (texts.length === 0) {
			$body.append('<tr><td colspan="4"><div class="empty-state"><i class="fas fa-file-lines"></i><p>هنوز متنی ثبت نشده.</p></div></td></tr>');
			return;
		}
		texts.forEach(function (t) {
			var $tr = $("<tr>");
			$tr.append($("<td>").addClass("mono").text(t.content_id));
			$tr.append($("<td>").text(truncate(t.body, 70)));
			$tr.append($("<td>").html(activeBadge(t.active !== false)));
			var $editBtn = $('<button class="btn btn-sm btn-outline-secondary"><i class="fas fa-pen"></i></button>');
			$editBtn.on("click", function () { openTextModal(t); });
			$tr.append($("<td>").append($editBtn));
			$body.append($tr);
		});
	}

	function renderFiles() {
		var $body = $("#filesTableBody").empty();
		if (files.length === 0) {
			$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-paperclip"></i><p>هنوز فایلی ثبت نشده.</p></div></td></tr>');
			return;
		}
		files.forEach(function (f) {
			var $tr = $("<tr>");
			$tr.append($("<td>").addClass("mono").text(f.content_id));
			$tr.append($("<td>").text(truncate(f.title, 50)));
			$tr.append($("<td>").text(f.file_type || "-"));
			$tr.append($("<td>").html(activeBadge(f.active !== false)));
			var $editBtn = $('<button class="btn btn-sm btn-outline-secondary"><i class="fas fa-pen"></i></button>');
			$editBtn.on("click", function () { openFileModal(f); });
			$tr.append($("<td>").append($editBtn));
			$body.append($tr);
		});
	}

	function loadTexts() {
		CrmData.fetchContentTexts()
			.then(function (res) {
				texts = Array.isArray(res) ? res : [];
				renderTexts();
			})
			.catch(function () {
				$("#textsTableBody").html('<tr><td colspan="4" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	function loadFiles() {
		CrmData.fetchContentFiles()
			.then(function (res) {
				files = Array.isArray(res) ? res : [];
				renderFiles();
			})
			.catch(function () {
				$("#filesTableBody").html('<tr><td colspan="5" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	function openTextModal(t) {
		t = t || {};
		$("#textContentId").val(t.content_id || "").prop("disabled", !!t.content_id);
		$("#textBody").val(t.body || "");
		$("#textPhotoFileId").val(t.photo_file_id || "");
		$("#textActive").prop("checked", t.active !== false);
		$("#textSaveResult").addClass("d-none");
		$("#editTextModal").modal("show");
	}

	function openFileModal(f) {
		f = f || {};
		$("#fileContentId").val(f.content_id || "").prop("disabled", !!f.content_id);
		$("#fileTitle").val(f.title || "");
		$("#fileFileId").val(f.file_id || "");
		$("#fileType").val(f.file_type || "document");
		$("#fileActive").prop("checked", f.active !== false);
		$("#fileSaveResult").addClass("d-none");
		$("#editFileModal").modal("show");
	}

	function showResult($el, success, text) {
		$el.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	function saveText() {
		var contentId = $("#textContentId").val().trim();
		if (!contentId) { showResult($("#textSaveResult"), false, "content_id الزامیه."); return; }
		var payload = {
			content_id: contentId,
			body: $("#textBody").val(),
			photo_file_id: $("#textPhotoFileId").val().trim(),
			active: $("#textActive").is(":checked")
		};
		var $btn = $("#btnSaveText").prop("disabled", true);
		CrmData.saveContentText(payload)
			.then(function () {
				showResult($("#textSaveResult"), true, "ذخیره شد.");
				loadTexts();
				setTimeout(function () { $("#editTextModal").modal("hide"); }, 500);
			})
			.catch(function (err) {
				showResult($("#textSaveResult"), false, err.message || "خطای نامشخص");
			})
			.finally(function () { $btn.prop("disabled", false); });
	}

	function saveFile() {
		var contentId = $("#fileContentId").val().trim();
		if (!contentId) { showResult($("#fileSaveResult"), false, "content_id الزامیه."); return; }
		var payload = {
			content_id: contentId,
			title: $("#fileTitle").val(),
			file_id: $("#fileFileId").val().trim(),
			file_type: $("#fileType").val(),
			active: $("#fileActive").is(":checked")
		};
		var $btn = $("#btnSaveFile").prop("disabled", true);
		CrmData.saveContentFile(payload)
			.then(function () {
				showResult($("#fileSaveResult"), true, "ذخیره شد.");
				loadFiles();
				setTimeout(function () { $("#editFileModal").modal("hide"); }, 500);
			})
			.catch(function (err) {
				showResult($("#fileSaveResult"), false, err.message || "خطای نامشخص");
			})
			.finally(function () { $btn.prop("disabled", false); });
	}

	$(function () {
		loadTexts();
		loadFiles();

		$("#contentTabs .filter-tab").on("click", function () {
			$("#contentTabs .filter-tab").removeClass("active");
			$(this).addClass("active");
			activeTab = $(this).data("tab");
			$("#textsSection").toggleClass("d-none", activeTab !== "texts");
			$("#filesSection").toggleClass("d-none", activeTab !== "files");
		});

		$("#btnAddContent").on("click", function () {
			if (activeTab === "texts") openTextModal(null);
			else openFileModal(null);
		});

		$("#btnSaveText").on("click", saveText);
		$("#btnSaveFile").on("click", saveFile);
	});
})();
