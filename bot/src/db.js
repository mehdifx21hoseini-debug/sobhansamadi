// لایه‌ی دسترسی به D1 - جایگزین جدول‌های n8n Data Table.

import { ensureCrmSchema } from "./crm/schema.js";

export async function getUserState(env, telegramUserId) {
  const row = await env.DB
    .prepare("SELECT * FROM user_state WHERE telegram_user_id = ?")
    .bind(String(telegramUserId))
    .first();
  if (!row) return null;
  return { ...row, temp_data: row.temp_data ? JSON.parse(row.temp_data) : {} };
}

export async function setUserState(env, telegramUserId, patch) {
  const existing = await getUserState(env, telegramUserId);

  // «کلید در patch هست» با «مقدارش پر است» فرق دارد.
  //
  // پیش‌تر اینجا ?? بود، و ?? یک nullِ صریح را هم نادیده می‌گیرد و به
  // مقدار قبلی برمی‌گردد. یعنی clearUserState - که دقیقاً null می‌فرستد
  // تا فرآیند را پاک کند - هیچ‌وقت واقعاً پاکش نمی‌کرد: فرآیند و قدمِ
  // قبلی سر جایشان می‌ماندند و کاربر برای همیشه «وسط یک فرم» می‌ماند.
  const pick = (key, fallback = null) => {
    if (key in patch) return patch[key] === undefined ? fallback : patch[key];
    if (existing && existing[key] !== undefined && existing[key] !== null) return existing[key];
    return fallback;
  };

  const merged = {
    telegram_user_id: String(telegramUserId),
    current_flow: pick("current_flow"),
    current_step: pick("current_step"),
    temp_data: patch.temp_data !== undefined ? patch.temp_data : existing?.temp_data ?? {},
    phone: pick("phone"),
    intro_progress: pick("intro_progress", 0),
    source_first_seen: existing?.source_first_seen ?? patch.source_first_seen ?? new Date().toISOString(),
    last_interaction_at: new Date().toISOString(),
  };
  await env.DB
    .prepare(
      `INSERT INTO user_state (telegram_user_id, current_flow, current_step, temp_data, phone, intro_progress, source_first_seen, last_interaction_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         current_flow=excluded.current_flow,
         current_step=excluded.current_step,
         temp_data=excluded.temp_data,
         phone=excluded.phone,
         intro_progress=excluded.intro_progress,
         last_interaction_at=excluded.last_interaction_at`
    )
    .bind(
      merged.telegram_user_id,
      merged.current_flow,
      merged.current_step,
      JSON.stringify(merged.temp_data),
      merged.phone,
      merged.intro_progress,
      merged.source_first_seen,
      merged.last_interaction_at
    )
    .run();
  return merged;
}

/**
 * ثبتِ اینکه این کاربر امروز با ربات کار کرده.
 *
 * چرا جدا از setUserState: آن یکی اول می‌خواند، بعد ادغام می‌کند، بعد
 * می‌نویسد - و فقط وقتی صدا زده می‌شود که کاربر وارد یک فرم شود. یعنی
 * کسی که فقط /start می‌زد و منو را می‌گشت هیچ ردی از خودش نمی‌گذاشت و در
 * هیچ شمارشی نمی‌آمد. این یکی یک upsert خالی است: بدون خواندن، و بدون
 * دست زدن به وضعیتِ فرمِ در جریان.
 *
 * شکستش هرگز نباید جلوی پاسخ به کاربر را بگیرد - یک عدد آماری به اندازه‌ی
 * جواب ندادن مهم نیست.
 */
export async function touchUser(env, telegramUserId) {
  if (!env || !env.DB) return;
  const now = new Date().toISOString();
  try {
    await env.DB
      .prepare(
        `INSERT INTO user_state (telegram_user_id, source_first_seen, last_interaction_at)
         VALUES (?, ?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET last_interaction_at = excluded.last_interaction_at`
      )
      .bind(String(telegramUserId), now, now)
      .run();
  } catch (err) {
    console.error("ثبت تعامل کاربر شکست خورد:", err && err.message);
  }
}

export async function clearUserState(env, telegramUserId) {
  await setUserState(env, telegramUserId, { current_flow: null, current_step: null, temp_data: {} });
}

