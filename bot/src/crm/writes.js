// مسیرهای نوشتنیِ پنل CRM.
//
// ─── یک قاعده در کلِ این فایل ────────────────────────────────────────
// هر نوشتنی که وضعیتِ لید را عوض می‌کند، یک ردیف در crm_activity_log هم
// می‌گذارد. در n8n این کار پراکنده بود و بعضی مسیرها فراموشش کرده
// بودند - نتیجه‌اش تایم‌لاینی بود که بعضی اتفاق‌ها را نداشت و کسی
// نمی‌فهمید چرا. اینجا از یک تابع می‌گذرد، پس جا انداختنش سخت‌تر است.

import { normalizePhone } from "./intake.js";

const nowIso = () => new Date().toISOString();

/** شناسه‌ی یکتا با پیشوندِ خوانا. همان الگویی که n8n می‌ساخت. */
export function newId(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.floor(1000 + Math.random() * 9000);
}

async function logActivity(env, leadId, action, detail, actor) {
  if (!leadId) return;
  await env.DB
    .prepare(
      "INSERT INTO crm_activity_log (lead_id, action, detail, actor, created_at) VALUES (?, ?, ?, ?, ?)"
    )
    .bind(String(leadId), action, detail || "", actor || "", nowIso())
    .run();
}

async function leadExists(env, leadId) {
  const row = await env.DB
    .prepare("SELECT lead_id FROM crm_leads WHERE lead_id = ?")
    .bind(String(leadId || ""))
    .first();
  return !!row;
}

const bad = (error) => ({ ok: false, error });

// ─── لیدِ تازه از ربات ────────────────────────────────────────────────

/**
 * شناسه‌ی لید، با همان الگویی که n8n می‌ساخت: LEAD-YYYYMMDD-NNNN.
 *
 * تاریخ به وقت تهران است، نه UTC. شناسه‌ای که مشاور در ساعت دو بامداد
 * می‌سازد نباید تاریخِ دیروز را روی خودش داشته باشد.
 */
export function newLeadId(d = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
  return "LEAD-" + p.replace(/-/g, "") + "-" + Math.floor(1000 + Math.random() * 9000);
}

// وضعیتِ لیدِ تازه. رشته‌ی فارسی است چون پنل و n8n هر دو با همین کار
// می‌کنند - ۱۰۲ ردیف از ۱۱۸ ردیفِ منتقل‌شده همین را دارند.
const NEW_STATUS = "جدید";

/**
 * لیدی که ربات گرفته را مستقیم در D1 می‌نشاند.
 *
 * تا پیش از این فقط به n8n فرستاده می‌شد و پنل هم از n8n می‌خواند. حالا
 * که پنل از D1 می‌خواند، بدون این نوشتن، لیدِ تازه در پنل دیده نمی‌شود -
 * یعنی مشتری‌ای که همین حالا ثبت‌نام کرده، هیچ‌وقت تماسی نمی‌گیرد.
 *
 * ارسال به n8n سر جایش می‌ماند: تخصیص چرخشی و اطلاع‌رسانی به مشاورها
 * هنوز آنجاست و تا وقتی خاموش نشده، قطع کردنش یعنی از دست دادن آن‌ها.
 */
