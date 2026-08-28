// آینه‌ی پایگاه دانش در D1.
//
// چرا آینه و نه خواندن مستقیم: پایگاه دانش را آکادمی از داخل CRM ویرایش
// می‌کند و جدولش در n8n است. اگر ورکر موقع هر سوال کاربر از n8n می‌خواند،
// پشتیبانی هوشمند دقیقاً به همان چیزی وابسته می‌ماند که مدام قطع می‌شود -
// همان اشتباهی که یک‌بار در تقویم تکرار شد. به‌جای آن، همان زمان‌بندی که
// تقویم را همگام می‌کند این را هم می‌کشد و پاسخ به کاربر از D1 خوانده
// می‌شود.

import { buildIndex } from "./retrieval.js";

const DDL = [
  `CREATE TABLE IF NOT EXISTS ai_kb (
     id INTEGER PRIMARY KEY, category TEXT, question TEXT, answer TEXT,
     embedding TEXT, active INTEGER)`,
  // آمار استفاده عمداً جدول جداست: ai_kb در هر همگام‌سازی کامل جای‌گزین
  // می‌شود و اگر شمارنده داخلش بود، هر ده دقیقه صفر می‌شد.
  `CREATE TABLE IF NOT EXISTS ai_kb_usage (
     kb_id INTEGER PRIMARY KEY, usage_count INTEGER DEFAULT 0, last_used_at TEXT)`,
];

export async function ensureKbSchema(env) {
  await env.DB.batch(DDL.map((sql) => env.DB.prepare(sql)));
}

// پیش از اولین همگام‌سازی، جدول وجود ندارد. این خطا نیست - یعنی «هنوز
// پایگاه دانشی نداریم» - و باید همان‌طور خوانده شود تا پشتیبانی به مسیر
// انسانی برگردد، نه اینکه کاربر خطای داخلی بگیرد.
export async function readKb(env) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, category, question, answer, embedding
         FROM ai_kb WHERE active = 1`
    ).all();
    return results || [];
  } catch (err) {
    if (err && /no such table/i.test(String(err.message))) return [];
    throw err;
  }
}

export async function replaceKb(env, entries) {
  const rows = (entries || []).filter((r) => r && r.id != null);
  const statements = [env.DB.prepare(`DELETE FROM ai_kb`)];
  for (const r of rows) {
    statements.push(
      env.DB.prepare(
        `INSERT OR REPLACE INTO ai_kb (id, category, question, answer, embedding, active)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        Number(r.id),
        r.category || null,
        r.question || null,
        r.answer || null,
        // embedding در مبدأ یک رشته‌ی JSON است. اگر آرایه آمد هم پذیرفته
        // می‌شود تا شکل دقیق خروجی export این‌جا را نشکند.
        typeof r.embedding === "string"
          ? r.embedding
          : Array.isArray(r.embedding)
            ? JSON.stringify(r.embedding)
            : null,
        r.active === false || r.active === 0 ? 0 : 1
      )
    );
  }
  await env.DB.batch(statements);
  invalidateKbCache();
  return rows.length;
}

// کدام مدخل‌های پایگاه دانش واقعاً به کار آمدند. نسخه‌ی n8n این را روی
// خود ردیف می‌نوشت و صفحه‌ی «مدیریت هوش مصنوعی» در CRM از آن می‌خواند تا
// نشان دهد کدام جواب‌ها پرکاربردند و کدام‌ها هرگز استفاده نشده‌اند. اگر
// اینجا ثبت نشود، آن آمار برای همیشه از بین می‌رود؛ پس محلی نگه داشته
// می‌شود تا وقتی مسیر برگرداندنش به n8n ساخته شود.
//
// شکستش هرگز نباید جلوی پاسخ کاربر را بگیرد - این یک آمار است، نه پاسخ.
export async function recordKbUsage(env, kbIds) {
  // Number(null) برابر 0 است و از فیلترِ «عدد معتبر» رد می‌شود، پس شناسه
  // باید صریحاً مثبت هم باشد - وگرنه یک null به مدخل خیالیِ ۰ تبدیل می‌شد.
  const ids = [...new Set((kbIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return 0;
  const now = new Date().toISOString();
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare(
        `INSERT INTO ai_kb_usage (kb_id, usage_count, last_used_at) VALUES (?, 1, ?)
           ON CONFLICT(kb_id) DO UPDATE SET
             usage_count = usage_count + 1,
             last_used_at = excluded.last_used_at`
      ).bind(id, now)
    )
  );
  return ids.length;
}

// --- پایگاه دانشِ آماده‌ی جست‌وجو ---
//
// هر سوال کاربر تا امروز کل جدول را می‌خواند و هر ۲۵۰ بردار را دوباره
// JSON.parse می‌کرد. با ۷۶۸ بُعد، هر بردار حدود ۱۵ کیلوبایت متن است -
// یعنی چند مگابایت خواندن از D1 و چند مگابایت parse، برای هر پیام.
//
// پس یک‌بار خوانده می‌شود و در همان isolate می‌ماند: ردیف‌ها، بردارهای
// آماده، و نمایه‌ی کلیدواژه‌ای که ساختنش هم ارزان نیست.
//
// عمر کش کوتاه است چون مدیر بعد از /kbsync یا ویرایش یک بخش، انتظار
// دارد تغییر را ببیند - و isolateهای دیگر خبر ندارند که کش اینجا باطل
// شده، پس فقط گذر زمان است که همه را هم‌تراز می‌کند.
const CACHE_TTL_MS = 120_000;

let cache = null;

/** کش را دور می‌ریزد. بعد از هر تغییر در پایگاه دانش صدا زده می‌شود. */
export function invalidateKbCache() {
  cache = null;
}

function parseVectors(rows) {
  const vectors = new Map();
  for (const r of rows) {
    if (!r.embedding) continue;
    try {
      const vec = JSON.parse(r.embedding);
      if (Array.isArray(vec) && vec.length > 0) vectors.set(r.id, vec);
    } catch {
      // بردار خراب یعنی این مدخل فقط با کلیدواژه پیدا می‌شود، نه اینکه
      // کل پایگاه دانش از کار بیفتد.
    }
  }
  return vectors;
}

/**
 * @returns {Promise<{rows:Array, vectors:Map<number,number[]>, index:Object}>}
 */
export async function loadKb(env) {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.kb;

  const rows = await readKb(env);
  // ستون embedding بعد از تبدیل به بردار لازم نیست و فقط حافظه‌ی کش را
  // دو برابر می‌کند؛ ضمن اینکه بعداً به پرامپت هم می‌رود.
  const vectors = parseVectors(rows);
  const light = rows.map((r) => ({
    id: r.id,
    category: r.category,
    question: r.question,
    answer: r.answer,
  }));

  const kb = { rows: light, vectors, index: buildIndex(light) };
  cache = { at: now, kb };
  return kb;
}
