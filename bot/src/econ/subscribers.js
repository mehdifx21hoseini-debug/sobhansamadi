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

import { DEFAULT_CURRENCIES, parseCurrencies, serializeCurrencies } from "./currencies.js";
import { DEFAULT_LEVELS, parseLevels, serializeLevels, levelsFromLegacy } from "./levels.js";

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
  // و همان ایندکس، ولی با ستونِ دومی که صفحه‌بندی لازم دارد.
  //
  // بی‌آن، نقشه‌ی اجرای کوئریِ صفحه‌بندیِ هشدار این بود:
  //
  //   SEARCH s USING INDEX idx_econ_sub_active (subscribed=?)
  //   USE TEMP B-TREE FOR ORDER BY
  //
  // یعنی هر دور همه‌ی ۳٬۷۷۶ مشترک را برمی‌داشت، در حافظه مرتب می‌کرد،
  // و بعد ۱۲۰ تای اول را نگه می‌داشت - LIMIT هیچ صرفه‌ای نداشت. با
  // ستونِ دوم، ردیف‌ها از خودِ ایندکس مرتب بیرون می‌آیند، `> ?` یک
  // پرشِ محدوده است و LIMIT واقعاً زود می‌ایستد.
  `CREATE INDEX IF NOT EXISTS idx_econ_sub_page ON econ_subscriber(subscribed, telegram_user_id)`,
];

// ستون‌هایی که بعد از ساخته شدنِ جدول اضافه شده‌اند. SQLite راهی برای
// «اضافه کن اگر نیست» ندارد، پس خطای «ستون تکراری» بلعیده می‌شود - تنها
// خطایی که اینجا انتظارش را داریم.
const ADD_COLUMNS = [
  `ALTER TABLE econ_subscriber ADD COLUMN digest_off INTEGER NOT NULL DEFAULT 0`,
  // ارزهایی که کاربر می‌خواهد ببیند، با ویرگول. خالی یعنی پیش‌فرض
  // (فقط دلار) - همان چیزی که همه‌ی کاربرانِ فعلی امروز می‌بینند.
  `ALTER TABLE econ_subscriber ADD COLUMN currencies TEXT`,
  // سطح‌های اهمیتی که کاربر هشدارشان را می‌خواهد، با ویرگول.
  //
  // جای‌گزینِ show_low_importance است. آن ستون پاک نمی‌شود - SQLite
  // حذفِ ستون را ساده نمی‌گیرد و ارزشش را هم ندارد - ولی دیگر مرجع
  // نیست؛ همگام نگه داشته می‌شود تا هر خواننده‌ی قدیمی‌ای که از قلم
  // افتاده باشد، دست‌کم دروغ نگوید.
  `ALTER TABLE econ_subscriber ADD COLUMN alert_levels TEXT`,
];

// «این کاربر ربات را بلاک یا حذف کرده».
//
// تلگرام هیچ خبری از رفتنِ کاربر نمی‌دهد؛ تنها نشانه‌اش کدِ ۴۰۳ در
// پاسخِ ارسال است. تا امروز آن کد فقط شمرده می‌شد و دور ریخته - یعنی هر
// روز صبح به هزاران نفری پیام می‌فرستادیم که ماه‌ها پیش رفته بودند، و
// آمارِ «اعضا» هم آن‌ها را زنده حساب می‌کرد.
//
// ستون روی user_state است نه econ_subscriber: بلاک کردن ربطی به اشتراکِ
// تقویم ندارد و هر کسی که ردیفی در user_state دارد می‌تواند بلاک کند.
const USER_STATE_COLUMNS = [
  `ALTER TABLE user_state ADD COLUMN blocked_at TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_user_state_blocked ON user_state(blocked_at)`,
  // ─── ایندکسی که ۸۷٪ مصرفِ D1 را توضیح می‌داد ───────────────────
  //
  // اندازه‌گیریِ ۸ اکتبر: شش شکلِ کوئریِ مخاطب ۸۷ میلیون ردیف در هفت
  // روز خواندند - ۱۶٬۹۸۰ ردیف در هر فراخوانی، برای پیدا کردنِ ۴۵ نفر،
  // از جدولی که ۱۷٬۶۴۷ ردیف دارد. یعنی کلِ جدول، هر بار.
  //
  // کامنتِ پایین‌تر می‌گفت «> ? مستقیم از ایندکسِ کلیدِ اصلی استفاده
  // می‌کند». EXPLAIN QUERY PLAN گفت نه:
  //
  //   SEARCH u USING INDEX idx_user_state_blocked (blocked_at=?)
  //   ...
  //   USE TEMP B-TREE FOR ORDER BY
  //
  // SQLite ایندکسِ blocked_at را انتخاب می‌کرد، نه کلیدِ اصلی. و آن
  // انتخاب فاجعه بود، چون `blocked_at IS NULL` تقریباً همه‌ی ردیف‌ها
  // را می‌گیرد - پس آن «SEARCH» در عمل اسکنِ کامل است. بدتر: وقتی
  // کلیدِ اصلی کنار گذاشته می‌شود، نشانگر از یک پرشِ محدوده تبدیل
  // می‌شود به یک فیلترِ بعد از خواندن، و `ORDER BY` هم ناچار کلِ
  // نتیجه را در حافظه مرتب می‌کند. یعنی LIMIT 45 هیچ کاری نمی‌کرد.
  //
  // این ایندکسِ دوستونه دقیقاً همان دسترسی است که کوئری می‌خواهد:
  // گروهِ `blocked_at IS NULL`، و داخلش ردیف‌ها از قبل بر اساسِ
  // telegram_user_id مرتب. هم نشانگر پرش می‌کند، هم ترتیب رایگان
  // می‌آید، هم LIMIT زود می‌ایستد.
  `CREATE INDEX IF NOT EXISTS idx_user_state_audience ON user_state(blocked_at, telegram_user_id)`,
];

