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
				'<tr><td colspan="5"><div class="empty-state"><i class="fas fa-address-book"></i><p>' +
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
			$tr.append(
				$("<td>").html(
					r.username
						? '<a href="https://t.me/' + encodeURIComponent(r.username) + '" target="_blank" rel="noopener">@' +
						$("<div>").text(r.username).html() + "</a>"
						: "-"
				)
			);
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

	function applyFilter() {
		var q = ($("#phoneSearch").val() || "").trim().toLowerCase();
		if (!q) return render(all);
		render(
			all.filter(function (r) {
				return (
					String(r.phone || "").indexOf(q) !== -1 ||
					String(r.name || "").toLowerCase().indexOf(q) !== -1 ||
					String(r.username || "").toLowerCase().indexOf(q) !== -1
				);
			})
		);
	}

	function load() {
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
					'<tr><td colspan="5" class="text-center text-danger py-4">' +
					$("<div>").text(err.message || "خطا در بارگذاری.").html() +
					"</td></tr>"
				);
			});
	}

	// دانلود با یک لینک ساده انجام می‌شود و مرورگر روی آن هدر Authorization
	// نمی‌گذارد، پس توکن در کوئری می‌رود - همان توکن نشست، که عمر کوتاهی
	// دارد و در همین صفحه هم استفاده می‌شود.
	function exportCsv() {
		var url = BASE + ".csv?token=" + encodeURIComponent(token());
		var a = document.createElement("a");
		a.href = url;
		a.download = "";
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	$(function () {
		load();
		$("#phoneSearch").on("input", applyFilter);
		$("#btnExportPhones").on("click", exportCsv);
	});
})();
