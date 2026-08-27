// لایه‌ی دسترسی به D1 - جایگزین جدول‌های n8n Data Table.

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
  const merged = {
    telegram_user_id: String(telegramUserId),
    current_flow: patch.current_flow ?? existing?.current_flow ?? null,
    current_step: patch.current_step ?? existing?.current_step ?? null,
    temp_data: patch.temp_data !== undefined ? patch.temp_data : existing?.temp_data ?? {},
    phone: patch.phone ?? existing?.phone ?? null,
    intro_progress: patch.intro_progress ?? existing?.intro_progress ?? 0,
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
  await env.DB
    .prepare(
      `INSERT INTO support_tickets (ticket_id, telegram_user_id, telegram_username, first_name, last_name, message, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'باز', ?)`
    )
    .bind(
      ticketId,
      String(ticket.telegram_user_id),
      ticket.telegram_username || null,
      ticket.first_name || null,
      ticket.last_name || null,
      ticket.message || null,
      new Date().toISOString()
    )
    .run();
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
