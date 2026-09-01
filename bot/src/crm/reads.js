// مسیرهای خواندنیِ پنل CRM.
//
// ─── قاعده‌ی شکلِ پاسخ ───────────────────────────────────────────────
// تقریباً همه‌ی فهرست‌ها یک «آرایه‌ی خام» برمی‌گردانند، نه {success, data}.
// این حدس نیست: در WF-15 نودهای پاسخ روی allIncomingItems تنظیم شده‌اند،
// و request() در js/data.js هم پاسخ را بدون هیچ پوششی به صفحه می‌دهد.
// اگر اینجا در پوشش می‌گذاشتم، همه‌ی صفحه‌ها خالی می‌شدند بدون آنکه
// خطایی دیده شود - بدترین نوع شکست.
//
// فقط چهار مسیر شیء برمی‌گردانند و شکل هرکدام از همان نود n8n که آن را
// می‌ساخت برداشته شده.

const NOT_FOUND = { found: false };

async function all(env, sql, ...binds) {
  const q = env.DB.prepare(sql);
  const { results } = await (binds.length ? q.bind(...binds) : q).all();
  return results || [];
}

// ─── فهرست‌های ساده ──────────────────────────────────────────────────

export function listLeads(env) {
  return all(env, "SELECT * FROM crm_leads ORDER BY created_at DESC");
}

export function listCalls(env) {
  return all(env, "SELECT * FROM crm_calls ORDER BY created_at DESC");
}

export function listProducts(env) {
  return all(env, "SELECT * FROM crm_products ORDER BY product_id");
}

export function listMentoring(env) {
  return all(env, "SELECT * FROM crm_mentoring_requests ORDER BY created_at DESC");
}

export function listTickets(env) {
  return all(env, "SELECT * FROM crm_support_tickets ORDER BY created_at DESC");
}

export function listErrors(env) {
  return all(env, "SELECT * FROM crm_error_log ORDER BY created_at DESC");
}

export function listBroadcasts(env) {
  // حذف‌شده‌ها نباید در فهرست بیایند - «حذف» در این جدول یک پرچم است نه
  // یک DELETE، چون شناسه‌ی پیام‌ها برای پاک کردن از تلگرام لازم می‌ماند.
  return all(env, "SELECT * FROM crm_broadcasts WHERE deleted = 0 ORDER BY created_at DESC");
}

/**
 * مدیرهای تلگرامی ربات - همان چیزی که صفحه‌ی admins.html نشان می‌دهد.
 * با حساب‌های ورودِ پنل (crm_admin) یکی نیست.
 */
export function listAdmins(env) {
  return all(env, "SELECT * FROM crm_admin_users ORDER BY name");
}

/**
 * مشاورها: حساب‌های ورودِ پنل، برای منوی «تخصیص لید».
 *
 * فقط فعال‌ها. حسابی که غیرفعال شده نباید در فهرستِ تخصیص بیاید، وگرنه
 * لید به کسی داده می‌شود که اصلاً نمی‌تواند وارد پنل شود.
 *
 * هش و نمک و کد بازیابی هرگز بیرون نمی‌روند: ستون‌ها صریح نام برده
 * شده‌اند نه SELECT *، تا ستونِ حساسِ بعدی هم بی‌صدا لو نرود.
 */
export function listConsultants(env) {
  return all(
    env,
    `SELECT username, display_name, role, avatar FROM crm_admin
      WHERE active = 1 ORDER BY display_name, username`
  );
}

export function listContentTexts(env) {
  return all(env, "SELECT * FROM text_content ORDER BY content_id");
}

export function listContentFiles(env) {
  return all(env, "SELECT * FROM content_library ORDER BY content_id");
}

export function listEconSubscribers(env) {
  return all(env, "SELECT * FROM econ_subscriber ORDER BY updated_at DESC");
}

/** تاریخچه‌ی یک لید. n8n هم ردیف‌های بدون action را دور می‌ریخت. */
export function leadActivity(env, leadId) {
  return all(
    env,
    `SELECT * FROM crm_activity_log
      WHERE lead_id = ? AND action IS NOT NULL AND action <> ''
      ORDER BY created_at DESC`,
    String(leadId || "")
  );
}

// ─── تیکت پشتیبانی، با پیام‌هایش ─────────────────────────────────────

export async function ticketDetail(env, ticketId) {
  const id = String(ticketId || "");
  const ticket = await env.DB
    .prepare("SELECT * FROM crm_support_tickets WHERE ticket_id = ?")
    .bind(id)
    .first();
  if (!ticket) return NOT_FOUND;
  const messages = await all(
    env,
    "SELECT * FROM crm_ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC",
    id
  );
  return { found: true, ticket, messages };
}

// ─── پیگیری‌های امروز ────────────────────────────────────────────────

const URGENT_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * next_followup_at ستونِ امروزی است. reminder_date قدیمی است و فقط روی
 * ردیف‌هایی مانده که پیش از یکی شدنِ این دو نوشته شده‌اند؛ بدون این
 * جای‌گزینی، تاریخی که در تقویمِ یادآور ست شده هرگز اینجا دیده نمی‌شد.
 */
