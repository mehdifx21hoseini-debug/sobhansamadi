// کدام کانال حق دارد محتوا بفرستد.
//
// تاریخچه‌ی این فایل مهم است: اول این تنظیم یک متغیر محیطی بود که آدم
// باید آیدی عددی کانال را دستی در آن می‌گذاشت. آن راه سه بار پشت‌سرهم
// شکست خورد و هر بار به یک شکل - عدد از لینک t.me/c بدون پیشوند -100
// برداشته می‌شد، متغیر متنی با دیپلوی پاک می‌شد، و از بیرون همه‌ی این‌ها
// «هیچ اتفاقی نمی‌افتد» بودند.
//
// وقتی یک تنظیم سه بار اشتباه وارد می‌شود، مشکل از وارد کننده نیست.
// حالا ربات خودش یاد می‌گیرد: اولین کانالی که یک پست با هشتگ معتبر
// بفرستد ثبت می‌شود و مدیر همان لحظه خبردار می‌شود. هیچ عددی جایی تایپ
// نمی‌شود.

import { defineSchema } from "../schemaGate.js";

const KEY = "content_channel_id";

const CONFIG_DDL = `CREATE TABLE IF NOT EXISTS bot_config (
         key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`;

export const ensureConfig = defineSchema("bot_config", CONFIG_DDL, async (env) => {
  await env.DB.prepare(CONFIG_DDL).run();
});

export async function readContentChannel(env) {
  try {
    const row = await env.DB
      .prepare(`SELECT value FROM bot_config WHERE key = ?`)
      .bind(KEY)
      .first();
    return row ? row.value : null;
  } catch (err) {
    if (err && /no such table/i.test(String(err.message))) return null;
    throw err;
  }
}

export async function writeContentChannel(env, chatId) {
  await ensureConfig(env);
  await env.DB
    .prepare(
      `INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(KEY, String(chatId), new Date().toISOString())
    .run();
}

export async function clearContentChannel(env) {
  try {
    await env.DB.prepare(`DELETE FROM bot_config WHERE key = ?`).bind(KEY).run();
  } catch (err) {
    if (!/no such table/i.test(String(err && err.message))) throw err;
  }
}

// ─── تنظیم‌های عمومی ربات ──────────────────────────────────────────
//
// همان جدول، برای هر چیزی که «یک مقدار» است و باید بدون دیپلوی عوض
// شود. لینک آزمون سایت اولین نمونه‌اش است: آدرسی که آکادمی می‌سازد و
// روزی عوضش می‌کند، نباید در کد قفل باشد.

// کلیدهای روشن/خاموش که چند بار در یک اجرا خوانده می‌شوند.
//
// کرانِ پنج‌دقیقه‌ای econ_worker_sender را نُه بار در یک تیک می‌خواند -
// هر کارِ موازی یک بار. پلنِ رایگان ۵۰ کوئری در هر اجرا می‌دهد، پس این
// چند کلید یک دقیقه در حافظه‌ی همان ایزوله می‌مانند. فقط کلیدهایی که
// آدم دستی عوض می‌کند و یک دقیقه دیر دیده شدنشان بی‌ضرر است؛ هر کلیدی که
// منطقِ ارسال رویش «مقایسه و جای‌گزینی» می‌کند (برگه‌های دسته، نشانگرها)
// هرگز اینجا نمی‌آید.
const FLAG_KEYS = new Set([
  "econ_worker_sender",
  "econ_result_notice",
  "econ_audience_snapshot",
  "econ_batch_claim",
  "econ_worker_ingest",
  "econ_worker_explain",
  "econ_greet",
  "econ_greet_force",
  "econ_notice",
  "kb_seed_version",
  "quiz_url",
]);
const FLAG_TTL_MS = 60 * 1000;
const flagMem = new Map();

/** برای تست‌ها و برای وقتی که مقدار همین الان باید از دیتابیس بیاید. */
export function forgetConfigCache() {
  flagMem.clear();
}

export async function readConfig(env, key) {
  const memo = FLAG_KEYS.has(key) ? flagMem.get(key) : null;
  if (memo && memo.db === env.DB && Date.now() - memo.at < FLAG_TTL_MS) return memo.value;
  try {
    const row = await env.DB
      .prepare(`SELECT value FROM bot_config WHERE key = ?`)
      .bind(key)
      .first();
    const value = row ? row.value : "";
    if (FLAG_KEYS.has(key)) flagMem.set(key, { value, at: Date.now(), db: env.DB });
    return value;
  } catch (err) {
    if (err && /no such table/i.test(String(err.message))) return "";
    throw err;
  }
}

export async function writeConfig(env, key, value) {
  await ensureConfig(env);
  await env.DB
    .prepare(
      `INSERT INTO bot_config (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(value), new Date().toISOString())
    .run();
  if (FLAG_KEYS.has(key)) flagMem.set(key, { value: String(value), at: Date.now(), db: env.DB });
}

export const QUIZ_URL_KEY = "quiz_url";

// آدرس آزمون تعیین سطح آکادمی. این مقدار پیش‌فرض است نه قفل: هر چیزی
// که با /setquiz ثبت شود بر آن می‌چربد، و «off» یعنی مدیر عمداً دکمه
// را برداشته - که با «هنوز تنظیم نشده» یکی نیست.
export const DEFAULT_QUIZ_URL = "https://sobhansamadi.com/skill-test/";
export const QUIZ_OFF = "off";

export async function readQuizUrl(env) {
  const stored = await readConfig(env, QUIZ_URL_KEY).catch(() => "");
  if (stored === QUIZ_OFF) return "";
  return stored || DEFAULT_QUIZ_URL;
}
