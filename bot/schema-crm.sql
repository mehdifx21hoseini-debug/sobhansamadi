-- جدول‌های CRM در D1.
--
-- تا امروز اینها در Data Table های n8n بودند و کلِ پنل روی همان سرور
-- ایستاده بود. این فایل مقصدشان در D1 است.
--
-- ─── دو تصمیم که کلِ این فایل را شکل می‌دهند ───────────────────────────
--
-- ۱) پیشوندِ crm_. جدولِ leads و support_tickets از قبل در D1 هستند، ولی
--    شکلِ متفاوتی دارند: آن‌ها را ربات می‌سازد و ستون‌هایشان چیز دیگری
--    است (name/level/topic در برابر full_name/status/assigned_to). اگر
--    همین اسم‌ها استفاده می‌شد، یا باید ستون‌های ربات را می‌شکستیم یا
--    ستون‌های CRM را. با پیشوند، هر دو کنار هم زندگی می‌کنند و در مرحله‌ی
--    آخر - وقتی ربات مستقیم در جدول CRM بنویسد - جدولِ قدیمی خالی
--    می‌ماند و بعداً حذف می‌شود. مهاجرتی که وسطش هر دو سمت زنده‌اند،
--    ارزانش همین است.
--
-- ۲) ستون‌ها مو‌به‌مو همان n8n. حتی جاهایی که اسم بهتری داشت و حتی
--    جاهایی که نوع بهتری داشت (contact_attempts در n8n number است و
--    اینجا INTEGER می‌ماند، نه چیز دیگر). دلیلش این است که در دوره‌ی
--    موازی باید بشود خروجی ورکر و n8n را بایت‌به‌بایت مقایسه کرد؛ هر
--    تغییرِ نام یعنی یک تفاوتِ ساختگی که باید از تفاوتِ واقعی جدا شود.
--    زیباسازی بعد از خاموش شدن n8n.

-- ─── لیدها ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_leads (
  lead_id TEXT PRIMARY KEY,
  telegram_user_id TEXT,
  telegram_username TEXT,
  full_name TEXT,
  phone TEXT,
  course TEXT,
  request_type TEXT,
  notes TEXT,
  status TEXT,
  contact_attempts INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT,
  score INTEGER,
  priority TEXT,
  assigned_to TEXT,
  reminder_date TEXT,
  source TEXT,
  quality TEXT,
  last_call_result TEXT,
  next_followup_at TEXT
);

