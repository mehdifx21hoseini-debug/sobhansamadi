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
		message_sent: { icon: "fa-paper-plane", label: "پیام ارسالی" },
		call_logged: { icon: "fa-phone-volume", label: "نتیجه تماس" },
		purchase: { icon: "fa-sack-dollar", label: "خرید" }
	};

	function renderActivity(entries) {
		var $box = $("#activityLog").empty();
		if (!entries || entries.length === 0) {
			$box.append('<div class="empty-state"><i class="fas fa-clock-rotate-left"></i><p>هنوز فعالیتی ثبت نشده است.</p></div>');
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
		if (lead.phone) {
			$("#btnCallLead").attr("href", "tel:" + lead.phone.replace(/[^\d+]/g, "")).removeClass("d-none");
		} else {
			$("#btnCallLead").addClass("d-none");
		}
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
			reminderPicker.setDate(CrmData.parseLocalDate(lead.reminder_date).getTime());
		} else {
			$("#reminderDatePersian").val("");
		}

		var template = CrmData.REGISTRATION_MESSAGE_TEMPLATE.replace("{نام}", lead.full_name || "");
		$("#messageDraft").val(template);
	}

	function renderMessageTemplateButtons() {
		var $box = $("#messageTemplateButtons").empty();
		(CrmData.MESSAGE_TEMPLATES || []).forEach(function (tpl) {
			var $btn = $('<button class="filter-tab">').text(tpl.label).attr("data-template-id", tpl.id);
			$btn.on("click", function () {
				var name = (currentLead && currentLead.full_name) || "";
				$("#messageDraft").val(tpl.text.replace("{نام}", name));
				$("#composerBox").removeClass("d-none");
				$("#sendResult").addClass("d-none");
			});
			$box.append($btn);
		});
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

	var selectedCallResult = null;

	function showCallResultMsg(success, text) {
		$("#callResultMsg")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	function submitCallResult() {
		if (!leadId || !selectedCallResult) return;
		var note = $("#callNote").val().trim();
		var nextStep = $("#callNextStep").val().trim();
		var $btn = $("#btnSubmitCallResult").prop("disabled", true);
		CrmData.recordCall(leadId, selectedCallResult, note, nextStep)
			.then(function () {
				showCallResultMsg(true, "نتیجه تماس با موفقیت ثبت شد.");
				$("#callResultForm").addClass("d-none");
				$("#callNote").val("");
				$("#callNextStep").val("");
				selectedCallResult = null;
				$(".call-result-btn").removeClass("active");
				loadLead();
			})
			.catch(function (err) {
				showCallResultMsg(false, "خطا در ثبت تماس: " + (err.message || "خطای نامشخص"));
			})
			.finally(function () {
				$btn.prop("disabled", false);
			});
	}

	function loadConsultants() {
		if (typeof CrmData.fetchConsultants !== "function") return;
		CrmData.fetchConsultants()
			.then(function (consultants) {
				var $sel = $("#assignSelect");
				(consultants || []).forEach(function (c) {
					var $opt = $("<option>").val(c.username).text(c.display_name || c.username);
					$sel.append($opt);
				});
				if (currentLead && currentLead.assigned_to) {
					$sel.val(currentLead.assigned_to);
				}
			})
			.catch(function (err) {
				console.error("خطا در بارگذاری فهرست مشاوران:", err);
			});
	}

	function showAssignMsg(success, text) {
		$("#assignMsg")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	function saveAssign() {
		if (!leadId) return;
		var assignedTo = $("#assignSelect").val();
		var $btn = $("#btnSaveAssign").prop("disabled", true);
		CrmData.assignLead(leadId, assignedTo)
			.then(function () {
				showAssignMsg(true, "لید با موفقیت ارجاع داده شد.");
				loadLead();
			})
			.catch(function (err) {
				showAssignMsg(false, "خطا در ثبت ارجاع: " + (err.message || "خطای نامشخص"));
			})
			.finally(function () {
				$btn.prop("disabled", false);
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

		renderMessageTemplateButtons();
		loadLead();
		loadConsultants();

		$("#btnCalled").on("click", function () { updateStatus("تماس گرفته شد"); });
		$("#btnNoAnswer").on("click", function () { updateStatus("پاسخ نداد"); });

		$("#callResultButtons").on("click", ".call-result-btn", function () {
			$(".call-result-btn").removeClass("active");
			$(this).addClass("active");
			selectedCallResult = $(this).data("result");
			$("#callResultSelected").text(selectedCallResult);
			$("#callResultForm").removeClass("d-none");
			$("#callResultMsg").addClass("d-none");
		});
		$("#btnCancelCallResult").on("click", function () {
			$("#callResultForm").addClass("d-none");
			$(".call-result-btn").removeClass("active");
			selectedCallResult = null;
		});
		$("#btnSubmitCallResult").on("click", submitCallResult);

		$("#btnSaveAssign").on("click", saveAssign);

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