/**
 * ثبتِ رفتنِ یک کاربر.
 *
 * تاریخ نگه داشته می‌شود نه یک بله/خیر: می‌خواهیم بدانیم کِی رفت، تا
 * بشود دید کدام پیام باعثش شده.
 */
export async function markBlocked(env, telegramUserId) {
  try {
    await env.DB
      .prepare(`UPDATE user_state SET blocked_at = ? WHERE telegram_user_id = ? AND blocked_at IS NULL`)
      .bind(new Date().toISOString(), String(telegramUserId))
      .run();
  } catch (err) {
    // ثبت نشدنش نباید ارسال را متوقف کند.
    console.error("ثبتِ بلاک شکست خورد:", err && err.message);
  }
}

/**
 * برگشتنِ کاربر.
 *
 * هر تعاملی یعنی ربات را دوباره باز کرده. بدونِ این، کسی که برگشته برای
 * همیشه «رفته» می‌ماند و دیگر هیچ پیامی نمی‌گیرد.
 */
export async function clearBlocked(env, telegramUserId) {
  try {
    await env.DB
      .prepare(`UPDATE user_state SET blocked_at = NULL WHERE telegram_user_id = ? AND blocked_at IS NOT NULL`)
      .bind(String(telegramUserId))
      .run();
  } catch {
    // بی‌اهمیت: اجرای بعدی دوباره تلاش می‌کند.
  }
}

