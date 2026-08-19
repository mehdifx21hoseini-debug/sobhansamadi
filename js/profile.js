(function () {
	"use strict";

	function displayName() {
		return sessionStorage.getItem("crmDisplayName") || "مشاور فروش";
	}

	function resetForm() {
		$("#currentPasswordInput, #newPasswordInput, #confirmPasswordInput").val("");
		$("#changePasswordResult").addClass("d-none");
	}

	function showResult(success, text) {
		$("#changePasswordResult")
			.removeClass("d-none text-success text-danger")
			.addClass(success ? "text-success" : "text-danger")
			.text(text);
	}

	$(function () {
		$("#userDisplayName, #profileDisplayName").text(displayName());

		$("#btnProfile").on("click", function () {
			resetForm();
			$("#profileModal").modal("show");
		});

		$("#changePasswordForm").on("submit", function (e) {
			e.preventDefault();
			var current = $("#currentPasswordInput").val();
			var next = $("#newPasswordInput").val();
			var confirm = $("#confirmPasswordInput").val();

			if (!current || !next) {
				showResult(false, "لطفاً همه فیلدها را پر کنید.");
				return;
			}
			if (next.length < 6) {
				showResult(false, "رمز جدید باید حداقل ۶ کاراکتر باشد.");
				return;
			}
			if (next !== confirm) {
				showResult(false, "تکرار رمز عبور با رمز جدید یکسان نیست.");
				return;
			}

			var $btn = $("#btnChangePassword").prop("disabled", true);
			CrmData.changePassword(current, next)
				.then(function () {
					showResult(true, "رمز عبور با موفقیت تغییر کرد.");
					$("#currentPasswordInput, #newPasswordInput, #confirmPasswordInput").val("");
				})
				.catch(function (err) {
					showResult(false, err.message || "خطای نامشخص");
				})
				.finally(function () {
					$btn.prop("disabled", false);
				});
		});
	});
})();
