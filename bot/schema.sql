-- دیتابیس مستقل بات (Cloudflare D1) - جایگزین جدول‌های n8n Data Table
-- (user_state, leads, support_tickets) که این بات دیگه بهشون وابسته نیست.

CREATE TABLE IF NOT EXISTS user_state (
  telegram_user_id TEXT PRIMARY KEY,
  current_flow TEXT,
  current_step TEXT,
  temp_data TEXT,           -- JSON: {course, name, phone, level, topic, preferred_time, ...}
  phone TEXT,
  intro_progress INTEGER DEFAULT 0,
  source_first_seen TEXT,
  last_interaction_at TEXT,
  -- دیگر خوانده و نوشته نمی‌شود. دروازه‌ی عضویت کش را برداشت چون کسی که
  -- از کانال بیرون می‌رفت تا انقضای همین ستون دسترسی‌اش باز می‌ماند. ستون
  -- سر جایش مانده تا دیتای موجود دور ریخته نشود.
  channel_verified_at TEXT  -- منسوخ
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_type TEXT NOT NULL,   -- 'ثبت‌نام' | 'مشاوره'
  telegram_user_id TEXT NOT NULL,
  username TEXT,
  name TEXT,
  phone TEXT,
  course TEXT,
  level TEXT,
  topic TEXT,
  preferred_time TEXT,
  confirmed TEXT DEFAULT 'false',  -- 'true' فقط وقتی فرم کامل تایید شده
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_tickets (
  ticket_id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  telegram_username TEXT,
  first_name TEXT,
  last_name TEXT,
  message TEXT,
  status TEXT DEFAULT 'باز',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  username TEXT,
  content_id TEXT NOT NULL,   -- مثلا BOOK_01_PDF, EXPERT_MT4_FILE, INTRO_P05
  created_at TEXT NOT NULL,
  delivered INTEGER DEFAULT 0  -- تا وقتی ارسال فایل واقعی خودکار نشده، دستی چک می‌شود
);

-- دفترچه‌ی شماره‌ها: شماره‌ی هر کسی که برای دوره‌ی مقدماتی، اکسپرت یا
-- فرم‌های ثبت‌نام/مشاوره شماره‌اش را داده. یک ردیف برای هر کاربر؛
-- منبع‌ها روی هم جمع می‌شوند. جدا از leads است چون لید یعنی کسی که
-- باید پیگیری شود، و این یعنی کسی که فقط شماره‌اش را داریم.
CREATE TABLE IF NOT EXISTS phone_book (
  telegram_user_id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  name TEXT,
  username TEXT,
  sources TEXT NOT NULL DEFAULT '[]',   -- JSON: ["دوره مقدماتی", ...]
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phone_book_phone ON phone_book(phone);
CREATE INDEX IF NOT EXISTS idx_phone_book_created ON phone_book(created_at);

-- مشترکین هشدار تقویم اقتصادی. تا پیش از این فقط در جدول‌های n8n بود و
-- هر بار n8n می‌خوابید، کارت هشدار از مینی‌اپ ناپدید می‌شد و پیام صبح
-- نمی‌رفت. حالا منبع اصلی همین است و هر دو راهِ نوشتن (دکمه‌های ربات و
-- مینی‌اپ) به همین‌جا می‌رسند.
CREATE TABLE IF NOT EXISTS econ_subscriber (
  telegram_user_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  subscribed INTEGER NOT NULL DEFAULT 0,
  alert_minutes INTEGER NOT NULL DEFAULT 15,   -- فقط ۵/۱۵/۳۰/۶۰
  show_low_importance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_econ_sub_active ON econ_subscriber(subscribed);
