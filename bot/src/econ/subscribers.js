// مشترکین هشدار تقویم اقتصادی - در D1، نه در n8n.
//
// تا امروز این فهرست فقط در جدول‌های n8n بود و سه چیز به آن وابسته:
// مینی‌اپ (برای نشان دادن کارت هشدار)، زمان‌بند خلاصه‌ی روزانه، و
// زمان‌بند هشدار قبل از خبر. یعنی هر بار n8n می‌خوابید، کارت هشدار از
// مینی‌اپ ناپدید می‌شد و پیام صبح نمی‌رفت - بدون اینکه کسی خبردار شود.
//
// حالا منبع اصلی همین جدول است. نوشتن از دو راه انجام می‌شود (دکمه‌های
// ربات و مینی‌اپ) و هر دو به اینجا می‌رسند، پس دو نسخه‌ی واگرا از یک
// تنظیم وجود ندارد.

const DDL = [
  `CREATE TABLE IF NOT EXISTS econ_subscriber (
     telegram_user_id TEXT PRIMARY KEY,
     chat_id TEXT NOT NULL,
     subscribed INTEGER NOT NULL DEFAULT 0,
     alert_minutes INTEGER NOT NULL DEFAULT 15,
     show_low_importance INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_econ_sub_active ON econ_subscriber(subscribed)`,
];

// ستون‌هایی که بعد از ساخته شدنِ جدول اضافه شده‌اند. SQLite راهی برای
// «اضافه کن اگر نیست» ندارد، پس خطای «ستون تکراری» بلعیده می‌شود - تنها
// خطایی که اینجا انتظارش را داریم.
const ADD_COLUMNS = [
  `ALTER TABLE econ_subscriber ADD COLUMN digest_off INTEGER NOT NULL DEFAULT 0`,
];

export async function ensureSubscriberSchema(env) {
  for (const sql of DDL) await env.DB.prepare(sql).run();
  for (const sql of ADD_COLUMNS) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // قبلاً اضافه شده.
    }
  }
}

// تنها مقادیری که کاربر می‌تواند انتخاب کند. هر چیز دیگری - چه از
// مینی‌اپ بیاید چه از یک درخواست دستی - به نزدیک‌ترین مقدار مجاز
// برمی‌گردد، وگرنه یک عدد دلخواه یعنی هشداری که هرگز نمی‌رسد: منطق
// ارسال دنبال تساوی دقیقه‌هاست، نه بازه.
export const ALLOWED_MINUTES = [5, 15, 30, 60];

export function normalizeMinutes(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 15;
  return ALLOWED_MINUTES.reduce((best, m) =>
    Math.abs(m - n) < Math.abs(best - n) ? m : best
  );
}

function toRow(row) {
  if (!row) return null;
  return {
    telegram_user_id: String(row.telegram_user_id),
    chat_id: String(row.chat_id),
    subscribed: !!row.subscribed,
    alert_minutes: Number(row.alert_minutes) || 15,
    show_low_importance: !!row.show_low_importance,
    // خلاصه‌ی روزانه برعکسِ هشدار است: پیش‌فرض روشن، و این ستون فقط
    // وقتی پر می‌شود که کاربر خودش گفته باشد «نفرست».
    digest_off: !!row.digest_off,
    updated_at: row.updated_at,
  };
}

/**
 * تنظیم فعلی یک کاربر.
 * @returns {Promise<object|null>} null یعنی هرگز چیزی ثبت نکرده - که با
 *   «خاموش کرده» یکی نیست و صداکننده باید خودش پیش‌فرض را نشان دهد.
 */
export async function readSubscription(env, telegramUserId) {
  try {
    await ensureSubscriberSchema(env);
    const row = await env.DB
      .prepare(`SELECT * FROM econ_subscriber WHERE telegram_user_id = ?`)
      .bind(String(telegramUserId))
      .first();
    return toRow(row);
  } catch (err) {
    console.error("خواندن اشتراک تقویم شکست خورد:", err && err.message);
    return null;
  }
}

/** پیش‌فرضی که به کاربرِ تازه نشان داده می‌شود. */
export function defaultSubscription() {
  return { subscribed: false, alert_minutes: 15, show_low_importance: false, digest_off: false };
}

/**
 * ثبت یا به‌روزرسانی.
 *
 * chat_id جدا از telegram_user_id نگه داشته می‌شود چون فرستنده به آن
 * پیام می‌دهد؛ در چت خصوصی هر دو یکی‌اند، ولی جدا نگه داشتنشان یعنی
 * اگر روزی گروهی هم اضافه شد، ساختار نمی‌شکند.
 */
