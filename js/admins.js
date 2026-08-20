(function () {
	"use strict";

	var admins = [];

	function activeBadge(isActive) {
		return isActive
			? '<span class="status-badge badge-ticket-answered"><i class="fas fa-check"></i>فعال</span>'
			: '<span class="status-badge badge-ticket-closed"><i class="fas fa-ban"></i>غیرفعال</span>';
	}

	function renderAdmins() {
		var $body = $("#adminsTableBody").empty();
		if (admins.length === 0) {
			$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-user-shield"></i><p>هنوز ادمینی ثبت نشده.</p></div></td></tr>');
			return;
		}
		admins.forEach(function (a) {
			var $tr = $("<tr>");
			$tr.append($("<td>").addClass("mono").text(a.telegram_id));
			$tr.append($("<td>").text(a.name || "-"));
			$tr.append($("<td>").text(a.role || "admin"));
			$tr.append($("<td>").html(activeBadge(a.active !== false)));

			var $editBtn = $('<button class="btn btn-sm btn-outline-secondary mr-1"><i class="fas fa-pen"></i></button>');
			$editBtn.on("click", function () { openAdminModal(a); });

			var $toggleBtn = $('<button class="btn btn-sm btn-outline-secondary"></button>');
			if (a.active !== false) {
				$toggleBtn.html('<i class="fas fa-ban"></i>').attr("title", "غیرفعال کردن").on("click", function () {
					if (!confirm("این ادمین دیگه هشدارها رو دریافت نکنه؟")) return;
					CrmData.saveAdmin({ telegram_id: a.telegram_id, name: a.name, role: a.role, active: false }).then(loadAdmins);
				});
			} else {
				$toggleBtn.html('<i class="fas fa-check"></i>').attr("title", "فعال کردن").on("click", function () {
					CrmData.saveAdmin({ telegram_id: a.telegram_id, name: a.name, role: a.role, active: true }).then(loadAdmins);
				});
			}

			var $actions = $("<td>").append($editBtn).append($toggleBtn);
			$tr.append($actions);
			$body.append($tr);
		});
	}

	function loadAdmins() {
		CrmData.fetchAdmins()
			.then(function (res) {
				admins = Array.isArray(res) ? res : [];
				renderAdmins();
			})
			.catch(function () {
				$("#adminsTableBody").html('<tr><td colspan="5" class="text-center text-danger py-4">خطا در بارگذاری.</td></tr>');
			});
	}

	function openAdminModal(a) {
		a = a || {};
		$("#adminTelegramId").val(a.telegram_id || "").prop("disabled", !!a.telegram_id);
		$("#adminName").val(a.name || "");
		$("#adminRole").val(a.role || "admin");
		$("#adminActive").prop("checked", a.active !== false);
		$("#adminSaveResult").addClass("d-none");
		$("#editAdminModal").modal("show");
	}

	function saveAdmin() {
		var telegramId = $("#adminTelegramId").val().trim();
		if (!telegramId) {
			$("#adminSaveResult").removeClass("d-none text-success").addClass("text-danger").text("شناسه تلگرام الزامیه.");
			return;
		}
		var payload = {
			telegram_id: telegramId,
			name: $("#adminName").val(),
			role: $("#adminRole").val(),
			active: $("#adminActive").is(":checked")
		};
		var $btn = $("#btnSaveAdmin").prop("disabled", true);
		CrmData.saveAdmin(payload)
			.then(function () {
				$("#adminSaveResult").removeClass("d-none text-danger").addClass("text-success").text("ذخیره شد.");
				loadAdmins();
				setTimeout(function () { $("#editAdminModal").modal("hide"); }, 500);
			})
			.catch(function (err) {
				$("#adminSaveResult").removeClass("d-none text-success").addClass("text-danger").text(err.message || "خطای نامشخص");
			})
			.finally(function () { $btn.prop("disabled", false); });
	}

	$(function () {
		loadAdmins();
		$("#btnAddAdmin").on("click", function () { openAdminModal(null); });
		$("#btnSaveAdmin").on("click", saveAdmin);
	});
})();
