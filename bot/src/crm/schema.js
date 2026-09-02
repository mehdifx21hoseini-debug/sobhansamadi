// ساختِ جدول‌های CRM در D1.
//
// چرا در کد و نه فقط در schema-crm.sql: راه‌اندازی نباید به این وابسته
// باشد که کسی یادش بماند یک فایل SQL را دستی اجرا کند. همان الگویی که
// تقویم دارد - هر مسیری که به این جدول‌ها دست می‌زند، اول ensureCrmSchema
// را صدا می‌زند و همه‌ی دستورها idempotent هستند.
//
// فایل schema-crm.sql همچنان منبعِ خواندنی و مستندِ ساختار است؛ این
// آرایه باید با آن یکی بماند.

const DDL = [
  `CREATE TABLE IF NOT EXISTS crm_leads (
     lead_id TEXT PRIMARY KEY, telegram_user_id TEXT, telegram_username TEXT,
     full_name TEXT, phone TEXT, course TEXT, request_type TEXT, notes TEXT,
     status TEXT, contact_attempts INTEGER DEFAULT 0, created_at TEXT,
     updated_at TEXT, score INTEGER, priority TEXT, assigned_to TEXT,
     reminder_date TEXT, source TEXT, quality TEXT, last_call_result TEXT,
     next_followup_at TEXT, level TEXT, topic TEXT, followup_reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads (created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads (status)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads (assigned_to)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_leads_followup ON crm_leads (next_followup_at)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON crm_leads (phone)`,

  `CREATE TABLE IF NOT EXISTS crm_admin (
     username TEXT PRIMARY KEY, display_name TEXT, role TEXT NOT NULL DEFAULT 'admin',
     active INTEGER NOT NULL DEFAULT 0, password_hash TEXT, password_salt TEXT,
     telegram_chat_id TEXT, reset_code TEXT, reset_expires TEXT, avatar TEXT,
     created_at TEXT, updated_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS crm_session (
     token TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT,
     expires_at TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_session_expires ON crm_session (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_session_user ON crm_session (username)`,

  // شمارشِ تلاش‌های ناموفقِ ورود. کلید یا «کاربر|IP» است یا «ip:IP» -
  // توضیحش در auth.js. ردیف‌ها با موفق شدنِ ورود یا با گذشتنِ پنجره
  // بی‌اثر می‌شوند، پس این جدول هیچ‌وقت بزرگ نمی‌شود.
  `CREATE TABLE IF NOT EXISTS crm_login_attempt (
     key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0,
     window_start TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS crm_activity_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id TEXT, action TEXT,
     detail TEXT, actor TEXT, created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_activity_lead ON crm_activity_log (lead_id, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS crm_calls (
     call_id TEXT PRIMARY KEY, lead_id TEXT, admin_username TEXT, result TEXT,
     note TEXT, next_step TEXT, created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_calls_lead ON crm_calls (lead_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_calls_admin ON crm_calls (admin_username, created_at)`,

  `CREATE TABLE IF NOT EXISTS crm_products (
     product_id TEXT PRIMARY KEY, name TEXT, price INTEGER,
     active INTEGER NOT NULL DEFAULT 1, created_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS crm_orders (
     order_id TEXT PRIMARY KEY, lead_id TEXT, product_id TEXT, amount INTEGER,
     payment_status TEXT, payment_date TEXT, transaction_id TEXT, source TEXT,
     created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_orders_lead ON crm_orders (lead_id)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_orders_paid ON crm_orders (payment_status, payment_date)`,

  `CREATE TABLE IF NOT EXISTS crm_support_tickets (
     ticket_id TEXT PRIMARY KEY, telegram_user_id TEXT, telegram_username TEXT,
     first_name TEXT, last_name TEXT, request_type TEXT, message TEXT, reason TEXT,
     status TEXT, priority TEXT, assigned_to TEXT, photo_file_ids TEXT,
     created_at TEXT, updated_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_tickets_status ON crm_support_tickets (status, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS crm_ticket_messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL, direction TEXT,
     message TEXT, admin_name TEXT, created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_ticket_msg ON crm_ticket_messages (ticket_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS crm_broadcasts (
     batch_id TEXT PRIMARY KEY, message TEXT, audience TEXT,
     sent_count INTEGER DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, created_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS crm_broadcast_recipients (
     id INTEGER PRIMARY KEY AUTOINCREMENT, batch_id TEXT NOT NULL,
     chat_id TEXT NOT NULL, message_id TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_bcast_batch ON crm_broadcast_recipients (batch_id)`,

  `CREATE TABLE IF NOT EXISTS crm_mentoring_requests (
     request_id TEXT PRIMARY KEY, lead_id TEXT, created_at TEXT, full_name TEXT,
     phone TEXT, telegram_id TEXT, email TEXT, consultation_goal TEXT,
     answers_json TEXT, raw_payload TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_mentoring_created ON crm_mentoring_requests (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS crm_error_log (
     log_id TEXT PRIMARY KEY, workflow_name TEXT, node_name TEXT, error_message TEXT,
     input_snapshot TEXT, telegram_user_id TEXT, retry_count INTEGER DEFAULT 0,
     resolved INTEGER NOT NULL DEFAULT 0, notes TEXT, severity TEXT, created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_crm_errors_open ON crm_error_log (resolved, created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS crm_admin_users (
     telegram_id TEXT PRIMARY KEY, name TEXT, role TEXT,
     active INTEGER NOT NULL DEFAULT 1)`,

  `CREATE TABLE IF NOT EXISTS crm_admin_action_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, admin_telegram_id TEXT, admin_username TEXT,
     action_type TEXT, lead_id TEXT, details TEXT, created_at TEXT)`,

  `CREATE TABLE IF NOT EXISTS crm_rr_state (
     state_key TEXT PRIMARY KEY, last_assigned_username TEXT)`,

  `CREATE TABLE IF NOT EXISTS crm_admin_reply_map (
     admin_message_id TEXT PRIMARY KEY, customer_telegram_user_id TEXT,
     lead_id TEXT, created_at TEXT)`,
];

