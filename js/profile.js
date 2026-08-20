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

	function avatarDataUri() {
		return sessionStorage.getItem("crmAvatar") || "";
	}

	function renderAvatar() {
		var avatar = avatarDataUri();
		if (avatar) {
			$("#userAvatarImg, #profileAvatarImg").attr("src", avatar).removeClass("d-none");
			$("#userAvatarIcon, #profileAvatarIcon").addClass("d-none");
		} else {
			$("#userAvatarImg, #profileAvatarImg").addClass("d-none").attr("src", "");
			$("#userAvatarIcon, #profileAvatarIcon").removeClass("d-none");
		}
	}

	var AVATAR_SIZE = 200;

	function fileToResizedDataUri(file) {
		return new Promise(function (resolve, reject) {
			var img = new Image();
			var reader = new FileReader();
			reader.onload = function () {
				img.onload = function () {
					var side = Math.min(img.width, img.height);
					var sx = (img.width - side) / 2;
					var sy = (img.height - side) / 2;
					var canvas = document.createElement("canvas");
					canvas.width = AVATAR_SIZE;
					canvas.height = AVATAR_SIZE;
					var ctx = canvas.getContext("2d");
					ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
					resolve(canvas.toDataURL("image/jpeg", 0.82));
				};
				img.onerror = function () { reject(new Error("فایل تصویر معتبر نیست.")); };
				img.src = reader.result;
			};
			reader.onerror = function () { reject(new Error("خواندن فایل ناموفق بود.")); };
			reader.readAsDataURL(file);
		});
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
		renderAvatar();

		$("#avatarFileInput").on("change", function () {
			var file = this.files && this.files[0];
			this.value = "";
			if (!file) return;
			var $result = $("#avatarUpdateResult");
			$result.addClass("d-none");
			fileToResizedDataUri(file)
				.then(function (dataUri) {
					return CrmData.updateAvatar(dataUri);
				})
				.then(function (res) {
					sessionStorage.setItem("crmAvatar", (res && res.avatar) || "");
					renderAvatar();
					showResult($result, true, "عکس پروفایل به‌روزرسانی شد.");
				})
				.catch(function (err) {
					showResult($result, false, err.message || "خطای نامشخص");
				});
		});

		$("#btnProfile").on("click", function () {
			resetPasswordForm();
			exitNameEditMode();
			exitUsernameEditMode();
			$("#avatarUpdateResult").addClass("d-none");
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