function followupOf(lead) {
  return lead.next_followup_at || lead.reminder_date || "";
}

/**
 * رشته‌ی فقط-تاریخ به‌عنوان نیمه‌شبِ UTC پارس می‌شود، که در تهران یعنی
 * روزِ قبل. این‌ها به ۹ صبحِ محلی - شروع روز کاری - لنگر می‌شوند.
 */
export function followupTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const p = raw.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2], 9, 0, 0, 0).getTime();
  }
  return new Date(raw).getTime();
}

/** سه سطل: عقب‌افتاده، فوری (تا دو ساعت آینده)، و بقیه‌ی امروز. */
export function bucketFollowups(rows, now = Date.now()) {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setHours(23, 59, 59, 999);

  const overdue = [];
  const urgent = [];
  const normal = [];

  for (const lead of rows) {
    const value = followupOf(lead);
    if (!value) continue;
    const t = followupTime(value);
    if (isNaN(t)) continue;
    // همیشه همان فیلدی گزارش می‌شود که صفحه می‌خواند، از هرکجا که آمده.
    const item = { ...lead, next_followup_at: new Date(t).toISOString() };
    if (t < now) overdue.push(item);
    else if (t >= dayStart.getTime() && t <= dayEnd.getTime()) {
      if (t - now <= URGENT_WINDOW_MS) urgent.push(item);
      else normal.push(item);
    }
  }

  const byTime = (a, b) => new Date(a.next_followup_at) - new Date(b.next_followup_at);
  overdue.sort(byTime); urgent.sort(byTime); normal.sort(byTime);

  return {
    overdue_count: overdue.length,
    urgent_count: urgent.length,
    normal_count: normal.length,
    overdue, urgent, normal,
  };
}

export async function followupsToday(env) {
  // فیلترِ «تاریخ دارد» در SQL انجام می‌شود نه در حافظه: جدول لیدها
  // بزرگ‌ترین جدولِ پنل است و کشیدنِ همه‌اش برای دور ریختنِ بیشترش،
  // هزینه‌ای است که هر بار باز کردنِ صفحه می‌پردازد.
  const rows = await all(
    env,
    `SELECT * FROM crm_leads
      WHERE (next_followup_at IS NOT NULL AND next_followup_at <> '')
         OR (reminder_date IS NOT NULL AND reminder_date <> '')`
  );
  return bucketFollowups(rows);
}

// ─── جزئیات یک لید ───────────────────────────────────────────────────

// وضعیت‌های خام به سه سطلِ نمایشی خلاصه می‌شوند - همان کاری که n8n
// می‌کرد. صفحه روی همین سه مقدار رنگ و فیلتر می‌گذارد، ولی مقدار خام هم
// در raw_status می‌رود چون بعضی جاها به خودش نیاز است.
const CALLED = ["تماس گرفته شد"];
const NOANSWER = ["پاسخ نداد"];

export function statusBucket(status) {
  if (CALLED.includes(status)) return "تماس گرفته شد";
  if (NOANSWER.includes(status)) return "پاسخ نداد";
  return "پاسخ‌داده‌نشده";
}

/**
 * تاریخچه‌ی گفتگوی کاربر با دستیار هوش مصنوعی.
 *
 * جای عجیبی نشسته - داخل ستون JSONِ temp_data در user_state - ولی همان
 * جایی است که ربات می‌نویسدش. هر خطای پارس بی‌صدا به آرایه‌ی خالی
 * می‌افتد: یک temp_data خراب نباید کلِ صفحه‌ی لید را از کار بیندازد.
 */
async function aiHistoryFor(env, telegramUserId) {
  if (!telegramUserId) return [];
  try {
    const row = await env.DB
      .prepare("SELECT temp_data FROM user_state WHERE telegram_user_id = ?")
      .bind(String(telegramUserId))
      .first();
    const td = row && row.temp_data ? JSON.parse(row.temp_data) : null;
    return td && Array.isArray(td.ai_history) ? td.ai_history : [];
  } catch {
    return [];
  }
}

export async function leadDetail(env, leadId) {
  const j = await env.DB
    .prepare("SELECT * FROM crm_leads WHERE lead_id = ?")
    .bind(String(leadId || ""))
    .first();
  if (!j || !j.lead_id) return NOT_FOUND;

  return {
    found: true,
    lead_id: j.lead_id,
    telegram_user_id: j.telegram_user_id,
    telegram_username: j.telegram_username,
    full_name: j.full_name,
    phone: j.phone,
    course: j.course,
    request_type: j.request_type,
    notes: j.notes,
    status: statusBucket(j.status),
    raw_status: j.status,
    contact_attempts: j.contact_attempts,
    created_at: j.created_at,
    updated_at: j.updated_at,
    priority: j.priority,
    reminder_date: j.reminder_date,
    score: j.score,
    quality: j.quality,
    source: j.source,
    last_call_result: j.last_call_result,
    assigned_to: j.assigned_to,
    next_followup_at: j.next_followup_at,
    ai_history: await aiHistoryFor(env, j.telegram_user_id),
    calls: await all(
      env,
      "SELECT call_id, admin_username, result, note, next_step, created_at FROM crm_calls WHERE lead_id = ? ORDER BY created_at DESC",
      j.lead_id
    ),
    orders: await leadOrders(env, j.lead_id),
    tickets: await leadTickets(env, j.telegram_user_id),
  };
}

