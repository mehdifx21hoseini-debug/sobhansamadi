// آینه‌ی داده‌ی تقویم در D1.
//
// چرا آینه: داده‌ی تقویم را زمان‌بندهای n8n جمع می‌کنند و در جدول‌های
// خودش می‌نویسند. اگر ورکر موقع هر ضربه‌ی کاربر مستقیم از n8n بخواند،
// تقویم دقیقاً به همان چیزی وابسته می‌ماند که مدام قطع می‌شد. به‌جای آن
// یک زمان‌بند در ورکر داده را می‌کشد و در D1 می‌ریزد؛ پاسخ به کاربر
// همیشه از D1 خوانده می‌شود، پس قطعی n8n تقویم را از کار نمی‌اندازد -
// فقط داده کمی کهنه می‌شود.

import { ensureKbSchema, replaceKb } from "../ai/kb.js";
import { importSubscribers } from "./subscribers.js";
import { ingestEnabled } from "./ingest.js";

const SYNC_STATE_KEY = "econ_last_sync";

// جدول‌ها را خودِ همگام‌سازی می‌سازد تا راه‌اندازی به یک مسیر موقت
// مهاجرت وابسته نباشد. همه‌ی دستورها idempotent هستند.
const DDL = [
  `CREATE TABLE IF NOT EXISTS econ_events (
     event_id TEXT PRIMARY KEY, date TEXT, time TEXT, event TEXT, event_fa TEXT,
     importance TEXT, forecast TEXT, previous TEXT, actual TEXT, status TEXT,
     source TEXT, last_updated TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_econ_events_date ON econ_events (date)`,
  `CREATE TABLE IF NOT EXISTS econ_labels (
     match_text TEXT PRIMARY KEY, label_fa TEXT, label_short_en TEXT,
     direction TEXT, priority INTEGER, active INTEGER)`,
  `CREATE TABLE IF NOT EXISTS econ_holidays (
     date TEXT, name TEXT, name_fa TEXT, country TEXT, market_status TEXT)`,
  `CREATE TABLE IF NOT EXISTS econ_ai_cache (
     cache_key TEXT PRIMARY KEY, answer TEXT, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS econ_sync_state (
     key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`,
];

export async function ensureSchema(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
}

// پیش از اولین همگام‌سازی موفق، جدول‌ها هنوز وجود ندارند. این حالت خطا
// نیست - یعنی «هنوز داده‌ای نداریم» - و باید همان‌طور خوانده شود، وگرنه
// کاربر به‌جای پیام روشن یک خطای داخلی می‌گیرد. فقط همین یک حالت بلعیده
// می‌شود؛ هر خطای دیگری بالا می‌رود.
function emptyIfNoTable(err) {
  if (err && /no such table/i.test(String(err.message))) return null;
  throw err;
}

export async function readEvents(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT event_id, date, time, event, event_fa, importance, forecast, previous,
              actual, status, source, last_updated
         FROM econ_events`
    ).all();
    return results || [];
  } catch (err) {
    emptyIfNoTable(err);
    return [];
  }
}

export async function readLabels(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT match_text, label_fa, label_short_en, direction, priority, active
         FROM econ_labels`
    ).all();
    // در D1 این ستون عدد است، ولی سازنده‌ی متن با `active !== false` فیلتر
    // می‌کند - و 0 برابر false نیست، پس برچسب غیرفعال بدون این تبدیل باز
    // هم اعمال می‌شد.
    return (results || []).map((r) => ({ ...r, active: r.active !== 0 }));
  } catch (err) {
    emptyIfNoTable(err);
    return [];
  }
}

