(function () {
	"use strict";

	var SECTIONS = [
		{ key: "welcome", label: "پیام خوش‌آمد و منوی اصلی", icon: "fa-house", match: function (id) {
			return ["WELCOME_TEXT", "ABOUT_TEXT", "COURSES_MENU_TEXT", "FREE_MENU_TEXT", "WELCOME_PHOTO"].indexOf(id) !== -1;
		} },
		{ key: "intro", label: "دوره مقدماتی رایگان", icon: "fa-graduation-cap", match: function (id) {
			return id === "INTRO_COURSE_TEXT" || id.indexOf("INTRO_P") === 0;
		} },
		{ key: "eq", label: "دوره هوش هیجانی", icon: "fa-brain", match: function (id) {
			return id === "EQ_INTRO_TEXT" || id.indexOf("EMOTIONAL_P") === 0;
		} },
		{ key: "library", label: "کتابخانه تخصصی", icon: "fa-book", match: function (id) {
			return id === "LIBRARY_INTRO_TEXT" || id.indexOf("BOOK_0") === 0;
		} },
		{ key: "expert", label: "اکسپرت SSProX", icon: "fa-robot", match: function (id) {
			return id === "EXPERT_INTRO_TEXT" || id.indexOf("EXPERT_") === 0 || id.indexOf("MONEY_MANAGEMENT_EXPERT") === 0;
		} },
		{ key: "broker", label: "بروکر معتمد", icon: "fa-building-columns", match: function (id) {
			return id === "TRUSTED_BROKER_TEXT" || id === "TRUSTED_BROKER";
		} },
		{ key: "psychology", label: "پادکست‌های روانشناسی", icon: "fa-microphone", match: function (id) {
			return id.indexOf("PSY_VOICE") === 0;
		} },
		{ key: "live_trade", label: "ویدیوهای لایو ترید", icon: "fa-chart-line", match: function (id) {
			return id.indexOf("LIVE_TRADE") === 0;
		} }
	];
	var OTHER_SECTION = { key: "other", label: "سایر", icon: "fa-ellipsis" };
	var ALL_SECTIONS = SECTIONS.concat([OTHER_SECTION]);

	function sectionOf(id) {
		id = id || "";
		for (var i = 0; i < SECTIONS.length; i++) {
			if (SECTIONS[i].match(id)) return SECTIONS[i];
		}
		return OTHER_SECTION;
	}

	function sectionByKey(key) {
		for (var i = 0; i < ALL_SECTIONS.length; i++) {
			if (ALL_SECTIONS[i].key === key) return ALL_SECTIONS[i];
		}
		return null;
	}

	var texts = [];
	var files = [];
	var textsById = {};
	var filesById = {};
	var dataLoaded = { texts: false, files: false };
	var activeTab = "texts";
	var currentSection = null;

	function escapeHtml(s) {
		return String(s || "").replace(/[&<>"']/g, function (c) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
		});
	}

	function truncate(s, n) {
		s = s || "";
		return s.length > n ? s.slice(0, n) + "…" : s;
	}

	function activeBadge(isActive) {
		return isActive
			? '<span class="status-badge badge-ticket-answered"><i class="fas fa-check"></i>فعال</span>'
			: '<span class="status-badge badge-ticket-closed"><i class="fas fa-eye-slash"></i>غیرفعال</span>';
	}

	function getSectionFromUrl() {
		var params = new URLSearchParams(window.location.search);
		return params.get("section");
	}

	function textsForSection(key) {
		return texts.filter(function (t) { return sectionOf(t.content_id).key === key; });
	}

	function filesForSection(key) {
		return files.filter(function (f) { return sectionOf(f.content_id).key === key; });
	}

	function renderTexts() {
		var $body = $("#textsTableBody");
		var list = currentSection ? textsForSection(currentSection) : [];
		if (list.length === 0) {
			$body.html('<tr><td colspan="4"><div class="empty-state"><i class="fas fa-file-lines"></i><p>هنوز متنی در این بخش ثبت نشده.</p></div></td></tr>');
			return;
		}
		var rows = list.map(function (t) {
			return '<tr data-content-id="' + escapeHtml(t.content_id) + '">' +
				'<td class="mono">' + escapeHtml(t.content_id) + '</td>' +
				'<td>' + escapeHtml(truncate(t.body, 70)) + '</td>' +
				'<td>' + activeBadge(t.active !== false) + '</td>' +
				'<td><button type="button" class="btn btn-sm btn-outline-secondary btn-edit-text"><i class="fas fa-pen"></i></button></td>' +
				'</tr>';
		});
		$body.html(rows.join(""));
	}

	function renderFiles() {
		var $body = $("#filesTableBody");
		var list = currentSection ? filesForSection(currentSection) : [];
		if (list.length === 0) {
			$body.html('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-paperclip"></i><p>هنوز فایلی در این بخش ثبت نشده.</p></div></td></tr>');
			return;
		}
		var rows = list.map(function (f) {
			return '<tr data-content-id="' + escapeHtml(f.content_id) + '">' +
				'<td class="mono">' + escapeHtml(f.content_id) + '</td>' +
				'<td>' + escapeHtml(truncate(f.title, 50)) + '</td>' +
				'<td>' + escapeHtml(f.file_type || "-") + '</td>' +
				'<td>' + activeBadge(f.active !== false) + '</td>' +
				'<td><button type="button" class="btn btn-sm btn-outline-secondary btn-edit-file"><i class="fas fa-pen"></i></button></td>' +
				'</tr>';
		});
		$body.html(rows.join(""));
	}

	function renderOverview() {
		var counts = {};
		ALL_SECTIONS.forEach(function (s) { counts[s.key] = 0; });
		texts.forEach(function (t) { counts[sectionOf(t.content_id).key]++; });
		files.forEach(function (f) { counts[sectionOf(f.content_id).key]++; });

		var cards = SECTIONS.map(function (s) {
			return '<div class="col-md-4 col-sm-6 mb-3">' +
				'<button type="button" class="content-section-card" data-section="' + s.key + '">' +
				'<i class="fas ' + s.icon + '"></i>' +
				'<div class="content-section-card-label">' + escapeHtml(s.label) + '</div>' +
				'<div class="content-section-card-count">' + counts[s.key] + ' مورد</div>' +
				'</button></div>';
		});
		if (counts.other > 0) {
			cards.push('<div class="col-md-4 col-sm-6 mb-3">' +
				'<button type="button" class="content-section-card" data-section="other">' +
				'<i class="fas ' + OTHER_SECTION.icon + '"></i>' +
				'<div class="content-section-card-label">' + escapeHtml(OTHER_SECTION.label) + '</div>' +
				'<div class="content-section-card-count">' + counts.other + ' مورد</div>' +
				'</button></div>');
		}
		$("#sectionsGrid").html(cards.join(""));
	}

	function renderView() {
		if (currentSection) {
			var section = sectionByKey(currentSection);
			$("#sectionsOverview").addClass("d-none");
			$("#sectionDetail").removeClass("d-none");
			$("#sectionDetailTitle").text(section ? section.label : "بخش");
			$("#pageSubtitle").text((section ? section.label : "بخش") + " — متن‌ها و فایل‌های همین بخش از ربات");
			renderTexts();
			renderFiles();
		} else {
			$("#sectionDetail").addClass("d-none");
			$("#sectionsOverview").removeClass("d-none");
			$("#pageSubtitle").text("یکی از بخش‌های ربات رو انتخاب کن تا فقط محتوای همون بخش رو ببینی و ویرایش کنی — بدون نیاز به دست‌زدن به n8n");
			renderOverview();
		}
	}

	function selectSection(key, pushState) {
		currentSection = key || null;
		if (pushState !== false) {
			var url = currentSection ? ("content.html?section=" + encodeURIComponent(currentSection)) : "content.html";
			history.pushState({ section: currentSection }, "", url);
		}
		renderView();
	}

	function maybeRenderWhenReady() {
		if (dataLoaded.texts && dataLoaded.files) renderView();
	}

	function loadTexts() {
		CrmData.fetchContentTexts()
			.then(function (res) {
				texts = Array.isArray(res) ? res : [];
				textsById = {};
				texts.forEach(function (t) { textsById[t.content_id] = t; });
				dataLoaded.texts = true;
				maybeRenderWhenReady();
			})
			.catch(function () {
				dataLoaded.texts = true;
				$("#textsTableBody").html('<tr><td colspan="4" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	function loadFiles() {
		CrmData.fetchContentFiles()
			.then(function (res) {
				files = Array.isArray(res) ? res : [];
				filesById = {};
				files.forEach(function (f) { filesById[f.content_id] = f; });
				dataLoaded.files = true;
				maybeRenderWhenReady();
			})
			.catch(function () {
				dataLoaded.files = true;
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
		currentSection = getSectionFromUrl();
		loadTexts();
		loadFiles();

		window.addEventListener("popstate", function (e) {
			currentSection = (e.state && e.state.section) || getSectionFromUrl();
			renderView();
		});

		$(document).on("click", "#sectionsGrid .content-section-card", function () {
			selectSection($(this).data("section"));
		});

		$(document).on("click", "#btnBackToSections", function (e) {
			e.preventDefault();
			selectSection(null);
		});

		$(document).on("click", ".btn-edit-text", function () {
			var id = $(this).closest("tr").data("content-id");
			openTextModal(textsById[id]);
		});

		$(document).on("click", ".btn-edit-file", function () {
			var id = $(this).closest("tr").data("content-id");
			openFileModal(filesById[id]);
		});

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