export async function saveSubscription(env, telegramUserId, patch = {}) {
  await ensureSubscriberSchema(env);
  const id = String(telegramUserId);
  const now = new Date().toISOString();
  const current = (await readSubscription(env, id)) || defaultSubscription();

  const next = {
    subscribed: patch.subscribed !== undefined ? !!patch.subscribed : current.subscribed,
    alert_minutes:
      patch.alert_minutes !== undefined
        ? normalizeMinutes(patch.alert_minutes)
        : current.alert_minutes,
    show_low_importance:
      patch.show_low_importance !== undefined
        ? !!patch.show_low_importance
        : current.show_low_importance,
    digest_off:
      patch.digest_off !== undefined ? !!patch.digest_off : !!current.digest_off,
  };

  await env.DB
    .prepare(
      `INSERT INTO econ_subscriber
         (telegram_user_id, chat_id, subscribed, alert_minutes, show_low_importance, digest_off, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         subscribed = excluded.subscribed,
         alert_minutes = excluded.alert_minutes,
         show_low_importance = excluded.show_low_importance,
         digest_off = excluded.digest_off,
         updated_at = excluded.updated_at`
    )
    .bind(
      id,
      String(patch.chat_id || id),
      next.subscribed ? 1 : 0,
      next.alert_minutes,
      next.show_low_importance ? 1 : 0,
      next.digest_off ? 1 : 0,
      now,
      now
    )
    .run();

  return { ...next, telegram_user_id: id };
}

/** کسانی که باید پیام بگیرند. */
export async function listActiveSubscribers(env) {
  await ensureSubscriberSchema(env);
  const { results } = await env.DB
    .prepare(`SELECT * FROM econ_subscriber WHERE subscribed = 1`)
    .all();
  return (results || []).map(toRow);
}

/**
 * مشترکینی که این پیام هنوز برایشان نرفته - حداکثر به تعدادِ خواسته‌شده.
 *
 * چرا این و نه «همه را بخوان و بعد فیلتر کن»: فهرستِ کامل دو هزار ردیف
 * است و هر اجرا فقط چند ده نفر را می‌فرستد. با LIMIT، اجرای اول بعد از
 * پیدا کردنِ همان چند ده نفر می‌ایستد و بقیه‌ی جدول اصلاً خوانده
 * نمی‌شود.
 *
 * دفترِ ارسال کلیدِ مرکبِ (kind, ref, telegram_user_id) دارد، پس شرطِ
 * NOT EXISTS یک جست‌وجوی نقطه‌ای روی ایندکس است نه اسکن.
 */
export async function listPendingSubscribers(env, kind, ref, limit) {
  await ensureSubscriberSchema(env);
  const { results } = await env.DB
    .prepare(
      `SELECT s.* FROM econ_subscriber s
        WHERE s.subscribed = 1
          AND NOT EXISTS (
                SELECT 1 FROM econ_sent_log l
                 WHERE l.kind = ? AND l.ref = ?
                   AND l.telegram_user_id = s.telegram_user_id)
        LIMIT ?`
    )
    .bind(String(kind), String(ref), Number(limit) || 1)
    .all();
  return (results || []).map(toRow);
}

/**
 * مخاطبِ خلاصه‌ی روزانه: هر کسی که با ربات کار کرده - نه فقط کسانی که
 * اشتراک را روشن کرده‌اند.
 *
 * چرا این تغییر: خلاصه‌ی صبح تنها چیزی است که هر روز ربات را زنده نگه
 * می‌دارد، و تا امروز فقط به آن‌هایی می‌رسید که خودشان دکمه‌ی هشدار را
 * زده بودند - یعنی حدود یک‌چهارمِ اعضا. بقیه هفته‌ها هیچ پیامی از ربات
 * نمی‌دیدند.
 *
 * سه چیز از فهرست کنار گذاشته می‌شود:
 *   • ادمین‌ها - پیام را در گروه کاری می‌بینند.
 *   • هر کسی که خودش گفته «نفرست» (digest_off).
 *   • کسانی که خلاصه‌ی همین روز برایشان رفته.
 *
 * تازه‌واردها خودبه‌خود داخل‌اند: به‌محضِ اولین تعامل، ردیفشان در
 * user_state ساخته می‌شود و از فردا صبح پیام می‌گیرند.
 */