/**
 * خریدهای همین لید، با نامِ محصول.
 *
 * نام در crm_orders نیست و فقط شناسه‌ی محصول ذخیره می‌شود، پس بدون این
 * اتصال صفحه‌ی لید یک شناسه‌ی بی‌معنا نشان می‌داد. LEFT JOIN است چون
 * خریدِ دستیِ «سایر» اصلاً محصولی ندارد.
 */
function leadOrders(env, leadId) {
  return all(
    env,
    `SELECT o.order_id, o.product_id, o.amount, o.payment_status, o.payment_date,
            o.transaction_id, o.source, o.created_at, p.name AS product_name
       FROM crm_orders o
       LEFT JOIN crm_products p ON p.product_id = o.product_id
      WHERE o.lead_id = ?
      ORDER BY o.created_at DESC`,
    String(leadId || "")
  );
}

/**
 * تیکت‌های پشتیبانیِ همین شخص.
 *
 * اتصال از راه شناسه‌ی تلگرام است چون تیکت‌ها lead_id ندارند - ربات
 * موقع ثبت تیکت نمی‌داند طرف لید هم هست. بدون شناسه‌ی تلگرام هیچ
 * اتصالی ممکن نیست و فهرست خالی برمی‌گردد.
 */
function leadTickets(env, telegramUserId) {
  const id = String(telegramUserId || "").trim();
  if (!id) return Promise.resolve([]);
  return all(
    env,
    `SELECT ticket_id, request_type, message, status, priority, assigned_to, created_at, updated_at
       FROM crm_support_tickets WHERE telegram_user_id = ? ORDER BY created_at DESC`,
    id
  );
}

// ─── داشبورد مدیر ────────────────────────────────────────────────────

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * شمارش‌های داشبورد.
 *
 * جدا از خواندنِ دیتابیس نگه داشته شده تا بشود با ورودیِ ساختگی و یک
 * «الان»ِ ثابت سنجیدش - وگرنه هر تستی به ساعتِ اجرا وابسته می‌شد.
 */
export function dashboardStats(leads, users, range = "ALL", nowMs = Date.now()) {
  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  let todayCount = 0, yesterdayCount = 0, weekCount = 0, monthCount = 0;
  for (const r of leads) {
    const created = parseDate(r.created_at);
    if (!created) continue;
    if (created >= startOfToday) todayCount++;
    else if (created >= startOfYesterday && created < startOfToday) yesterdayCount++;
    if (created >= sevenDaysAgo) weekCount++;
    if (created >= startOfMonth) monthCount++;
  }

  let rangeStart = null;
  if (range === "DAILY") rangeStart = startOfToday;
  else if (range === "WEEKLY") rangeStart = sevenDaysAgo;
  else if (range === "MONTHLY") rangeStart = startOfMonth;

  const inRange = rangeStart
    ? leads.filter((r) => { const d = parseDate(r.created_at); return d && d >= rangeStart; })
    : leads;

  const status_counts = {};
  const type_counts = {};
  for (const r of inRange) {
    const st = r.status || "نامشخص";
    status_counts[st] = (status_counts[st] || 0) + 1;
    const rt = r.request_type || "نامشخص";
    type_counts[rt] = (type_counts[rt] || 0) + 1;
  }

  let dauCount = 0, wauCount = 0;
  for (const u of users) {
    const lastSeen = parseDate(u.last_interaction_at);
    if (!lastSeen) continue;
    if (lastSeen >= startOfToday) dauCount++;
    if (lastSeen >= sevenDaysAgo) wauCount++;
  }

  return {
    range,
    leads_today: todayCount,
    leads_yesterday: yesterdayCount,
    leads_week: weekCount,
    leads_month: monthCount,
    leads_in_range: inRange.length,
    leads_total: leads.length,
    status_counts,
    type_counts,
    bot_users_total: users.length,
    bot_users_dau: dauCount,
    bot_users_wau: wauCount,
    generated_at: now.toISOString(),
  };
}

export async function adminDashboard(env, range) {
  const leads = await all(env, "SELECT lead_id, status, request_type, created_at FROM crm_leads");
  const allUsers = await all(env, "SELECT telegram_user_id, last_interaction_at FROM user_state");
  const admins = await all(env, "SELECT telegram_id FROM crm_admin_users");

  // ادمین‌ها از شمارشِ «کاربران ربات» بیرون می‌روند. بدون این، تیمِ خودمان
  // در آمارِ کاربرانِ فعال می‌آمد و عدد را همیشه بالاتر از واقعیت نشان
  // می‌داد - و روی یک ربات با چند صد کاربر، این اختلاف کم نیست.
  const adminIds = new Set(admins.map((a) => String(a.telegram_id)));
  const users = allUsers.filter((u) => !adminIds.has(String(u.telegram_user_id)));

  return dashboardStats(leads, users, range || "ALL");
}