export async function createLead(env, lead) {
  await env.DB
    .prepare(
      `INSERT INTO leads (request_type, telegram_user_id, username, name, phone, course, level, topic, preferred_time, confirmed, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      lead.request_type,
      String(lead.telegram_user_id),
      lead.username || null,
      lead.name || null,
      lead.phone || null,
      lead.course || null,
      lead.level || null,
      lead.topic || null,
      lead.preferred_time || null,
      lead.confirmed || "false",
      lead.source || "telegram_bot",
      new Date().toISOString()
    )
    .run();
}

export async function createSupportTicket(env, ticket) {
  const ticketId = "TCK-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const now = new Date().toISOString();
  const args = [
    ticketId,
    String(ticket.telegram_user_id),
    ticket.telegram_username || null,
    ticket.first_name || null,
    ticket.last_name || null,
    ticket.message || null,
    now,
  ];

  await env.DB
    .prepare(
      `INSERT INTO support_tickets (ticket_id, telegram_user_id, telegram_username, first_name, last_name, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'باز', ?)`
    )
    .bind(...args)
    .run();

  // و همان تیکت در جدولی که پنل CRM می‌خواند.
  //
  // این دو جدول هم‌نام نیستند و نباید باشند: support_tickets از قبل در
  // D1 بود و شکل دیگری داشت. تا پیش از سوییچ، پنل تیکت‌ها را از n8n
  // می‌گرفت؛ حالا از crm_support_tickets می‌خواند، پس بدون این نوشتن
  // تیکتِ تازه در صندوق پشتیبانی دیده نمی‌شود.
  //
  // خطایش بلعیده می‌شود: تیکت در جدول بالا ثبت شده و از بین نمی‌رود.
  try {
    await ensureCrmSchema(env);
    await env.DB
      .prepare(
        `INSERT INTO crm_support_tickets
           (ticket_id, telegram_user_id, telegram_username, first_name, last_name,
            message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'باز', ?, ?)`
      )
      .bind(...args, now)
      .run();
  } catch (err) {
    console.error("ثبت تیکت در crm_support_tickets شکست خورد:", err && err.message);
  }

  return ticketId;
}

export async function logContentRequest(env, telegramUserId, username, contentId) {
  await env.DB
    .prepare(
      `INSERT INTO content_requests (telegram_user_id, username, content_id, created_at) VALUES (?, ?, ?, ?)`
    )
    .bind(String(telegramUserId), username || null, contentId, new Date().toISOString())
    .run();
}

// --- منبع جذب کاربر ---
//
// لینک‌های عمیق تلگرام (t.me/BOT?start=instagram) اجازه می‌دهند بدانیم هر
// کاربر از کدام کمپین آمده. برای انتشار عمومی این تنها راه فهمیدن این است
// که تبلیغ اینستاگرام جواب داده یا پست کانال.
//
// جدول جداست و نه ستونی در user_state، چون clearUserState در پایان هر
// فرآیند temp_data را خالی می‌کند و منبع جذب باید برای همیشه بماند.
export async function ensureUserSource(env) {
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS user_source (
         telegram_user_id TEXT PRIMARY KEY, source TEXT, first_seen_at TEXT)`
    )
    .run();
}

// اولین لمس برنده است: اگر کاربری اول از اینستاگرام آمد و بعد از کانال،
// اعتبار جذب مال اینستاگرام است. DO NOTHING دقیقاً همین را تضمین می‌کند.
export async function recordUserSource(env, telegramUserId, source) {
  if (!source) return;
  await ensureUserSource(env);
  await env.DB
    .prepare(
      `INSERT INTO user_source (telegram_user_id, source, first_seen_at) VALUES (?, ?, ?)
         ON CONFLICT(telegram_user_id) DO NOTHING`
    )
    .bind(String(telegramUserId), String(source).slice(0, 64), new Date().toISOString())
    .run();
}

export async function readUserSource(env, telegramUserId) {
  try {
    const row = await env.DB
      .prepare(`SELECT source FROM user_source WHERE telegram_user_id = ?`)
      .bind(String(telegramUserId))
      .first();
    return row ? row.source : null;
  } catch {
    return null;
  }
}
