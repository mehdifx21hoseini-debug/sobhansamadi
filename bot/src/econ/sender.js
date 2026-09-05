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

import { readEvents, readLabels } from "./store.js";
import { buildTodayMarkdown } from "./views.js";
import {
  listActiveSubscribers,
  listPendingSubscribers,
  listPendingAudience,
  digestAudienceStats,
} from "./subscribers.js";
import { makeLabelHelpers } from "./labels.js";
import { readConfig, writeConfig } from "../content/channel.js";
import {
  RLM,
  IMPORTANCE_EMOJI,
  etTimeToTehran,
  etMinutesUntilNow,
  toPersianDigits,
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
  if (!(await claim(env, kind, ref, sub.telegram_user_id))) return "skip";
  let r;
  try {
    const { method, payload } = build();
    r = await tg(env, method, { chat_id: sub.chat_id, ...payload });
  } catch {
    await unclaim(env, kind, ref, sub.telegram_user_id).catch(() => {});
    return "stop";
  }
  if (r.ok) stats.sent++;
  else if (r.blocked) stats.blocked++;
  else stats.failed++;
  return "ok";
}

export async function pruneSentLog(env) {
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  await env.DB.prepare(`DELETE FROM econ_sent_log WHERE sent_at < ?`).bind(cutoff).run();
}

// ─── ارسال ──────────────────────────────────────────────────────────

const API = (env, method) => "https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method;

async function tg(env, method, payload) {
  const res = await fetch(API(env, method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true };
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
  const [events, labels] = await Promise.all([readEvents(env), readLabels(env)]);
  return { markdown: buildTodayMarkdown(events, labels), weekend: false };
}

// کلیدی که می‌گوید خلاصه‌ی کدام روز کامل رفته است. یک ردیفِ تنظیمات،
// تا درِین هر پنج دقیقه بدونِ زدن به جدولِ دوهزارتاییِ مشترکین بفهمد
// کاری مانده یا نه.
const DIGEST_DONE = "econ_digest_done";

export function digestRef(now = new Date()) {
  // کلیدِ یکتاییِ خلاصه، تاریخِ تهران است نه UTC - وگرنه اجرای ۴:۳۰
  // بامداد UTC و روزِ تقویمیِ کاربر با هم جور در نمی‌آمدند.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(now);
}

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

  const pending = await listPendingAudience(env, "digest", ref, SEND_BUDGET, shard);
  if (pending.length === 0) {
    // پرچمِ پایان فقط از اجرای بی‌تکه زده می‌شود: خالی بودنِ یک تکه فقط
    // یعنی همان تکه تمام شده، نه کلِ فهرست.
    if (!shard) await writeConfig(env, DIGEST_DONE, ref).catch(() => {});
    return { sent: 0, failed: 0, blocked: 0, done: true };
  }

  const digest = await buildDigest(env, now);
  const build = () =>
    digest.weekend
      ? // متن آخر هفته دکمه‌ی تحلیل ندارد: خبری برای تحلیل وجود ندارد و
        // دکمه‌ای که به تحلیلِ هیچ می‌رسد، از نبودنش بدتر است.
        { method: "sendMessage", payload: { text: digest.text } }
      : {
          method: "sendRichMessage",
          payload: { rich_message: { markdown: digest.markdown }, reply_markup: AI_BUTTON },
        };

  const stats = { sent: 0, failed: 0, blocked: 0 };
  let stopped = false;
  for (let i = 0; i < pending.length; i++) {
    const res = await claimAndSend(env, "digest", ref, pending[i], build, stats);
    if (res === "stop") {
      stopped = true;
      break;
    }
    // مکث هر بیست پیام، برای نخوردن به سقفِ نرخِ تلگرام.
    if (i % 20 === 19) await new Promise((k) => setTimeout(k, 1000));
  }

  // پرچمِ پایان فقط در شاخه‌ی بالا زده می‌شود - جایی که کوئری واقعاً
  // دست خالی برگشته. تکه‌ی کوتاه‌تر از بودجه دلیلِ کافی نیست: وقتی چند
  // درِین موازی کار می‌کنند، ممکن است بقیه‌ی فهرست را همان لحظه
  // همکارهایش برداشته باشند و هنوز در حالِ فرستادن باشند. یک دورِ اضافه
  // ارزان است؛ جا ماندنِ چند نفر نه.
  return { ...stats, weekend: digest.weekend, chunk: pending.length, done: false, throttled: stopped };
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
  const ref = digestRef(now);
  const done = await readConfig(env, DIGEST_DONE).catch(() => "");
  if (String(done) === ref) return { skipped: "تمام شده" };
  return runDailyDigest(env, now, shard);
}

// ─── ۲) هشدار قبل از خبر ────────────────────────────────────────────

