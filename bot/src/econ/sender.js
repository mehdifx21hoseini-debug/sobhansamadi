// فرستنده‌ی تقویم اقتصادی - همان سه پیامی که تا امروز n8n می‌فرستاد،
// حالا از داخل ورکر.
//
// چرا جابه‌جا شد: زمان‌بندهای n8n روی سروری بودند که مدام می‌خوابید، و
// خوابیدنش هیچ نشانه‌ای بیرون نمی‌داد جز اینکه پیام صبح نمی‌رسید. علاوه
// بر آن، ورک‌فلو هیچ منطقه‌ی زمانی تنظیم‌شده‌ای نداشت، پس «۸ صبح» عملاً
// معلوم نبود ۸ صبحِ کجاست. کرانِ کلادفلر همیشه UTC است و همین ابهام را
// برای همیشه می‌بندد: `0 4 * * *` دقیقاً ۷:۳۰ تهران است.
//
// سه پیام:
//   ۱) خلاصه‌ی روزانه   - هر روز ۷:۳۰ صبح تهران
//   ۲) هشدار قبل از خبر - در فاصله‌ای که خود کاربر انتخاب کرده
//   ۳) اعلام نتیجه      - وقتی عدد واقعی منتشر شد
//
// شنبه و یکشنبه بازار بسته است: هشدار و نتیجه نمی‌رود و خلاصه جایش را
// به یک متن ثابت می‌دهد. سکوت کامل نه - دو روز خاموشیِ پشت‌سرهم عادتِ
// باز کردن ربات را می‌شکند.

import { readEvents, readEventsRange, readLabels, readHolidays, dayOffset } from "./store.js";
import { holidayLabel, holidayNameFa } from "./holidayNames.js";
import { filterByCurrencies, DEFAULT_CURRENCIES, currencyFlag } from "./currencies.js";
import { parseLevels, serializeLevels } from "./levels.js";
import { buildTodayMarkdown, buildAlertMarkdown } from "./views.js";
import {
  listActiveSubscribers,
  listActiveSubscribersPage,
  dayColumn,
  claimDay,
  unclaimDay,
  listPendingSubscribers,
  listPendingAudience,
  listPendingAudienceIds,
  digestAudienceStats,
  markBlocked,
} from "./subscribers.js";
import { makeLabelHelpers } from "./labels.js";
import { MONDAY_GREETINGS } from "../content/mondayGreetings.js";
import { noticeTextFor, noticeButtonFor, noticeForwardFor, noticeRoundFor, NOTICE_DATES } from "../content/notices.js";
import { eventToken } from "./explain.js";
import { readConfig, writeConfig, ensureConfig } from "../content/channel.js";
import {
  RLM,
  IMPORTANCE_EMOJI,
  etTimeToTehran,
  etMinutesUntilNow,
  toPersianDigits,
  formatJalaliDate,
} from "./format.js";

// ─── کلید روشن/خاموش ────────────────────────────────────────────────
//
// تا وقتی n8n هم می‌فرستد، این باید خاموش بماند وگرنه کاربر هر پیام را
// دو بار می‌گیرد. لحظه‌ی انتقال یعنی: شاخه‌های ارسالِ n8n خاموش، بعد این
// روشن. چون کلید در پایگاه داده است نه در کد، این جابه‌جایی به دیپلوی
// نیاز ندارد و اگر چیزی خراب شد، برگرداندنش هم همین‌قدر سریع است.
export const SENDER_FLAG = "econ_worker_sender";