-- فهرست لیدها همیشه با تاریخ مرتب می‌شود و اغلب با وضعیت فیلتر.
CREATE INDEX IF NOT EXISTS idx_crm_leads_created ON crm_leads (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON crm_leads (status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON crm_leads (assigned_to);
-- صفحه‌ی «پیگیری‌های امروز» فقط روی همین ستون می‌گردد.
CREATE INDEX IF NOT EXISTS idx_crm_leads_followup ON crm_leads (next_followup_at);
-- ضدِ تکراری: ورودیِ ربات با شماره dedupe می‌کند.
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON crm_leads (phone);

-- ─── حساب‌های ورود پنل ─────────────────────────────────────────────────
-- active در n8n امروز اضافه شد. اینجا از روز اول هست و NOT NULL است:
-- «نامشخص» برای یک پرچمِ دسترسی، حالتِ خطرناکی است.
CREATE TABLE IF NOT EXISTS crm_admin (
  username TEXT PRIMARY KEY,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'admin',
  active INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  password_salt TEXT,
  telegram_chat_id TEXT,
  reset_code TEXT,
  reset_expires TEXT,
  avatar TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- ستونِ password (رمزِ متنِ ساده) عمداً منتقل نشد. در n8n خالی بود و
-- تنها کاری که می‌کرد این بود که یک مسیرِ فرار در کدِ ورود باز نگه دارد.

-- ─── نشست‌ها ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_session (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- برای پاکسازیِ نشست‌های منقضی و برای «همه‌ی نشست‌های این کاربر را ببند».
CREATE INDEX IF NOT EXISTS idx_crm_session_expires ON crm_session (expires_at);
CREATE INDEX IF NOT EXISTS idx_crm_session_user ON crm_session (username);

-- ─── تاریخچه‌ی فعالیت روی لید ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT,
  action TEXT,
  detail TEXT,
  actor TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_activity_lead ON crm_activity_log (lead_id, created_at DESC);

-- ─── تماس‌ها ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_calls (
  call_id TEXT PRIMARY KEY,
  lead_id TEXT,
  admin_username TEXT,
  result TEXT,
  note TEXT,
  next_step TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_calls_lead ON crm_calls (lead_id, created_at DESC);
-- جدول عملکرد مشاوران روی همین دو ستون گروه می‌بندد.
CREATE INDEX IF NOT EXISTS idx_crm_calls_admin ON crm_calls (admin_username, created_at);

-- ─── محصولات و سفارش‌ها ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_products (
  product_id TEXT PRIMARY KEY,
  name TEXT,
  price INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS crm_orders (
  order_id TEXT PRIMARY KEY,
  lead_id TEXT,
  product_id TEXT,
  amount INTEGER,
  payment_status TEXT,
  payment_date TEXT,
  transaction_id TEXT,
  source TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_orders_lead ON crm_orders (lead_id);
-- KPI فروش روی «پرداخت‌شده‌های این بازه» است.
CREATE INDEX IF NOT EXISTS idx_crm_orders_paid ON crm_orders (payment_status, payment_date);

-- ─── پشتیبانی ──────────────────────────────────────────────────────────
-- اسم crm_ گرفت چون support_tickets در D1 از قبل هست و ربات می‌سازدش.
CREATE TABLE IF NOT EXISTS crm_support_tickets (
  ticket_id TEXT PRIMARY KEY,
  telegram_user_id TEXT,
  telegram_username TEXT,
  first_name TEXT,
  last_name TEXT,
  request_type TEXT,
  message TEXT,
  reason TEXT,
  status TEXT,
  priority TEXT,
  assigned_to TEXT,
  photo_file_ids TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_tickets_status ON crm_support_tickets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS crm_ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL,
  direction TEXT,          -- 'in' از کاربر، 'out' از پشتیبانی
  message TEXT,
  admin_name TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_ticket_msg ON crm_ticket_messages (ticket_id, created_at);

-- ─── پیام همگانی ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_broadcasts (
  batch_id TEXT PRIMARY KEY,
  message TEXT,
  audience TEXT,
  sent_count INTEGER DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

-- برای «حذف پیام همگانی»: باید شناسه‌ی پیام در هر چت را داشت تا بشود در
-- تلگرام هم پاکش کرد، نه فقط در جدول.
CREATE TABLE IF NOT EXISTS crm_broadcast_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_bcast_batch ON crm_broadcast_recipients (batch_id);

-- ─── درخواست‌های منتورینگ ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_mentoring_requests (
  request_id TEXT PRIMARY KEY,
  lead_id TEXT,
  created_at TEXT,
  full_name TEXT,
  phone TEXT,
  telegram_id TEXT,
  email TEXT,
  consultation_goal TEXT,
  answers_json TEXT,
  raw_payload TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_mentoring_created ON crm_mentoring_requests (created_at DESC);

-- ─── خطاها ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_error_log (
  log_id TEXT PRIMARY KEY,
  workflow_name TEXT,
  node_name TEXT,
  error_message TEXT,
  input_snapshot TEXT,
  telegram_user_id TEXT,
  retry_count INTEGER DEFAULT 0,
  resolved INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  severity TEXT,
  created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_crm_errors_open ON crm_error_log (resolved, created_at DESC);

-- ─── ادمین‌های تلگرامی ربات ────────────────────────────────────────────
-- این همان جدولی است که صفحه‌ی admins.html نشان می‌دهد - و با crm_admin
-- یکی نیست. آن یکی لاگین وب است، این یکی می‌گوید چه کسی در تلگرام
-- اعلان می‌گیرد.
CREATE TABLE IF NOT EXISTS crm_admin_users (
  telegram_id TEXT PRIMARY KEY,
  name TEXT,
  role TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS crm_admin_action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_telegram_id TEXT,
  admin_username TEXT,
  action_type TEXT,
  lead_id TEXT,
  details TEXT,
  created_at TEXT
);

-- ─── تخصیص چرخشی ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_rr_state (
  state_key TEXT PRIMARY KEY,
  last_assigned_username TEXT
);

-- ─── نگاشتِ پاسخ ادمین ────────────────────────────────────────────────
-- وقتی ادمین در تلگرام روی پیامِ یک لید ریپلای می‌کند، از این جدول
-- می‌فهمیم پاسخ مالِ کدام مشتری است.
CREATE TABLE IF NOT EXISTS crm_admin_reply_map (
  admin_message_id TEXT PRIMARY KEY,
  customer_telegram_user_id TEXT,
  lead_id TEXT,
  created_at TEXT
);
