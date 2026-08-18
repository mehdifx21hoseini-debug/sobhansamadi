(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock", label: "در انتظار تماس" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone", label: "تماس گرفته شد" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash", label: "پاسخ نداد" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status] || STATUS_META["پاسخ‌داده‌نشده"];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + meta.label + '</span>';
	}

	function formatDate(iso) {
		if (!iso) return "-";
		return new Date(iso).toLocaleString("fa-IR");
	}

	var ACTION_META = {
		status_change: { icon: "fa-phone", label: "تغییر وضعیت به" },
		note_added: { icon: "fa-sticky-note", label: "یادداشت داخلی" },
		reminder_set: { icon: "fa-bell", label: "یادآوری پیگیری" },
		message_sent: { icon: "fa-paper-plane", label: "پیام ارسالی" }
	};

	function renderActivity(entries) {
		var $box = $("#activityLog").empty();
		if (!entries || entries.length === 0) {
			$box.append('<div class="activity-log-empty">هنوز فعالیتی ثبت نشده است.</div>');
			return;
		}
		entries.forEach(function (entry) {
			var meta = ACTION_META[entry.action] || { icon: "fa-circle", label: entry.action };
			var $item = $('<div class="activity-log-item">');
			$item.append($('<div class="activity-log-icon">').append($('<i class="fas ' + meta.icon + '">')));
			var $body = $('<div class="activity-log-body">');
			$body.append($('<div>').append($('<strong>').text(meta.label), $('<span class="activity-log-detail">').text(" " + (entry.detail || ""))));
			$body.append($('<div class="activity-log-time">').text(formatDate(entry.created_at)));
			$item.append($body);
			$box.append($item);
		});
	}

	function loadActivity() {
		if (!leadId) return;
		CrmData.fetchLeadActivity(leadId)
			.then(renderActivity)
			.catch(function () {
				$("#activityLog").html('<div class="activity-log-empty">خطا در بارگذاری تاریخچه.</div>');
			});
	}

	function getLeadId() {
		var params = new URLSearchParams(window.location.search);
		return params.get("id");
	}

	var leadId = getLeadId();
	var currentLead = null;
	var reminderPicker = null;

	function pad2(n) {
		return (n < 10 ? "0" : "") + n;
	}

	function toIsoDate(date) {
		return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
	}

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
		if (lead.reminder_date && reminderPicker) {
			reminderPicker.setDate(new Date(lead.reminder_date).getTime());
		} else {
			$("#reminderDatePersian").val("");
		}

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
				loadActivity();
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
				loadActivity();
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
		reminderPicker = $("#reminderDatePersian").persianDatepicker({
			format: "YYYY/MM/DD",
			autoClose: true,
			initialValue: false,
			altField: "#reminderDate",
			altFieldFormatter: function (unixDate) {
				return toIsoDate(new Date(unixDate));
			}
		});

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
			$("#reminderDatePersian").val("");
			saveReminder("");
		});
	});
})();