export async function senderEnabled(env) {
  const v = await readConfig(env, SENDER_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

// ─── کلیدِ اعلامِ عدد ────────────────────────────────────────────────
//
// به خواستِ آکادمی خاموش است: کاربر هشدارِ پیش از خبر را می‌گیرد و عدد
// را خودش در مینی‌اپ می‌بیند. پیش از این، سه شاخصی که ساعت ۱۶:۰۰ با هم
// منتشر می‌شوند سه پیامِ جدا پشتِ سرِ هم می‌فرستادند.
//
// کلید است و نه حذفِ کد، چون این پیام دو سال رفته و اگر نبودنش دیده شد،
// روشن کردنش نباید به دیپلوی نیاز داشته باشد. پیش‌فرضْ خاموش: هر مقداری
// جز "on" یعنی نه.
export const RESULT_FLAG = "econ_result_notice";

export async function resultNoticeEnabled(env) {
  const v = await readConfig(env, RESULT_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

// ─── روز هفته به وقت تهران ──────────────────────────────────────────
//
// این را نمی‌شود از getUTCDay گرفت: شنبه‌ی ایران از جمعه ساعت ۲۰:۳۰ به
// وقت UTC شروع می‌شود، پس محاسبه‌ی UTC چند ساعتِ اول شنبه را هنوز جمعه
// می‌دید و هشدار می‌فرستاد.
export function tehranWeekday(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    weekday: "short",
  }).format(date);
}

export function isWeekend(date = new Date()) {
  const d = tehranWeekday(date);
  return d === "Sat" || d === "Sun";
}

// متن‌های آخر هفته را خود آکادمی نهایی کرده است؛ بدون هماهنگی با او
// عوض نشوند.
//
// هر خط عمداً با فارسی یا ایموجی شروع می‌شود: تلگرام تنظیم جهت ندارد و
// جهتِ هر خط را از اولین حرف قویِ همان خط می‌گیرد، پس خطی که با کلمه‌ی
// انگلیسی شروع شود چپ‌چین می‌افتد.
export const WEEKEND_TEXT = {
  Sat:
    "🌙 شنبه — استراحت\n\n" +
    "بازارها امروز تعطیل‌اند و خبری نداریم.\n\n" +
    "امروز از چارت فاصله بگیرید. ذهن خسته، هفته‌ی بعد هم خسته معامله می‌کند.",
  Sun:
    "📘 یکشنبه — مرور و تمرین\n\n" +
    "وقتِ کاری است که در طول هفته جا می‌ماند:\n\n" +
    "✅ ژورنال هفته‌ی گذشته خود را بررسی کنید\n\n" +
    "✅ بک تست بگیرید\n\n" +
    "✅ اهداف و پلن هفته پیش رو رو بررسی کنید\n\n" +
    "هفته‌ی خوب، از امروز شروع می‌شود.",
};

// ─── دفترِ آنچه فرستاده شده ─────────────────────────────────────────
//
// بدون این جدول، هر اجرای کران دوباره همان هشدار را می‌فرستاد: پنجره‌ی
// «کمتر از ۱۵ دقیقه مانده» چند بار پشت سر هم برقرار است. کلید مرکب
// یعنی درج تکراری بی‌صدا رد می‌شود و لازم نیست جای دیگری حالت نگه
// داریم.
const SENT_DDL = [
  `CREATE TABLE IF NOT EXISTS econ_sent_log (
     kind TEXT NOT NULL,
     ref TEXT NOT NULL,
     telegram_user_id TEXT NOT NULL,
     sent_at TEXT NOT NULL,
     PRIMARY KEY (kind, ref, telegram_user_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_econ_sent_at ON econ_sent_log(sent_at)`,
];

export async function ensureSentSchema(env) {
  for (const sql of SENT_DDL) await env.DB.prepare(sql).run();
}

/**
 * اگر قبلاً فرستاده نشده، ثبتش می‌کند و true برمی‌گرداند.
 * ثبت پیش از ارسال انجام می‌شود، نه بعدش: اگر وسط کار ورکر کشته شود،
 * از دست رفتنِ یک هشدار خیلی کم‌هزینه‌تر از فرستادن دوباره‌ی آن به همه
 * است.
 */
async function claim(env, kind, ref, userId) {
  const res = await env.DB
    .prepare(
      `INSERT OR IGNORE INTO econ_sent_log (kind, ref, telegram_user_id, sent_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(kind, String(ref), String(userId), new Date().toISOString())
    .run();
  return (res && res.meta ? res.meta.changes || 0 : 0) > 0;
}

// دفتر را کوچک نگه می‌دارد. ۳۰ روز از هر بازه‌ای که ممکن است یک رویداد
// در تقویم بماند بلندتر است.
/**
 * پس گرفتنِ یک claim.
 *
 * فقط یک جا لازم می‌شود: وقتی ثبت انجام شده ولی ارسال به سقفِ زیرساخت
 * خورده و اصلاً به تلگرام نرسیده. بدونِ این، آن یک نفر برای همیشه
 * «فرستاده شده» علامت می‌خورد و هیچ اجرای بعدی سراغش نمی‌رود.
 */
async function unclaim(env, kind, ref, userId) {
  await env.DB
    .prepare(
      `DELETE FROM econ_sent_log
        WHERE kind = ? AND ref = ? AND telegram_user_id = ?`
    )
    .bind(String(kind), String(ref), String(userId))
    .run();
}

/**
 * سقفِ درخواستِ بیرونی در هر اجرای ورکر.
 *
 * پلنِ رایگانِ کلادفلر حدود ۵۰ subrequest به هر اجرا می‌دهد و هر پیامِ
 * تلگرام یکی از آن‌هاست. بالاتر از این عدد، fetch استثنا پرتاب می‌کند و
 * بقیه‌ی کار نصفه می‌ماند - همان چیزی که یک بار پیامِ همگانی را سرِ ۴۹
 * نفر متوقف کرد.
 *
 * ۴۵ و نه ۵۰: چند subrequest برای خودِ D1 و خطاهای احتمالی کنار گذاشته
 * می‌شود.
 */
const SEND_BUDGET = 45;

/**
 * بلندترین فاصله‌ای که کاربر می‌تواند برای هشدار انتخاب کند.
 *
 * با این، کرانِ هر پنج دقیقه پیش از خواندنِ جدولِ مشترکین می‌تواند
 * بپرسد «اصلاً خبری در راه هست؟» و در بیشترِ دفعات دست خالی و ارزان
 * برگردد.
 */
const MAX_ALERT_MINUTES = 60;

/**
 * فاصله‌هایی که کاربر می‌تواند برای هشدار انتخاب کند.
 *
 * درِینِ موازی باید سرِ باز شدنِ هر کدام یک بار راه بیفتد: پیشِ آن
 * لحظه کسی از آن گروه «موعدش» نرسیده و دور بی‌فایده است.
 */
export const ALERT_TIERS = [60, 30, 15, 5];

/**
 * کدام پنجره‌ها همین تیک تازه باز شده‌اند؟
 *
 * تیک هر پنج دقیقه است و هر بازه هم پنج دقیقه عرض دارد، پس هر خبر
 * حداکثر چهار بار - یک بار برای هر فاصله - درِین را راه می‌اندازد. اگر
 * به‌جای این، هر تیکی که خبری در یک‌ساعتِ پیشِ رو داشت درِین می‌زد،
 * روزی حدودِ هشتاد اجرا می‌شد بی‌آنکه چیزی اضافه بفرستد.
 *
 * فقط «خیلی مهم» و «مهم» شمرده می‌شوند. کم‌اهمیت را حدودِ بیست نفر
 * روشن کرده‌اند و کرانِ خودِ ورکر با ۴۵ پیام در هر تیک کاملاً پوششش
 * می‌دهد - درِینِ موازی برایش فقط اجراهای بی‌مصرف می‌سازد.
 */
export function alertTiersOpening(events) {
  const out = [];
  // فقط خبرهایی که واقعاً هشداری برایشان می‌رود. dueEvents هشدار را روی
  // ارزهای پیش‌فرض (دلار) می‌بندد؛ بدونِ همین فیلتر، یک خبرِ مهمِ پوند یا
  // یورو هم چهار اجرای درِین راه می‌انداخت که ۳٬۴۰۰ مشترک را می‌خواند
  // و به هیچ‌کس پیامی نمی‌داد (۱۴ اکتبر: ~۲۵۰ هزار خواندنِ بیهوده).
  const relevant = filterByCurrencies(events || [], DEFAULT_CURRENCIES);
  for (const m of ALERT_TIERS) {
    for (const e of relevant) {
      if (!e.date || !e.time) continue;
      if (e.status === "released") continue;
      if (e.importance !== "high" && e.importance !== "medium") continue;
      const left = etMinutesUntilNow(e.date, e.time);
      if (left > m - 5 && left <= m) {
        out.push(m);
        break;
      }
    }
  }
  return out;
}

/**
 * کدام پنجره‌های هشدار همین حالا باز شده‌اند - فقط با خواندنِ رویدادها.
 *
 * این جدا از جاروی ارسال است، چون تصمیمِ «درِین را راه بینداز» نباید به
 * پایان‌یافتنِ یک جارویِ سنگین بسته باشد: جاروی داخلِ ورکر کلِ مشترکین را
 * قدم می‌زند و کسانی که قبلاً هشدارشان رفته هم یک claimِ ناموفق می‌خورند.
 * ۱۳:۳۰ یک اکتبر همین‌طور شد - صدها claimِ بی‌نتیجه سقفِ subrequest را پر
 * کرد، جارو شکست، و چون دیسپچ بعد از جارو بود هرگز اجرا نشد.
 */
export async function alertOpeningNow(env, now = new Date()) {
  if (!(await senderEnabled(env))) return [];
  if (!env.BOT_TOKEN) return [];
  if (isWeekend(now)) return [];
  const events = await readEventsRange(env, dayOffset(-1), dayOffset(1));
  return alertTiersOpening(events);
}

/** آیا رویدادی در بازه‌ی پیشِ رو هست؟ */
function anyEventWithin(events, minutes) {
  for (const e of events || []) {
    if (!e.date || !e.time) continue;
    if (e.status === "released") continue;
    const left = etMinutesUntilNow(e.date, e.time);
    if (left > 0 && left <= minutes) return true;
  }
  return false;
}

/**
 * ثبت، بعد ارسال - با بودجه.
 *
 * ترتیبِ «اول ثبت، بعد ارسال» عمدی است: اگر ورکر وسطِ کار کشته شود، از
 * دست رفتنِ یک پیام خیلی کم‌هزینه‌تر از فرستادنِ دوباره‌اش به همه است.
 *
 * ولی خوردن به سقفِ زیرساخت فرق دارد - آنجا پیام اصلاً نرفته. پس claim
 * پس گرفته می‌شود و "stop" برمی‌گردد تا صداکننده همان‌جا بایستد و
 * اجرای بعدی از همین نقطه ادامه بدهد.
 *
 * @returns {Promise<"ok"|"skip"|"stop">}
 */
async function claimAndSend(env, kind, ref, sub, build, stats) {
  // پیام‌های روزانه ثبتشان روی ردیفِ خودِ کاربر است، نه یک ردیفِ تازه
  // در دفترِ ارسال: یک نوشتن به‌جای دو، و هیچ حذفی در آینده. چرایش
  // بالای DAY_CLAIM_FROM در subscribers.js است.
  const col = dayColumn(kind, ref);
  const take = () =>
    col
      ? claimDay(env, col, ref, sub.telegram_user_id)
      : claim(env, kind, ref, sub.telegram_user_id);
  const giveBack = () =>
    col
      ? unclaimDay(env, col, ref, sub.telegram_user_id)
      : unclaim(env, kind, ref, sub.telegram_user_id);

  if (!(await take())) return "skip";
  const res = await sendOne(env, sub, build, stats);
  if (res === "stop") await giveBack().catch(() => {});
  return res;
}

/**
 * خودِ ارسال، بی‌ثبت: "stop" یعنی پیام اصلاً به تلگرام نرسید (سقفِ
 * زیرساخت) و صداکننده باید همان‌جا بایستد.
 *
 * @returns {Promise<"ok"|"stop">}
 */
async function sendOne(env, sub, build, stats) {
  const built = build();
  const parts = Array.isArray(built) ? built : [built];
  let r;
  try {
    r = await tg(env, parts[0].method, { chat_id: sub.chat_id, ...parts[0].payload });
  } catch {
    return "stop";
  }
  // پیام‌های چندتکه (مثلاً متن و بعد فورواردِ ویس): تکه‌ی بعدی فقط
  // وقتی می‌رود که تکه‌ی قبلی رسیده باشد، و دقیقاً به همان ترتیب - هر
  // تکه منتظرِ پاسخِ تلگرام برای تکه‌ی قبلی می‌ماند.
  //
  // شکستِ تکه‌های بعدی ارسال را متوقف نمی‌کند و تکه‌ی اول را تکرار
  // نمی‌کند: کسی که متن را گرفته، دوباره نمی‌گیردش. فقط شمرده می‌شود.
  if (r.ok) {
    for (let i = 1; i < parts.length; i++) {
      try {
        const r2 = await tg(env, parts[i].method, { chat_id: sub.chat_id, ...parts[i].payload });
        if (!r2.ok) {
          stats.partFailed = (stats.partFailed || 0) + 1;
          console.error("تکه‌ی " + (i + 1) + " نرفت:", sub.telegram_user_id, r2.detail);
          break;
        }
      } catch (err) {
        stats.partFailed = (stats.partFailed || 0) + 1;
        console.error("تکه‌ی " + (i + 1) + " نرفت:", sub.telegram_user_id, err && err.message);
        break;
      }
    }
  }
  if (r.ok) stats.sent++;
  else if (r.blocked) {
    stats.blocked++;
    // تلگرام هیچ راه دیگری برای فهمیدنِ رفتنِ کاربر نمی‌دهد؛ همین کدِ
    // ۴۰۳ تنها نشانه است. تا امروز فقط شمرده می‌شد و دور ریخته - پس هر
    // روز صبح دوباره سراغِ همان‌ها می‌رفتیم و آمار هم زنده حسابشان
    // می‌کرد. حالا ثبت می‌شود، از صفِ ارسال بیرون می‌رود، و اگر روزی
    // برگشت، اولین تعاملش پاکش می‌کند.
    await markBlocked(env, sub.telegram_user_id);
  } else stats.failed++;
  return "ok";
}

export async function pruneSentLog(env) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  await env.DB.prepare(`DELETE FROM econ_sent_log WHERE sent_at < ?`).bind(cutoff).run();
}

// ─── ارسال ──────────────────────────────────────────────────────────

const API = (env, method) => "https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method;

async function tg(env, method, payload, attempt = 0) {
  const res = await fetch(API(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };
  // ۴۲۹ یعنی «زیادی سریع» - مثلاً پیامِ دوم به همان نفر در همان ثانیه.
  // تلگرام می‌گوید چند ثانیه صبر کن؛ صبر می‌کنیم و دوباره می‌فرستیم.
  // ۹ نوامبر بی‌این، ویسِ پشتِ متن برای بخشی از اعضا بی‌صدا نرفت.
  if (res.status === 429 && attempt < 2) {
    let wait = 1;
    try {
      const b = await res.json();
      wait = Number(b && b.parameters && b.parameters.retry_after) || 1;
    } catch {
      /* پیش‌فرض یک ثانیه */
    }
    await new Promise((k) => setTimeout(k, Math.min(wait, 10) * 1000 + 100));
    return tg(env, method, payload, attempt + 1);
  }
  let detail = String(res.status);
  try {
    const body = await res.json();
    if (body && body.description) detail += " " + body.description;
    // ۴۰۳ یعنی کاربر ربات را بلاک کرده. این خطا نیست، یک واقعیت است -
    // و نباید در لاگ‌ها با قطعی شبکه قاطی شود.
    return { ok: false, blocked: res.status === 403, detail };
  } catch {
    return { ok: false, blocked: false, detail };
  }
}

// ─── ۱) خلاصه‌ی روزانه ──────────────────────────────────────────────

// دکمه‌ی «دیگر نفرست» زیرِ خودِ خلاصه بود و به خواستِ آکادمی برداشته شد -
// هم از پیامِ روزهای هفته، هم از پیامِ آخر هفته. راهِ خاموش کردن از بین
// نرفته: در صفحه‌ی «تنظیم هشدار» سرِ جایش است و digest_off هنوز رعایت
// می‌شود؛ فقط دیگر جلوی چشمِ هر روزِ همه نیست.
const AI_BUTTON = {
  inline_keyboard: [
    [{ text: "🤖 تحلیل هوش مصنوعی", callback_data: "ECON_EXPLAIN", style: "primary" }],
    [{ text: "📅 اخبار امروز", callback_data: "ECON_TODAY", style: "primary" }],
  ],
};

/**
 * متنِ امروز - همان چیزی که کاربر می‌بیند.
 * @returns {{markdown?: string, text?: string, weekend: boolean}}
 */
export async function buildDigest(env, now = new Date()) {
  const day = tehranWeekday(now);
  if (day === "Sat" || day === "Sun") {
    return { text: WEEKEND_TEXT[day], weekend: true };
  }
  // فقط سه روز، نه کلِ جدول. خلاصه به رویدادهای «امروز» نگاه می‌کند و
  // یک روز حاشیه‌ی دو طرف، اختلافِ تاریخِ نیویورک و UTC را می‌پوشاند.
  const [events, labels, holidays] = await Promise.all([
    readEventsRange(env, dayOffset(-1), dayOffset(1)),
    readLabels(env),
    readHolidays(env).catch(() => []),
  ]);
  // خلاصه‌ی صبح فقط دلار می‌ماند - عمداً.
  //
  // این پیام به یازده هزار نفر می‌رود و یک متن برای همه ساخته می‌شود.
  // اگر بخواهد ارزهای هر کاربر را رعایت کند، باید هزاران متنِ متفاوت
  // ساخته شود: هم کند، هم مستقیم به همان سقف‌هایی می‌خورد که تازه
  // درستشان کردیم. ارزهای دیگر در نماهای «امروز» و «این هفته» هستند که
  // کاربر خودش بازشان می‌کند.
  const usdOnly = filterByCurrencies(events, DEFAULT_CURRENCIES);
  return { markdown: buildTodayMarkdown(usdOnly, labels, holidays), weekend: false };
}

// کلیدی که می‌گوید خلاصه‌ی کدام روز کامل رفته است. یک ردیفِ تنظیمات،
// تا درِین هر پنج دقیقه بدونِ زدن به جدولِ دوهزارتاییِ مشترکین بفهمد
// کاری مانده یا نه.
const DIGEST_DONE = "econ_digest_done";

// ─── نشانگرِ «تا اینجا رفته‌ام» ──────────────────────────────────────
//
// یک ردیفِ تنظیمات برای هر (نوعِ پیام، روز، تکه). با آن، هر دور فقط از
// جایی که دورِ قبل ایستاده ادامه می‌دهد و ردیف‌های پشتِ سرش را دوباره
// نمی‌خواند.
//
// چرا لازم شد: بدونِ آن، ارسال به هشت هزار نفر حدود چهار و نیم میلیون
// ردیف‌خوانی از D1 می‌برد - ۹۲ درصدِ سقفِ روزانه، در حالی که ارسالِ دوم
// همان روز هم پیش رو بود.
function cursorKey(kind, ref, shard) {
  const tag = shard && shard.of > 1 ? shard.index + "of" + shard.of : "all";
  return "econ_cur_" + kind + "_" + ref + "_" + tag;
}

// آخرین باری که جاروی کامل زده شد. کلیدش مثل نشانگر است تا هر (نوع،
// روز، تکه) حسابِ خودش را داشته باشد.
function sweepKey(kind, ref, shard) {
  const tag = shard && shard.of > 1 ? shard.index + "of" + shard.of : "all";
  return "econ_swept_" + kind + "_" + ref + "_" + tag;
}

// فاصله‌ی دو جاروی کامل.
//
// یک ساعت، و این عدد از یک خرابیِ واقعی آمده. جارو قرار بود «یک بار در
// پایانِ کار» باشد، ولی پایانی در کار نبود: هر ساعت ده‌ها نفر عضو
// می‌شوند، پس صف هیچ‌وقت خالی نمی‌ماند، پرچمِ «تمام شد» زده نمی‌شود، و
// کرانِ هر پنج دقیقه دوباره جارو می‌زند. یعنی ۲۸۸ اسکنِ کاملِ جدولِ
// یازده‌هزارتایی در روز - حدود ۳٫۳ میلیون ردیف‌خوانی، که با بقیه‌ی مصرف
// روی هم سقفِ روزانه را پر کرد و ربات برای همه ساکت شد.
//
// با یک ساعت، همان کار ۲۴ بار در روز انجام می‌شود. هزینه‌اش این است که
// عضوِ تازه ممکن است تا یک ساعت خلاصه‌اش دیر برسد - که برای پیامی که
// روزی یک بار صبح می‌رود، بی‌اهمیت است.
const SWEEP_EVERY_MS = 60 * 60 * 1000;

/**
 * یک تکه از مخاطب، با نشانگر - و یک جاروی گاه‌به‌گاه.
 *
 * نشانگر کارِ اصلی را می‌کند: هر دور از جایی که دورِ قبل ایستاده ادامه
 * می‌دهد. جارو برای تازه‌واردهاست - کسی که وسطِ ارسال عضو شده و آیدی‌اش
 * در ترتیب پشتِ نشانگر افتاده - و چون گران است، ساعتی یک بار.
 *
 * ساعت از صداکننده می‌آید نه از Date.now(): بقیه‌ی این تابع با
 * `ref`ِ همان اجرا کار می‌کند، و اگر پنجره‌ی جارو ساعتِ دیگری داشته
 * باشد، دو منطق روی دو زمان می‌نشینند و تست هم دروغ می‌گوید.
 *
 * @returns {{rows: Array, swept: boolean, throttled: boolean}}
 *   swept یعنی واقعاً کلِ فهرست نگاه شد. این تفاوت مهم است: «هیچ ردیفی
 *   نبود» فقط وقتی معنیِ «کار تمام است» می‌دهد که جارو زده شده باشد،
 *   وگرنه یعنی «این بار نگاه نکردیم».
 */
async function nextChunk(env, kind, ref, shard, now = Date.now()) {
  // «عکسِ فهرستِ مخاطب» - مسیرِ پیش‌فرض. اگر خاموش باشد یا نشود ساخت،
  // همان مسیرِ قدیمیِ D1 در ادامه کار می‌کند.
  if (await snapshotOn(env)) {
    const snap = await nextChunkSnapshot(env, kind, ref, shard, now).catch((err) => {
      // خطای خواندنِ ردیفِ عکس عمداً به مسیرِ قدیمی نمی‌افتد: آن مسیر هر دور
      // تا ۱۶ هزار ردیف را رد می‌کند، و ورک‌فلو خطا را دوباره امتحان می‌کند.
      if (err && err.name === "SnapshotReadError") throw err;
      console.error("عکسِ فهرستِ مخاطب شکست خورد، مسیرِ قدیمی:", err && err.message);
      return null;
    });
    if (snap) return snap;
  }
  return nextChunkLegacy(env, kind, ref, shard, now);
}

// ─── عکسِ فهرستِ مخاطب ──────────────────────────────────────────────
//
// ─── چرا ────────────────────────────────────────────────────────────
//
// هر دورِ ارسال پیش از این کوئریِ مخاطب را روی user_state اجرا می‌کرد.
// `CAST(id) % 6` ایندکس ندارد، پس هر شارد برای پیدا کردنِ ۴۵ نفر باید
// تا ۱۶ هزار ردیف را رد می‌کرد - و بعد از هر ۵۰۳، جاروی ساعتی یا شروعِ
// دوباره، از اول. ۱۲ اکتبر ۵٫۰۵ میلیون خواندن، و ربات برای همه ساکت شد.
//
// حالا فهرستِ مخاطبِ هر (نوع، روز) یک بار با همان کوئریِ قبلی ساخته و در
// **یک ردیف** bot_config ذخیره می‌شود. D1 ردیف می‌شمارد نه حجم، پس
// خواندنش یک ردیف است. هر دور فقط آن یک ردیف را می‌خواند و تکه‌اش را در
// حافظه برمی‌دارد.
//
// ─── چه چیزی عوض نشده ──────────────────────────────────────────────
//
// «آیا این نفر قبلاً گرفته؟» هنوز با claimِ اتمیکِ هر نفر تعیین می‌شود
// (claimAndSend). عکس فقط می‌گوید «چه کسانی کاندیدند»؛ هرگز نمی‌گوید
// «چه کسانی گرفته‌اند». پس عکسِ کهنه یا ساخته‌شده‌ی هم‌زمان نمی‌تواند
// پیامِ تکراری بسازد - بدترین حالتش یک کاندیدِ اضافه است که claim رد
// می‌کند.
//
// ─── کهنگی ─────────────────────────────────────────────────────────
//
// تازه‌واردی که بعد از ساختِ عکس عضو شود در آن نیست. همان جاروی ساعتی
// قبلی او را می‌گیرد: وقتی نشانگرِ یک شارد تمام شد و عکس بیش از یک
// ساعت از ساختش گذشته، عکس دوباره ساخته می‌شود - فقط با کسانی که هنوز
// نگرفته‌اند - و آن شارد از اولِ آن می‌خواند.
//
// کلیدِ برگشت: bot_config.econ_audience_snapshot = off.

const SNAP_FLAG = "econ_audience_snapshot";
// سقفِ اندازه‌ی یک ردیفِ D1 دو مگابایت است. بالاتر از این به مسیرِ
// قدیمی برمی‌گردیم تا ذخیره‌ی عکس بی‌صدا شکست نخورد.
const SNAP_MAX_CHARS = 1_500_000;

const snapMem = new Map();

// برای تست‌ها: حافظه‌ی ایزوله بینِ دو دیتابیسِ جدا نباید بماند.
export function resetSnapshotMemo() {
  snapMem.clear();
}

function snapKey(kind, ref) {
  return "econ_aud_" + kind + "_" + ref;
}

async function snapshotOn(env) {
  const v = await readConfig(env, SNAP_FLAG).catch(() => "");
  return String(v).toLowerCase() !== "off";
}

function parseSnapshot(raw) {
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o.t !== "number" || typeof o.ids !== "string") return null;
    return { t: o.t, ids: o.ids ? o.ids.split(",") : [] };
  } catch {
    return null;
  }
}

async function buildSnapshot(env, kind, ref, now) {
  // همان کوئریِ مخاطبِ همیشگی، بدونِ نشانگر و تکه‌بندی: فقط کسانی که
  // بلاک نیستند، خاموشش نکرده‌اند و این پیام را هنوز نگرفته‌اند.
  const ids = await listPendingAudienceIds(env, kind, ref);
  // ترتیبِ group_concat به ORDER BYِ زیرکوئری وابسته است و SQLite آن را
  // تضمین نمی‌کند؛ جست‌وجوی دودویی به ترتیب نیاز دارد. بررسی ارزان است.
  for (let i = 1; i < ids.length; i++) {
    if (ids[i - 1] > ids[i]) {
      ids.sort();
      break;
    }
  }
  // آیدیِ تلگرام عددی است. ردیفِ غیرعددی (مثلاً آیدیِ منفیِ یک گروه) را
  // کنار می‌گذاریم و بقیه را نگه می‌داریم.
  //
  // پیش از این یک ردیفِ غیرعددی کلِ ساخت را رد می‌کرد: عکس ذخیره نمی‌شد،
  // مسیرِ قدیمی (گران) جایش را می‌گرفت، و دورِ بعد دوباره ساختنِ عکس -
  // با ~۱۷ هزار ردیف خواندن - از نو شروع می‌شد. به یک پیامِ تلگرام هم
  // که چت‌آیدیِ عددی ندارد نمی‌شود فرستاد، پس کنار گذاشتنش چیزی از کسی
  // نمی‌گیرد.
  const numeric = ids.filter((id) => /^\d+$/.test(id));
  const skipped = ids.length - numeric.length;
  const value = JSON.stringify({ t: now, ids: numeric.join(",") });
  if (value.length > SNAP_MAX_CHARS) {
    await recordSnapDiag(env, ref, kind, { too_large: 1 });
    return null;
  }
  const key = snapKey(kind, ref);
  await writeConfig(env, key, value);
  // عکس‌های روزهای پیش را پاک می‌کند، تا جدول بی‌پایان بزرگ نشود.
  await env.DB
    .prepare(`DELETE FROM bot_config WHERE key LIKE ? ESCAPE '\\' AND key <> ?`)
    .bind("econ\\_aud\\_" + kind + "\\_%", key)
    .run()
    .catch(() => {});
  const rec = { t: now, ids: numeric };
  snapMem.set(key, rec);
  await recordSnapDiag(env, ref, kind, { builds: 1, non_numeric_skipped: skipped, last_size: numeric.length });
  return rec;
}

// ─── ابزارِ تشخیص: عکس چند بار و چرا ساخته شد ───────────────────────
//
// ۲۹ و ۳۰ اکتبر کوئریِ ساختِ عکس به‌جای ۱ تا ۳ بار در روز، ۵۶ بار اجرا
// شد (~۹۷۶ هزار خواندن، ۸۶٪ جمعِ کوئری‌ها)؛ و شنبه ۳۱ اکتبر اصلاً نه.
// علتش از بیرون معلوم نبود. این شمارنده‌ها یک ردیفِ bot_config برای هر
// (نوع، روز) می‌سازند و در /admin/econ-sender دیده می‌شوند.
//
// بهترین تلاش است و هرگز ارسال را نمی‌شکند: شکستِ نوشتنش بی‌صدا رد می‌شود.
function diagKey(kind, ref) {
  return "econ_snapdiag_" + kind + "_" + ref;
}

async function recordSnapDiag(env, ref, kind, patch) {
  try {
    const key = diagKey(kind, ref);
    const raw = await readConfig(env, key).catch(() => "");
    let cur = {};
    try {
      cur = raw ? JSON.parse(raw) || {} : {};
    } catch {
      cur = {};
    }
    for (const [k, v] of Object.entries(patch)) {
      cur[k] = k === "last_size" ? v : (Number(cur[k]) || 0) + Number(v);
    }
    cur.last_at = new Date().toISOString();
    await writeConfig(env, key, JSON.stringify(cur));
  } catch {
    /* تشخیص نباید کاری را بشکند */
  }
}

export async function readSnapDiag(env, kind = "digest", ref = digestRef()) {
  try {
    const raw = await readConfig(env, diagKey(kind, ref));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// تکه‌ی بعدی از عکس: ids بعد از `after` (مقایسه‌ی متنی، همان ترتیبِ
// ORDER BY در SQLite)، که به این شارد می‌رسند، حداکثر `limit` تا.
function pickChunk(rec, shard, after, limit) {
  const ids = rec.ids;
  const shards = shard && shard.of > 1 ? Math.floor(shard.of) : 0;
  const mine = shards ? Math.floor(shard.index) % shards : 0;
  let lo = 0;
  if (after) {
    let hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] > after) hi = mid;
      else lo = mid + 1;
    }
  }
  const out = [];
  for (let i = lo; i < ids.length && out.length < limit; i++) {
    const id = ids[i];
    if (shards && Number(id) % shards !== mine) continue;
    out.push({ telegram_user_id: id, chat_id: id });
  }
  return out;
}

// قفلِ ساختنِ عکس.
//
// بدونِ قفل، شش کارگرِ موازی در دقیقه‌ی اول هر کدام عکس را نمی‌یافتند و
// هر کدام شروع به ساختنش می‌کردند - و چون ساختن چند ثانیه طول می‌کشد،
// دورهای بعدیِ همان کارگرها هم دوباره می‌ساختند. ۱۴ اکتبر ۳۹ بار ساخته شد
// (۷۹۵ هزار خواندن، ۷۰٪ مصرفِ آن روز) به‌جای یک بار (۲۰ هزار).
//
// قفل یک ردیفِ bot_config است که با INSERT OR IGNORE اتمیک گرفته می‌شود.
// کسی که قفل را نگرفت منتظر می‌ماند تا عکس ظاهر شود (هر بار فقط یک
// ردیف می‌خواند)، و قفلِ بیش از ۳۰ ثانیه، مالِ ورکرِ مرده است و
// برداشته می‌شود.
const SNAP_LOCK_STALE_MS = 30_000;
const SNAP_WAIT_STEP_MS = 700;
const SNAP_WAIT_STEPS = 14;

function lockKey(kind, ref) {
  return "econ_audlock_" + kind + "_" + ref;
}

async function takeLock(env, kind, ref, now) {
  await ensureConfig(env);
  const key = lockKey(kind, ref);
  const iso = new Date().toISOString();
  const ins = await env.DB
    .prepare(`INSERT OR IGNORE INTO bot_config (key, value, updated_at) VALUES (?, ?, ?)`)
    .bind(key, String(now), iso)
    .run();
  if ((ins.meta ? ins.meta.changes || 0 : 0) > 0) return true;
  const take = await env.DB
    .prepare(`UPDATE bot_config SET value = ?, updated_at = ? WHERE key = ? AND CAST(value AS INTEGER) < ?`)
    .bind(String(now), iso, key, now - SNAP_LOCK_STALE_MS)
    .run();
  return (take.meta ? take.meta.changes || 0 : 0) > 0;
}

async function dropLock(env, kind, ref) {
  await env.DB.prepare(`DELETE FROM bot_config WHERE key = ?`).bind(lockKey(kind, ref)).run().catch(() => {});
}

/**
 * عکس را می‌سازد - یا اگر کسِ دیگری می‌سازد، منتظرش می‌ماند.
 * @returns {Promise<{rec, built:boolean}|null>} null یعنی نشد (مسیر قدیمی)
 */
async function buildOrWait(env, kind, ref, now, key) {
  if (await takeLock(env, kind, ref, now)) {
    try {
      const rec = await buildSnapshot(env, kind, ref, now);
      return rec ? { rec, built: true } : null;
    } finally {
      await dropLock(env, kind, ref);
    }
  }
  for (let i = 0; i < SNAP_WAIT_STEPS; i++) {
    await new Promise((r) => setTimeout(r, SNAP_WAIT_STEP_MS));
    const raw = await readConfig(env, key).catch(() => "");
    const rec = raw ? parseSnapshot(raw) : null;
    if (rec) return { rec, built: false };
  }
  return null;
}

// خواندنِ ردیفِ عکس، با فرقِ «ردیف نیست» و «خواندن شکست خورد».
//
// پیش از این `.catch(() => "")` هر دو را یکی می‌کرد: یک خطای گذرای D1 مثلِ
// «عکس وجود ندارد» رفتار می‌کرد و کلِ عکس - ~۱۷ هزار ردیف خواندن - از نو
// ساخته می‌شد. حالا یک بار با مکثِ کوتاه دوباره می‌خوانیم و اگر باز شکست
// خورد، خطا بالا می‌رود: ورک‌فلو آن را کدِ غیر-۲۰۰ می‌بیند و با مکث
// دوباره می‌زند، و کرانِ پنج‌دقیقه‌ای تیکِ بعد را. هیچ ارسالی جا نمی‌ماند
// و ساختِ گران هم اتفاق نمی‌افتد.
class SnapshotReadError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "SnapshotReadError";
  }
}

async function readSnapRow(env, kind, ref, key) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await readConfig(env, key);
    } catch (err) {
      lastErr = err;
      await recordSnapDiag(env, ref, kind, { read_errors: 1 });
      if (attempt === 0) await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new SnapshotReadError("خواندنِ ردیفِ عکس شکست خورد: " + String((lastErr && lastErr.message) || lastErr));
}

async function nextChunkSnapshot(env, kind, ref, shard, now) {
  const key = snapKey(kind, ref);
  let built = false;
  let rec = snapMem.get(key);
  if (!rec) {
    const raw = await readSnapRow(env, kind, ref, key);
    rec = raw ? parseSnapshot(raw) : null;
    if (raw && !rec) await recordSnapDiag(env, ref, kind, { parse_failed: 1 });
  }
  if (!rec) {
    await recordSnapDiag(env, ref, kind, { build_missing: 1 });
    const got = await buildOrWait(env, kind, ref, now, key);
    if (!got) return null;
    rec = got.rec;
    built = got.built;
  }
  snapMem.set(key, rec);

  const after = await readConfig(env, cursorKey(kind, ref, shard)).catch(() => "");
  const rows = pickChunk(rec, shard, after, SEND_BUDGET);
  if (rows.length > 0) return { rows, swept: false, throttled: false };

  // بدونِ نشانگر: این شارد هنوز شروع نکرده و عکس کلِ فهرست است، پس
  // خالی بودنش یعنی واقعاً چیزی نیست.
  if (!after) return { rows: [], swept: true, throttled: false };

  // نشانگر تمام شد. عکسِ تازه (همین الان ساخته یا کمتر از یک ساعت پیش)
  // یعنی جاروی تازه‌ای هست و چیزی جا نمانده.
  if (!built) {
    if (now - rec.t < SWEEP_EVERY_MS) return { rows: [], swept: false, throttled: true };
    // شاردِ دیگری شاید همین حالا دوباره ساخته باشد.
    const raw = await readConfig(env, key).catch(() => "");
    const fresh = raw ? parseSnapshot(raw) : null;
    if (fresh && fresh.t > rec.t) {
      rec = fresh;
      snapMem.set(key, rec);
    }
    if (now - rec.t >= SWEEP_EVERY_MS) {
      // بازسازیِ ساعتی هم قفل دارد؛ اگر قفل دستِ دیگری بود، با عکسِ فعلی
      // ادامه می‌دهیم - این کار نباید منتظر بماند.
      if (await takeLock(env, kind, ref, now)) {
        try {
          await recordSnapDiag(env, ref, kind, { build_hourly: 1 });
          const rebuilt = await buildSnapshot(env, kind, ref, now);
          if (!rebuilt) return null;
          rec = rebuilt;
        } finally {
          await dropLock(env, kind, ref);
        }
      }
    }
  }
  // تازه‌واردها و برگشته‌ها: از اولِ عکسِ تازه، بی‌نشانگر.
  return { rows: pickChunk(rec, shard, null, SEND_BUDGET), swept: true, throttled: false };
}

async function nextChunkLegacy(env, kind, ref, shard, now = Date.now()) {
  const after = await readConfig(env, cursorKey(kind, ref, shard)).catch(() => "");
  if (after) {
    const rows = await listPendingAudience(env, kind, ref, SEND_BUDGET, shard, after);
    if (rows.length > 0) return { rows, swept: false, throttled: false };
  }

  // بدونِ نشانگر یعنی هنوز دورِ اول است؛ آنجا این کوئری خودِ صفحه‌بندی
  // است، نه جارو، و نباید عقب بیفتد.
  if (after) {
    const key = sweepKey(kind, ref, shard);
    const last = Number(await readConfig(env, key).catch(() => "")) || 0;
    if (now - last < SWEEP_EVERY_MS) {
      return { rows: [], swept: false, throttled: true };
    }
    await writeConfig(env, key, String(now)).catch(() => {});
  }

  const rows = await listPendingAudience(env, kind, ref, SEND_BUDGET, shard, null);
  return { rows, swept: true, throttled: false };
}

/** نشانگر را جلو می‌برد - فقط تا کسی که واقعاً پردازش شد. */
async function advanceCursor(env, kind, ref, shard, lastId) {
  if (!lastId) return;
  await writeConfig(env, cursorKey(kind, ref, shard), String(lastId)).catch(() => {});
}

// ─── ثبتِ دسته‌ای (پیام‌های روزانه) ─────────────────────────────────
//
// ─── چرا ────────────────────────────────────────────────────────────
//
// ۸ نوامبر اندازه گرفته شد: ۸۵٪ نوشتنِ هر روزِ D1 در همان یک ساعتِ
// خلاصه‌ی صبح است. خلاصه برای هر نفر یک UPDATE روی user_state می‌زد
// (claimDay) - ~۱۸٫۸ هزار دستور، و کلادفلر برایشان ۳۶ تا ۵۲ هزار ردیف
// حساب کرد. دوشنبه با سلامِ هفتگی دو برابر.
//
// حالا تکه‌ی اصلیِ فهرست (عکسِ اولِ روز) با یک «رزرو» برای هر دسته‌ی
// ۴۵نفره فرستاده می‌شود: دو نوشتن برای هر دسته به‌جای ۴۵.
//
// ─── چطور تکراری نمی‌شود ────────────────────────────────────────────
//
// برای هر (نوع، روز، شارد) یک ردیفِ bot_config هست - برگه‌ی شارد - که
// نشانگر، دسته‌های در حالِ ارسال (inf) و دسته‌های نیمه‌مانده (left) را
// دارد. رزرو با «مقایسه و جای‌گزینی» روی همین ردیف انجام می‌شود
// (UPDATE ... WHERE value = <همان چیزی که خواندم>): دو کارگرِ هم‌زمان
// نمی‌توانند یک دسته را بردارند، چون فقط یکی از دو UPDATE ردیف را عوض
// می‌کند. کارگرِ بی‌شارد (کرانِ پنج‌دقیقه‌ای) هم از همین شش برگه
// برمی‌دارد، پس با کارگرهای شاردشده‌ی ورک‌فلو هم تداخل ندارد.
//
// ─── وقتی ارسال وسطِ دسته می‌ایستد ─────────────────────────────────
//
// • سقفِ زیرساخت (claimAndSend → stop): بقیه‌ی دسته به left برمی‌گردد و
//   دورِ بعد اول همان را برمی‌دارد. کسی تکراری نمی‌گیرد.
// • ورکر کشته شود و فرصتِ نوشتن نداشته باشد: دسته در inf می‌ماند. بعد از
//   INFLIGHT_STALE_MS به left می‌رود و دوباره فرستاده می‌شود. این تنها
//   جایی است که تکرار ممکن است - حداکثر یک دسته (۴۵ نفر)، و فقط در همان
//   روزِ نادر. دورِ دومِ ۰۵:۳۰ همین‌ها را هم جمع می‌کند.
//
// ─── تازه‌واردها ─────────────────────────────────────────────────────
//
// عکسِ اول دیگر بازسازی نمی‌شود. تازه‌واردهای بعد از آن در «عکسِ
// تکمیلی» (econ_audx_*) می‌آیند - همان کوئریِ مخاطب منهای عکسِ اول - و
// با همان claimِ تک‌به‌تکِ قبلی فرستاده می‌شوند؛ روزی چند ده نفر.
//
// ─── کلیدِ برگشت ────────────────────────────────────────────────────
//
// bot_config.econ_batch_claim = off → همان مسیرِ قبلی (claim برای هر نفر).
// فقط بینِ دو روز عوضش کنید: در مسیرِ قبلی کسی که امروز با دسته گرفته
// «نگرفته» دیده می‌شود.

export const BATCH_FLAG = "econ_batch_claim";
export const BATCH_SHARDS = 6;
const INFLIGHT_STALE_MS = 10 * 60 * 1000;
const BATCH_CAS_TRIES = 6;

async function batchOn(env) {
  const v = await readConfig(env, BATCH_FLAG).catch(() => "");
  return String(v).toLowerCase() !== "off";
}

function batchKey(kind, ref, s) {
  return "econ_bat_" + kind + "_" + ref + "_" + s;
}

function parseBatch(raw) {
  let o = null;
  try {
    o = raw ? JSON.parse(raw) : null;
  } catch {
    o = null;
  }
  return {
    c: (o && typeof o.c === "string") ? o.c : "",
    inf: (o && Array.isArray(o.inf)) ? o.inf : [],
    left: (o && Array.isArray(o.left)) ? o.left : [],
    n: (o && Number(o.n)) || 0,
    pf: (o && Number(o.pf)) || 0,
    b: (o && Number(o.b)) || 0,
    f: (o && Number(o.f)) || 0,
  };
}

// مقایسه و جای‌گزینی روی یک ردیفِ bot_config. raw = همان چیزی که خوانده
// شد ("" یعنی ردیف نبود).
async function casConfig(env, key, raw, next) {
  const iso = new Date().toISOString();
  const res = raw
    ? await env.DB
        .prepare(`UPDATE bot_config SET value = ?, updated_at = ? WHERE key = ? AND value = ?`)
        .bind(next, iso, key, raw)
        .run()
    : await env.DB
        .prepare(`INSERT OR IGNORE INTO bot_config (key, value, updated_at) VALUES (?, ?, ?)`)
        .bind(key, next, iso)
        .run();
  return (res && res.meta ? res.meta.changes || 0 : 0) > 0;
}

// آیدی‌های (a, z] از عکس که به شارد s می‌رسند - به همان ترتیبِ pickChunk.
function rangeIds(ids, s, a, z) {
  let lo = 0;
  if (a) {
    let hi = ids.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (ids[mid] > a) hi = mid;
      else lo = mid + 1;
    }
  }
  const out = [];
  for (let i = lo; i < ids.length && ids[i] <= z; i++) {
    if (Number(ids[i]) % BATCH_SHARDS === s) out.push(ids[i]);
  }
  return out;
}

/**
 * یک دسته برای شاردِ s رزرو می‌کند.
 * @returns {Promise<{a:string,z:string,ids:string[]}|null>} null یعنی این
 *   شارد فعلاً چیزی برای برداشتن ندارد.
 */
async function reserveBatch(env, kind, ref, s, rec, now, limit = SEND_BUDGET) {
  await ensureConfig(env);
  const key = batchKey(kind, ref, s);
  for (let attempt = 0; attempt < BATCH_CAS_TRIES; attempt++) {
    const raw = await readConfig(env, key).catch(() => null);
    if (raw === null) return null;
    const st = parseBatch(raw);
    // دسته‌ای که ورکرش مرده: دوباره به صف.
    const alive = [];
    for (const x of st.inf) {
      if (now - Number(x.t || 0) >= INFLIGHT_STALE_MS) st.left.push({ a: x.a, z: x.z });
      else alive.push(x);
    }
    st.inf = alive;

    let range = null;
    while (st.left.length > 0 && !range) {
      const r = st.left.shift();
      const ids = rangeIds(rec.ids, s, r.a, r.z);
      if (ids.length === 0) continue;
      // بودجه‌ی این کارگر کمتر از دسته‌ی مانده است: نیمه‌ی دوم به صف برمی‌گردد.
      if (ids.length > limit) {
        const cut = ids[limit - 1];
        st.left.unshift({ a: cut, z: r.z });
        range = { a: r.a, z: cut, ids: ids.slice(0, limit) };
      } else range = { a: r.a, z: r.z, ids };
    }
    if (!range) {
      const chunk = pickChunk(rec, { of: BATCH_SHARDS, index: s }, st.c, limit);
      if (chunk.length === 0) {
        // چیزی برای برداشتن نیست؛ اگر فقط دسته‌های مرده جابه‌جا شده بودند
        // هم ارزشِ نوشتن ندارد - دورِ بعد همین را دوباره حساب می‌کند.
        return null;
      }
      const z = chunk[chunk.length - 1].telegram_user_id;
      range = { a: st.c, z, ids: chunk.map((r) => r.telegram_user_id) };
      st.c = z;
    }
    st.inf.push({ a: range.a, z: range.z, t: now });
    if (await casConfig(env, key, raw, JSON.stringify(st))) return range;
    // کسِ دیگری همین لحظه برگه را عوض کرد؛ از نو.
  }
  return null;
}

/** پایانِ یک دسته: از inf بیرون، آمار اضافه، و باقیِ نیمه‌کاره به left. */
async function finishBatch(env, kind, ref, s, range, stats, leftFrom) {
  const key = batchKey(kind, ref, s);
  for (let attempt = 0; attempt < BATCH_CAS_TRIES * 2; attempt++) {
    const raw = await readConfig(env, key).catch(() => null);
    if (raw === null) continue;
    const st = parseBatch(raw);
    const i = st.inf.findIndex((x) => x.a === range.a && x.z === range.z);
    if (i >= 0) st.inf.splice(i, 1);
    // اگر ورکرِ دیگری این دسته را مرده فرض کرده و به left برده بود، آنجا
    // هم پاکش می‌کنیم - کارش همین الان تمام شد.
    st.left = st.left.filter((x) => !(x.a === range.a && x.z === range.z));
    if (leftFrom !== null) st.left.push({ a: leftFrom, z: range.z });
    st.n += stats.sent;
    st.b += stats.blocked;
    st.f += stats.failed;
    st.pf = (Number(st.pf) || 0) + (stats.partFailed || 0);
    if (await casConfig(env, key, raw, JSON.stringify(st))) return true;
  }
  console.error("پایانِ دسته ثبت نشد", kind, ref, s, range.a, range.z);
  return false;
}

/** آیا همه‌ی شاردها عکسِ اول را تمام کرده‌اند (بی‌دسته‌ی باز و بی‌مانده)؟ */
async function batchAllClear(env, kind, ref, rec) {
  for (let s = 0; s < BATCH_SHARDS; s++) {
    const st = parseBatch(await readConfig(env, batchKey(kind, ref, s)).catch(() => ""));
    if (st.inf.length || st.left.length) return false;
    if (pickChunk(rec, { of: BATCH_SHARDS, index: s }, st.c, 1).length) return false;
  }
  return true;
}

/** آمارِ ثبت‌شده‌ی دسته‌ها - برای /admin/econ-sender. */
export async function batchStats(env, kind, ref) {
  const out = { sent: 0, blocked: 0, failed: 0, part_failed: 0, open: 0, left: 0 };
  for (let s = 0; s < BATCH_SHARDS; s++) {
    const raw = await readConfig(env, batchKey(kind, ref, s)).catch(() => "");
    if (!raw) continue;
    const st = parseBatch(raw);
    out.sent += st.n;
    out.blocked += st.b;
    out.failed += st.f;
    out.part_failed += st.pf;
    out.open += st.inf.length;
    out.left += st.left.length;
  }
  return out;
}

// ─── عکسِ تکمیلی: تازه‌واردهای بعد از عکسِ اول ─────────────────────

function extraKey(kind, ref) {
  return "econ_audx_" + kind + "_" + ref;
}

function extraCursorKey(kind, ref, s) {
  return "econ_curx_" + kind + "_" + ref + "_" + s;
}

async function buildExtras(env, kind, ref, rec, now) {
  const base = new Set(rec.ids);
  const all = await listPendingAudienceIds(env, kind, ref);
  const ids = all.filter((id) => /^\d+$/.test(id) && !base.has(id)).sort();
  const x = { t: now, ids };
  await writeConfig(env, extraKey(kind, ref), JSON.stringify({ t: now, ids: ids.join(",") }));
  await env.DB
    .prepare(`DELETE FROM bot_config WHERE key LIKE ? ESCAPE '\\' AND key <> ?`)
    .bind("econ\\_audx\\_" + kind + "\\_%", extraKey(kind, ref))
    .run()
    .catch(() => {});
  await recordSnapDiag(env, ref, kind, { extras_builds: 1, extras_size: ids.length });
  return x;
}

/**
 * تکه‌ی بعدیِ تازه‌واردها برای شاردِ s، یا {throttled} اگر تا بازسازیِ
 * ساعتیِ بعدی چیزی نیست.
 */
async function nextExtras(env, kind, ref, s, rec, now, budget = SEND_BUDGET) {
  const raw = await readConfig(env, extraKey(kind, ref)).catch(() => "");
  let x = raw ? parseSnapshot(raw) : null;
  const curRaw = await readConfig(env, extraCursorKey(kind, ref, s)).catch(() => "");
  const [ct, cafter] = String(curRaw || "").split(":");
  let after = x && String(x.t) === ct ? cafter || "" : "";
  let rows = x ? pickChunk(x, { of: BATCH_SHARDS, index: s }, after, budget) : [];
  if (rows.length > 0) return { rows, x };
  // تکمیلی هنوز ساخته نشده: مبدأ همان عکسِ اول است. یعنی اولین نگاه به
  // تازه‌واردها هم یک ساعت بعد از عکسِ اول است - همان آهنگِ قبلی، و نه
  // یک اسکنِ کاملِ اضافه همان لحظه‌ای که یک شارد تمام می‌شود.
  // clear: تکمیلیِ فعلی برای این شارد تمام شده - همان چیزی که مسیرِ
  // قبلی «جارو شد» می‌نامید.
  if (now - (x ? x.t : rec.t) < SWEEP_EVERY_MS) return { rows: [], throttled: true, clear: !!x };
  // نبود یا کهنه است: بازسازی، با همان قفلِ عکس.
  if (!(await takeLock(env, kind, ref, now))) return { rows: [], throttled: true, clear: false };
  try {
    const again = await readConfig(env, extraKey(kind, ref)).catch(() => "");
    const fresh = again ? parseSnapshot(again) : null;
    x = fresh && (!x || fresh.t > x.t) && now - fresh.t < SWEEP_EVERY_MS ? fresh : await buildExtras(env, kind, ref, rec, now);
  } finally {
    await dropLock(env, kind, ref);
  }
  rows = pickChunk(x, { of: BATCH_SHARDS, index: s }, "", budget);
  return { rows, x, clear: rows.length === 0 };
}

async function loadFirstSnapshot(env, kind, ref, now) {
  const key = snapKey(kind, ref);
  let rec = snapMem.get(key);
  if (!rec) {
    const raw = await readSnapRow(env, kind, ref, key);
    rec = raw ? parseSnapshot(raw) : null;
    if (raw && !rec) await recordSnapDiag(env, ref, kind, { parse_failed: 1 });
  }
  if (!rec) {
    await recordSnapDiag(env, ref, kind, { build_missing: 1 });
    const got = await buildOrWait(env, kind, ref, now, key);
    if (!got) return null;
    rec = got.rec;
  }
  snapMem.set(key, rec);
  return rec;
}

/**
 * یک دورِ ارسال با ثبتِ دسته‌ای.
 *
 * @param makeBuild تابعی که سازنده‌ی پیام را می‌دهد - فقط وقتی کسی برای
 *   فرستادن هست صدا زده می‌شود.
 * @returns null اگر عکس در دسترس نیست (صداکننده مسیرِ قبلی را می‌رود).
 */
async function batchRound(env, kind, ref, shard, now, makeBuild, budget = SEND_BUDGET) {
  const rec = await loadFirstSnapshot(env, kind, ref, now);
  if (!rec) return null;
  const order = shard
    ? [Math.floor(shard.index) % BATCH_SHARDS]
    : [0, 1, 2, 3, 4, 5].sort(() => Math.random() - 0.5);

  // ۱) عکسِ اول، دسته‌ای. کارگرِ بی‌شارد تا پر شدنِ بودجه از چند برگه
  //    برمی‌دارد؛ کارگرِ شاردشده فقط از برگه‌ی خودش.
  const stats = { sent: 0, failed: 0, blocked: 0 };
  let build = null;
  let chunk = 0;
  let stopped = false;
  for (const s of order) {
    while (!stopped && chunk < budget) {
      const range = await reserveBatch(env, kind, ref, s, rec, now, budget - chunk);
      if (!range) break;
      if (!build) build = await makeBuild();
      const part = { sent: 0, failed: 0, blocked: 0 };
      let leftFrom = null;
      let prev = range.a;
      for (let i = 0; i < range.ids.length; i++) {
        const id = range.ids[i];
        const res = await sendOne(env, { telegram_user_id: id, chat_id: id }, build, part);
        if (res === "stop") {
          stopped = true;
          leftFrom = prev;
          break;
        }
        prev = id;
        chunk++;
        if (chunk % 20 === 0) await new Promise((k) => setTimeout(k, 1000));
      }
      await finishBatch(env, kind, ref, s, range, part, leftFrom);
      stats.sent += part.sent;
      stats.failed += part.failed;
      stats.blocked += part.blocked;
      stats.partFailed = (stats.partFailed || 0) + (part.partFailed || 0);
    }
    if (stopped || chunk >= budget) break;
  }
  if (chunk > 0 || stopped) return { stats, chunk, stopped };

  // ۲) عکسِ اول برای این شاردها تمام است؛ تازه‌واردها، تک‌به‌تک.
  let throttled = false;
  let sweptAll = true;
  for (const s of order) {
    const got = await nextExtras(env, kind, ref, s, rec, now, budget);
    if (got.throttled) {
      throttled = true;
      if (!got.clear) sweptAll = false;
      continue;
    }
    if (!got.rows.length) continue;
    const xbuild = await makeBuild();
    const xstats = { sent: 0, failed: 0, blocked: 0 };
    let xstopped = false;
    let lastId = "";
    for (let i = 0; i < got.rows.length; i++) {
      const res = await claimAndSend(env, kind, ref, got.rows[i], xbuild, xstats);
      if (res === "stop") {
        xstopped = true;
        break;
      }
      lastId = got.rows[i].telegram_user_id;
      if (i % 20 === 19) await new Promise((k) => setTimeout(k, 1000));
    }
    if (lastId) await writeConfig(env, extraCursorKey(kind, ref, s), got.x.t + ":" + lastId).catch(() => {});
    return { stats: xstats, chunk: got.rows.length, stopped: xstopped };
  }

  // هیچ‌چیز نماند. «جارو شد» فقط اگر هیچ شاردی دسته‌ی باز یا مانده
  // نداشته باشد و تکمیلی هم تازه نگاه شده باشد.
  const swept = !shard && sweptAll && (await batchAllClear(env, kind, ref, rec));
  return { empty: true, swept, throttled: shard ? throttled : !swept && throttled };
}

/**
 * یک دورِ ارسال برای پیام‌های روزانه - دسته‌ای اگر بشود، وگرنه همان مسیرِ
 * قبلی با claimِ هر نفر.
 */
async function sendRound(env, kind, ref, shard, now, makeBuild, perUser = 1) {
  // پیامِ چندتکه یعنی چند درخواست به تلگرام برای هر نفر؛ تعدادِ نفرها در
  // هر دور به همان نسبت کم می‌شود تا از سقفِ subrequest رد نشود.
  const budget = Math.max(1, Math.floor(SEND_BUDGET / Math.max(1, perUser)));
  if ((await snapshotOn(env)) && (await batchOn(env))) {
    // شاردبندیِ دیگری جز شش نمی‌تواند برگه‌های شارد را شریک شود؛ چنین
    // صداکننده‌ای مثلِ کارگرِ بی‌شارد از هر شش برگه برمی‌دارد. به مسیرِ
    // قبلی فرستادنش خطرناک است: آنجا کسی که امروز با دسته گرفته «نگرفته»
    // دیده می‌شود.
    const bshard = shard && Math.floor(shard.of) === BATCH_SHARDS ? shard : null;
    const r = await batchRound(env, kind, ref, bshard, now.getTime(), makeBuild, budget).catch((err) => {
      if (err && err.name === "SnapshotReadError") throw err;
      console.error("ارسالِ دسته‌ای شکست خورد، مسیرِ قبلی:", err && err.message);
      return null;
    });
    if (r) return r;
  }
  const { rows: all, swept, throttled } = await nextChunk(env, kind, ref, shard, now.getTime());
  if (all.length === 0) return { empty: true, swept, throttled };
  // نشانگر فقط تا آخرین نفرِ پردازش‌شده جلو می‌رود، پس بقیه‌ی تکه دورِ بعد می‌آید.
  const pending = all.slice(0, budget);
  const build = await makeBuild();
  const stats = { sent: 0, failed: 0, blocked: 0 };
  let stopped = false;
  let lastId = "";
  for (let i = 0; i < pending.length; i++) {
    const res = await claimAndSend(env, kind, ref, pending[i], build, stats);
    if (res === "stop") {
      stopped = true;
      break;
    }
    lastId = pending[i].telegram_user_id;
    if (i % 20 === 19) await new Promise((k) => setTimeout(k, 1000));
    if (i % 20 === 19) await advanceCursor(env, kind, ref, shard, lastId);
  }
  await advanceCursor(env, kind, ref, shard, lastId);
  return { stats, chunk: pending.length, stopped };
}

export function digestRef(now = new Date()) {
  // کلیدِ یکتاییِ خلاصه، تاریخِ تهران است نه UTC - وگرنه اجرای ۴:۳۰
  // بامداد UTC و روزِ تقویمیِ کاربر با هم جور در نمی‌آمدند.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(now);
}

/** ساعتِ تهران به شکلِ "HH:MM" - برای مقایسه‌ی رشته‌ای. */
export function tehranHhmm(now = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
}

// ساعتی که خلاصه زودتر از آن نباید حرکت کند.
//
// ─── باگی که این را لازم کرد ──────────────────────────────────────
//
// شناسه‌ی یکتاییِ خلاصه (digestRef) تاریخِ تهران است، و تاریخِ تهران سرِ
// نیمه‌شب عوض می‌شود - یعنی ۲۰:۳۰ UTC. درِینِ هر پنج دقیقه فقط یک شرط
// داشت: «آیا خلاصه‌ی این ref تمام شده؟». سرِ ساعت ۰۰:۰۰ تهران ref تازه
// می‌شد، هیچ‌کس برای آن ref پیامی نگرفته بود، و درِین بی‌درنگ شروع
// می‌کرد به فرستادن - نیمه‌شب.
//
// نتیجه‌اش این بود: از ۰۰:۰۰ تا ۷:۳۰ تهران، هر پنج دقیقه حدود ۴۵ نفر،
// یعنی چند هزار نفر خلاصه را وسطِ شب می‌گرفتند. بقیه صبح، سرِ وقت. و
// چون متنِ خلاصه با تاریخِ UTC ساخته می‌شود، آن‌هایی که بینِ ۰۰:۰۰ و
// ۳:۳۰ می‌گرفتند سرتیترِ **دیروز** را می‌دیدند - پیامی که هم بی‌موقع
// بود هم کهنه به نظر می‌رسید.
//
// همین دروازه از اول برای سلامِ دوشنبه و اطلاعیه نوشته شده بود (هر دو
// `hhmm < "08:00"` دارند)؛ فقط برای خودِ خلاصه و اعلانِ تعطیلی جا
// افتاده بود.
//
// ۰۷:۳۰ و نه ۰۸:۰۰: کرانِ کلادفلر دقیقاً ۰۴:۰۰ UTC است، یعنی ۰۷:۳۰
// تهران، و همان کران خودش تکه‌ی اول را می‌فرستد. دروازه نباید جلوی
// درِینی را بگیرد که قرار است همان لحظه ادامه‌اش بدهد.
const DIGEST_OPENS_AT = "07:30";

// و ساعتی که دیگر بسته می‌شود.
//
// این برای تازه‌واردهاست. جاروی ساعتیِ nextChunk هر عضوِ تازه‌ای را که
// شناسه‌اش پشتِ نشانگر افتاده برمی‌دارد، و بدونِ سقف این کار تا آخرِ شب
// ادامه داشت: کسی که ساعت چهارِ بعدازظهر عضو می‌شد، «خلاصه‌ی صبح» را
// همان موقع می‌گرفت. خبرهایش هنوز مالِ امروز بود، ولی پیامی که خودش
// را خلاصه‌ی صبح معرفی می‌کند و عصر می‌رسد، از نرفتنش بدتر است.
//
// کسی که بعد از این ساعت عضو شود، خلاصه‌ی فردا صبح را می‌گیرد.
//
// ۱۱ و نه ۹، دقیقاً به همان دلیلِ سلامِ دوشنبه: ورک‌فلوی گیت‌هاب ۷:۳۰
// می‌آید و حدود بیست دقیقه طول می‌کشد، ولی زمان‌بندِ گیت‌هاب گاهی عقب
// می‌افتد. این سه ساعت همان حاشیه است.
//
// و فقط روی درِین است، نه روی مسیرِ force=1. آن مسیر شبکه‌ی ایمنی
// است: اگر روزی کرانِ کلادفلر بیفتد و تنها اجرای باقی‌مانده همان
// اجرای عقب‌افتاده‌ی گیت‌هاب باشد، بستنِ پنجره یعنی آن روز خلاصه برای
// **هیچ‌کس** نرود - که از دیر رسیدن بدتر است.
const DIGEST_CLOSES_AT = "11:00";

/**
 * خلاصه‌ی روزانه - تکه‌تکه و قابلِ ادامه.
 *
 * چرا تکه‌تکه: دو هزار مشترک یعنی دو هزار درخواست به تلگرام، و پلنِ
 * رایگان حدود ۵۰ تا در هر اجرا می‌دهد. نسخه‌ی قبلی همه را یک‌جا می‌فرستاد
 * و بدتر از آن، پیش از فرستادن همه را «فرستاده شد» علامت می‌زد - پس
 * وقتی سرِ پنجاهمی به سقف می‌خورد، بقیه نه پیام می‌گرفتند نه دوباره
 * تلاش می‌شد. عملاً خلاصه فقط به چند ده نفرِ اول می‌رسید.
 *
 * حالا هر اجرا یک تکه می‌فرستد و کرانِ هر پنج دقیقه ادامه‌اش می‌دهد تا
 * فهرست تمام شود. با پلنِ پولی سقف هزار می‌شود و کلِ فهرست در دو سه
 * اجرا تمام می‌شود.
 */
export async function runDailyDigest(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };

  await ensureSentSchema(env);
  const ref = digestRef(now);

  let digest = null;
  const round = await sendRound(env, "digest", ref, shard, now, async () => {
    digest = await buildDigest(env, now);
    return () =>
      digest.weekend
        ? // متن آخر هفته دکمه‌ی تحلیل ندارد: خبری برای تحلیل وجود ندارد و
          // دکمه‌ای که به تحلیلِ هیچ می‌رسد، از نبودنش بدتر است.
          { method: "sendMessage", payload: { text: digest.text } }
        : {
            method: "sendRichMessage",
            payload: { rich_message: { markdown: digest.markdown }, reply_markup: AI_BUTTON },
          };
  });
  if (round.empty) {
    const { swept, throttled } = round;
    // پرچمِ پایان دو شرط دارد. اول اینکه اجرا بی‌تکه باشد: خالی بودنِ یک
    // تکه فقط یعنی همان تکه تمام شده، نه کلِ فهرست. دوم اینکه واقعاً
    // جارو زده باشیم - «هیچ ردیفی نبود» می‌تواند فقط یعنی «این بار نگاه
    // نکردیم». بدونِ این شرط، اولین درِینِ محدودشده روز را تمام‌شده اعلام
    // می‌کرد و تازه‌واردها تا فردا خلاصه نمی‌گرفتند.
    if (!shard && swept) await writeConfig(env, DIGEST_DONE, ref).catch(() => {});
    // برای یک کارگرِ شاردشده، «تکه‌ی من خالی است» یعنی کارِ من تمام
    // شده. با done:swept، شاردی که فهرستش تمام شده بود done:false
    // می‌گرفت و ده‌ها دورِ اضافه می‌زد (۶ اکتبر: ~۱۴٫۵ میلیون خواندن در
    // روز). پرچمِ DIGEST_DONE همان معنیِ سخت‌گیر را نگه می‌دارد.
    return { sent: 0, failed: 0, blocked: 0, done: shard ? true : swept, throttled };
  }
  const { stats, stopped } = round;

  // `throttled` اینجا همیشه false است و ایستادن با `stopped` خبر داده می‌شود.
  //
  // ─── باگی که این جدایی را لازم کرد ──────────────────────────────
  //
  // ۲۸ اکتبر یک ارسالِ ناموفق به تلگرام (claimAndSend → "stop") جواب را
  // `throttled:true` می‌کرد، و ورک‌فلو آن را «الان کاری نیست» می‌فهمد و
  // همان شارد را می‌بندد - وسطِ فهرست. شش شارد با دورِ نیمه‌پر (۹، ۲۱، ۱۰،
  // ۳۵، ۲۲ پیام) بسته شدند و فقط ۵٬۷۴۴ نفر از ~۱۶٫۹ هزار خلاصه گرفتند؛
  // بقیه تا ۱۳:۴۳ تهران منتظر ماندند.
  //
  // `throttled` فقط یعنی «جارو هنوز زود است» (از nextChunk) و ایستادنِ
  // ورک‌فلو درست است. ایستادنِ وسطِ تکه یعنی کار مانده و باید دورِ بعد
  // ادامه بدهد: نشانگر تا نفرِ آخرِ واقعاً پردازش‌شده جلو رفته.
  // پرچمِ پایان فقط در شاخه‌ی بالا زده می‌شود - جایی که کوئری واقعاً
  // دست خالی برگشته. تکه‌ی کوتاه‌تر از بودجه دلیلِ کافی نیست: وقتی چند
  // درِین موازی کار می‌کنند، ممکن است بقیه‌ی فهرست را همان لحظه
  // همکارهایش برداشته باشند و هنوز در حالِ فرستادن باشند. یک دورِ اضافه
  // ارزان است؛ جا ماندنِ چند نفر نه.
  return { ...stats, weekend: digest ? digest.weekend : undefined, chunk: round.chunk, done: false, throttled: false, stopped };
}

// ─── ۱ب) اعلانِ تعطیلی بانکی ────────────────────────────────────────
//
// چرا جدا از خلاصه: خلاصه‌ی صبح جدولِ رویدادهاست و در روزِ تعطیل فقط
// می‌نویسد «امروز رویداد مهمی ثبت نشده» - که از نگاهِ کاربر با یک روزِ
// خالیِ عادی فرقی ندارد. تعطیلیِ بانکی خودش یک خبر است و باید اسم و
// دلیل داشته باشد.
//
// چرا با همان ماشینِ خلاصه: دفترِ ارسال، تکه‌بندی، بودجه‌ی subrequest و
// درِینِ موازی همه اینجا هم لازم‌اند. تنها فرقش kind است - «holiday»
// به‌جای «digest» - پس همان مسیر با یک شناسه‌ی دیگر کار می‌کند و هیچ‌کس
// دو بار پیام نمی‌گیرد.

const HOLIDAY_BUTTON = {
  inline_keyboard: [
    [{ text: "🏦 تعطیلات پیشِ رو", callback_data: "ECON_HOLIDAYS", style: "primary" }],
  ],
};

const WEEKDAY_FA = {
  Sat: "شنبه", Sun: "یکشنبه", Mon: "دوشنبه", Tue: "سه‌شنبه",
  Wed: "چهارشنبه", Thu: "پنجشنبه", Fri: "جمعه",
};

/**
 * تعطیلیِ امروز، اگر باشد.
 *
 * تاریخ به وقت تهران گرفته می‌شود نه UTC: پیام صبحِ تهران می‌رود و اگر
 * با UTC سنجیده شود، چند ساعتِ اولِ روز هنوز دیروز حساب می‌شود.
 */
export async function todaysHoliday(env, now = new Date()) {
  const today = digestRef(now);
  const rows = await readHolidays(env).catch(() => []);
  return (rows || []).find((h) => h && h.date === today) || null;
}

/** متنِ اعلان. جدا نوشته شده تا بشود بدونِ فرستادن دیدش. */
export function buildHolidayText(holiday, now = new Date()) {
  const date = digestRef(now);
  const day = WEEKDAY_FA[tehranWeekday(now)] || "";
  const label = holidayLabel(holiday);

  return (
    "🏦 BANK HOLIDAY\n" +
    "تعطیلی بانکی آمریکا — " + (holidayNameFa(holiday) || label) + "\n\n" +
    "امروز " + day + "، " + formatJalaliDate(date) + "، بازارهای آمریکا به مناسبت " +
    label + " تعطیل‌اند. بانک‌ها، بورس و مؤسسات مالی آمریکا در این روز بسته‌اند.\n\n" +
    "📉 نقدینگی پایین می‌آید\n\n" +
    "بخش بزرگی از حجم معاملات دلار از بانک‌ها و مؤسسات آمریکایی می‌آید. وقتی آن‌ها تعطیل‌اند، نقدینگی بازار به‌شدت پایین می‌آید. بازار فارکس باز است، ولی عملاً با بخشی از توان همیشگی‌اش کار می‌کند.\n\n" +
    "📰 خبر اقتصادی منتشر نمی‌شود\n\n" +
    "هیچ داده‌ی اقتصادی مهمی برای دلار امروز اعلام نمی‌شود؛ نهادهای آماری آمریکا هم تعطیل‌اند.\n\n" +
    "فردا بازار و تقویم اقتصادی به حالت عادی برمی‌گردند."
  );
}

const HOLIDAY_DONE = "econ_holiday_done";

/**
 * یک تکه از اعلانِ تعطیلی.
 *
 * اگر امروز تعطیل نباشد، بی‌هیچ کاری برمی‌گردد - پس صدا زدنش در هر روزی
 * بی‌خطر است و لازم نیست جای دیگری تصمیم بگیرد که امروز تعطیل هست یا نه.
 */
export async function runHolidayNotice(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };

  const holiday = await todaysHoliday(env, now);
  if (!holiday) return { skipped: "امروز تعطیل نیست", done: true };

  await ensureSentSchema(env);
  const ref = digestRef(now);

  const text = buildHolidayText(holiday, now);
  const round = await sendRound(env, "holiday", ref, shard, now, async () => () => ({
    method: "sendMessage",
    payload: { text, reply_markup: HOLIDAY_BUTTON },
  }));
  if (round.empty) {
    // همان دو شرطِ خلاصه‌ی روزانه - دلیلش آنجا نوشته شده.
    if (!shard && round.swept) await writeConfig(env, HOLIDAY_DONE, ref).catch(() => {});
    return { sent: 0, failed: 0, blocked: 0, done: shard ? true : round.swept, throttled: round.throttled };
  }
  const { stats, stopped } = round;

  return {
    ...stats,
    holiday: holiday.name,
    chunk: round.chunk,
    done: false,
    throttled: false,
    stopped,
  };
}

/** همان، ولی با پرچمِ «امروز تمام شد» - برای کرانِ هر پنج دقیقه. */
export async function drainHolidayNotice(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  // همان پنجره‌ی خلاصه. اعلانِ تعطیلی با همان کران شروع می‌شود و همان
  // ref را دارد، پس بدونِ این، نیمه‌شب راه می‌افتاد - و یک اعلانِ
  // تعطیلی که عصر برسد، وقتی بازار تمامِ روز بسته بوده، بی‌معنی است.
  const hhmm = tehranHhmm(now);
  if (hhmm < DIGEST_OPENS_AT) return { skipped: "هنوز ۷:۳۰ نشده" };
  if (hhmm >= DIGEST_CLOSES_AT) return { skipped: "پنجره‌ی امروز بسته شده" };
  const ref = digestRef(now);
  const done = await readConfig(env, HOLIDAY_DONE).catch(() => "");
  if (String(done) === ref) return { skipped: "تمام شده" };
  return runHolidayNotice(env, now, shard);
}

/**
 * ادامه‌ی خلاصه‌ی نیمه‌کاره - برای کرانِ هر پنج دقیقه.
 *
 * اول یک ردیفِ تنظیمات را می‌خواند و اگر خلاصه‌ی امروز تمام شده باشد،
 * بی‌آنکه به جدولِ مشترکین دست بزند برمی‌گردد. بدونِ این، هر پنج دقیقه
 * یک کوئری روی دو هزار ردیف اجرا می‌شد - همان بی‌احتیاطی که یک بار سقفِ
 * روزانه‌ی D1 را پر کرد.
 */
export async function drainDailyDigest(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  // پنجره‌ی امروز. توضیحش کنارِ DIGEST_OPENS_AT و DIGEST_CLOSES_AT است.
  const hhmm = tehranHhmm(now);
  if (hhmm < DIGEST_OPENS_AT) return { skipped: "هنوز ۷:۳۰ نشده" };
  if (hhmm >= DIGEST_CLOSES_AT) return { skipped: "پنجره‌ی امروز بسته شده" };
  const ref = digestRef(now);
  const done = await readConfig(env, DIGEST_DONE).catch(() => "");
  if (String(done) === ref) return { skipped: "تمام شده" };
  return runDailyDigest(env, now, shard);
}

// ─── ۲) هشدار قبل از خبر ────────────────────────────────────────────

/**
 * متنِ هشدارِ پیش از خبر.
 *
 * سه چیز اینجا عمدی است:
 *
 * ۱. هیچ جمله‌ای درباره‌ی وضعیتِ بازار نمی‌آید. خطِ پایانیِ قبلی -
 *    «تا انتشار عدد، حجم و اسپرد غیرعادی می‌شود» - هم قطعی حرف می‌زد
 *    درباره‌ی چیزی که قطعی نیست، و هم برای کسی که این اصطلاح‌ها را
 *    نمی‌شناسد بی‌معنی بود. هشدار کارش خبر دادن است، نه تفسیرِ بازار.
 *
 * ۲. شمارشِ معکوس در سرتیتر است نه یک خطِ جدا. پیش از این هم بالا
 *    «تا چند دقیقه دیگر» نوشته می‌شد و هم پایین‌تر «۱۵ دقیقه دیگر» -
 *    یک چیز، دو بار.
 *
 * ۳. پرچمِ ارز آمده. از وقتی کاربر می‌تواند چند ارز را روشن کند،
 *    هشداری که نمی‌گوید مالِ کدام ارز است نصفِ اطلاعات را جا می‌گذارد.
 */
export function buildAlertText(event, minutesLeft) {
  // پشتیبانِ متنِ ساده‌ی پیامِ گروهی هم هست: اگر فهرست بگیرد، هر خبر را
  // با همین قالب می‌سازد و با یک خطِ جداکننده به هم می‌چسباند. آرگومانِ
  // دوم آنجا زمانِ مبناست نه دقیقه، چون هر خبر شمارشِ خودش را دارد.
  if (Array.isArray(event)) {
    const list = event;
    if (list.length === 0) return "";
    const head =
      list.length === 1
        ? ""
        : RLM + "🔔 " + toPersianDigits(list.length) + " خبر مهم در راه است\n\n";
    const each = list.map((e) => {
      const left = e.time ? etMinutesUntilNow(e.date, e.time) : 0;
      const one = buildAlertText(e, left);
      // سرتیترِ «🔔 خبر مهم» زیرِ سرتیترِ گروه تکراری است؛ همان خط به یک
      // شمارشِ معکوسِ ساده تبدیل می‌شود.
      return list.length === 1
        ? one
        : one.replace(/^.*?🔔 خبر مهم — /, RLM + "⏳ ");
    });
    return head + each.join("\n\n" + RLM + "—\n\n");
  }

  const e = event;
  const emoji = IMPORTANCE_EMOJI[e.importance] || "⚪";
  const when = e.time ? etTimeToTehran(e.date, e.time) : "";
  const flag = currencyFlag(e.currency);

  const lines = [
    RLM + "🔔 خبر مهم — " + toPersianDigits(Math.max(1, minutesLeft)) + " دقیقه دیگر",
    "",
    RLM + (flag ? flag + " " : "") + emoji + " " + (e.event_fa || e.event),
  ];
  // ساعت لاتین، مثل نماهای تقویم. مدتِ «چند دقیقه دیگر» بالا فارسی
  // مانده - آن مدت است نه ساعت.
  if (when) lines.push(RLM + "⏰ " + when + " به وقت تهران");

  // رقم‌ها فارسی می‌شوند، مثل ساعت و مثل بقیه‌ی ربات؛ پیش از این «0.3%»
  // لاتین کنارِ «۱۶:۰۰» فارسی می‌نشست.
  if (e.forecast || e.previous) {
    lines.push("");
    lines.push(RLM + "پیش‌بینی: " + toPersianDigits(e.forecast || "-"));
    lines.push(RLM + "قبلی: " + toPersianDigits(e.previous || "-"));
  }
  return lines.join("\n");
}

/**
 * کیبوردِ پیامِ هشدار و نتیجه.
 *
 * تابع است نه ثابت، چون حالا یک دکمه به خودِ رویداد گره خورده. تا امروز
 * این دو پیام - «۱۵ دقیقه تا فلان خبر» و «عدد منتشر شد» - هیچ راهی برای
 * پرسیدن نداشتند: کاربر دقیقاً در لحظه‌ای که بیشترین سؤال را دارد باید
 * مینی‌اپ را باز می‌کرد. موتورِ توضیحِ تک‌خبر روی سرور هست؛ فقط این دکمه
 * نبود که به آن وصل شود.
 *
 * در دکمه نشانه‌ی کوتاه می‌رود نه شناسه‌ی رویداد: callback_data سقفِ ۶۴
 * بایت دارد و شناسه‌های بلند از آن رد می‌شوند - که یعنی تلگرام کلِ پیام
 * را رد می‌کند و هشدار بی‌صدا ارسال نمی‌شود، آن هم فقط برای بعضی خبرها.
 */
/**
 * نامِ خبر روی دکمه.
 *
 * وقتی یک پیام چند خبر دارد، «توضیح این خبر» دیگر معنی ندارد - باید
 * معلوم باشد کدام. نام کوتاه می‌شود چون دکمه‌ی بلند در تلگرام وسطش را
 * می‌خورد و کاربر هیچ‌کدام را کامل نمی‌بیند.
 */
function buttonName(e) {
  const name = String(e.event_fa || e.event || "").trim();
  return name.length > 26 ? name.slice(0, 25) + "…" : name;
}

function alertKeyboard(list) {
  const events = (Array.isArray(list) ? list : [list]).filter((e) => e && e.event_id);
  const rows = [];
  if (events.length === 1) {
    rows.push([{ text: "🤖 توضیح این خبر", callback_data: "ECON_X_" + eventToken(events[0].event_id), style: "primary" }]);
  } else {
    // چهار تا، نه همه: کیبوردِ ده‌ردیفه خودش یک دیوارِ دیگر است. بقیه از
    // «اخبار امروز» در دسترس‌اند، و ترتیب زمانی است پس این چهار تا
    // نزدیک‌ترین‌هایند.
    for (const e of events.slice(0, 4)) {
      rows.push([{ text: "🤖 " + buttonName(e), callback_data: "ECON_X_" + eventToken(e.event_id), style: "primary" }]);
    }
  }
  rows.push([{ text: "📅 اخبار امروز", callback_data: "ECON_TODAY", style: "primary" }]);
  rows.push([{ text: "🔔 تنظیمات هشدار", callback_data: "ECON_ALERT_SETTINGS" }]);
  return { inline_keyboard: rows };
}

/** کلیدِ دفترِ هشدار: لحظه‌ی خبر، نه خودِ خبر. */
export function alertGroupRef(e) {
  return "G:" + e.date + " " + e.time;
}

/**
 * رویدادهایی که همین حالا در پنجره‌ی هشدارِ این کاربر هستند.
 *
 * شرط `<=` است نه تساوی: کران هر چند دقیقه یک‌بار اجرا می‌شود و ممکن
 * است دقیقاً روی دقیقه‌ی ۱۵ نیفتد. دفترِ ارسال جلوی تکرار را می‌گیرد،
 * پس بازه‌ی بازتر فقط یعنی هشدار حداکثر چند دقیقه زودتر می‌رسد - که از
 * نرسیدنش بی‌نهایت بهتر است.
 */
// روز رویداد جداگانه فیلتر نمی‌شود: خودِ فاصله این کار را می‌کند -
// دیروز عددی منفی می‌دهد و فردا عددی بزرگ‌تر از هر پنجره‌ی مجاز. یک
// شرط تاریخِ اضافه فقط جایی بود که ساعتِ دو محاسبه می‌توانست از هم جدا
// بیفتد.
export function dueEvents(events, sub) {
  const levels = new Set(parseLevels(serializeLevels(sub && sub.alert_levels)));
  // فاز یک: هشدار و اعلامِ نتیجه فقط برای دلار.
  //
  // نه به این دلیل که سخت است - به این دلیل که کاربری که نُه ارز را
  // روشن کرده، روزی سی-چهل هشدار می‌گیرد و ربات را بلاک می‌کند. سقف و
  // انتخابِ ارزِ هشدار کارِ فاز دوم است؛ تا آن موقع رفتار دقیقاً همان
  // چیزی می‌ماند که مشترک‌ها امروز به آن عادت دارند.
  return filterByCurrencies(events, DEFAULT_CURRENCIES)
    .filter((e) => {
      if (!e.date || !e.time) return false;
      if (e.status === "released") return false;
      // سطح‌هایی که خودِ کاربر انتخاب کرده.
      //
      // پیش از این دو خطِ ثابت بود: «کم‌اهمیت هرگز» و «مهم فقط اگر
      // کلیدِ show_low_importance روشن باشد». یعنی پیش‌فرض عملاً «فقط
      // خیلی مهم» بود، در حالی که متنِ تنظیمات «مهم و خیلی مهم» وعده
      // می‌داد - و همان شکاف بود که سخنرانی‌های نارنجی را بی‌صدا
      // می‌انداخت.
      if (!levels.has(e.importance)) return false;
      const left = etMinutesUntilNow(e.date, e.time);
      return left > 0 && left <= sub.alert_minutes;
    })
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

/**
 * چند مشترک در هر دور نگاه می‌شوند.
 *
 * از بودجه‌ی ارسال بیشتر است و باید باشد: در هر لحظه فقط بخشی از
 * مشترکین موعدشان رسیده - آن‌هایی که فاصله‌ی انتخابی‌شان با این خبر
 * جور است. وقتی تنها پنجره‌ی باز، پنجره‌ی ۶۰ دقیقه باشد، یعنی حدودِ
 * یک‌ششمِ فهرست. با صفحه‌ی هم‌اندازه‌ی بودجه، هر دور چند نفر می‌فرستاد
 * و دورها تمام نمی‌شدند.
 *
 * ۱۲۰ یعنی هر دور کلِ فهرستِ یک شارد در حدودِ پنج دور پیموده می‌شود، و
 * هیچ دوری هم آن‌قدر بزرگ نیست که از بودجه‌ی ارسال رد شود و نیمه‌کاره
 * بماند.
 */
const ALERT_PAGE = 120;

/**
 * هشدارها - یک پیام برای هر کاربر، نه یکی برای هر خبر.
 *
 * دفترِ ارسال هنوز خبر-به-خبر است و باید باشد: تضمینِ «هیچ خبری دو بار
 * اعلام نمی‌شود» از همان‌جا می‌آید. چیزی که عوض شده جای ارسال است -
 * اول همه‌ی خبرهای تازه‌ی این کاربر claim می‌شوند، بعد یک پیام برای همه‌شان
 * می‌رود.
 *
 * اگر ارسال به سقفِ زیرساخت بخورد، claimِ همه‌شان پس گرفته می‌شود؛ وگرنه
 * آن خبرها برای همیشه «فرستاده شده» علامت می‌خوردند بی‌آنکه رفته باشند.
 *
 * ─── تکه‌بندی و نشانگر ───────────────────────────────────────────
 *
 * `shard` و `after` برای درِینِ موازی‌اند. بی‌آن‌ها رفتار همان قبلی است:
 * از اولِ فهرست، تا سقفِ بودجه - که برای کرانِ خودِ ورکر درست است، چون
 * فقط تورِ ایمنی است.
 *
 * نشانگر برخلافِ خلاصه در دیتابیس ذخیره نمی‌شود، بلکه در پاسخ
 * برمی‌گردد و ورک‌فلو خودش آن را به دورِ بعد می‌دهد. دلیلش این است که
 * هشدار `ref`ِ یکتای روزانه ندارد - هر مشترک بسته به فاصله‌ی انتخابی‌اش
 * خبرِ دیگری در موعد دارد - پس کلیدِ «نشانگرِ امروز» معنایی ندارد و
 * پاک کردنش هم جایی ندارد. با نشانگرِ داخلِ پاسخ، هر دورِ درِین یک
 * پیمایشِ کاملِ تازه است و هیچ حالتی برای پاک کردن نمی‌ماند.
 */
export async function runAlertSweep(env, now = new Date(), shard = null, after = null, dry = false) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };
  if (isWeekend(now)) return { skipped: "آخر هفته" };

  await ensureSentSchema(env);
  // هشدار حداکثر یک ساعت جلوتر را می‌بیند (بلندترین گزینه ۶۰ دقیقه است)،
  // پس سه روز بیش از کافی است.
  const [events, labelRows] = await Promise.all([
    readEventsRange(env, dayOffset(-1), dayOffset(1)),
    readLabels(env),
  ]);
  if (events.length === 0) return { sent: 0, failed: 0, blocked: 0 };

  // فهرستِ مشترکین فقط وقتی خوانده می‌شود که واقعاً خبری در راه باشد.
  //
  // این کران هر پنج دقیقه اجرا می‌شود - ۲۸۸ بار در روز - ولی در بیشترِ
  // آن دفعات هیچ خبری در بازه‌ی هشدار نیست. پیش از این، هر بار کلِ
  // جدولِ مشترکین خوانده می‌شد تا معلوم شود کاری نیست.
  // اجرای خشک این دروازه را رد می‌کند، و فقط این یکی را: هدفش همین است
  // که مسیرِ صفحه‌بندی را روی جدولِ واقعی راه بیندازد در روزی که هیچ
  // خبری در بازه نیست. هیچ claimی و هیچ ارسالی در آن حالت انجام
  // نمی‌شود، پس بی‌خطر است.
  //
  // فقط خبرهای دلار شمرده می‌شوند، چون dueEvents هم فقط برای دلار هشدار
  // می‌سازد. بی‌این صافی، یک خبرِ یورو یا ین در ساعتِ پیشِ رو کلِ جدول را
  // هر پنج دقیقه می‌خواند و به هیچ‌کس چیزی نمی‌فرستاد (۵ نوامبر: ۶۸ بار و
  // ۲۴۵ هزار خواندن تا ۰۵:۴۰ UTC).
  if (!dry && !anyEventWithin(filterByCurrencies(events, DEFAULT_CURRENCIES), MAX_ALERT_MINUTES)) {
    return { sent: 0, failed: 0, blocked: 0 };
  }

  // بی‌شارد و بی‌نشانگر همان رفتارِ قبلی: از اولِ فهرست. با شارد یا
  // نشانگر، یک صفحه از همان‌جایی که دورِ قبل ایستاد.
  //
  // مقایسه با null و نه با truthy: نشانگرِ دورِ اولِ درِین رشته‌ی خالی
  // است، و `!!""` دروغ است - یعنی اولین دورِ هر درِین بی‌صفحه‌بندی
  // می‌افتاد و بی‌نشانگر برمی‌گشت، و حلقه‌ی ورک‌فلو جا نمی‌افتاد.
  const paged = !!shard || (after !== null && after !== undefined);
  const subs = paged
    ? await listActiveSubscribersPage(env, ALERT_PAGE, shard, after || null)
    : await listActiveSubscribers(env);

  const stats = { sent: 0, failed: 0, blocked: 0 };
  let budget = SEND_BUDGET;
  let stopped = false;
  let grouped = 0;
  // آخرین مشترکی که **نگاه** شد، نه آخرین کسی که پیام گرفت. چرایش بالای
  // listActiveSubscribersPage نوشته است: اگر نشانگر فقط روی فرستاده‌ها
  // جلو برود، ردیف‌های بی‌موعد هر دور دوباره خوانده می‌شوند و پیمایش
  // هیچ‌وقت به آخر نمی‌رسد.
  let cursor = after ? String(after) : "";
  let looked = 0;

  let wouldSend = 0;

  for (const s of subs) {
    const due = dueEvents(events, s);
    // اجرای خشک: فقط می‌شمارد و نشانگر را جلو می‌برد. نه claim، نه
    // ارسال، نه هیچ نوشتنی.
    if (dry) {
      if (due.length > 0) wouldSend++;
      cursor = s.telegram_user_id;
      looked++;
      continue;
    }
    if (due.length === 0) {
      cursor = s.telegram_user_id;
      looked++;
      continue;
    }

    // بودجه که تمام شد، بقیه دست‌نخورده می‌مانند: هنوز چیزی claim نشده،
    // پس اجرای پنج دقیقه‌ی بعد - یا دورِ بعدِ درِین - دقیقاً از همین‌جا
    // ادامه می‌دهد. نشانگر عمداً جلو نمی‌رود.
    if (budget <= 0) {
      stopped = true;
      break;
    }

    // فقط خبرهایی که هنوز برای این کاربر نرفته‌اند. claim پیش از ارسال
    // انجام می‌شود - دلیلش بالای claim نوشته است.
    //
    // claim به‌ازای «لحظه‌ی خبر» است، نه هر خبر. ۱۵ اکتبر شش خبر هم‌زمان
    // (۱۲:۳۰) برای هر نفر شش ردیفِ دفتر می‌ساخت - هر ردیف سه نوشتن (جدول،
    // کلیدِ اصلی، ایندکسِ sent_at) - و نوشتنِ روز به ۱۲۳٬۸۲۴ رسید. حالا
    // خبرهای هم‌زمان یک ردیف دارند و یک پیام می‌روند، همان‌طور که قبلاً هم
    // یک پیامِ تجمیعی می‌رفت. اگر لحظه‌ای که قبلاً claim شده خبرِ تازه‌ای
    // بگیرد، آن خبر نمی‌رود (کم‌فرستادن، نه دوباره‌فرستادن).
    const groups = new Map();
    for (const e of due) {
      const g = alertGroupRef(e);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(e);
    }
    const fresh = [];
    const claimed = [];
    for (const [g, evs] of groups) {
      if (await claim(env, "alert", g, s.telegram_user_id)) {
        claimed.push(g);
        fresh.push(...evs);
      }
    }
    if (fresh.length === 0) {
      cursor = s.telegram_user_id;
      looked++;
      continue;
    }

    budget--;
    const markdown = buildAlertMarkdown(fresh, labelRows);
    const keyboard = alertKeyboard(fresh);
    let r;
    try {
      r = await tg(env, "sendRichMessage", {
        chat_id: s.chat_id,
        rich_message: { markdown },
        reply_markup: keyboard,
      });
      // sendRichMessage متدی غیرمستند است. اگر روزی برداشته شود، هشدارها
      // بی‌صدا قطع می‌شدند - و هشدارِ نرسیده بدترین خرابیِ این رباتست. پس
      // متنِ ساده پشتِ سرش می‌ایستد.
      if (!r.ok && !r.blocked) {
        r = await tg(env, "sendMessage", {
          chat_id: s.chat_id,
          text: buildAlertText(fresh, now),
          reply_markup: keyboard,
        });
      }
    } catch {
      for (const g of claimed) {
        await unclaim(env, "alert", g, s.telegram_user_id).catch(() => {});
      }
      // نشانگر عمداً جلو نمی‌رود: این نفر هنوز پیامی نگرفته و دورِ بعد
      // باید دوباره سراغش برود.
      stopped = true;
      break;
    }

    cursor = s.telegram_user_id;
    looked++;

    if (r.ok) {
      stats.sent++;
      grouped += fresh.length;
    } else if (r.blocked) {
      stats.blocked++;
      await markBlocked(env, s.telegram_user_id);
    } else stats.failed++;
  }

  // «تمام شد» یعنی صفحه تا آخر خوانده شد و از آن کوتاه‌تر هم بود - یعنی
  // دیگر ردیفی پشتش نیست. اگر بودجه تمام شده باشد، تمام نشده‌ایم.
  const done = paged ? !stopped && subs.length < ALERT_PAGE : undefined;

  return {
    ...stats,
    events: grouped,
    throttled: stopped,
    ...(dry ? { dry: true, would_send: wouldSend } : {}),
    // کدام پنجره‌ها همین حالا باز شده‌اند. کرانِ ورکر از همین تصمیم
    // می‌گیرد که درِینِ موازی را صدا بزند یا نه.
    //
    // اینجا برمی‌گردد و نه در خودِ کران، تا جدولِ رویدادها دو بار
    // خوانده نشود: کران و این تابع هم‌زمان اجرا می‌شوند و ممکن است هر
    // دو کش را از دست بدهند.
    ...(paged ? { cursor, looked, page: subs.length, done } : { opening: alertTiersOpening(events) }),
  };
}

// ─── ۳) اعلام نتیجه ─────────────────────────────────────────────────

export function buildResultText(e, labels) {
  const emoji = IMPORTANCE_EMOJI[e.importance] || "⚪";
  let text = RLM + "📊 عدد منتشر شد\n\n";
  text += RLM + emoji + " " + (e.event_fa || e.event) + "\n";
  text += RLM + "واقعی: " + (e.actual || "-") + "\n";
  text += RLM + "پیش‌بینی: " + (e.forecast || "-") + "\n";
  text += RLM + "قبلی: " + (e.previous || "-") + "\n";

  // خوانشِ دلار همان جدول برچسب‌هاست که نمای امروز هم از آن استفاده
  // می‌کند؛ اگر برچسبی برای این رویداد نباشد، هیچ خوانشی نوشته نمی‌شود
  // - حدس زدنِ جهت بدتر از نگفتن است.
  const read = labels && labels.usdRead ? labels.usdRead(e) : null;
  if (read) {
    text += "\n" + RLM + "💵 " + read.arrow + " " + read.word + " — " + read.icon + " " + read.verdict + "\n";
    text += RLM + "این یک برداشت کلی است، نه سیگنال معاملاتی.";
  }
  return text;
}

export async function runResultSweep(env, now = new Date()) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  // پیش‌فرض خاموش - دلیلش کنارِ RESULT_FLAG نوشته است.
  if (!(await resultNoticeEnabled(env))) return { skipped: "اعلام نتیجه خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };
  if (isWeekend(now)) return { skipped: "آخر هفته" };

  await ensureSentSchema(env);
  // پنجره‌ی این نما سه ساعتِ گذشته است، پس همان سه روز کافی است.
  const [events, labelRows] = await Promise.all([
    readEventsRange(env, dayOffset(-1), dayOffset(1)),
    readLabels(env),
  ]);

  // پنجره‌ی سه ساعت پس از انتشار. دفترِ ارسال به‌تنهایی کافی نبود: کسی
  // که همین امروز مشترک می‌شود در دفتر هیچ ردیفی ندارد و بدون این
  // پنجره، عددهای دیروز و پریروز یک‌جا برایش می‌رفت.
  // فاز یک: اعلامِ نتیجه هم فقط دلار - به همان دلیلِ هشدارها.
  const released = filterByCurrencies(events, DEFAULT_CURRENCIES).filter((e) => {
    // «کم‌اهمیت» اینجا هم کنار گذاشته می‌شود، ولی به‌عنوانِ صافیِ
    // ارزان و سراسری: انتخابِ خودِ کاربر پایین‌تر و به‌ازای هر نفر
    // اعمال می‌شود.
    if (e.status !== "released" || !e.actual || !e.time || e.importance === "low") return false;
    const since = -etMinutesUntilNow(e.date, e.time);
    return since >= 0 && since <= 180;
  });
  if (released.length === 0) return { sent: 0, failed: 0, blocked: 0 };

  const helpers = makeLabelHelpers(labelRows);

  const subs = await listActiveSubscribers(env);
  const stats = { sent: 0, failed: 0, blocked: 0 };
  let budget = SEND_BUDGET;
  let stopped = false;

  outer: for (const s of subs) {
    const levels = new Set(parseLevels(serializeLevels(s.alert_levels)));
    for (const e of released) {
      // همان سطح‌هایی که برای هشدار انتخاب شده‌اند، برای اعلامِ نتیجه هم.
      //
      // دو فهرستِ جدا نشد: کسی که «مهم» را برای هشدار نمی‌خواهد، عددِ
      // همان خبر را هم نمی‌خواهد - و دو کلید برای یک تصمیم، فقط یک
      // تنظیمِ دیگر است که باید توضیح داده شود.
      if (!levels.has(e.importance)) continue;
      if (budget <= 0) {
        stopped = true;
        break outer;
      }
      budget--;
      // عدد در کلید است: اگر منبع عدد را تصحیح کند، اعلام تازه می‌رود.
      const ref = e.event_id + "|" + e.actual;
      const res = await claimAndSend(
        env,
        "result",
        ref,
        s,
        () => ({
          method: "sendMessage",
          payload: { text: buildResultText(e, helpers), reply_markup: alertKeyboard(e) },
        }),
        stats
      );
      if (res === "skip") budget++;
      if (res === "stop") {
        stopped = true;
        break outer;
      }
    }
  }

  return { ...stats, throttled: stopped };
}

// وضعیت، برای /health و برای اینکه بشود بدون باز کردن D1 فهمید فرستنده
// روشن است یا نه.
export async function senderStatus(env) {
  const enabled = await senderEnabled(env).catch(() => false);
  const resultNotice = await resultNoticeEnabled(env).catch(() => false);
  // از روزِ جابه‌جایی به بعد، دفترِ ارسال فقط هشدار و اعلامِ نتیجه را
  // نگه می‌دارد؛ پیام‌های روزانه ثبتشان روی ردیفِ خودِ کاربر است. پس
  // این عدد دیگر «همه‌ی پیام‌ها» نیست و نامش هم همین را می‌گوید -
  // تعدادِ خلاصه‌ی امروز در خودِ digest پایین‌تر هست.
  let alerts24h = 0;
  try {
    await ensureSentSchema(env);
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM econ_sent_log WHERE sent_at >= ?`)
      .bind(cutoff)
      .first();
    alerts24h = (row && row.n) || 0;
  } catch {
    alerts24h = 0;
  }
  // مخاطبِ خلاصه و اینکه امروز به چند نفرشان رسیده. بدونِ این عدد، تنها
  // راهِ فهمیدنِ «برای چند نفر نرفته» شمردنِ دستی در D1 بود.
  let digest = null;
  try {
    digest = await digestAudienceStats(env, "digest", digestRef());
    // «در صف» از شمارشِ دقیقِ همان کوئریِ مخاطب می‌آید (unsent). فرمولِ
    // تقریبیِ قبلی کسی را که بعد از دریافت بلاک کرد دو بار کم می‌کرد و
    // با Math.max به صفر می‌بُرید - پس «۰» می‌توانست ۰ تا چند ده نفر
    // باشد. تقریبی نگه داشته می‌شود تا مقایسه ممکن باشد.
    digest.pending = digest.unsent;
    digest.pending_estimate = Math.max(
      0,
      digest.total - digest.blocked - digest.opted_out - digest.sent_today
    );
    // ثبتِ دسته‌ای (از ۸ نوامبر): کسانی که با دسته گرفته‌اند در ستونِ
    // sent_digest نیستند، پس شمارشِ بالا آن‌ها را «نگرفته» می‌بیند. عددِ
    // درست از برگه‌های شارد و عکسِ اول می‌آید.
    const ref = digestRef();
    const raw = await readConfig(env, snapKey("digest", ref)).catch(() => "");
    const rec = raw ? parseSnapshot(raw) : null;
    if (rec && (await batchOn(env))) {
      const b = await batchStats(env, "digest", ref);
      let remaining = 0;
      for (let s = 0; s < BATCH_SHARDS; s++) {
        const st = parseBatch(await readConfig(env, batchKey("digest", ref, s)).catch(() => ""));
        remaining += pickChunk(rec, { of: BATCH_SHARDS, index: s }, st.c, rec.ids.length).length;
        for (const r of st.left.concat(st.inf)) remaining += rangeIds(rec.ids, s, r.a, r.z).length;
      }
      digest.batch = { first_snapshot: rec.ids.length, ...b, remaining };
      // تک‌به‌تک‌ها (تازه‌واردها) در ستون‌اند؛ دسته‌ای‌ها در برگه.
      digest.sent_today += b.sent + b.blocked + b.failed;
      // «نگرفته» در شمارشِ ستونی = عکسِ اول + تازه‌واردهای نگرفته.
      digest.unsent = remaining + Math.max(0, digest.unsent - rec.ids.length);
      digest.pending = digest.unsent;
      digest.pending_estimate = Math.max(
        0,
        digest.total - digest.blocked - digest.opted_out - digest.sent_today
      );
    }
  } catch {
    digest = null;
  }
  return {
    enabled,
    result_notice: resultNotice,
    alerts_24h: alerts24h,
    weekend: isWeekend(),
    digest,
    // امروز عکسِ مخاطب چند بار و چرا ساخته شد (خالی = هنوز ساخته نشده).
    snapshot: await readSnapDiag(env).catch(() => null),
  };
}

// ─── ۴) سلامِ صبحِ دوشنبه ────────────────────────────────────────────
//
// یکی از سی متنی که آکادمی نوشته، هر دوشنبه صبح، به همه‌ی اعضای ربات.
//
// چرا با همان ماشینِ خلاصه: مخاطب همان است و مسئله‌ها هم همان - سقفِ
// subrequest، تکه‌بندی، دفترِ ارسال، و کاربری که ربات را بلاک کرده.
// تنها فرقش kind است.

export const GREET_FLAG = "econ_greet";

export async function greetEnabled(env) {
  const v = await readConfig(env, GREET_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

// کلیدِ «امروز را استثنائاً بفرست»: هر تاریخی که اینجا نوشته شود، همان
// روز حتی اگر دوشنبه نباشد سلام می‌رود. یک بار مصرف است چون با تاریخ
// سنجیده می‌شود، پس جا گذاشتنش خطری ندارد.
export const GREET_FORCE = "econ_greet_force";

const GREET_DONE = "econ_greet_done";

/**
 * شماره‌ی متنِ این هفته.
 *
 * از خودِ تاریخ درمی‌آید نه از یک شمارنده، و دلیلش عملی است: ارسال در
 * ده‌ها تکه و روی چند اجرای کران پخش می‌شود، و شمارنده‌ای که وسطِ کار
 * جلو برود یعنی نیمی از اعضا یک متن بگیرند و نیمی متنِ بعدی. با تاریخ،
 * هر تکه‌ی هر اجرا به یک عدد می‌رسد.
 *
 * مبدأ ۱۹۷۰-۰۱-۰۵ است - اولین دوشنبه‌ی تاریخِ یونیکس - پس تقسیم بر هفت
 * همیشه رُند درمی‌آید.
 */
// اولین دوشنبه‌ای که این پیام قرار است برود. بودنش برای این است که
// شماره از یک شروع شود؛ بدونِ آن، عددِ هفته‌ی مطلق یک جای دلخواهِ وسطِ
// فهرست را می‌داد.
export const GREET_EPOCH = "2026-09-14";

function weekOf(dateIso) {
  return Math.floor(Date.UTC(
    +dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10)
  ) / (7 * 86400000));
}

export function greetIndex(dateIso, total) {
  const week = weekOf(dateIso) - weekOf(GREET_EPOCH);
  return ((week % total) + total) % total;
}

/** متنِ همین هفته. جدا نوشته شده تا بشود بدونِ فرستادن دیدش. */
export function greetTextFor(dateIso) {
  return MONDAY_GREETINGS[greetIndex(dateIso, MONDAY_GREETINGS.length)];
}

/**
 * امروز روزِ سلام است؟
 *
 * سه شرط، و هر سه از خواسته‌ی آکادمی می‌آید:
 *
 *  ۱) دوشنبه باشد - یا کلیدِ «استثنائاً امروز» برای همین تاریخ نوشته
 *     شده باشد.
 *  ۲) ساعتِ تهران از ۸ گذشته باشد.
 *  ۳) خلاصه‌ی اقتصادیِ امروز کامل رفته باشد، تا دو پیام پشتِ سرِ هم
 *     نیفتند. اگر خلاصه تا ۹ تمام نشد، سلام دیگر منتظرش نمی‌ماند -
 *     وگرنه یک گیرِ نادر در خلاصه، سلام را هم تا هفته‌ی بعد می‌بلعد.
 */
async function greetDue(env, now) {
  const ref = digestRef(now);
  const forced = String(await readConfig(env, GREET_FORCE).catch(() => "")) === ref;
  if (!forced && tehranWeekday(now) !== "Mon") return { due: false, why: "دوشنبه نیست" };

  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  if (!forced && hhmm < "08:00") return { due: false, why: "هنوز ۸ نشده" };

  // پنجره‌ی امروز سرِ ۱۱ بسته می‌شود.
  //
  // بدونِ این، کلیدِ روشن یعنی کرانِ هر پنج دقیقه تا آخرِ شب سراغِ هر
  // عضوِ تازه‌ای می‌رود و سلامِ صبح را ظهر و شب هم می‌فرستد - چیزی که
  // آکادمی صریح گفت نباید بشود. کسی که بعد از بسته شدنِ پنجره عضو
  // می‌شود، سلامِ هفته‌ی بعد را می‌گیرد.
  //
  // ۱۱ و نه ۹: ورک‌فلو ۸:۳۰ می‌آید و بیست دقیقه‌ای تمام می‌کند، ولی
  // زمان‌بندِ گیت‌هاب گاهی عقب می‌افتد. این سه ساعت همان حاشیه است تا
  // کرانِ ورکر بتواند جای خالی‌اش را پر کند - و همچنان خیلی پیش از
  // ظهر بسته می‌شود.
  if (!forced && hhmm >= "11:00") return { due: false, why: "پنجره‌ی امروز بسته شد" };

  if (!forced && hhmm < "09:00") {
    const done = String(await readConfig(env, DIGEST_DONE).catch(() => ""));
    if (done !== ref) return { due: false, why: "منتظرِ تمام شدنِ خلاصه" };
  }
  return { due: true, ref };
}

export async function runWeeklyGreeting(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!(await greetEnabled(env))) return { skipped: "سلام خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };

  const gate = await greetDue(env, now);
  if (!gate.due) return { skipped: gate.why };

  await ensureSentSchema(env);
  const ref = gate.ref;

  const text = greetTextFor(ref);
  const round = await sendRound(env, "greet", ref, shard, now, async () => () => ({ method: "sendMessage", payload: { text } }));
  if (round.empty) {
    if (!shard && round.swept) await writeConfig(env, GREET_DONE, ref).catch(() => {});
    // همان قاعده‌ی runDailyDigest: برای یک شارد، تکه‌ی خالی یعنی
    // کارِ آن شارد تمام است. توضیحِ کامل آنجاست.
    return { sent: 0, failed: 0, blocked: 0, done: shard ? true : round.swept, throttled: round.throttled };
  }
  const { stats, stopped } = round;

  return { ...stats, index: greetIndex(ref, MONDAY_GREETINGS.length) + 1, chunk: round.chunk, throttled: false, stopped };
}

/** همان، ولی با پرچمِ «امروز تمام شد» - برای کرانِ هر پنج دقیقه. */
export async function drainWeeklyGreeting(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!(await greetEnabled(env))) return { skipped: "سلام خاموش" };
  const ref = digestRef(now);
  const done = await readConfig(env, GREET_DONE).catch(() => "");
  if (String(done) === ref) return { skipped: "تمام شده" };
  return runWeeklyGreeting(env, now, shard);
}

// ─── ۵) اطلاعیه‌ی موردی ──────────────────────────────────────────────
//
// یک متن، در چند روزِ مشخص، به همه‌ی اعضا. همان ماشینِ سلام با kind
// دیگر - پس همان تکه‌بندی، همان دفترِ ارسال، و همان درِینِ موازی.
//
// فرقش با سلام در دو چیز است: تاریخ‌ها دستی تعیین می‌شوند نه هفتگی، و
// پنجره‌ی روز تا شب باز می‌ماند. دومی عمدی است - اطلاعیه خبرِ فوری
// است و کسی که ظهر عضو شود هم باید ببیندش، برخلافِ سلامِ صبح.

export const NOTICE_FLAG = "econ_notice";

export async function noticeEnabled(env) {
  const v = await readConfig(env, NOTICE_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

const NOTICE_DONE = "econ_notice_done";

/**
 * امروز روزِ اطلاعیه است؟
 *
 * شرطِ «خلاصه رفته باشد» فقط پیش از ۹ صبح اعمال می‌شود، همان‌جا که دو
 * پیام می‌توانند پشتِ سرِ هم بیفتند. بعد از ۹ خلاصه مدت‌هاست رفته و
 * منتظر ماندن فقط تأخیر است.
 */
async function noticeDue(env, now) {
  const ref = digestRef(now);
  if (!NOTICE_DATES.includes(ref)) return { due: false, why: "امروز روزِ اطلاعیه نیست" };

  const hhmm = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(now);
  if (hhmm < "08:00") return { due: false, why: "هنوز ۸ نشده" };

  if (hhmm < "09:00") {
    const done = String(await readConfig(env, DIGEST_DONE).catch(() => ""));
    if (done !== ref) return { due: false, why: "منتظرِ تمام شدنِ خلاصه" };
  }
  return { due: true, ref };
}

export async function runNotice(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!(await noticeEnabled(env))) return { skipped: "اطلاعیه خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };

  const gate = await noticeDue(env, now);
  if (!gate.due) return { skipped: gate.why };

  await ensureSentSchema(env);
  const ref = gate.ref;
  // ثبتِ ارسال با تاریخ + دور: دورِ تازه در همان روز دوباره به همه می‌رسد.
  const round_ = noticeRoundFor(ref);
  const sendRef = round_ ? ref + "-" + round_ : ref;

  // متن از روی تاریخ برداشته می‌شود، نه یک متنِ ثابت: هر روزِ اطلاعیه
  // متنِ خودش را دارد. اگر روزی در جدول نباشد، gate بالاتر جلویش را
  // گرفته - این بررسی فقط برای آن است که هرگز رشته‌ی خالی نرود.
  // فوروارد از کانال: پیام همان شکلی می‌رسد که در کانال است، با
  // «Forwarded from» بالایش. فایل روی تلگرام می‌ماند و از ورکر رد
  // نمی‌شود، پس پادکست یا ویدیو همان‌قدر ارزان است که یک متن.
  //
  // اگر هر دو باشند (متن و فوروارد)، هر نفر اول متن را می‌گیرد و بلافاصله
  // بعدش پستِ کانال را - همیشه به همین ترتیب (sendOne).
  const fwd = noticeForwardFor(ref);
  const text = noticeTextFor(ref);
  if (!fwd && !text) return { skipped: "متنی برای امروز نیست" };

  // دکمه اختیاری است. سبز (success) چون اطلاعیه‌ی دکمه‌دار یک دعوت
  // است نه یک هشدار - و در این ربات سبز همان معنی را دارد.
  const btn = noticeButtonFor(ref);
  const markup = btn
    ? { inline_keyboard: [[{ text: btn.label, url: btn.url, style: "success" }]] }
    : null;

  const parts = [];
  if (text) parts.push({ method: "sendMessage", payload: markup ? { text, reply_markup: markup } : { text } });
  if (fwd) parts.push({ method: "forwardMessage", payload: { from_chat_id: fwd.from_chat_id, message_id: fwd.message_id } });
  const round = await sendRound(
    env, "notice", sendRef, shard, now,
    async () => () => (parts.length === 1 ? parts[0] : parts),
    parts.length
  );
  if (round.empty) {
    if (!shard && round.swept) await writeConfig(env, NOTICE_DONE, sendRef).catch(() => {});
    // همان قاعده‌ی runDailyDigest: برای یک شارد، تکه‌ی خالی یعنی
    // کارِ آن شارد تمام است. توضیحِ کامل آنجاست.
    return { sent: 0, failed: 0, blocked: 0, done: shard ? true : round.swept, throttled: round.throttled };
  }
  const { stats, stopped } = round;

  return { ...stats, chunk: round.chunk, throttled: false, stopped };
}

/** همان، ولی با پرچمِ «امروز تمام شد» - برای کرانِ هر پنج دقیقه. */
export async function drainNotice(env, now = new Date(), shard = null) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!(await noticeEnabled(env))) return { skipped: "اطلاعیه خاموش" };
  const ref = digestRef(now);
  const r = noticeRoundFor(ref);
  const done = await readConfig(env, NOTICE_DONE).catch(() => "");
  if (String(done) === (r ? ref + "-" + r : ref)) return { skipped: "تمام شده" };
  return runNotice(env, now, shard);
}