/**
 * ستون‌هایی که بعد از ساختِ اولیه‌ی جدول اضافه شده‌اند.
 *
 * CREATE TABLE IF NOT EXISTS روی جدولی که از قبل هست هیچ کاری نمی‌کند،
 * پس ستونِ تازه هرگز به دیتابیسِ موجود اضافه نمی‌شود مگر صریح. sqlite
 * هم «ADD COLUMN IF NOT EXISTS» ندارد، پس اجرای دوباره خطای «duplicate
 * column name» می‌دهد و همان خطا اینجا بلعیده می‌شود - این ارزان‌ترین
 * راهِ idempotent بودن است، ارزان‌تر از خواندن PRAGMA در هر درخواست.
 *
 * جدا از batch اجرا می‌شوند چون یک خطا کلِ batch را برمی‌گرداند.
 */
const ADD_COLUMNS = [
  // پاسخ‌های ربات: سطح معامله‌گری و هدف از مشاوره. تا امروز فقط داخل
  // متنِ notes بودند و هیچ‌جا قابل فیلتر یا جستجو نبودند.
  "ALTER TABLE crm_leads ADD COLUMN level TEXT",
  "ALTER TABLE crm_leads ADD COLUMN topic TEXT",
  // دلیلِ پیگیری. تاریخ به‌تنهایی نمی‌گوید قرار بوده چه بگوییم، و
  // مشاور برای فهمیدنش باید پرونده را باز کند و یادداشت‌ها را بخواند.
  "ALTER TABLE crm_leads ADD COLUMN followup_reason TEXT",
  // فرمِ تعیین سطح: سه پاسخِ تازه که پیش از این پرسیده نمی‌شدند.
  //
  // بدون ستونِ جدا، هر سه داخل متنِ یادداشت می‌ماندند - همان اشتباهی که
  // یک بار برای «سطح» و «هدف» تکرار شد و بعداً باید پارس‌شان می‌کردیم.
  // مشاور باید پیش از برداشتنِ گوشی بداند طرف حساب واقعی دارد یا نه.
  "ALTER TABLE crm_leads ADD COLUMN experience TEXT",
  "ALTER TABLE crm_leads ADD COLUMN has_real_account TEXT",
  "ALTER TABLE crm_leads ADD COLUMN trade_status TEXT",
  // صفِ پیام همگانی.
  //
  // تا امروز ردیفِ گیرنده فقط بعد از ارسالِ موفق ساخته می‌شد، پس هیچ‌جا
  // نوشته نبود «این نفر هنوز مانده». حالا همه‌ی گیرنده‌ها از اول ثبت
  // می‌شوند و همین ستون می‌گوید کدامشان فرستاده شده - تنها راهی که
  // ارسال بتواند تکه‌تکه انجام شود و از جایی که مانده ادامه پیدا کند.
  "ALTER TABLE crm_broadcast_recipients ADD COLUMN status TEXT",
  "ALTER TABLE crm_broadcasts ADD COLUMN total INTEGER",
  // شمارنده‌های روی خودِ ردیفِ ارسال.
  //
  // چرا لازم شد: هم صفحه‌ی پیشرفت و هم کرانِ هر پنج دقیقه، جوابشان را
  // با اسکنِ جدولِ گیرنده‌ها می‌گرفتند. یک ارسالِ ۷٬۷۰۰ نفره یعنی ۱۵۵
  // تکه و هر تکه یک اسکنِ کامل - بیش از یک میلیون ردیف‌خوانی برای
  // شمردنِ چیزی که خودمان همان لحظه می‌دانیم. سقفِ روزانه‌ی D1 یک بار
  // به همین دلیل پر شد و دیتابیس تا نیمه‌شب UTC از کار افتاد.
  //
  // حالا هر تکه فقط عددها را جمع و تفریق می‌کند و هیچ‌کس جدولِ
  // گیرنده‌ها را نمی‌شمارد.
  "ALTER TABLE crm_broadcasts ADD COLUMN failed_count INTEGER",
  "ALTER TABLE crm_broadcasts ADD COLUMN pending_count INTEGER",
];

