(function () {
	"use strict";

	var STATUS_META = {
		"پاسخ‌داده‌نشده": { cls: "badge-pending", icon: "fa-clock" },
		"تماس گرفته شد": { cls: "badge-called", icon: "fa-phone" },
		"پاسخ نداد": { cls: "badge-noanswer", icon: "fa-phone-slash" }
	};

	function statusBadgeHtml(status) {
		var meta = STATUS_META[status];
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + status + '</span>';
	}

	function formatRelativeTime(iso) {
		var date = new Date(iso);
		var now = new Date();
		var diffMins = Math.round((now - date) / 60000);
		if (diffMins < 1) return "همین الان";
		if (diffMins < 60) return diffMins + " دقیقه پیش";
		var diffHours = Math.round(diffMins / 60);
		if (diffHours < 24) return diffHours + " ساعت پیش";
		var diffDays = Math.round(diffHours / 24);
		if (diffDays === 1) return "دیروز";
		return diffDays + " روز پیش";
	}

	function getParam(name) {
		return new URLSearchParams(window.location.search).get(name);
	}

	var leads = CrmData.loadLeads();
	var messages = CrmData.loadMessages();
	var leadId = getParam("id");
	var lead = leads.filter(function (l) { return l.id === leadId; })[0];

	function persistLeads() {
		CrmData.saveLeads(leads);
	}

	function persistMessages() {
		CrmData.saveMessages(messages);
	}

	function renderLeadMessages() {
		var leadMessages = messages.filter(function (m) { return m.leadId === lead.id; });
		var $list = $("#messageList").empty().removeClass("d-none");
		if (leadMessages.length === 0) {
			$("#noMessages").removeClass("d-none");
			return;
		}
		$("#noMessages").addClass("d-none");
		leadMessages.forEach(function (m) {
			var $item = $('<div class="message-item">');
			$item.append($('<div class="mb-2">').text(m.text));
			$item.append($('<div class="text-muted text-sm mb-0">').text("ارسال شد · " + formatRelativeTime(m.sentAt)));
			$list.append($item);
		});
	}

	function renderLead() {
		$("#leadName").text(lead.fullName);
		$("#leadPhone").text(lead.phone);
		$("#leadStatusBadge").html(statusBadgeHtml(lead.status));
		$("#leadLevel").text(lead.level);
		$("#leadPreferredTime").text(lead.preferredTime);
		$("#leadTopic").text(lead.topic);
		$("#leadId").text(lead.id);
		$("#leadCreatedAt").text(formatRelativeTime(lead.createdAt));
		$("#leadRegSent").text(lead.registrationSent ? "ارسال شده" : "ارسال نشده");
		$("#internalNote").val(lead.note || "");
		$("#btnOpenComposer").text(lead.registrationSent ? "ارسال مجدد" : "ارسال پیام");

		$("#btnCalled").toggleClass("active", lead.status === "تماس گرفته شد");
		$("#btnNoAnswer").toggleClass("active", lead.status === "پاسخ نداد");

		renderLeadMessages();
	}

	function setStatus(status) {
		lead.status = status;
		persistLeads();
		renderLead();
	}

	$(function () {
		if (!lead) {
			$("#leadContent").addClass("d-none");
			$("#leadNotFound").removeClass("d-none");
			return;
		}

		renderLead();

		$("#btnCalled").on("click", function () { setStatus("تماس گرفته شد"); });
		$("#btnNoAnswer").on("click", function () { setStatus("پاسخ نداد"); });

		$("#internalNote").on("blur", function () {
			lead.note = $(this).val();
			persistLeads();
		});

		$("#btnOpenComposer").on("click", function () {
			var prefilled = CrmData.REGISTRATION_MESSAGE_TEMPLATE.replace("{نام}", lead.fullName.split(" ")[0]);
			$("#messageDraft").val(prefilled);
			$("#composerBox").removeClass("d-none");
			$("#messageList, #noMessages").addClass("d-none");
		});

		$("#btnCancelComposer").on("click", function () {
			$("#composerBox").addClass("d-none");
			renderLeadMessages();
		});

		$("#btnSendMessage").on("click", function () {
			var text = $("#messageDraft").val();
			messages.push({ id: "M-" + Date.now(), leadId: lead.id, text: text, sentAt: new Date().toISOString() });
			persistMessages();
			lead.registrationSent = true;
			persistLeads();
			$("#composerBox").addClass("d-none");
			renderLead();
		});
	});
})();
