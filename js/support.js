(function () {
	"use strict";

	var STATUS_META = {
		"باز": { cls: "badge-ticket-open", icon: "fa-exclamation-circle", label: "باز" },
		"پاسخ داده شده": { cls: "badge-ticket-answered", icon: "fa-check-circle", label: "پاسخ داده شده" },
		"بسته": { cls: "badge-ticket-closed", icon: "fa-archive", label: "بسته" }
	};

	function statusMeta(status) {
		return STATUS_META[status] || { cls: "badge-ticket-closed", icon: "fa-question-circle", label: status || "نامشخص" };
	}

	function statusBadgeHtml(status) {
		var meta = statusMeta(status);
		return '<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i>' + meta.label + '</span>';
	}

	function formatDate(iso) {
		if (!iso) return "-";
		return new Date(iso).toLocaleString("fa-IR");
	}

	function fullName(t) {
		var name = ((t.first_name || "") + " " + (t.last_name || "")).trim();
		return name || (t.telegram_username ? "@" + t.telegram_username : "کاربر ناشناس");
	}

	var tickets = [];
	var activeFilter = "همه";
	var currentTicketId = null;

	function filteredTickets() {
		if (activeFilter === "همه") return tickets;
		return tickets.filter(function (t) { return t.status === activeFilter; });
	}

	function renderTicketList() {
		var $list = $("#ticketList").empty();
		var visible = filteredTickets();
		if (visible.length === 0) {
			$list.append('<div class="ticket-list-empty">ارجاعی در این دسته وجود ندارد.</div>');
			return;
		}
		visible.forEach(function (t) {
			var meta = statusMeta(t.status);
			var $item = $('<div class="ticket-item">').attr("data-ticket-id", t.ticket_id);
			if (t.ticket_id === currentTicketId) $item.addClass("active");
			var $top = $('<div class="ticket-item-top">');
			$top.append($('<span class="ticket-item-name">').text(fullName(t)));
			$top.append($('<span class="status-badge ' + meta.cls + '"><i class="fas ' + meta.icon + '"></i></span>'));
			$item.append($top);
			$item.append($('<div class="ticket-item-preview">').text(t.message || "-"));
			$item.append($('<div class="ticket-item-time">').text(formatDate(t.updated_at)));
			$item.on("click", function () { selectTicket(t.ticket_id); });
			$list.append($item);
		});
	}

	function loadTickets(preserveSelection) {
		CrmData.fetchSupportTickets()
			.then(function (res) {
				tickets = Array.isArray(res) ? res : [];
				renderTicketList();
				if (!preserveSelection && !currentTicketId && tickets.length > 0) {
					selectTicket(tickets[0].ticket_id);
				}
			})
			.catch(function () {
				$("#ticketList").html('<div class="ticket-list-empty">خطا در بارگذاری ارجاعات.</div>');
			});
	}

	function renderThread(messages) {
		var $thread = $("#ticketThread").empty();
		if (!messages || messages.length === 0) {
			$thread.append('<div class="ticket-thread-empty">پیامی ثبت نشده است.</div>');
			return;
		}
		messages.forEach(function (m) {
			var dir = m.direction === "out" ? "msg-out" : "msg-in";
			var $row = $('<div class="msg-row ' + dir + '">');
			var $bubble = $('<div class="msg-bubble">').text(m.message || "");
			var metaText = formatDate(m.created_at) + (m.admin_name ? " · " + m.admin_name : "");
			var $wrap = $('<div>').append($bubble).append($('<div class="msg-meta">').text(metaText));
			$row.append($wrap);
			$thread.append($row);
		});
		$thread.scrollTop($thread[0].scrollHeight);
	}

	function renderTicketDetail(data) {
		var t = data.ticket;
		$("#ticketUserName").text(fullName(t));
		$("#ticketUsername").text(t.telegram_username ? "@" + t.telegram_username : "بدون نام کاربری");
		$("#ticketTelegramId").text(t.telegram_user_id || "-");
		$("#ticketStatusBadge").html(statusBadgeHtml(t.status));

		if (t.reason) {
			$("#ticketReasonText").text(t.reason);
			$("#ticketReasonBox").removeClass("d-none");
		} else {
			$("#ticketReasonBox").addClass("d-none");
		}

		var $toggleBtn = $("#btnToggleTicketStatus");
		if (t.status === "بسته") {
			$toggleBtn.html('<i class="fas fa-undo mr-1"></i>بازگشایی').off("click").on("click", function () { changeStatus(t.ticket_id, "باز"); });
		} else {
			$toggleBtn.html('<i class="fas fa-lock mr-1"></i>بستن ارجاع').off("click").on("click", function () { changeStatus(t.ticket_id, "بسته"); });
		}

		renderThread(data.messages);
	}

	function selectTicket(ticketId) {
		currentTicketId = ticketId;
		renderTicketList();
		$("#ticketEmptyState").addClass("d-none");
		$("#ticketDetail").removeClass("d-none");
		$("#replyResult").addClass("d-none");
		$("#replyDraft").val("");
		CrmData.fetchSupportTicket(ticketId)
			.then(function (data) {
				if (!data || data.found === false) {
					$("#ticketDetail").addClass("d-none");
					$("#ticketEmptyState").removeClass("d-none");
					return;
				}
				renderTicketDetail(data);
			})
			.catch(function () {
				$("#ticketDetail").addClass("d-none");
				$("#ticketEmptyState").removeClass("d-none");
			});
	}

	function changeStatus(ticketId, status) {
		CrmData.setSupportTicketStatus(ticketId, status)
			.then(function () {
				loadTickets(true);
				selectTicket(ticketId);
			})
			.catch(function (err) {
				alert("خطا در تغییر وضعیت: " + (err.message || "خطای نامشخص"));
			});
	}

	function sendReply() {
		var message = $("#replyDraft").val().trim();
		if (!message || !currentTicketId) return;
		var $btn = $("#btnSendReply").prop("disabled", true);
		CrmData.replySupportTicket(currentTicketId, message)
			.then(function (res) {
				if (res && res.success === false) {
					showReplyResult(false, res.error || "ارسال پاسخ ناموفق بود.");
					return;
				}
				$("#replyDraft").val("");
				showReplyResult(true, "پاسخ برای کاربر در تلگرام ارسال شد.");
				loadTickets(true);
				selectTicket(currentTicketId);
			})
			.catch(function (err) {
				showReplyResult(false, err.message || "خطای نامشخص");
			})
			.finally(function () {
				$btn.prop("disabled", false);
			});
	}

	function showReplyResult(success, text) {
		$("#replyResult")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	$(function () {
		loadTickets(false);

		$("#ticketFilterTabs .filter-tab").on("click", function () {
			$("#ticketFilterTabs .filter-tab").removeClass("active");
			$(this).addClass("active");
			activeFilter = $(this).data("status");
			renderTicketList();
		});

		$("#btnSendReply").on("click", sendReply);
	});
})();
