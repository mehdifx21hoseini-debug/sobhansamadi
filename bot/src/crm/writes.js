// مسیرهای نوشتنیِ پنل CRM.
//
// ─── یک قاعده در کلِ این فایل ────────────────────────────────────────
// هر نوشتنی که وضعیتِ لید را عوض می‌کند، یک ردیف در crm_activity_log هم
// می‌گذارد. در n8n این کار پراکنده بود و بعضی مسیرها فراموشش کرده
// بودند - نتیجه‌اش تایم‌لاینی بود که بعضی اتفاق‌ها را نداشت و کسی
// نمی‌فهمید چرا. اینجا از یک تابع می‌گذرد، پس جا انداختنش سخت‌تر است.

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

  await env.DB
    .prepare("UPDATE crm_leads SET next_followup_at = ?, updated_at = ? WHERE lead_id = ?")
    .bind(value, nowIso(), leadId)
    .run();
  await logActivity(env, leadId, "followup", value || "پاک شد", actor);
  return { ok: true, next_followup_at: value };
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

export async function recordCall(env, body, actor) {
  const leadId = String(body.lead_id || "").trim();
  const result = String(body.result || "").trim();
  if (!leadId) return bad("lead_id لازم است");
  if (!result) return bad("نتیجه‌ی تماس لازم است");

  const lead = await env.DB
    .prepare("SELECT lead_id, contact_attempts FROM crm_leads WHERE lead_id = ?")
    .bind(leadId)
    .first();
  if (!lead) return bad("لید پیدا نشد");

  const callId = newId("CALL");
  const attempts = Number(lead.contact_attempts) || 0;
  const created = nowIso();

  // ثبتِ تماس و به‌روزرسانیِ لید با هم می‌روند. اگر جدا بودند، یک شکست
  // وسط کار یعنی تماسی که ثبت شده ولی شمارنده‌اش بالا نرفته - و آن
  // ناهماهنگی بعداً در گزارش‌ها پیدا می‌شود، نه همان لحظه.
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO crm_calls (call_id, lead_id, admin_username, result, note, next_step, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(callId, leadId, actor || "", result, String(body.note || ""), String(body.next_step || ""), created),
    env.DB
      .prepare(
        `UPDATE crm_leads SET contact_attempts = ?, last_call_result = ?, updated_at = ?
          WHERE lead_id = ?`
      )
      .bind(attempts + 1, result, created, leadId),
  ]);

  await logActivity(env, leadId, "call", result, actor);
  return { ok: true, call_id: callId, contact_attempts: attempts + 1 };
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
