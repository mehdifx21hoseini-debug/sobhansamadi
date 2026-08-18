(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status] || STATUS_META["پاسخ‌داده‌نشده"];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + status + '</span>';
	}

	function formatDate(iso) {
		if (!iso) return "-";
		return new Date(iso).toLocaleString("fa-IR");
	}

	function getLeadId() {
		var params = new URLSearchParams(window.location.search);
		return params.get("id");
	}

	var leadId = getLeadId();
	var currentLead = null;

	function renderLead(lead) {
		currentLead = lead;
		$("#leadName").text(lead.full_name || "(بدون نام)");
		$("#leadPhone").text(lead.phone || "-");
		$("#leadStatusBadge").html(statusBadgeHtml(lead.status));
		$("#leadCourse").text(lead.course || "-");
		$("#leadRequestType").text(lead.request_type || "-");
		$("#leadNotesBox").text(lead.notes || "یادداشتی ثبت نشده است.");
		$("#leadId").text(lead.lead_id || "-");
		$("#leadContactAttempts").text(lead.contact_attempts != null ? lead.contact_attempts : "-");
		$("#leadCreatedAt").text(formatDate(lead.created_at));
		$("#leadUpdatedAt").text(formatDate(lead.updated_at));
		$("#reminderDate").val(lead.reminder_date || "");

		var template = CrmData.REGISTRATION_MESSAGE_TEMPLATE.replace("{نام}", lead.full_name || "");
		$("#messageDraft").val(template);
	}

	function loadLead() {
		if (!leadId) {
			$("#leadContent").addClass("d-none");
			$("#leadNotFound").removeClass("d-none");
			return;
		}
		CrmData.fetchLead(leadId)
			.then(function (lead) {
				if (!lead || lead.found === false) {
					$("#leadContent").addClass("d-none");
					$("#leadNotFound").removeClass("d-none");
					return;
				}
				renderLead(lead);
			})
			.catch(function () {
				$("#leadContent").addClass("d-none");
				$("#leadNotFound").removeClass("d-none");
			});
	}

	function updateStatus(status) {
		if (!leadId) return;
		CrmData.updateLeadStatus(leadId, status)
			.then(function () {
				loadLead();
			})
			.catch(function (err) {
				alert("خطا در ثبت وضعیت: " + (err.message || "خطای نامشخص"));
			});
	}

	function saveNote() {
		var note = $("#internalNote").val().trim();
		if (!note || !leadId) return;
		var $btn = $("#btnSaveNote").prop("disabled", true);
		CrmData.addLeadNote(leadId, note)
			.then(function () {
				$("#internalNote").val("");
				loadLead();
			})
			.catch(function (err) {
				alert("خطا در ثبت یادداشت: " + (err.message || "خطای نامشخص"));
			})
			.finally(function () {
				$btn.prop("disabled", false);
			});
	}

	function sendMessage() {
		var message = $("#messageDraft").val().trim();
		if (!message || !leadId) return;
		var $btn = $("#btnSendMessage").prop("disabled", true);
		CrmData.sendRegistrationMessage(leadId, message)
			.then(function (res) {
				if (res && res.success === false) {
					showSendResult(false, res.error || "ارسال پیام ناموفق بود.");
					return;
				}
				showSendResult(true, "پیام با موفقیت برای این فرد ارسال شد.");
			})
			.catch(function (err) {
				showSendResult(false, err.message || "خطای نامشخص");
			})
			.finally(function () {
				$btn.prop("disabled", false);
			});
	}

	function showSendResult(success, text) {
		$("#sendResult")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	function saveReminder(dateValue) {
		if (!leadId) return;
		CrmData.setLeadReminder(leadId, dateValue)
			.then(function () { loadLead(); })
			.catch(function (err) {
				alert("خطا در ثبت یادآوری: " + (err.message || "خطای نامشخص"));
			});
	}

	$(function () {
		loadLead();

		$("#btnCalled").on("click", function () { updateStatus("تماس گرفته شد"); });
		$("#btnNoAnswer").on("click", function () { updateStatus("پاسخ نداد"); });

		$("#btnSaveNote").on("click", saveNote);

		$("#btnOpenComposer").on("click", function () {
			$("#composerBox").removeClass("d-none");
			$("#sendResult").addClass("d-none");
		});
		$("#btnCancelComposer").on("click", function () {
			$("#composerBox").addClass("d-none");
		});
		$("#btnSendMessage").on("click", sendMessage);

		$("#btnSaveReminder").on("click", function () {
			var val = $("#reminderDate").val();
			if (!val) { alert("لطفاً یک تاریخ انتخاب کنید."); return; }
			saveReminder(val);
		});
		$("#btnClearReminder").on("click", function () {
			$("#reminderDate").val("");
			saveReminder("");
		});
	});
})();
