(function () {
	"use strict";

	function displayName() {
		return sessionStorage.getItem("crmDisplayName") || "مشاور فروش";
	}

	function username() {
		return sessionStorage.getItem("crmUsername") || "admin";
	}

	function renderName() {
		var name = displayName();
		$("#userDisplayName, #profileDisplayName").text(name);
		$("#profileUsername").text(username());
	}

	function resetPasswordForm() {
		$("#currentPasswordInput, #newPasswordInput, #confirmPasswordInput").val("");
		$("#changePasswordResult").addClass("d-none");
	}

	function showResult($el, success, text) {
		$el.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	function exitNameEditMode() {
		$("#profileNameEdit").addClass("d-none");
		$("#profileNameView").removeClass("d-none");
		$("#updateNameResult").addClass("d-none");
	}

	function exitUsernameEditMode() {
		$("#usernameEdit").addClass("d-none");
		$("#usernameView").removeClass("d-none");
		$("#updateUsernameResult").addClass("d-none");
		$("#usernameCurrentPasswordInput").val("");
	}

	$(function () {
		renderName();

		$("#btnProfile").on("click", function () {
			resetPasswordForm();
			exitNameEditMode();
			exitUsernameEditMode();
			$("#profileModal").modal("show");
		});

		$("#btnEditName").on("click", function () {
			$("#editNameInput").val(displayName());
			$("#profileNameView").addClass("d-none");
			$("#profileNameEdit").removeClass("d-none");
			$("#editNameInput").trigger("focus");
		});

		$("#btnCancelName").on("click", exitNameEditMode);

		$("#btnSaveName").on("click", function () {
			var newName = $("#editNameInput").val().trim();
			if (!newName) {
				showResult($("#updateNameResult"), false, "نام نمایشی نمی‌تواند خالی باشد.");
				return;
			}
			var $btn = $(this).prop("disabled", true);
			CrmData.updateDisplayName(newName)
				.then(function (res) {
					var finalName = (res && res.display_name) || newName;
					sessionStorage.setItem("crmDisplayName", finalName);
					renderName();
					exitNameEditMode();
				})
				.catch(function (err) {
					showResult($("#updateNameResult"), false, err.message || "خطای نامشخص");
				})
				.finally(function () {
					$btn.prop("disabled", false);
				});
		});

		$("#btnEditUsername").on("click", function () {
			$("#editUsernameInput").val(username());
			$("#usernameView").addClass("d-none");
			$("#usernameEdit").removeClass("d-none");
			$("#editUsernameInput").trigger("focus");
		});

		$("#btnCancelUsername").on("click", exitUsernameEditMode);

		$("#btnSaveUsername").on("click", function () {
			var newUsername = $("#editUsernameInput").val().trim();
			var currentPassword = $("#usernameCurrentPasswordInput").val();
			var $result = $("#updateUsernameResult");

			if (!newUsername) {
				showResult($result, false, "نام کاربری نمی‌تواند خالی باشد.");
				return;
			}
			if (!currentPassword) {
				showResult($result, false, "برای تایید، رمز عبور فعلی را وارد کنید.");
				return;
			}

			var $btn = $(this).prop("disabled", true);
			CrmData.updateUsername(newUsername, currentPassword)
				.then(function (res) {
					var finalUsername = (res && res.username) || newUsername;
					sessionStorage.setItem("crmUsername", finalUsername);
					renderName();
					exitUsernameEditMode();
				})
				.catch(function (err) {
					showResult($result, false, err.message || "خطای نامشخص");
				})
				.finally(function () {
					$btn.prop("disabled", false);
				});
		});

		$("#changePasswordForm").on("submit", function (e) {
			e.preventDefault();
			var current = $("#currentPasswordInput").val();
			var next = $("#newPasswordInput").val();
			var confirmVal = $("#confirmPasswordInput").val();
			var $result = $("#changePasswordResult");

			if (!current || !next) {
				showResult($result, false, "لطفاً همه فیلدها را پر کنید.");
				return;
			}
			if (next.length < 6) {
				showResult($result, false, "رمز جدید باید حداقل ۶ کاراکتر باشد.");
				return;
			}
			if (next !== confirmVal) {
				showResult($result, false, "تکرار رمز عبور با رمز جدید یکسان نیست.");
				return;
			}

			var $btn = $("#btnChangePassword").prop("disabled", true);
			CrmData.changePassword(current, next)
				.then(function () {
					showResult($result, true, "رمز عبور با موفقیت تغییر کرد.");
					$("#currentPasswordInput, #newPasswordInput, #confirmPasswordInput").val("");
				})
				.catch(function (err) {
					showResult($result, false, err.message || "خطای نامشخص");
				})
				.finally(function () {
					$btn.prop("disabled", false);
				});
		});
	});
})();
