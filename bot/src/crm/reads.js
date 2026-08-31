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