export async function readHolidays(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT date, name, name_fa, country, market_status FROM econ_holidays`
    ).all();
    return results || [];
  } catch (err) {
    emptyIfNoTable(err);
    return [];
  }
}

export async function readAiAnswer(env, cacheKey) {
  try {
    const row = await env.DB.prepare(
      `SELECT answer, created_at FROM econ_ai_cache WHERE cache_key = ?`
    )
      .bind(cacheKey)
      .first();
    return row || null;
  } catch (err) {
    emptyIfNoTable(err);
    return null;
  }
}

export async function readSyncState(env) {
  try {
    const row = await env.DB.prepare(`SELECT value FROM econ_sync_state WHERE key = ?`)
      .bind(SYNC_STATE_KEY)
      .first();
    return row ? row.value : null;
  } catch (err) {
    emptyIfNoTable(err);
    return null;
  }
}

// کلید کش دقیقاً همان‌طوری ساخته می‌شود که n8n می‌سازد، وگرنه ورکر سطری
// را می‌خواند که هرگز نوشته نشده. (نودهای Build Explain Key / Build
// Explain Prompt)
const DEFAULT_QUESTION = "اخبار مهم اقتصادی امروز رو برام خلاصه و توضیح بده.";

export function todayCacheKey() {
  const today = new Date().toISOString().slice(0, 10);
  return today + "|" + DEFAULT_QUESTION.trim().toLowerCase().slice(0, 300);
}

// یک تراکنش جای‌گزینی کامل: جدول خالی می‌شود و ردیف‌های تازه می‌نشینند.
// چون منبع همیشه کل مجموعه را می‌دهد، ادغام تدریجی فایده‌ای ندارد و فقط
// ردیف‌های حذف‌شده در مبدأ را برای همیشه در آینه نگه می‌داشت.
export async function replaceEvents(env, events) {
  const rows = (events || []).filter((e) => e && e.event_id);
  const statements = [env.DB.prepare(`DELETE FROM econ_events`)];

  for (const e of rows) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO econ_events
           (event_id, date, time, event, event_fa, importance, forecast,
            previous, actual, status, source, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        String(e.event_id),
        e.date || null,
        e.time || null,
        e.event || null,
        e.event_fa || null,
        e.importance || "low",
        e.forecast || null,
        e.previous || null,
        e.actual || null,
        e.status || null,
        e.source || null,
        e.last_updated || null
      )
    );
  }

  await env.DB.batch(statements);
  return rows.length;
}

export async function replaceLabels(env, labels) {
  const rows = (labels || []).filter((r) => r && r.match_text);
  const statements = [env.DB.prepare(`DELETE FROM econ_labels`)];
  for (const r of rows) {
    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO econ_labels
           (match_text, label_fa, label_short_en, direction, priority, active)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        String(r.match_text),
        r.label_fa || null,
        r.label_short_en || null,
        r.direction || null,
        Number(r.priority) || 0,
        r.active === false ? 0 : 1
      )
    );
  }
  await env.DB.batch(statements);
  return rows.length;
}

export async function replaceHolidays(env, holidays) {
  const rows = (holidays || []).filter((r) => r && r.date);
  const statements = [env.DB.prepare(`DELETE FROM econ_holidays`)];
  for (const r of rows) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO econ_holidays (date, name, name_fa, country, market_status)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        String(r.date),
        r.name || null,
        r.name_fa || null,
        r.country || null,
        r.market_status || null
      )
    );
  }
  await env.DB.batch(statements);
  return rows.length;
}

export async function replaceAiCache(env, entries) {
  const rows = (entries || []).filter((r) => r && r.cache_key && r.answer);
  const statements = [env.DB.prepare(`DELETE FROM econ_ai_cache`)];
  for (const r of rows) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO econ_ai_cache (cache_key, answer, created_at) VALUES (?, ?, ?)`
      ).bind(String(r.cache_key), String(r.answer), r.created_at || null)
    );
  }
  await env.DB.batch(statements);
  return rows.length;
}