export function buildAlertText(e, minutesLeft) {
  const emoji = IMPORTANCE_EMOJI[e.importance] || "⚪";
  const when = e.time ? etTimeToTehran(e.date, e.time) : "";
  let text = RLM + "🔔 تا چند دقیقه دیگر یک خبر مهم منتشر می‌شود\n\n";
  text += RLM + emoji + " " + (e.event_fa || e.event) + "\n";
  if (when) text += RLM + "⏰ " + toPersianDigits(when) + " (به وقت تهران)\n";
  text += RLM + "⏳ " + toPersianDigits(Math.max(1, minutesLeft)) + " دقیقه دیگر\n";
  if (e.forecast || e.previous) {
    text += RLM + "پیش‌بینی: " + (e.forecast || "-") + "\n";
    text += RLM + "قبلی: " + (e.previous || "-") + "\n";
  }
  text += "\n" + RLM + "تا انتشار عدد، حجم و اسپرد غیرعادی می‌شود.";
  return text;
}

const ALERT_KEYBOARD = {
  inline_keyboard: [
    [{ text: "📅 اخبار امروز", callback_data: "ECON_TODAY", style: "primary" }],
    [{ text: "🔔 تنظیمات هشدار", callback_data: "ECON_ALERT_SETTINGS" }],
  ],
};

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
  return events
    .filter((e) => {
      if (!e.date || !e.time) return false;
      if (e.status === "released") return false;
      if (e.importance === "low") return false;
      if (e.importance === "medium" && !sub.show_low_importance) return false;
      const left = etMinutesUntilNow(e.date, e.time);
      return left > 0 && left <= sub.alert_minutes;
    })
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

export async function runAlertSweep(env, now = new Date()) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };
  if (isWeekend(now)) return { skipped: "آخر هفته" };

  await ensureSentSchema(env);
  const events = await readEvents(env);
  if (events.length === 0) return { sent: 0, failed: 0, blocked: 0 };

  const subs = await listActiveSubscribers(env);
  const stats = { sent: 0, failed: 0, blocked: 0 };
  let budget = SEND_BUDGET;
  let stopped = false;

  outer: for (const s of subs) {
    for (const e of dueEvents(events, s)) {
      // بودجه که تمام شد، بقیه دست‌نخورده می‌مانند: هیچ‌کس claim نشده،
      // پس اجرای پنج دقیقه‌ی بعد دقیقاً از همین‌جا ادامه می‌دهد.
      if (budget <= 0) {
        stopped = true;
        break outer;
      }
      budget--;
      // فاصله در کلید نیست: کاربر باید برای هر رویداد یک هشدار بگیرد،
      // نه یکی به ازای هر اجرای کران.
      const left = etMinutesUntilNow(e.date, e.time);
      const res = await claimAndSend(
        env,
        "alert",
        e.event_id,
        s,
        () => ({
          method: "sendMessage",
          payload: { text: buildAlertText(e, left), reply_markup: ALERT_KEYBOARD },
        }),
        stats
      );
      // claim تکراری بودجه نمی‌خورد؛ این هشدار قبلاً رفته.
      if (res === "skip") budget++;
      if (res === "stop") {
        stopped = true;
        break outer;
      }
    }
  }

  return { ...stats, throttled: stopped };
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
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };
  if (isWeekend(now)) return { skipped: "آخر هفته" };

  await ensureSentSchema(env);
  const [events, labelRows] = await Promise.all([readEvents(env), readLabels(env)]);

  // پنجره‌ی سه ساعت پس از انتشار. دفترِ ارسال به‌تنهایی کافی نبود: کسی
  // که همین امروز مشترک می‌شود در دفتر هیچ ردیفی ندارد و بدون این
  // پنجره، عددهای دیروز و پریروز یک‌جا برایش می‌رفت.
  const released = events.filter((e) => {
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
    for (const e of released) {
      if (e.importance === "medium" && !s.show_low_importance) continue;
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
          payload: { text: buildResultText(e, helpers), reply_markup: ALERT_KEYBOARD },
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
  let today = 0;
  try {
    await ensureSentSchema(env);
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const row = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM econ_sent_log WHERE sent_at >= ?`)
      .bind(cutoff)
      .first();
    today = (row && row.n) || 0;
  } catch {
    today = 0;
  }
  // مخاطبِ خلاصه و اینکه امروز به چند نفرشان رسیده. بدونِ این عدد، تنها
  // راهِ فهمیدنِ «برای چند نفر نرفته» شمردنِ دستی در D1 بود.
  let digest = null;
  try {
    digest = await digestAudienceStats(env, "digest", digestRef());
    digest.pending = Math.max(0, digest.total - digest.opted_out - digest.sent_today);
  } catch {
    digest = null;
  }
  return { enabled, sent_24h: today, weekend: isWeekend(), digest };
}
