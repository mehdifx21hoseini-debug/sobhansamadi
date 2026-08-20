(function () {
	"use strict";

	function activeBadge(isActive) {
		return isActive
			? '<span class="status-badge badge-ticket-answered"><i class="fas fa-check"></i>فعال</span>'
			: '<span class="status-badge badge-ticket-closed"><i class="fas fa-ban"></i>غیرفعال</span>';
	}

	function formatPrice(price) {
		return (Number(price) || 0).toLocaleString("fa-IR");
	}

	function renderRow(product) {
		var $tr = $("<tr>").attr("data-product-id", product.product_id);
		$tr.append($("<td>").text(product.name || "-"));
		$tr.append($("<td>").addClass("mono").text(product.product_id || "-"));

		var $priceCell = $("<td>");
		var $priceView = $("<span>").addClass("product-price-view").text(formatPrice(product.price));
		var $editBtn = $('<button class="btn btn-link btn-sm p-0 mr-2"><i class="fas fa-pen"></i></button>');
		var $priceInput = $('<input type="number" class="form-control form-control-sm d-none product-price-input" style="max-width:160px;display:inline-block;">').val(product.price || 0);
		var $saveBtn = $('<button class="btn btn-brand btn-sm d-none">ذخیره</button>');
		var $cancelBtn = $('<button class="btn btn-outline-secondary btn-sm d-none mr-1">انصراف</button>');

		$editBtn.on("click", function () {
			$priceView.addClass("d-none");
			$editBtn.addClass("d-none");
			$priceInput.removeClass("d-none");
			$saveBtn.removeClass("d-none");
			$cancelBtn.removeClass("d-none");
		});
		$cancelBtn.on("click", function () {
			$priceInput.val(product.price || 0).addClass("d-none");
			$saveBtn.addClass("d-none");
			$cancelBtn.addClass("d-none");
			$priceView.removeClass("d-none");
			$editBtn.removeClass("d-none");
		});
		$saveBtn.on("click", function () {
			var newPrice = Number($priceInput.val());
			if (isNaN(newPrice) || newPrice < 0) {
				alert("قیمت نامعتبر است.");
				return;
			}
			$saveBtn.prop("disabled", true);
			CrmData.updateProductPrice(product.product_id, newPrice)
				.then(function () {
					product.price = newPrice;
					$priceView.text(formatPrice(newPrice));
					$cancelBtn.click();
				})
				.catch(function (err) {
					alert("خطا در ثبت قیمت: " + (err.message || "خطای نامشخص"));
				})
				.finally(function () {
					$saveBtn.prop("disabled", false);
				});
		});

		$priceCell.append($priceView, $editBtn, $priceInput, $saveBtn, $cancelBtn);
		$tr.append($priceCell);
		$tr.append($("<td>").html(activeBadge(product.active !== false)));
		$tr.append($("<td>"));
		return $tr;
	}

	function loadProducts() {
		var $body = $("#productsTableBody").empty();
		$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-spinner fa-spin"></i><p>در حال بارگذاری...</p></div></td></tr>');
		CrmData.fetchProducts()
			.then(function (products) {
				$body.empty();
				if (!products || products.length === 0) {
					$body.append('<tr><td colspan="5"><div class="empty-state"><i class="fas fa-box-open"></i><p>محصولی ثبت نشده.</p></div></td></tr>');
					return;
				}
				products.forEach(function (product) {
					$body.append(renderRow(product));
				});
			})
			.catch(function (err) {
				$body.html('<tr><td colspan="5" class="text-center py-4" style="color:#c81e4b">خطا در دریافت اطلاعات: ' + (err.message || "خطای نامشخص") + '</td></tr>');
			});
	}

	$(function () {
		loadProducts();
	});
})();
