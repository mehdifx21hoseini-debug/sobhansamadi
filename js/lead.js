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

	// Shared rule, defined once in js/data.js.
	function isAtRisk(lead) {
		return CrmData.isAtRisk(lead);
	}

	var NOTE_ENTRY_META = {
		consultation: { icon: "fa-user-tie", label: "درخواست مشاوره از تلگرام", cls: "note-entry-consult" },
		escalation: { icon: "fa-robot", label: "سوال ارجاع‌شده از هوش مصنوعی", cls: "note-entry-escalation" },
		manual_note: { icon: "fa-sticky-note", label: "یادداشت مشاور", cls: "note-entry-manual" },
		plain: { icon: "fa-comment", label: "پیام", cls: "note-entry-plain" }
	};

	function parseNotesEntries(notesText) {
		if (!notesText) return [];
		var blocks = notesText.split(/\n?---\n?/).map(function (b) { return b.trim(); }).filter(Boolean);
		return blocks.map(function (block) {
			var tsMatch = block.match(/^\[([^\]]+)\]\s*/);
			var timestamp = tsMatch ? tsMatch[1] : null;
			var rest = tsMatch ? block.slice(tsMatch[0].length) : block;

			if (timestamp && /یادداشت مشاور/.test(timestamp)) {
				return { type: "manual_note", timestamp: timestamp.replace(/\s*-\s*یادداشت مشاور\s*$/, ""), text: rest };
			}

			var consultMatch = rest.match(/^سطح:\s*(.*?)\s*\|\s*موضوع:\s*(.*?)\s*\|\s*زمان مناسب تماس:\s*(.*)$/);
			if (consultMatch) {
				return { type: "consultation", timestamp: timestamp, level: consultMatch[1], topic: consultMatch[2], preferredTime: consultMatch[3] };
			}

			var escMatch = rest.match(/^([\s\S]*?)\n\n🔎 دلیل ارجاع:\s*([\s\S]*)$/);
			if (escMatch) {
				return { type: "escalation", timestamp: timestamp, question: escMatch[1].trim(), reason: escMatch[2].trim() };
			}

			return { type: "plain", timestamp: timestamp, text: rest };
		});
	}

	function renderNotesTimeline(notesText) {
		var $box = $("#leadNotesTimeline").empty();
		var entries = parseNotesEntries(notesText);
		if (entries.length === 0) {
			$box.append('<div class="empty-state"><i class="fas fa-comment-slash"></i><p>یادداشتی ثبت نشده است.</p></div>');
			return;
		}
		entries.slice().reverse().forEach(function (entry) {
			var meta = NOTE_ENTRY_META[entry.type];
			var $item = $('<div class="note-entry ' + meta.cls + '">');
			var $head = $('<div class="note-entry-head">');
			$head.append($('<span class="note-entry-label">').append($('<i class="fas ' + meta.icon + ' mr-1">'), document.createTextNode(meta.label)));
			if (entry.timestamp) $head.append($('<span class="note-entry-time">').text(entry.timestamp));
			$item.append($head);

			if (entry.type === "consultation") {
				var $grid = $('<div class="note-entry-grid">');
				$grid.append($('<div>').append($('<span class="text-muted text-sm">').text("سطح: "), $('<strong>').text(entry.level || "-")));
				$grid.append($('<div>').append($('<span class="text-muted text-sm">').text("موضوع: "), $('<strong>').text(entry.topic || "-")));
				$grid.append($('<div>').append($('<span class="text-muted text-sm">').text("زمان مناسب تماس: "), $('<strong>').text(entry.preferredTime || "-")));
				$item.append($grid);
			} else if (entry.type === "escalation") {
				$item.append($('<div class="note-entry-body">').text(entry.question));
				if (entry.reason) $item.append($('<div class="note-entry-reason text-muted text-sm">').text(entry.reason));
			} else {
				$item.append($('<div class="note-entry-body">').text(entry.text));
			}

			$box.append($item);
		});
	}

	function renderQuickInfo(lead) {
		var $box = $("#leadQuickInfo").empty();
		var pills = [];
		if (lead.priority) pills.push({ cls: "", icon: "fa-flag", text: lead.priority });
		if (lead.score != null && lead.score !== "") pills.push({ cls: "pill-score", icon: "fa-star", text: "امتیاز " + lead.score });
		if (lead.quality) pills.push({ cls: "pill-quality", icon: "fa-gem", text: lead.quality });
		if (lead.source) pills.push({ cls: "pill-source", icon: "fa-signpost", text: lead.source });
		pills.forEach(function (p) {
			$box.append($('<span class="info-pill ' + p.cls + '">').append($('<i class="fas ' + p.icon + '">'), document.createTextNode(p.text)));
		});
	}

	function renderAiHistory(history) {
		var $box = $("#aiHistoryBox").empty();
		if (!history || history.length === 0) {
			$("#aiHistoryCard").addClass("d-none");
			return;
		}
		$("#aiHistoryCard").removeClass("d-none");
		history.forEach(function (turn) {
			$box.append($('<div class="ai-chat-bubble ai-chat-user">').append($('<i class="fas fa-user">'), document.createTextNode(turn.q || "")));
			$box.append($('<div class="ai-chat-bubble ai-chat-bot">').append($('<i class="fas fa-robot">'), document.createTextNode(turn.a || "")));
		});
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
		$("#leadRiskBadge").toggleClass("d-none", !isAtRisk(lead));
		renderQuickInfo(lead);
		$("#leadCourse").text(lead.course || "-");
		$("#leadRequestType").text(lead.request_type || "-");
		renderNotesTimeline(lead.notes);
		renderAiHistory(lead.ai_history);
		$("#leadId").text(lead.lead_id || "-");
		$("#leadContactAttempts").text(lead.contact_attempts != null ? lead.contact_attempts : "-");
		$("#leadCreatedAt").text(formatDate(lead.created_at));
		$("#leadUpdatedAt").text(formatDate(lead.updated_at));
		$("#leadScore").text(lead.score != null && lead.score !== "" ? lead.score : "-");
		$("#leadQuality").text(lead.quality || "-");
		$("#leadSource").text(lead.source || "-");
		$("#leadLastCallResult").text(lead.last_call_result || "-");

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

		$("#reminderQuickPicks").on("click", "button", function () {
			var days = parseInt($(this).data("days"), 10);
			var d = new Date();
			d.setDate(d.getDate() + days);
			var iso = toIsoDate(d);
			$("#reminderDate").val(iso);
			if (reminderPicker) reminderPicker.setDate(d.getTime());
			saveReminder(iso);
		});
	});
})();
