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
  last_interaction_at TEXT
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