export async function markSynced(env, note) {
  await env.DB.prepare(
    `INSERT INTO econ_sync_state (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(SYNC_STATE_KEY, note || new Date().toISOString(), new Date().toISOString())
    .run();
}

// می‌کشد و آینه را جای‌گزین می‌کند. اگر n8n قطع باشد استثنا می‌دهد و
// آینه‌ی قبلی دست‌نخورده می‌ماند - این دقیقاً همان چیزی است که تقویم را
// در قطعی سرِپا نگه می‌دارد.
export async function syncFromN8n(env) {
  if (!env.ECON_EXPORT_URL || !env.ECON_EXPORT_KEY) {
    throw new Error("ECON_EXPORT_URL/ECON_EXPORT_KEY تنظیم نشده است");
  }

  // اینجا کاربری منتظر نیست (زمان‌بند صدایش می‌زند)، پس مهلت سخاوتمندانه‌تر
  // است - ولی بی‌نهایت نیست، وگرنه یک اجرای معلق تا اجرای بعدی می‌ماند.
  const res = await fetch(env.ECON_EXPORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ key: env.ECON_EXPORT_KEY }),
  });

  if (!res.ok) throw new Error("پاسخ ناموفق از n8n: " + res.status);

  const data = await res.json();
  if (!data || data.success !== true) {
    throw new Error("پاسخ نامعتبر از n8n: " + (data && data.error ? data.error : "نامشخص"));
  }

  // بعد از گرفتن پاسخ سالم و پیش از اولین نوشتن: اگر جدول‌ها هنوز ساخته
  // نشده‌اند همین‌جا ساخته می‌شوند. اگر قبل از fetch صدا زده می‌شد، یک n8n
  // قطع باعث می‌شد هر ده دقیقه بیهوده DDL اجرا شود.
  await ensureSchema(env);
  await ensureKbSchema(env);

  // وقتی خود ورکر داده را جمع می‌کند، این دو جدول مالک تازه‌ای دارند و
  // آینه‌سازی باید کنار بکشد. بدون این شرط، هر ده دقیقه نسخه‌ی n8n روی
  // داده‌ی تازه‌ی ورکر نوشته می‌شد و از بیرون فقط این دیده می‌شد که عددها
  // گاهی عقب می‌روند.
  //
  // برچسب‌ها و بقیه همچنان از اینجا می‌آیند، پس /admin/sync دستی هنوز
  // کارِ خودش را می‌کند.
  const selfIngest = await ingestEnabled(env).catch(() => false);

  const eventCount = selfIngest ? null : await replaceEvents(env, data.events);
  const labelCount = await replaceLabels(env, data.labels);
  const holidayCount = selfIngest ? null : await replaceHolidays(env, data.holidays);
  const cacheCount = await replaceAiCache(env, data.ai_cache);

  // پایگاه دانش دستیار پشتیبانی هم از همین مسیر می‌آید. تا وقتی اندپوینت
  // export آن را نفرستد، این آرایه خالی است و جدول دست‌نخورده می‌ماند -
  // یعنی افزودنش به خروجی n8n کافی است تا خودبه‌خود شروع به کار کند.
  const kbCount = Array.isArray(data.kb) ? await replaceKb(env, data.kb) : null;

  // مشترکین هشدار، فقط برای پر کردن اولیه‌ی آینه.
  //
  // این یکی جای‌گزینی نیست بلکه INSERT OR IGNORE است: منبع اصلیِ این
  // فهرست از این به بعد خود D1 است و کاربر تنظیمش را از ربات و مینی‌اپ
  // عوض می‌کند. اگر هر بار با نسخه‌ی n8n بازنویسی می‌شد، هر تغییرِ کاربر
  // ده دقیقه بعد بی‌صدا برمی‌گشت به حالت قبل.
  const subs = Array.isArray(data.subscribers)
    ? await importSubscribers(env, data.subscribers)
    : null;

  await markSynced(env, new Date().toISOString());

  return {
    events: eventCount,
    labels: labelCount,
    holidays: holidayCount,
    ai_cache: cacheCount,
    kb: kbCount,
    subscribers: subs,
  };
}

// تحلیل هوش مصنوعی تنها چیزی است که در n8n می‌ماند - همان‌طور که قرار
// بود. ورکر زمینه را از آینه‌ی خودش می‌سازد و می‌فرستد؛ n8n یا پاسخ تازه‌ی
// کش (۱۵ دقیقه) را برمی‌گرداند یا از Gemini یکی می‌گیرد و کش می‌کند.
//
// چرا ورکر زمینه را می‌سازد و n8n نه: تبدیل جلالی و ساعت تهران همین حالا
// اینجا هست. اگر n8n هم نسخه‌ی خودش را نگه می‌داشت، دو پیاده‌سازی داشتیم
// که با هم از هم دور می‌افتادند.
export async function askExplain(env, { cacheKey, question, context }) {
  if (!env.ECON_EXPLAIN_URL || !env.ECON_EXPORT_KEY) return null;

  // مهلت زمانی حیاتی است. n8n وقتی زیر فشار است نه خطا می‌دهد نه می‌بندد -
  // فقط جواب نمی‌دهد. بدون این مهلت، fetch تا ابد معلق می‌ماند، کلادفلر
  // درخواست را می‌کشد و تلگرام هیچ پاسخی نمی‌گیرد: کاربر «در حال تایپ»
  // می‌بیند و بعد هیچ. با مهلت، به مسیر خطا می‌افتیم و پیام روشن می‌رود.
  const res = await fetch(env.ECON_EXPLAIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      key: env.ECON_EXPORT_KEY,
      cache_key: cacheKey,
      question,
      context,
    }),
  });

  if (!res.ok) throw new Error("پاسخ ناموفق از n8n: " + res.status);

  const data = await res.json();
  if (!data || data.success !== true || !data.answer) {
    throw new Error("پاسخ نامعتبر از n8n: " + (data && data.error ? data.error : "نامشخص"));
  }
  return { answer: data.answer, created_at: data.created_at || null };
}

export const EXPLAIN_QUESTION = DEFAULT_QUESTION;
