(function () {
	"use strict";

	// این صفحه برخلاف بقیه از n8n نمی‌خواند: شماره‌ها را خود ربات
	// می‌گیرد و در D1 ورکر می‌نشینند، پس همان‌جا هم خوانده می‌شوند.
	var BASE = "https://sobhansamadi.mehdifx21hoseini.workers.dev/crm/phones";

	var all = [];

	function token() {
		return sessionStorage.getItem("crmToken") || "";
	}

	function formatDate(iso) {
		if (!iso) return "-";
		try {
			return new Date(iso).toLocaleString("fa-IR");
		} catch (e) {
			return iso;
		}
	}

	function render(rows) {
		var $body = $("#phonesTableBody").empty();

		if (rows.length === 0) {
			$body.append(
				'<tr><td colspan="6"><div class="empty-state"><i class="fas fa-address-book"></i><p>' +
				(all.length === 0 ? "هنوز شماره‌ای ثبت نشده." : "با این جست‌وجو چیزی پیدا نشد.") +
				"</p></div></td></tr>"
			);
			$("#phonesFooter").text("");
			return;
		}

		rows.forEach(function (r) {
			var $tr = $("<tr>");
			// شماره در ستون خودش قابل انتخاب و کپی باشد؛ کاربردش همین است.
			$tr.append($("<td>").addClass("mono").text(r.phone));
			$tr.append($("<td>").text(r.name || "-"));
			// نامِ کاربری لاتین است و بدون dir=ltr، «@» به آخرِ متن می‌پرد و
			// «omid_nqv@» خوانده می‌شود.
			var $user = $("<td>").attr("dir", "ltr").css("text-align", "start");
			if (r.username) {
				$user.append($("<a>")
					.attr({ href: "https://t.me/" + encodeURIComponent(r.username), target: "_blank", rel: "noopener" })
					.text("@" + r.username));
			} else {
				$user.text("-");
			}
			$tr.append($user);
			// شناسه‌ی تلگرام: چیزی که برای هر خروجی و هر تطبیقِ بعدی لازم
			// است و تا امروز فقط در CSV بود، نه روی صفحه. ltr و mono چون
			// عدد است و در متنِ راست‌به‌چپ به هم می‌ریزد.
			var $id = $("<td>").addClass("mono").attr("dir", "ltr");
			if (r.telegram_user_id) {
				$id.append($("<span>").text(r.telegram_user_id));
				$id.append(CrmQuickActions.copyPhoneButton(String(r.telegram_user_id))
					.attr("title", "کپی شناسه"));
			} else {
				$id.text("-");
			}
			$tr.append($id);

			var $src = $("<td>");
			(r.sources || []).forEach(function (s) {
				$src.append($('<span class="status-badge badge-ticket-answered mr-1">').text(s));
			});
			if (!(r.sources || []).length) $src.text("-");
			$tr.append($src);
			$tr.append($("<td>").text(formatDate(r.created_at)));
			$body.append($tr);
		});

		$("#phonesFooter").text("نمایش " + rows.length + " از " + all.length + " شماره");
	}

	// یک تعریف برای «آنچه الان روی صفحه است»: هم رندر از آن می‌خواند و هم
	// خروجی. اگر دوتا بودند، روزی از هم فاصله می‌گرفتند و خروجی چیزی
	// می‌داد که کاربر ندیده بود.
	function filteredRows() {
		var q = ($("#phoneSearch").val() || "").trim().toLowerCase();
		if (!q) return all;
		return all.filter(function (r) {
			return (
				String(r.phone || "").indexOf(q) !== -1 ||
				String(r.name || "").toLowerCase().indexOf(q) !== -1 ||
				String(r.username || "").toLowerCase().indexOf(q) !== -1 ||
				String(r.telegram_user_id || "").indexOf(q) !== -1
			);
		});
	}

	function applyFilter() {
		render(filteredRows());
	}

	function load() {
		CrmData.showTableLoading("#phonesTableBody", 6);
		fetch(BASE, { headers: { Authorization: "Bearer " + token() } })
			.then(function (res) {
				if (res.status === 401) throw new Error("نشست شما منقضی شده؛ دوباره وارد شوید.");
				if (!res.ok) throw new Error("پاسخ سرور: " + res.status);
				return res.json();
			})
			.then(function (data) {
				all = data.rows || [];
				$("#phones-total").text(data.stats ? data.stats.total : all.length);
				$("#phones-week").text(data.stats ? data.stats.last7 : 0);
				$("#phones-intro").text(
					all.filter(function (r) {
						return (r.sources || []).indexOf("دوره مقدماتی") !== -1;
					}).length
				);
				applyFilter();
			})
			.catch(function (err) {
				// خطای واقعی نشان داده می‌شود، نه «موردی نیست»: این دو از
				// دید کاربر یکی به نظر می‌رسند و دقیقاً همان اشتباهی است که
				// سر صفحه‌ی منتورینگ سه هفته کسی متوجهش نشد.
				$("#phonesTableBody").html(
					'<tr><td colspan="6" class="text-center text-danger py-4">' +
					$("<div>").text(err.message || "خطا در بارگذاری.").html() +
					"</td></tr>"
				);
			});
	}

	// ─── خروجی ───────────────────────────────────────────────────────
	//
	// فایل همین‌جا در مرورگر ساخته می‌شود، نه با گرفتنش از سرور. سه دلیل:
	//
	// ۱. خروجی دقیقاً همان چیزی است که کاربر روی صفحه می‌بیند - اگر
	//    جست‌وجو کرده باشد، همان نتیجه‌ها بیرون می‌آید. مسیرِ سروری همیشه
	//    کلِ دفترچه را می‌داد.
	// ۲. توکنِ نشست دیگر لازم نیست در URL برود؛ لینکِ دانلود در تاریخچه‌ی
	//    مرورگر و لاگ‌ها می‌ماند.
	// ۳. یک وابستگیِ کمتر: مسیر /crm/phones.csv سرِ جایش هست (و باگِ
	//    مسیریابی‌اش هم درست شد) ولی دکمه‌ی صفحه دیگر به آن گره نخورده.

	var CSV_COLUMNS = [
		{ head: "شناسه تلگرام", get: function (r) { return r.telegram_user_id || ""; } },
		{ head: "شماره موبایل", get: function (r) { return r.phone || ""; }, text: true },
		{ head: "نام", get: function (r) { return r.name || ""; } },
		{ head: "نام کاربری", get: function (r) { return r.username ? "@" + r.username : ""; } },
		{ head: "منبع", get: function (r) { return (r.sources || []).join(" / "); } },
		{ head: "تاریخ ثبت", get: function (r) { return r.created_at || ""; } },
		{ head: "تاریخ ثبت (شمسی)", get: function (r) { return formatDate(r.created_at); } }
	];

	function csvCell(value, asText) {
		var s = String(value === null || value === undefined ? "" : value);
		// شماره با صفر شروع می‌شود و اکسل صفرِ اول را می‌خورد اگر سلول را
		// عدد ببیند. نقل‌قول جلویش را نمی‌گیرد؛ فرمولِ ="..." می‌گیرد.
		if (asText && s) return '"=""' + s.replace(/"/g, '""') + '"""';
		return '"' + s.replace(/"/g, '""') + '"';
	}

	function buildCsv(rows) {
		var lines = [CSV_COLUMNS.map(function (c) { return csvCell(c.head); }).join(",")];
		rows.forEach(function (r) {
			lines.push(CSV_COLUMNS.map(function (c) {
				return csvCell(c.get(r), c.text);
			}).join(","));
		});
		// BOM: اکسل فارسی بدون آن، UTF-8 را کدصفحه‌ی محلی می‌خواند و کلِ
		// فایل علامت سوال می‌شود.
		return "\uFEFF" + lines.join("\r\n");
	}

	function exportCsv() {
		var rows = filteredRows();
		if (!rows.length) {
			CrmToast.info("چیزی برای خروجی گرفتن نیست.");
			return;
		}
		var stamp = new Date().toISOString().slice(0, 10);
		var name = "phones-" + stamp + (rows.length < all.length ? "-filtered" : "") + ".csv";
		var blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8;" });
		var url = URL.createObjectURL(blob);
		var a = document.createElement("a");
		a.href = url;
		a.download = name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		// آزاد کردنِ بلافاصله در بعضی مرورگرها دانلود را قطع می‌کند.
		setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
		CrmToast.ok("خروجی گرفته شد: " + rows.length.toLocaleString("fa-IR") + " شماره در " + name);
	}

	$(function () {
		load();
		$("#phoneSearch").on("input", applyFilter);
		$("#btnExportPhones").on("click", exportCsv);
	});
})();