export async function insertBotLead(env, lead) {
  const leadId = newLeadId();
  const now = nowIso();
  const extras = [
    lead.level ? "سطح: " + lead.level : "",
    lead.topic ? "موضوع: " + lead.topic : "",
    lead.preferred_time ? "زمان دلخواه: " + lead.preferred_time : "",
  ].filter(Boolean);

  await env.DB
    .prepare(
      `INSERT INTO crm_leads
         (lead_id, telegram_user_id, telegram_username, full_name, phone, course,
          request_type, notes, status, contact_attempts, created_at, updated_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
    )
    .bind(
      leadId,
      lead.telegram_user_id == null ? null : String(lead.telegram_user_id),
      lead.username || null,
      lead.name || null,
      lead.phone || null,
      lead.course || null,
      lead.request_type || null,
      extras.join("\n") || null,
      NEW_STATUS,
      now,
      now,
      lead.source || "telegram_bot"
    )
    .run();

  await logActivity(env, leadId, "ثبت لید", "از ربات تلگرام", "bot");
  return leadId;
}

// ─── لیدِ دستی ───────────────────────────────────────────────────────

/**
 * لیدی که مشاور خودش وارد می‌کند.
 *
 * تا امروز تنها درِ ورودِ لید، ربات و فرم سایت بود. یعنی شماره‌ای که در
 * دایرکت اینستاگرام گرفته می‌شد هیچ راهی به CRM نداشت - فیلترِ
 * «اینستاگرام» وجود داشت ولی چیزی که پرش کند نه.
 *
 * شماره تکراری رد می‌شود و شناسه‌ی پرونده‌ی موجود برگردانده می‌شود، نه
 * اینکه ردیف دوم ساخته شود: همان قاعده‌ای که ربات دارد. دو پرونده برای
 * یک شماره یعنی دو مشاور به یک نفر زنگ می‌زنند.
 *
 * لید به سازنده‌اش تخصیص داده می‌شود - کسی که شماره را گرفته، صاحبِ
 * پیگیری‌اش است.
 */
export async function createManualLead(env, body, actor) {
  const name = String(body.full_name || "").trim();
  const phone = normalizePhone(body.phone);
  if (!name) return bad("نام لازم است");
  if (!phone || phone.length < 10) return bad("شماره‌ی موبایل معتبر نیست");

  const existing = await env.DB
    .prepare("SELECT lead_id, full_name FROM crm_leads WHERE phone = ? LIMIT 1")
    .bind(phone)
    .first();
  if (existing) {
    return {
      ok: false,
      error: "این شماره از قبل در CRM هست: " + (existing.full_name || existing.lead_id),
      existing_lead_id: existing.lead_id,
    };
  }

  const source = ALLOWED_SOURCES.includes(String(body.source || "").trim())
    ? String(body.source).trim()
    : "instagram";
  const now = nowIso();
  const leadId = newLeadId();
  const note = String(body.note || "").trim();

  await env.DB
    .prepare(
      `INSERT INTO crm_leads
         (lead_id, full_name, phone, course, request_type, notes, status,
          contact_attempts, created_at, updated_at, source, assigned_to, level, topic)
       VALUES (?, ?, ?, ?, ?, ?, 'جدید', 0, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      leadId, name, phone,
      String(body.course || "").trim() || null,
      String(body.request_type || "").trim() || "مشاوره",
      note ? "[" + tehranStamp() + " - یادداشت مشاور] " + note : null,
      now, now, source, actor || "",
      String(body.level || "").trim() || null,
      String(body.topic || "").trim() || null
    )
    .run();

  await logActivity(env, leadId, "ثبت لید", "ورود دستی از پنل", actor);
  return { ok: true, lead_id: leadId };
}

// ─── وضعیت لید ───────────────────────────────────────────────────────

export async function setLeadStatus(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  const status = String(body.status || "").trim();
  if (!leadId || !status) return bad("lead_id و status لازم است");
  if (!(await leadExists(env, leadId))) return bad("لید پیدا نشد");

  await env.DB
    .prepare("UPDATE crm_leads SET status = ?, updated_at = ? WHERE lead_id = ?")
    .bind(status, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "status", status, actor);
  return { ok: true };
}

// ─── یادداشت ─────────────────────────────────────────────────────────

/**
 * یادداشتِ تازه به انتهای یادداشت‌های قبلی اضافه می‌شود، نه جای‌گزینشان.
 *
 * تاریخ به وقت تهران مهر می‌خورد چون این متن را آدم می‌خواند نه ماشین -
 * و تیم فروش در تهران است.
 */
export function mergeNote(current, note, stamp) {
  const fresh = String(note || "").trim();
  if (!fresh) return String(current || "");
  const line = "[" + stamp + " - یادداشت مشاور] " + fresh;
  return current ? current + "\n---\n" + line : line;
}

export function tehranStamp(d = new Date()) {
  return d.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" });
}

export async function addLeadNote(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  const note = String(body.note || "").trim();
  if (!leadId) return bad("lead_id لازم است");
  if (!note) return bad("یادداشت خالی است");

  const row = await env.DB
    .prepare("SELECT notes FROM crm_leads WHERE lead_id = ?")
    .bind(leadId)
    .first();
  if (!row) return bad("لید پیدا نشد");

  const merged = mergeNote(row.notes, note, tehranStamp());
  await env.DB
    .prepare("UPDATE crm_leads SET notes = ?, updated_at = ? WHERE lead_id = ?")
    .bind(merged, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "note", note, actor);
  return { ok: true, notes: merged };
}

// ─── تخصیص ───────────────────────────────────────────────────────────

export async function assignLead(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  const to = String(body.assigned_to || "").trim();
  if (!leadId) return bad("lead_id لازم است");

  // تخصیص به حسابی که وجود ندارد یا غیرفعال است، یعنی لیدی که هیچ‌کس
  // نمی‌بیندش. رشته‌ی خالی مجاز است: یعنی «تخصیص را بردار».
  if (to) {
    const who = await env.DB
      .prepare("SELECT username FROM crm_admin WHERE username = ? AND active = 1")
      .bind(to)
      .first();
    if (!who) return bad("این مشاور وجود ندارد یا غیرفعال است");
  }
  if (!(await leadExists(env, leadId))) return bad("لید پیدا نشد");

  await env.DB
    .prepare("UPDATE crm_leads SET assigned_to = ?, updated_at = ? WHERE lead_id = ?")
    .bind(to, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "assign", to || "بدون مسئول", actor);
  return { ok: true, assigned_to: to };
}

// ─── پیگیری ──────────────────────────────────────────────────────────

/**
 * مقدارِ خالی یعنی «انجام شد» و پیگیری را پاک می‌کند.
 *
 * هر چیز دیگری باید تاریخِ واقعی باشد؛ وگرنه صفحه‌ی پیگیری‌ها آن را
 * «تاریخ نامعتبر» می‌خواند و لید بی‌صدا از همه‌ی سطل‌ها ناپدید می‌شود -
 * که بدتر از یک خطای صریح است.
 */
export function normalizeFollowup(raw) {
  const s = String(raw || "").trim();
  if (!s) return { value: "", rejected: false };
  const d = new Date(s);
  if (isNaN(d.getTime())) return { value: "", rejected: true };
  return { value: d.toISOString(), rejected: false };
}

export async function setFollowup(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  if (!leadId) return bad("lead_id لازم است");
  const { value, rejected } = normalizeFollowup(body.next_followup_at);
  if (rejected) return bad("تاریخ پیگیری معتبر نیست");
  if (!(await leadExists(env, leadId))) return bad("لید پیدا نشد");

  // دلیل با تاریخ می‌آید و با پاک شدنِ تاریخ هم پاک می‌شود - «دلیلِ
  // پیگیری» بدونِ پیگیری معنایی ندارد و اگر می‌ماند، دفعه‌ی بعد دلیلِ
  // یک قرارِ تمام‌شده را کنارِ تاریخِ تازه نشان می‌داد.
  //
  // reason می‌تواند اصلاً نیاید: نوارِ اقدام سریع اول تاریخ را ثبت
  // می‌کند و دلیل را بعد، اگر مشاور بنویسد. آن حالت نباید تاریخ را
  // دست بزند، پس undefined با «رشته‌ی خالی» یکی نیست.
  const hasReason = body.followup_reason !== undefined;
  const given = String(body.followup_reason || "").trim().slice(0, 200);
  const reason = value ? given : "";

  if (hasReason && !body.next_followup_at) {
    // فقط دلیل آمده، بدون تاریخ: یعنی به‌روزرسانیِ دلیلِ پیگیریِ موجود.
    await env.DB
      .prepare("UPDATE crm_leads SET followup_reason = ?, updated_at = ? WHERE lead_id = ?")
      .bind(given, nowIso(), leadId)
      .run();
    return { ok: true, followup_reason: given };
  }

  await env.DB
    .prepare("UPDATE crm_leads SET next_followup_at = ?, followup_reason = ?, updated_at = ? WHERE lead_id = ?")
    .bind(value, reason, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "followup", value ? value + (reason ? " — " + reason : "") : "پاک شد", actor);
  return { ok: true, next_followup_at: value, followup_reason: reason };
}

// ─── منبع جذب ────────────────────────────────────────────────────────

// فهرست سفید. مقدارِ ناشناخته به تلگرام می‌افتد نه به «نامشخص»، چون
// گزارشِ منابع روی همین مقادیر گروه می‌بندد و یک مقدارِ آزاد آن را
// خرد می‌کند.
export const ALLOWED_SOURCES = ["telegram_direct", "instagram", "website"];

export async function setLeadSource(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  if (!leadId) return bad("lead_id لازم است");
  const raw = String(body.source || "").trim();
  const source = ALLOWED_SOURCES.includes(raw) ? raw : "telegram_direct";
  if (!(await leadExists(env, leadId))) return bad("لید پیدا نشد");

  await env.DB
    .prepare("UPDATE crm_leads SET source = ?, updated_at = ? WHERE lead_id = ?")
    .bind(source, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "source", source, actor);
  return { ok: true, source };
}

// ─── ثبت تماس ────────────────────────────────────────────────────────

/**
 * وضعیتِ لید از روی نتیجه‌ی تماس.
 *
 * پیش از این، مشاور باید نتیجه را در یک فرم ثبت می‌کرد و وضعیت را با دو
 * دکمه‌ی جدا عوض می‌کرد - و معمولاً دومی را فراموش می‌کرد، پس لیدی که
 * سه بار با او حرف زده بودیم هنوز «در انتظار تماس» می‌ماند. حالا یک
 * اتفاق، یک ثبت.
 *
 * فقط همان سه سطلی که reads.statusBucket می‌شناسد ساخته می‌شود؛ هر
 * مقدارِ تازه‌ای اینجا یعنی لیدی که در هیچ تبِ فهرست پیدا نمی‌شود.
 */
export function statusForCallResult(result) {
  return String(result || "").trim() === "جواب نداد" ? "پاسخ نداد" : "تماس گرفته شد";
}

export async function recordCall(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  const result = String(body.result || "").trim();
  if (!leadId) return bad("نتیجه‌ی تماس بدون شناسه‌ی لید ثبت نمی‌شود");
  if (!result) return bad("نتیجه‌ی تماس لازم است");

  const lead = await env.DB
    .prepare("SELECT lead_id, contact_attempts FROM crm_leads WHERE lead_id = ?")
    .bind(leadId)
    .first();
  if (!lead) return bad("لید پیدا نشد");

  // پیگیری در همین فرم ست می‌شود. سه حالت دارد و هر سه باید از هم جدا
  // بمانند: تاریخِ تازه، «پیگیری لازم نیست» (پاک کردن)، و دست‌نزدن.
  const clearFollowup = body.clear_followup === true;
  const { value: followup, rejected } = normalizeFollowup(body.next_step);
  if (rejected) return bad("تاریخ پیگیری معتبر نیست");
  const touchFollowup = clearFollowup || !!followup;
  const followupValue = clearFollowup ? "" : followup;
  // دلیلِ پیگیری همان‌جا ثبت می‌شود که تاریخش. بستنِ پیگیری دلیل را هم
  // پاک می‌کند.
  const followupReason = followupValue ? String(body.followup_reason || "").trim().slice(0, 200) : "";

  const callId = newId("CALL");
  const attempts = Number(lead.contact_attempts) || 0;
  const created = nowIso();
  const status = statusForCallResult(result);

  const writes = [
    env.DB
      .prepare(
        `INSERT INTO crm_calls (call_id, lead_id, admin_username, result, note, next_step, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(callId, leadId, actor || "", result, String(body.note || ""), followupValue, created),
  ];

  // ثبتِ تماس و به‌روزرسانیِ لید با هم می‌روند. اگر جدا بودند، یک شکست
  // وسط کار یعنی تماسی که ثبت شده ولی شمارنده‌اش بالا نرفته - و آن
  // ناهماهنگی بعداً در گزارش‌ها پیدا می‌شود، نه همان لحظه.
  if (touchFollowup) {
    writes.push(
      env.DB
        .prepare(
          `UPDATE crm_leads SET contact_attempts = ?, last_call_result = ?, status = ?,
                                next_followup_at = ?, followup_reason = ?,
                                reminder_date = NULL, updated_at = ?
            WHERE lead_id = ?`
        )
        .bind(attempts + 1, result, status, followupValue, followupReason, created, leadId)
    );
  } else {
    writes.push(
      env.DB
        .prepare(
          `UPDATE crm_leads SET contact_attempts = ?, last_call_result = ?, status = ?, updated_at = ?
            WHERE lead_id = ?`
        )
        .bind(attempts + 1, result, status, created, leadId)
    );
  }

  await env.DB.batch(writes);

  await logActivity(env, leadId, "call", result, actor);
  if (touchFollowup) {
    await logActivity(env, leadId, "followup",
      followupValue ? followupValue + (followupReason ? " — " + followupReason : "") : "پاک شد", actor);
  }
  return {
    ok: true,
    call_id: callId,
    contact_attempts: attempts + 1,
    status,
    next_followup_at: touchFollowup ? followupValue : undefined,
    followup_reason: touchFollowup ? followupReason : undefined,
  };
}

// ─── ثبت خرید ────────────────────────────────────────────────────────

/**
 * خریدِ دستی.
 *
 * پرداخت روی سایت انجام می‌شود و هیچ‌جای CRM خبردار نمی‌شود، برای همین
 * crm_orders خالی است و نیمی از داشبورد و گزارشِ شبانه صفر می‌ماند.
 * تا وقتی درگاه به /intake/payment وصل نشده، این تنها راهِ ورودِ فروش
 * به CRM است: مشاور که می‌داند طرف خریده، همان‌جا ثبتش می‌کند.
 *
 * source روی "manual" می‌ماند تا بعداً بشود فروشِ ثبت‌شده به‌دست آدم را
 * از فروشِ آمده از درگاه جدا کرد.
 */
export async function recordPurchase(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  if (!leadId) return bad("lead_id لازم است");

  const amount = Math.round(Number(body.amount));
  if (!isFinite(amount) || amount < 0) return bad("مبلغ معتبر نیست");

  if (!(await leadExists(env, leadId))) return bad("لید پیدا نشد");

  const productId = String(body.product_id || "").trim();
  if (productId) {
    const p = await env.DB
      .prepare("SELECT product_id FROM crm_products WHERE product_id = ?")
      .bind(productId)
      .first();
    if (!p) return bad("این محصول وجود ندارد");
  }

  // تاریخِ پرداخت اگر داده نشود «همین حالا» است. تاریخِ نامعتبر رد
  // می‌شود نه اینکه بی‌صدا به حالا بیفتد - گزارشِ فروش روی همین ستون
  // بازه می‌بندد و یک تاریخِ اشتباه، عددِ ماه را جابه‌جا می‌کند.
  const { value: paidAt, rejected } = normalizeFollowup(body.payment_date);
  if (rejected) return bad("تاریخ پرداخت معتبر نیست");
  const created = nowIso();
  const orderId = newId("ORD");

  await env.DB
    .prepare(
      `INSERT INTO crm_orders (order_id, lead_id, product_id, amount, payment_status,
                               payment_date, transaction_id, source, created_at)
       VALUES (?, ?, ?, ?, 'paid', ?, ?, 'manual', ?)`
    )
    .bind(orderId, leadId, productId || null, amount, paidAt || created,
          String(body.transaction_id || "").trim() || null, created)
    .run();

  await logActivity(env, leadId, "purchase", String(amount), actor);
  return { ok: true, order_id: orderId, amount };
}

// ─── تیکت پشتیبانی ───────────────────────────────────────────────────

export async function setTicketStatus(env, body) {
  const id = String(body.ticket_id || "").trim();
  const status = String(body.status || "").trim();
  if (!id || !status) return bad("ticket_id و status لازم است");

  const res = await env.DB
    .prepare("UPDATE crm_support_tickets SET status = ?, updated_at = ? WHERE ticket_id = ?")
    .bind(status, nowIso(), id)
    .run();
  if (res && res.meta && res.meta.changes === 0) return bad("تیکت پیدا نشد");
  return { ok: true };
}

/**
 * پاسخ پشتیبانی. در جدول می‌نشیند و به تلگرام هم می‌رود.
 *
 * ترتیب عمدی است: اول نوشتن، بعد فرستادن. اگر تلگرام شکست بخورد پاسخ
 * دست‌کم در تاریخچه هست و می‌شود دستی فرستادش؛ عکسش یعنی پیامی که
 * مشتری گرفته ولی هیچ ردی از آن نیست.
 */
export async function replyTicket(env, body, actor, send) {
  const id = String(body.ticket_id || "").trim();
  const message = String(body.message || "").trim();
  if (!id) return bad("ticket_id لازم است");
  if (!message) return bad("متن پاسخ خالی است");

  const ticket = await env.DB
    .prepare("SELECT ticket_id, telegram_user_id FROM crm_support_tickets WHERE ticket_id = ?")
    .bind(id)
    .first();
  if (!ticket) return bad("تیکت پیدا نشد");

  await env.DB
    .prepare(
      `INSERT INTO crm_ticket_messages (ticket_id, direction, message, admin_name, created_at)
       VALUES (?, 'out', ?, ?, ?)`
    )
    .bind(id, message, actor || "", nowIso())
    .run();

  let delivered = false;
  if (ticket.telegram_user_id && typeof send === "function") {
    delivered = await send(ticket.telegram_user_id, message);
  }
  return { ok: true, delivered };
}

// ─── محصول ───────────────────────────────────────────────────────────

export async function setProductPrice(env, body) {
  const id = String(body.product_id || "").trim();
  const price = Number(body.price);
  if (!id) return bad("product_id لازم است");
  if (!isFinite(price) || price < 0) return bad("قیمت معتبر نیست");

  const res = await env.DB
    .prepare("UPDATE crm_products SET price = ? WHERE product_id = ?")
    .bind(Math.round(price), id)
    .run();
  if (res && res.meta && res.meta.changes === 0) return bad("محصول پیدا نشد");
  return { ok: true };
}

// ─── خطاها ───────────────────────────────────────────────────────────

export async function resolveError(env, body) {
  const id = String(body.log_id || "").trim();
  if (!id) return bad("log_id لازم است");
  const res = await env.DB
    .prepare("UPDATE crm_error_log SET resolved = 1, notes = ? WHERE log_id = ?")
    .bind(String(body.notes || ""), id)
    .run();
  if (res && res.meta && res.meta.changes === 0) return bad("این خطا پیدا نشد");
  return { ok: true };
}

// ─── محتوا ───────────────────────────────────────────────────────────

export async function saveContentText(env, body) {
  const id = String(body.content_id || "").trim();
  if (!id) return bad("content_id لازم است");
  await env.DB
    .prepare(
      `INSERT INTO text_content (content_id, body, active) VALUES (?, ?, 1)
       ON CONFLICT(content_id) DO UPDATE SET body = excluded.body, active = 1`
    )
    .bind(id, String(body.body || ""))
    .run();
  return { ok: true };
}

export async function saveContentFile(env, body) {
  const id = String(body.content_id || "").trim();
  if (!id) return bad("content_id لازم است");
  await env.DB
    .prepare(
      `INSERT INTO content_library (content_id, title, file_id, file_type, active)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(content_id) DO UPDATE SET
         title = excluded.title, file_id = excluded.file_id,
         file_type = excluded.file_type, active = 1`
    )
    .bind(id, String(body.title || ""), String(body.file_id || ""), String(body.file_type || ""))
    .run();
  return { ok: true };
}

// ─── اشتراک تقویم ────────────────────────────────────────────────────

export async function unsubscribeEcon(env, body) {
  const id = String(body.telegram_user_id || "").trim();
  if (!id) return bad("telegram_user_id لازم است");
  const res = await env.DB
    .prepare("UPDATE econ_subscriber SET subscribed = 0, updated_at = ? WHERE telegram_user_id = ?")
    .bind(nowIso(), id)
    .run();
  if (res && res.meta && res.meta.changes === 0) return bad("این مشترک پیدا نشد");
  return { ok: true };
}

// ─── مسیرهایی که در انتقال جا مانده بودند ────────────────────────────
//
// این پنج تا تا دیروز بی‌صدا به n8n می‌رفتند: مسیریابِ ما ۵۰۱ می‌داد و
// صفحه خودش به n8n برمی‌گشت. آن برگشت کار می‌کرد، پس در تست‌ها هم چیزی
// خراب به نظر نمی‌رسید - تا لحظه‌ای که n8n خاموش شد.
//
// درسش این است که «۵۰۱ به‌علاوه‌ی برگشتِ خودکار» یک تورِ ایمنیِ خوب برای
// دوره‌ی انتقال بود، ولی همان تور، ناقص بودنِ انتقال را هم پنهان کرد.
// مقایسه‌ی فهرستِ مسیرهای صفحه‌ها با فهرستِ پیاده‌شده‌ها، همان روز باید
// انجام می‌شد نه بعد از خاموشی.

/** پیام تلگرام به یک لید، از صفحه‌ی لید. */
export async function sendLeadMessage(env, body, actor, send) {
  const leadId = String(body.lead_id || "").trim();
  const message = String(body.message || "").trim();
  if (!leadId) return bad("lead_id لازم است");
  if (!message) return bad("متن پیام خالی است");

  const lead = await env.DB
    .prepare("SELECT lead_id, telegram_user_id, full_name FROM crm_leads WHERE lead_id = ?")
    .bind(leadId)
    .first();
  if (!lead) return bad("لید پیدا نشد");
  if (!lead.telegram_user_id) return bad("این لید شناسه‌ی تلگرام ندارد");

  const ok = await send(lead.telegram_user_id, message);
  // شکستِ ارسال، خطا برمی‌گرداند نه موفقیت. مشاور باید بداند پیام نرفته
  // - وگرنه منتظر جوابی می‌ماند که هرگز نمی‌آید.
  if (!ok) return bad("تلگرام پیام را نپذیرفت (شاید کاربر ربات را بلاک کرده)");

  await logActivity(env, leadId, "ارسال پیام", message.slice(0, 200), actor);
  return { ok: true };
}

/** یادآور ساده روی لید. جای‌گزینش setFollowup است ولی ستونش هنوز هست. */
export async function setLeadReminder(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  if (!leadId) return bad("lead_id لازم است");
  if (!(await leadExists(env, leadId))) return bad("لید پیدا نشد");

  const value = String(body.reminder_date || "").trim() || null;
  await env.DB
    .prepare("UPDATE crm_leads SET reminder_date = ?, updated_at = ? WHERE lead_id = ?")
    .bind(value, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "یادآور", value || "برداشته شد", actor);
  return { ok: true, reminder_date: value };
}

/** مدیرهای تلگرامیِ ربات - همان‌هایی که هشدار می‌گیرند. */
export async function saveAdminUser(env, body) {
  const id = String(body.telegram_id || "").trim();
  if (!id) return bad("شناسه‌ی تلگرام لازم است");
  if (!/^\d+$/.test(id)) return bad("شناسه‌ی تلگرام باید فقط عدد باشد");

  await env.DB
    .prepare(
      `INSERT INTO crm_admin_users (telegram_id, name, role, active) VALUES (?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         name = excluded.name, role = excluded.role, active = excluded.active`
    )
    .bind(id, String(body.name || "").trim() || null,
          String(body.role || "admin").trim(), body.active === false ? 0 : 1)
    .run();
  return { ok: true, telegram_id: id };
}

// ─── پیام همگانی ─────────────────────────────────────────────────────

const AUDIENCES = {
  // ادمین‌ها کنار گذاشته می‌شوند: پیامی که برای همه می‌رود، برای تیم
  // خودمان تکراری است و در گروهِ کاری هم دیده می‌شود.
  all: `SELECT u.telegram_user_id AS chat_id FROM user_state u
          WHERE u.telegram_user_id NOT IN (SELECT telegram_id FROM crm_admin_users)`,
  econ_subscribers: `SELECT telegram_user_id AS chat_id FROM econ_subscriber`,
};

/**
 * ارسال پیام همگانی - تکه‌تکه و قابلِ ادامه.
 *
 * چرا یکجا نمی‌شود: مخاطبِ «همه» هزاران نفر است و هر نفر یک درخواست به
 * تلگرام. کلادفلر روی هر اجرای ورکر سقفِ تعدادِ درخواستِ بیرونی دارد، و
 * تلگرام هم سقفِ نرخ. نسخه‌ی قبلی همه را در یک درخواست می‌فرستاد و
 * دقیقاً روی همان سقف می‌مرد: از ۷۴۹۲ نفر، ۴۹ نفر پیام می‌گرفتند و صفحه
 * «ارسال شد» نشان می‌داد.
 *
 * حالا:
 *   ۱ - همه‌ی گیرنده‌ها یک‌بار در جدول ثبت می‌شوند، بی‌آنکه چیزی فرستاده
 *       شود. این «صف» است.
 *   ۲ - هر فراخوانی یک تکه از صف را می‌فرستد و می‌گوید چقدر مانده.
 *   ۳ - صفحه تا تمام شدن ادامه می‌دهد، و کرانِ هر پنج دقیقه هم همان صف
 *       را می‌خورد - پس بستنِ تب یا قطع شدنِ نت، ارسال را نصفه رها
 *       نمی‌کند.
 *
 * اندازه‌ی تکه ثابت نیست: حلقه تا وقتی می‌فرستد که پلتفرم اجازه بدهد و
 * به‌محضِ اولین خطای زیرساختی می‌ایستد و بقیه را برای دفعه‌ی بعد
 * می‌گذارد. این‌طور هر سقفی که باشد، خودش را با آن جور می‌کند.
 */
const CHUNK_HARD_CAP = 60;

export async function sendBroadcast(env, body, actor, sendRaw) {
  const resume = String(body.batch_id || "").trim();
  if (resume) return drainBatch(env, resume, sendRaw);

  const message = String(body.message || "").trim();
  const audience = String(body.audience || "all").trim();
  if (!message) return bad("متن پیام خالی است");
  if (!AUDIENCES[audience]) return bad("مخاطب نامعتبر است");

  const { results } = await env.DB.prepare(AUDIENCES[audience]).all();
  const targets = [...new Set((results || []).map((r) => String(r.chat_id)).filter(Boolean))];
  if (targets.length === 0) return bad("هیچ گیرنده‌ای در این گروه نیست");

  const batchId = newId("BC");
  await env.DB
    .prepare(
      `INSERT INTO crm_broadcasts
         (batch_id, message, audience, sent_count, failed_count, pending_count,
          deleted, created_at, total)
       VALUES (?, ?, ?, 0, 0, ?, 0, ?, ?)`
    )
    .bind(batchId, message, audience, targets.length, nowIso(), targets.length)
    .run();

  // صف در دسته‌های صدتایی نوشته می‌شود: یک INSERT به‌ازای هر نفر یعنی
  // هفت هزار رفت‌وبرگشت به پایگاه داده، که خودش از همان سقف رد می‌شود.
  for (let i = 0; i < targets.length; i += 100) {
    await env.DB.batch(
      targets.slice(i, i + 100).map((chat) =>
        env.DB
          .prepare(
            `INSERT INTO crm_broadcast_recipients (batch_id, chat_id, message_id, status)
             VALUES (?, ?, NULL, 'pending')`
          )
          .bind(batchId, chat)
      )
    );
  }

  return drainBatch(env, batchId, sendRaw);
}

/**
 * یک تکه از صفِ یک پیام را می‌فرستد.
 *
 * سه سرنوشت برای هر گیرنده: sent (رفت)، failed (تلگرام رد کرد - بلاک
 * کرده یا چت را پاک کرده، پس تکرارش فایده ندارد)، و pending که دست
 * نخورده می‌ماند تا دفعه‌ی بعد.
 *
 * تفاوتِ «تلگرام رد کرد» و «ما به سقف خوردیم» مهم‌ترین نکته‌ی این تابع
 * است: اولی permanent است و دومی موقت. اگر هر دو یکی حساب می‌شدند، یک
 * سقفِ زودهنگام کلِ بقیه‌ی فهرست را «ناموفق» علامت می‌زد و هرگز فرستاده
 * نمی‌شدند.
 */
export async function drainBatch(env, batchId, sendRaw) {
  const batch = await env.DB
    .prepare(
      `SELECT message, total, deleted, sent_count, failed_count, pending_count
         FROM crm_broadcasts WHERE batch_id = ?`
    )
    .bind(batchId)
    .first();
  if (!batch) return bad("این ارسال پیدا نشد");
  if (batch.deleted) return bad("این پیام حذف شده است");

  const { results } = await env.DB
    .prepare(
      // «هنوز نرفته» یعنی message_id ندارد - نه اینکه status خالی است.
      //
      // ردیف‌های ارسال‌های پیش از ساخته شدنِ ستونِ status، message_id
      // دارند و status ندارند. با شرطِ «status IS NULL یعنی در صف»،
      // همان‌ها دوباره در صف می‌افتادند و کاربرانی که هفته‌ی پیش پیام
      // گرفته بودند، دوباره همان پیام را می‌گرفتند.
      `SELECT id, chat_id FROM crm_broadcast_recipients
        WHERE batch_id = ? AND message_id IS NULL
          AND (status IS NULL OR status = 'pending')
        ORDER BY id LIMIT ?`
    )
    .bind(batchId, CHUNK_HARD_CAP)
    .all();

  const done = [];
  let sent = 0;
  let failed = 0;
  let stopped = false;

  for (let i = 0; i < (results || []).length; i++) {
    const r = results[i];
    let res;
    try {
      res = await sendRaw(r.chat_id, batch.message);
    } catch {
      // زیرساخت جواب نداد - سقفِ درخواست، شبکه، یا تایم‌اوت. بقیه‌ی
      // فهرست دست‌نخورده می‌ماند.
      stopped = true;
      break;
    }
    if (res && res.ok && res.message_id) {
      sent++;
      done.push({ id: r.id, status: "sent", messageId: String(res.message_id) });
    } else {
      failed++;
      done.push({ id: r.id, status: "failed", messageId: null });
    }
    // مکث هر بیست پیام، برای نخوردن به سقفِ نرخِ تلگرام.
    if (i % 20 === 19) await new Promise((k) => setTimeout(k, 1000));
  }

  if (done.length) {
    await env.DB.batch(
      done.map((d) =>
        env.DB
          .prepare("UPDATE crm_broadcast_recipients SET status = ?, message_id = ? WHERE id = ?")
          .bind(d.status, d.messageId, d.id)
      )
    );
  }

  // شمارش با حساب، نه با اسکن.
  //
  // پیشتر بعد از هر تکه یک SUM روی همه‌ی ردیف‌های این دسته اجرا می‌شد.
  // برای یک ارسالِ ۷٬۷۰۰ نفره یعنی ۱۵۵ اسکنِ کامل و بیش از یک میلیون
  // ردیف‌خوانی - که سقفِ روزانه‌ی D1 را پر کرد و دیتابیس را از کار
  // انداخت. عددها همین‌جا در دست‌اند: چند تا رفت، چند تا رد شد.
  //
  // pending_count از تعدادِ واقعیِ پردازش‌شده کم می‌شود و نه از اندازه‌ی
  // تکه: اگر وسطِ تکه به سقف بخوریم، بقیه هنوز در صف‌اند.
  const totalSent = (batch.sent_count || 0) + sent;
  const totalFailed = (batch.failed_count || 0) + failed;
  const remaining = Math.max(0, (batch.pending_count || 0) - done.length);

  if (done.length) {
    await env.DB
      .prepare(
        `UPDATE crm_broadcasts
            SET sent_count = ?, failed_count = ?, pending_count = ?
          WHERE batch_id = ?`
      )
      .bind(totalSent, totalFailed, remaining, batchId)
      .run();
  }
  return {
    ok: true,
    batch_id: batchId,
    // شمارشِ کلِ این ارسال، نه فقط این تکه: صفحه باید پیشرفت را نشان
    // بدهد نه آخرین تکه را.
    sent: totalSent,
    failed: totalFailed,
    total: batch.total || totalSent + totalFailed + remaining,
    remaining,
    done: remaining === 0,
    // اگر وسطِ تکه ایستادیم، صفحه بهتر است کمی صبر کند نه اینکه بلافاصله
    // دوباره بزند و باز به همان سقف بخورد.
    throttled: stopped,
    chunk_sent: sent,
    chunk_failed: failed,
  };
}

/**
 * صفِ همه‌ی ارسال‌های ناتمام - برای کران.
 *
 * تبِ مرورگر ممکن است بسته شود؛ این تضمین می‌کند ارسال به هر حال تمام
 * می‌شود. قدیمی‌ترین ارسالِ ناتمام اول، تا چیزی برای همیشه ته صف نماند.
 */
export async function drainPendingBroadcasts(env, sendRaw) {
  const row = await env.DB
    .prepare(
      // پیشتر اینجا یک EXISTS روی جدولِ گیرنده‌ها بود که برای هر ارسال
      // اجرا می‌شد - هر پنج دقیقه، ۲۸۸ بار در روز، حتی وقتی هیچ کارِ
      // نیمه‌کاره‌ای نبود. حالا فقط یک ستونِ عددی روی همین جدولِ
      // کوچک خوانده می‌شود.
      `SELECT batch_id FROM crm_broadcasts
        WHERE deleted = 0 AND COALESCE(pending_count, 0) > 0
        ORDER BY created_at LIMIT 1`
    )
    .first();
  if (!row) return { idle: true };
  return drainBatch(env, row.batch_id, sendRaw);
}

/**
 * حذف یک پیام همگانی از چتِ همه‌ی گیرنده‌ها.
 *
 * تلگرام فقط تا ۴۸ ساعت اجازه‌ی حذف می‌دهد؛ بعد از آن پیام‌ها می‌مانند و
 * فقط از فهرستِ پنل پنهان می‌شوند. این را برمی‌گردانیم تا کسی فکر نکند
 * پیامی که هنوز در گوشی کاربران است، پاک شده.
 */
export async function deleteBroadcast(env, body, deleteMsg) {
  const batchId = String(body.batch_id || "").trim();
  if (!batchId) return bad("batch_id لازم است");

  const { results } = await env.DB
    // فقط آن‌هایی که واقعاً پیام گرفته‌اند و هنوز پاک نشده‌اند: ردیفِ در
    // صف مانده message_id ندارد و حذفش از تلگرام بی‌معنی است.
    //
    // status IS NULL هم شامل می‌شود، وگرنه ارسال‌های پیش از ساخته شدنِ
    // این ستون اصلاً قابل حذف نبودند: message_id داشتند ولی status
    // نداشتند، پس پرس‌وجو هیچ ردیفی برنمی‌گرداند و حذف بی‌صدا «تمام شد»
    // اعلام می‌کرد در حالی که پیام هنوز سر جایش بود.
    .prepare(
      `SELECT id, chat_id, message_id FROM crm_broadcast_recipients
        WHERE batch_id = ? AND message_id IS NOT NULL
          AND (status = 'sent' OR status IS NULL)
        ORDER BY id LIMIT ?`
    )
    .bind(batchId, CHUNK_HARD_CAP)
    .all();

  const marks = [];
  let deleted = 0;
  let failed = 0;
  let stopped = false;

  for (const r of results || []) {
    let okDel;
    try {
      okDel = await deleteMsg(r.chat_id, r.message_id);
    } catch {
      stopped = true;
      break;
    }
    if (okDel) deleted++;
    else failed++;
    // هر دو حالت علامت می‌خورند: پیامی که تلگرام اجازه‌ی حذفش را نداد
    // (بیش از ۴۸ ساعت گذشته، یا کاربر خودش پاکش کرده) با تکرار هم پاک
    // نمی‌شود، و بدون علامت برای همیشه در صفِ حذف می‌ماند.
    marks.push({ id: r.id, status: okDel ? "deleted" : "delete_failed" });
  }

  if (marks.length) {
    await env.DB.batch(
      marks.map((m) =>
        env.DB
          .prepare("UPDATE crm_broadcast_recipients SET status = ?, message_id = NULL WHERE id = ?")
          .bind(m.status, m.id)
      )
    );
  }

  const left = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM crm_broadcast_recipients
        WHERE batch_id = ? AND message_id IS NOT NULL
          AND (status = 'sent' OR status IS NULL)`
    )
    .bind(batchId)
    .first();
  const remaining = (left && left.n) || 0;

  const totals = await env.DB
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'deleted' THEN 1 ELSE 0 END) AS deleted,
         SUM(CASE WHEN status = 'delete_failed' THEN 1 ELSE 0 END) AS failed
       FROM crm_broadcast_recipients WHERE batch_id = ?`
    )
    .bind(batchId)
    .first();

  // پرچمِ «حذف شده» فقط وقتی می‌نشیند که واقعاً تمام شده باشد. اگر وسطِ
  // کار می‌نشست، ارسالِ نیمه‌پاک‌شده در فهرست «حذف شده» نشان داده می‌شد
  // در حالی که هنوز در گوشیِ هزاران نفر است.
  if (remaining === 0) {
    await env.DB
      .prepare("UPDATE crm_broadcasts SET deleted = 1 WHERE batch_id = ?")
      .bind(batchId)
      .run();
  }

  // نامِ فیلدها همان است که صفحه می‌خواند.
  return {
    ok: true,
    batch_id: batchId,
    deleted: (totals && totals.deleted) || 0,
    failed: (totals && totals.failed) || 0,
    remaining,
    done: remaining === 0,
    throttled: stopped,
    chunk_deleted: deleted,
    chunk_failed: failed,
  };
}
