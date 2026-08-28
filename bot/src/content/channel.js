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

const KEY = "content_channel_id";

async function ensureConfig(env) {
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS bot_config (
         key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)`
    )
    .run();
}

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

export async function readConfig(env, key) {
  try {
    const row = await env.DB
      .prepare(`SELECT value FROM bot_config WHERE key = ?`)
      .bind(key)
      .first();
    return row ? row.value : "";
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
}

export const QUIZ_URL_KEY = "quiz_url";