export async function listPendingAudience(env, kind, ref, limit, shard) {
  await ensureSubscriberSchema(env);

  // تکه‌بندی برای اجراهای موازی.
  //
  // بدونِ این، شش درخواستِ هم‌زمان هر شش‌تا همان ۴۵ نفرِ اولِ صف را
  // برمی‌دارند: یکی می‌فرستد و پنج‌تا فقط «قبلاً فرستاده شده» می‌بینند و
  // دستِ خالی برمی‌گردند. در اجرای واقعی همین باعث شد هر دور به‌جای ۴۵
  // پیام، ده تا بفرستد.
  //
  // با باقی‌ماندهٔ تقسیمِ آیدی، هر کارگر بخشِ خودش را دارد و هیچ دو
  // کارگری به یک نفر نمی‌رسند. آیدیِ تلگرام عدد است و پخشش یکنواخت.
  const shards = shard && shard.of > 1 ? Math.floor(shard.of) : 0;
  const mine = shards ? Math.floor(shard.index) % shards : 0;
  const shardClause = shards
    ? `CAST(u.telegram_user_id AS INTEGER) % ${shards} = ${mine} AND `
    : ``;

  const sql = (excludeAdmins) =>
    `SELECT u.telegram_user_id AS telegram_user_id,
            u.telegram_user_id AS chat_id
       FROM user_state u
      WHERE ` +
    shardClause +
    (excludeAdmins
      ? `u.telegram_user_id NOT IN (SELECT telegram_id FROM crm_admin_users)
          AND `
      : ``) +
    `NOT EXISTS (
              SELECT 1 FROM econ_subscriber s
               WHERE s.telegram_user_id = u.telegram_user_id
                 AND s.digest_off = 1)
        AND NOT EXISTS (
              SELECT 1 FROM econ_sent_log l
               WHERE l.kind = ? AND l.ref = ?
                 AND l.telegram_user_id = u.telegram_user_id)
      LIMIT ?`;

  const run = (excludeAdmins) =>
    env.DB.prepare(sql(excludeAdmins))
      .bind(String(kind), String(ref), Number(limit) || 1)
      .all();

  let results;
  try {
    ({ results } = await run(true));
  } catch {
    // جدولِ ادمین‌ها مالِ CRM است و ممکن است هنوز ساخته نشده باشد.
    // رسیدنِ خلاصه به چند ادمین، بهتر از نرسیدنش به هشت هزار نفر است.
    ({ results } = await run(false));
  }

  return (results || []).map((r) => ({
    telegram_user_id: String(r.telegram_user_id),
    chat_id: String(r.chat_id),
  }));
}

/** چند نفر مخاطبِ خلاصه‌اند و امروز برای چند نفرشان رفته. */
export async function digestAudienceStats(env, kind, ref) {
  await ensureSubscriberSchema(env);
  const one = async (sql, binds = []) => {
    const row = await env.DB.prepare(sql).bind(...binds).first();
    return (row && row.n) || 0;
  };
  const total = await one(`SELECT COUNT(*) AS n FROM user_state`);
  const optedOut = await one(
    `SELECT COUNT(*) AS n FROM econ_subscriber WHERE digest_off = 1`
  );
  const sent = await one(
    `SELECT COUNT(*) AS n FROM econ_sent_log WHERE kind = ? AND ref = ?`,
    [String(kind), String(ref)]
  );
  return { total, opted_out: optedOut, sent_today: sent };
}

export async function subscriberStats(env) {
  try {
    await ensureSubscriberSchema(env);
    const row = await env.DB
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN subscribed = 1 THEN 1 ELSE 0 END) AS active
           FROM econ_subscriber`
      )
      .first();
    return { total: (row && row.total) || 0, active: (row && row.active) || 0 };
  } catch {
    return { total: 0, active: 0 };
  }
}

/**
 * ورود یک‌باره‌ی مشترکین موجود از n8n.
 *
 * فقط ردیف‌هایی را می‌نویسد که اینجا نیستند. دلیلش مهم است: اگر کاربری
 * بین import و قطع شدن n8n تنظیمش را از ربات عوض کرده باشد، نسخه‌ی
 * تازه‌تر همین‌جاست و نباید با داده‌ی کهنه‌ی n8n بازنویسی شود.
 */
export async function importSubscribers(env, rows) {
  if (!Array.isArray(rows)) return { imported: 0, skipped: 0 };
  await ensureSubscriberSchema(env);
  const now = new Date().toISOString();
  let imported = 0;
  let skipped = 0;

  for (const r of rows) {
    const id = String((r && (r.telegram_user_id || r.chat_id)) || "").trim();
    if (!id) {
      skipped++;
      continue;
    }
    const res = await env.DB
      .prepare(
        `INSERT OR IGNORE INTO econ_subscriber
           (telegram_user_id, chat_id, subscribed, alert_minutes, show_low_importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        String(r.chat_id || id),
        // n8n این ستون را رشته‌ی "true"/"false" نگه می‌دارد، نه بولین.
        r.subscribed === true || r.subscribed === "true" || r.subscribed === 1 ? 1 : 0,
        normalizeMinutes(r.alert_minutes),
        r.show_low_importance === true || r.show_low_importance === "true" || r.show_low_importance === 1 ? 1 : 0,
        now,
        now
      )
      .run();
    const changed = res && res.meta ? res.meta.changes || 0 : 0;
    if (changed > 0) imported++;
    else skipped++;
  }

  return { imported, skipped };
}
