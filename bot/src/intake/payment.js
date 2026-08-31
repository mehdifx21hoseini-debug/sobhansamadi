// وبهوک پرداخت - جای‌گزینِ WF-16.
//
// مسیر: POST /intake/payment
//
// ─── یک تفاوت عمدی با n8n ────────────────────────────────────────────
// نسخه‌ی n8n هیچ احراز هویتی نداشت: هر کسی روی اینترنت می‌توانست یک
// «خرید» جعلی ثبت کند و لید بسازد. اینجا کلید لازم است. اگر درگاه
// نتواند هدر بفرستد، همان کلید در بدنه هم پذیرفته می‌شود.
//
// چون هنوز هیچ سفارشی از این مسیر عبور نکرده (جدول سفارش‌ها خالی است)،
// این سخت‌گیری چیزی را نمی‌شکند - و بعداً اضافه کردنش سخت‌تر می‌شد.

import { normalizePhone, nextConsultant, notifyAdmins, leadIdFor } from "../crm/intake.js";
import { ensureCrmSchema } from "../crm/schema.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** بدنه‌ی خام درگاه → فیلدهای نام‌دار. همان نگاشتِ n8n. */
export function normalizePayment(b) {
  const o = b || {};
  return {
    telegram_user_id: String(o.telegram_user_id || "").trim(),
    phone: normalizePhone(o.phone),
    product_id: String(o.product_id || "").trim(),
    amount: Number(o.amount) || 0,
    transaction_id: String(o.transaction_id || "").trim(),
    payment_status: String(o.payment_status || "paid").trim(),
  };
}

export function paymentError(d) {
  if (!d.telegram_user_id && !d.phone) return "telegram_user_id یا phone الزامیه.";
  if (!d.product_id) return "product_id الزامیه.";
  if (!d.amount) return "amount الزامیه.";
  if (!d.transaction_id) return "transaction_id الزامیه.";
  return "";
}

/**
 * خرید را ثبت می‌کند: لید را پیدا یا می‌سازد، سفارش را می‌نویسد، و به
 * مدیرها خبر می‌دهد.
 *
 * ترتیب اهمیت دارد: اول تراکنش تکراری بررسی می‌شود. درگاه‌های پرداخت
 * وبهوک را تکرار می‌کنند و بدون این، یک خرید دو بار در گزارش درآمد
 * می‌نشست.
 */
export async function recordPayment(env, d) {
  await ensureCrmSchema(env);
  const iso = new Date().toISOString();

  const dup = await env.DB
    .prepare("SELECT order_id, lead_id FROM crm_orders WHERE transaction_id = ?")
    .bind(d.transaction_id)
    .first();
  if (dup) return { ok: true, duplicate: true, lead_id: dup.lead_id, order_id: dup.order_id };

  // تلگرام اول، بعد شماره - همان اولویتِ n8n.
  let lead = null;
  if (d.telegram_user_id) {
    lead = await env.DB
      .prepare("SELECT * FROM crm_leads WHERE telegram_user_id = ? LIMIT 1")
      .bind(d.telegram_user_id)
      .first();
  }
  if (!lead && d.phone) {
    lead = await env.DB
      .prepare("SELECT * FROM crm_leads WHERE phone = ? LIMIT 1")
      .bind(d.phone)
      .first();
  }

  let leadId;
  if (lead) {
    leadId = lead.lead_id;
    await env.DB
      .prepare("UPDATE crm_leads SET status = 'خرید کرد', quality = 'hot', updated_at = ? WHERE lead_id = ?")
      .bind(iso, leadId)
      .run();
  } else {
    leadId = leadIdFor();
    const assignee = await nextConsultant(env);
    await env.DB
      .prepare(
        `INSERT INTO crm_leads
           (lead_id, telegram_user_id, phone, course, request_type, status, source,
            quality, contact_attempts, assigned_to, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'خرید', 'خرید کرد', 'website', 'hot', 0, ?, ?, ?)`
      )
      .bind(leadId, d.telegram_user_id || null, d.phone || null, d.product_id || null,
            assignee || null, iso, iso)
      .run();
  }

  const orderId = "ORDER-" + Date.now().toString(36) + "-" + Math.floor(1000 + Math.random() * 9000);
  await env.DB
    .prepare(
      `INSERT INTO crm_orders
         (order_id, lead_id, product_id, amount, payment_status, payment_date,
          transaction_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'website', ?)`
    )
    .bind(orderId, leadId, d.product_id, d.amount, d.payment_status, iso, d.transaction_id, iso)
    .run();

  await env.DB
    .prepare("INSERT INTO crm_activity_log (lead_id, action, detail, actor, created_at) VALUES (?, 'خرید', ?, 'payment', ?)")
    .bind(leadId, d.product_id + " — " + d.amount, iso)
    .run()
    .catch(() => {});

  const text =
    "💰 خرید جدید ثبت شد!\n\n🆔 لید: " + leadId +
    "\n📦 محصول: " + d.product_id +
    "\n💵 مبلغ: " + d.amount +
    "\n🔗 تراکنش: " + d.transaction_id +
    (lead ? "" : "\n\n⚠️ این خریدار لید قبلی نداشت، لید جدید ساخته شد.");
  await notifyAdmins(env, text).catch((err) =>
    console.error("اطلاع‌رسانی خرید شکست خورد:", err && err.message)
  );

  return { ok: true, lead_id: leadId, order_id: orderId, lead_found: !!lead };
}

export async function handlePaymentIntake(request, env) {
  if (request.method !== "POST") return json({ success: false, error: "method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "بدنه‌ی JSON معتبر نبود" }, 400);
  }

  const expected = env.PAYMENT_INTAKE_KEY || env.CRM_LEAD_INTAKE_KEY;
  if (!expected) return json({ success: false, error: "کلید سرویس تنظیم نشده است" }, 503);
  const given = request.headers.get("x-api-key") || (body && body.key) || "";
  if (given !== expected) return json({ success: false, error: "unauthorized" }, 401);

  const d = normalizePayment(body);
  const error = paymentError(d);
  if (error) return json({ success: false, error }, 400);

  try {
    const res = await recordPayment(env, d);
    return json({ success: true, lead_id: res.lead_id, order_id: res.order_id, duplicate: !!res.duplicate });
  } catch (err) {
    console.error("ثبت پرداخت شکست خورد:", err && (err.stack || err.message));
    return json({ success: false, error: "ثبت پرداخت ممکن نشد" }, 500);
  }
}