export async function ensureSubscriberSchema(env) {
  for (const sql of DDL) await env.DB.prepare(sql).run();
  for (const sql of [...ADD_COLUMNS, ...USER_STATE_COLUMNS]) {
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
    // ستونِ خالی یعنی این ردیف پیش از وجودِ این تنظیم ساخته شده.
    alert_levels: row.alert_levels ? parseLevels(row.alert_levels) : levelsFromLegacy(),
    // خلاصه‌ی روزانه برعکسِ هشدار است: پیش‌فرض روشن، و این ستون فقط
    // وقتی پر می‌شود که کاربر خودش گفته باشد «نفرست».
    digest_off: !!row.digest_off,
    currencies: parseCurrencies(row.currencies),
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
  return {
    subscribed: false,
    alert_minutes: 15,
    show_low_importance: false,
    alert_levels: [...DEFAULT_LEVELS],
    digest_off: false,
    currencies: [...DEFAULT_CURRENCIES],
  };
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

  const alertLevels =
    patch.alert_levels !== undefined
      ? parseLevels(serializeLevels(patch.alert_levels))
      : parseLevels(serializeLevels(current.alert_levels));

  const next = {
    subscribed: patch.subscribed !== undefined ? !!patch.subscribed : current.subscribed,
    alert_levels: alertLevels,
    alert_minutes:
      patch.alert_minutes !== undefined
        ? normalizeMinutes(patch.alert_minutes)
        : current.alert_minutes,
    // دیگر ورودی نیست، خروجی است: هر خواننده‌ی قدیمی‌ای که هنوز این را
    // می‌خواند، همان چیزی را ببیند که واقعاً اتفاق می‌افتد.
    show_low_importance: alertLevels.includes("low"),
    digest_off:
      patch.digest_off !== undefined ? !!patch.digest_off : !!current.digest_off,
    currencies:
      patch.currencies !== undefined
        ? parseCurrencies(serializeCurrencies(patch.currencies))
        : parseCurrencies(current.currencies),
  };

  await env.DB
    .prepare(
      `INSERT INTO econ_subscriber
         (telegram_user_id, chat_id, subscribed, alert_minutes, show_low_importance, digest_off, currencies, alert_levels, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(telegram_user_id) DO UPDATE SET
         chat_id = excluded.chat_id,
         subscribed = excluded.subscribed,
         alert_minutes = excluded.alert_minutes,
         show_low_importance = excluded.show_low_importance,
         digest_off = excluded.digest_off,
         currencies = excluded.currencies,
         alert_levels = excluded.alert_levels,
         updated_at = excluded.updated_at`
    )
    .bind(
      id,
      String(patch.chat_id || id),
      next.subscribed ? 1 : 0,
      next.alert_minutes,
      next.show_low_importance ? 1 : 0,
      next.digest_off ? 1 : 0,
      serializeCurrencies(next.currencies),
      serializeLevels(next.alert_levels),
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
 * یک صفحه از مشترکین، با نشانگر و تکه‌بندی.
 *
 * ─── باگی که این را لازم کرد ──────────────────────────────────────
 *
 * هشدارِ پیش از خبر، برخلافِ خلاصه و اطلاعیه، هیچ درِینِ موازی نداشت -
 * فقط کرانِ هر پنج دقیقه‌ی خودِ ورکر، و آن حداکثر ۴۵ پیام در هر تیک
 * می‌فرستد (سقفِ subrequest در هر فراخوانی). پنجره‌ی هشدار هم ۵ تا ۶۰
 * دقیقه است، یعنی یک تا دوازده تیک.
 *
 * اندازه‌گیریِ ۸ اکتبر این را دقیقاً نشان داد: ۳٬۳۸۴ مشترکِ فعال، و
 * هر خبرِ مهم به **۵۴۰** نفر رسیده بود - یعنی ۱۲ تیک × ۴۵، نه یک نفر
 * بیشتر. سخنرانی ترامپ، صورت‌جلسه‌ی فدرال‌رزرو، سخنرانی والر: هر سه
 * ۵۴۰. ۸۴٪ مشترکین هیچ‌وقت هشدار نگرفتند.
 *
 * و چون فهرست همیشه از اول خوانده می‌شد، همیشه همان نفراتِ ابتدای
 * جدول. بدتر: کسی که ۶۰ دقیقه انتخاب کرده پنجره‌اش زودتر باز می‌شود و
 * بودجه را می‌برد، پس ۴۱۵ نفری که ۵ دقیقه انتخاب کرده‌اند عملاً هرگز
 * چیزی نگرفتند - و همین گزارش شد.
 *
 * ─── چرا این شکل ─────────────────────────────────────────────────
 *
 * `telegram_user_id > ?` روی کلیدِ اصلی می‌نشیند، پس هر دور فقط از
 * نشانگر به جلو می‌خواند نه از اولِ جدول. همان درسِ listPendingAudience:
 * مقایسه عمداً متنی است، چون CAST به عدد ایندکس را کنار می‌گذارد.
 *
 * تکه‌بندی اما ناچار CAST دارد. اینجا بی‌خطر است و آنجا نبود: این جدول
 * سه هزار ردیف دارد نه شانزده هزار، و شرطِ CAST روی ردیف‌هایی اعمال
 * می‌شود که ایندکس از قبل محدودشان کرده - یعنی اسکن نمی‌شود، فقط همان
 * صفحه فیلتر می‌شود.
 *
 * نکته‌ی مهمِ صداکننده: نشانگر باید تا **آخرین ردیفِ دیده‌شده** جلو
 * برود، نه آخرین ردیفی که پیام گرفت. در هر لحظه فقط بخشی از مشترکین
 * «موعدشان رسیده» (آن‌هایی که فاصله‌ی انتخابی‌شان با این خبر جور است)؛
 * اگر نشانگر فقط روی فرستاده‌ها جلو برود، هر دور همان ردیف‌های
 * بی‌موعد را دوباره می‌خواند و هیچ‌وقت به آخرِ فهرست نمی‌رسد.
 */
export async function listActiveSubscribersPage(env, limit, shard, after) {
  await ensureSubscriberSchema(env);

  const shards = shard && shard.of > 1 ? Math.floor(shard.of) : 0;
  const mine = shards ? Math.floor(shard.index) % shards : 0;
  const shardClause = shards
    ? `AND CAST(s.telegram_user_id AS INTEGER) % ${shards} = ${mine} `
    : ``;
  const cursorClause = after ? `AND s.telegram_user_id > ? ` : ``;

  const binds = [];
  if (after) binds.push(String(after));
  binds.push(Number(limit) || 1);

  const { results } = await env.DB
    .prepare(
      `SELECT s.* FROM econ_subscriber s
        WHERE s.subscribed = 1 ` +
        shardClause +
        cursorClause +
        `ORDER BY s.telegram_user_id LIMIT ?`
    )
    .bind(...binds)
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
 * دو چیز از فهرست کنار گذاشته می‌شود:
 *   • هر کسی که خودش گفته «نفرست» (digest_off).
 *   • کسانی که خلاصه‌ی همین روز برایشان رفته.
 *
 * ادمین‌ها عمداً داخل‌اند. اول بیرون گذاشته شده بودند - قاعده‌ای که از
 * پیامِ همگانی قرض گرفته شده بود و آنجا درست است، چون آن پیام را در
 * گروهِ کاری هم می‌بینند. ولی خلاصه‌ی صبح خبر است نه اعلانِ داخلی، و
 * نتیجه‌اش این شد که صاحبِ ربات صبحِ شنبه هیچ پیامی ندید در حالی که
 * هشت هزار نفر دیده بودند. کسی که ربات را می‌گرداند باید همان چیزی را
 * ببیند که کاربرش می‌بیند.
 *
 * تازه‌واردها خودبه‌خود داخل‌اند: به‌محضِ اولین تعامل، ردیفشان در
 * user_state ساخته می‌شود و از فردا صبح پیام می‌گیرند.
 */
export async function listPendingAudience(env, kind, ref, limit, shard, after) {
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

  // نشانگر: «تا اینجا رفته‌ام».
  //
  // چرا هست: بدونِ آن هر دور می‌پرسید «کدام یک از هشت هزار نفر هنوز
  // پیام نگرفته؟» و هرچه جلوتر می‌رفتیم، باید ردیف‌های بیشتری را رد
  // می‌کرد تا ۴۵ نفرِ نگرفته پیدا کند - دورهای آخر تقریباً کلِ جدول.
  // یک روز همین کار سقفِ ردیف‌خوانیِ D1 را تا ۹۲ درصد بالا برد.
  //
  // مقایسه عمداً متنی است نه عددی: ستون متنی است و «> ?» روی آن یک
  // پرشِ محدوده است. با CAST به عدد، هیچ ایندکسی به کار نمی‌آمد.
  //
  // ولی متنی بودن به‌تنهایی کافی نبود - و این را یک بار گران یاد
  // گرفتیم. تا ۸ اکتبر این کامنت می‌گفت «از ایندکسِ کلیدِ اصلی استفاده
  // می‌کند»، و EXPLAIN QUERY PLAN نشان داد نمی‌کند: SQLite ایندکسِ
  // blocked_at را برمی‌داشت و نشانگر به فیلترِ بعد از خواندن تبدیل
  // می‌شد. نتیجه ۱۶٬۹۸۰ ردیف در هر فراخوانی بود، یعنی کلِ جدول.
  //
  // چیزی که درستش کرد idx_user_state_audience است (بالای همین فایل).
  // اگر روزی آن ایندکس برداشته شود، این کوئری بی‌صدا به همان رفتار
  // برمی‌گردد - از بیرون فقط صورت‌حسابِ D1 عوض می‌شود.
  //
  // ترتیبِ حروفی با ترتیبِ عددیِ آیدی‌ها یکی نیست و اهمیتی هم ندارد: تنها
  // چیزی که لازم داریم یک ترتیبِ ثابت است تا هر نفر دقیقاً یک بار دیده
  // شود.
  const cursorClause = after ? `u.telegram_user_id > ? AND ` : ``;

  const binds = [];
  if (after) binds.push(String(after));
  binds.push(String(kind), String(ref), Number(limit) || 1);

  const { results } = await env.DB
    .prepare(
      `SELECT u.telegram_user_id AS telegram_user_id,
              u.telegram_user_id AS chat_id
         FROM user_state u
        WHERE ` +
        cursorClause +
        shardClause +
        `u.blocked_at IS NULL
          AND NOT EXISTS (
                SELECT 1 FROM econ_subscriber s
                 WHERE s.telegram_user_id = u.telegram_user_id
                   AND s.digest_off = 1)
          AND NOT EXISTS (
                SELECT 1 FROM econ_sent_log l
                 WHERE l.kind = ? AND l.ref = ?
                   AND l.telegram_user_id = u.telegram_user_id)
        ORDER BY u.telegram_user_id
        LIMIT ?`
    )
    .bind(...binds)
    .all();

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
  const blocked = await one(`SELECT COUNT(*) AS n FROM user_state WHERE blocked_at IS NOT NULL`);
  const optedOut = await one(
    `SELECT COUNT(*) AS n FROM econ_subscriber WHERE digest_off = 1`
  );
  const sent = await one(
    `SELECT COUNT(*) AS n FROM econ_sent_log WHERE kind = ? AND ref = ?`,
    [String(kind), String(ref)]
  );
  return { total, blocked, opted_out: optedOut, sent_today: sent };
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