/**
 * پر کردنِ یک‌باره‌ی شمارنده‌ها برای ارسال‌هایی که پیش از این ستون‌ها
 * ساخته شده‌اند.
 *
 * فقط ردیف‌هایی را می‌خواند که هنوز NULL‌اند، پس بعد از اولین اجرا
 * عملاً یک اسکنِ سیزده‌ردیفی است و نه بیشتر. بدونِ این، کران برای
 * ارسال‌های قدیمی تصمیمِ اشتباه می‌گرفت.
 */
const BACKFILL = [
  `UPDATE crm_broadcasts SET pending_count = (
       SELECT COUNT(*) FROM crm_broadcast_recipients r
        WHERE r.batch_id = crm_broadcasts.batch_id
          AND r.message_id IS NULL
          AND (r.status IS NULL OR r.status = 'pending'))
     WHERE pending_count IS NULL`,
  `UPDATE crm_broadcasts SET failed_count = (
       SELECT COUNT(*) FROM crm_broadcast_recipients r
        WHERE r.batch_id = crm_broadcasts.batch_id AND r.status = 'failed')
     WHERE failed_count IS NULL`,
];

// روی ستونِ تازه، پس بعد از ADD_COLUMNS اجرا می‌شود نه با بقیه‌ی DDL.
const LATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_crm_bcast_pending
     ON crm_broadcast_recipients (batch_id, status)`,
];

let ensured = false;

/**
 * جدول‌ها را می‌سازد. بعد از اولین موفقیت روی این isolate دیگر تکرار
 * نمی‌شود - بیست دستور DDL روی هر درخواست، تاخیری است که هیچ چیزی
 * برنمی‌گرداند.
 */
export async function ensureCrmSchema(env) {
  if (ensured) return;
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
  for (const sql of ADD_COLUMNS) {
    try {
      await env.DB.prepare(sql).run();
    } catch (err) {
      // فقط «ستون از قبل هست» قابل چشم‌پوشی است؛ هر چیز دیگری باید
      // دیده شود، وگرنه یک مهاجرتِ شکست‌خورده بی‌صدا می‌ماند.
      const msg = String((err && err.message) || err);
      if (!/duplicate column name/i.test(msg)) {
        console.error("افزودن ستون شکست خورد:", sql, msg);
      }
    }
  }
  for (const sql of LATE_INDEXES) {
    await env.DB.prepare(sql).run().catch((err) =>
      console.error("ساخت ایندکس شکست خورد:", sql, err && err.message)
    );
  }
  for (const sql of BACKFILL) {
    await env.DB.prepare(sql).run().catch((err) =>
      console.error("پر کردنِ شمارنده‌ها شکست خورد:", err && err.message)
    );
  }
  ensured = true;
}

// برای تست: حافظه‌ی «ساخته شد» را پاک می‌کند.
export function resetSchemaCache() {
  ensured = false;
}

export const CRM_TABLES = [
  "crm_leads", "crm_admin", "crm_session", "crm_activity_log", "crm_calls",
  "crm_products", "crm_orders", "crm_support_tickets", "crm_ticket_messages",
  "crm_broadcasts", "crm_broadcast_recipients", "crm_mentoring_requests",
  "crm_error_log", "crm_admin_users", "crm_admin_action_log", "crm_rr_state",
  "crm_admin_reply_map",
];
