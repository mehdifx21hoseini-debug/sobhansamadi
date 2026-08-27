-- آینه‌ی داده‌ی تقویم اقتصادی در D1.
--
-- منبع اصلی همچنان جدول‌های n8n است که زمان‌بندهای خودش پر می‌کنند؛
-- این‌ها فقط کپی خوانده‌شده‌اند تا پاسخ به کاربر به بالا بودن n8n وابسته
-- نباشد. هیچ‌کدام منبع حقیقت نیستند و در هر همگام‌سازی کامل جای‌گزین
-- می‌شوند، پس کلید خارجی و ایندکس اضافی لازم ندارند.

CREATE TABLE IF NOT EXISTS econ_events (
  event_id     TEXT PRIMARY KEY,
  date         TEXT,
  time         TEXT,
  event        TEXT,
  event_fa     TEXT,
  importance   TEXT,
  forecast     TEXT,
  previous     TEXT,
  actual       TEXT,
  status       TEXT,
  source       TEXT,
  last_updated TEXT
);

-- هر سه نما (امروز/هفته/رویداد بعدی) بر اساس تاریخ فیلتر می‌کنند.
CREATE INDEX IF NOT EXISTS idx_econ_events_date ON econ_events (date);

CREATE TABLE IF NOT EXISTS econ_ai_cache (
  cache_key  TEXT PRIMARY KEY,
  answer     TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS econ_sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT
);
