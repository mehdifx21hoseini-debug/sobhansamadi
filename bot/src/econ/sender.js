// فرستنده‌ی تقویم اقتصادی - همان سه پیامی که تا امروز n8n می‌فرستاد،
// حالا از داخل ورکر.
//
// چرا جابه‌جا شد: زمان‌بندهای n8n روی سروری بودند که مدام می‌خوابید، و
// خوابیدنش هیچ نشانه‌ای بیرون نمی‌داد جز اینکه پیام صبح نمی‌رسید. علاوه
// بر آن، ورک‌فلو هیچ منطقه‌ی زمانی تنظیم‌شده‌ای نداشت، پس «۸ صبح» عملاً
// معلوم نبود ۸ صبحِ کجاست. کرانِ کلادفلر همیشه UTC است و همین ابهام را
// برای همیشه می‌بندد: `30 4 * * *` دقیقاً ۸:۰۰ تهران است.
//
// سه پیام:
//   ۱) خلاصه‌ی روزانه   - هر روز ۸ صبح تهران
//   ۲) هشدار قبل از خبر - در فاصله‌ای که خود کاربر انتخاب کرده
//   ۳) اعلام نتیجه      - وقتی عدد واقعی منتشر شد
//
// شنبه و یکشنبه بازار بسته است: هشدار و نتیجه نمی‌رود و خلاصه جایش را
// به یک متن ثابت می‌دهد. سکوت کامل نه - دو روز خاموشیِ پشت‌سرهم عادتِ
// باز کردن ربات را می‌شکند.

import { readEvents, readLabels } from "./store.js";
import { buildTodayMarkdown } from "./views.js";
import { listActiveSubscribers } from "./subscribers.js";
import { makeLabelHelpers } from "./labels.js";
import { readConfig } from "../content/channel.js";
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

/**
 * یک پیام به فهرستی از مشترکین، با رعایت محدودیت نرخ تلگرام.
 *
 * تلگرام حدود ۳۰ پیام در ثانیه را تحمل می‌کند. با فهرست چند صد نفره
 * ارسالِ همزمانِ کامل یعنی 429 و از دست رفتن بخشی از پیام‌ها، پس در
 * دسته‌های کوچک فرستاده می‌شود.
 */
async function fanOut(env, targets, buildPayload) {
  const BATCH = 20;
  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (t) => {
        const { method, payload } = buildPayload(t);
        return tg(env, method, { chat_id: t.chat_id, ...payload });
      })
    );
    for (const r of results) {
      if (r.ok) sent++;
      else if (r.blocked) blocked++;
      else failed++;
    }
  }
  return { sent, failed, blocked };
}

// ─── ۱) خلاصه‌ی روزانه ──────────────────────────────────────────────

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

export async function runDailyDigest(env, now = new Date()) {
  if (!(await senderEnabled(env))) return { skipped: "خاموش" };
  if (!env.BOT_TOKEN) return { skipped: "BOT_TOKEN" };

  await ensureSentSchema(env);
  const digest = await buildDigest(env, now);

  // کلیدِ یکتاییِ خلاصه، تاریخِ تهران است نه UTC - وگرنه اجرای ۴:۳۰
  // بامداد UTC و روزِ تقویمیِ کاربر با هم جور در نمی‌آمدند.
  const ref = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(now);

  const subs = await listActiveSubscribers(env);
  const targets = [];
  for (const s of subs) {
    if (await claim(env, "digest", ref, s.telegram_user_id)) targets.push(s);
  }
  if (targets.length === 0) return { sent: 0, failed: 0, blocked: 0, weekend: digest.weekend };

  const stats = await fanOut(env, targets, () =>
    digest.weekend
      ? // متن آخر هفته دکمه‌ی تحلیل ندارد: خبری برای تحلیل وجود ندارد و
        // دکمه‌ای که به تحلیلِ هیچ می‌رسد، از نبودنش بدتر است.
        { method: "sendMessage", payload: { text: digest.text } }
      : {
          method: "sendRichMessage",
          payload: { rich_message: { markdown: digest.markdown }, reply_markup: AI_BUTTON },
        }
  );

  return { ...stats, weekend: digest.weekend };
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
  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (const s of subs) {
    for (const e of dueEvents(events, s)) {
      // فاصله در کلید نیست: کاربر باید برای هر رویداد یک هشدار بگیرد،
      // نه یکی به ازای هر اجرای کران.
      if (!(await claim(env, "alert", e.event_id, s.telegram_user_id))) continue;
      const left = etMinutesUntilNow(e.date, e.time);
      const r = await tg(env, "sendMessage", {
        chat_id: s.chat_id,
        text: buildAlertText(e, left),
        reply_markup: ALERT_KEYBOARD,
      });
      if (r.ok) sent++;
      else if (r.blocked) blocked++;
      else failed++;
    }
  }

  return { sent, failed, blocked };
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
  let sent = 0;
  let failed = 0;
  let blocked = 0;

  for (const s of subs) {
    for (const e of released) {
      if (e.importance === "medium" && !s.show_low_importance) continue;
      // عدد در کلید است: اگر منبع عدد را تصحیح کند، اعلام تازه می‌رود.
      const ref = e.event_id + "|" + e.actual;
      if (!(await claim(env, "result", ref, s.telegram_user_id))) continue;
      const r = await tg(env, "sendMessage", {
        chat_id: s.chat_id,
        text: buildResultText(e, helpers),
        reply_markup: ALERT_KEYBOARD,
      });
      if (r.ok) sent++;
      else if (r.blocked) blocked++;
      else failed++;
    }
  }

  return { sent, failed, blocked };
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
  return { enabled, sent_24h: today, weekend: isWeekend() };
}
