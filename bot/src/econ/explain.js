// تحلیل هوش مصنوعی تقویم، مستقیم از ورکر.
//
// این آخرین کاری بود که n8n در مسیر یک ضربه‌ی کاربر انجام می‌داد: ورکر
// زمینه را می‌ساخت، به n8n می‌داد، n8n همان را به Gemini می‌داد و جواب
// را برمی‌گرداند. یعنی یک رفت‌وبرگشت اضافه روی سروری که مدام می‌خوابید،
// دقیقاً وسط کاری که کاربر منتظرش ایستاده.
//
// پرامپت مو‌به‌مو همان چیزی است که نود Econ Explain Agent داشت. یک کلمه
// عوض شود، لحن و قالب جواب عوض می‌شود - و قالب اینجا تزئینی نیست: متن
// سرصفحه و سلب مسئولیت جدا اضافه می‌شوند، پس مدل نباید آن‌ها را بنویسد.

import { generateStructured } from "../ai/gemini.js";
import { readAiAnswer } from "./store.js";
import { renderDayAnalysis } from "./views.js";
import { readConfig } from "../content/channel.js";

export const EXPLAIN_FLAG = "econ_worker_explain";

export async function explainEnabled(env) {
  const v = await readConfig(env, EXPLAIN_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

// همان ۱۵ دقیقه‌ی نود Is Cache Fresh. کوتاه‌تر یعنی هزینه‌ی بی‌مورد،
// بلندتر یعنی بعد از انتشار یک عدد، تحلیل هنوز از «منتشر نشده» حرف می‌زند.
const TTL_MS = 15 * 60 * 1000;

const SYSTEM_PROMPT = `تو دستیار توضیح‌دهندهٔ اخبار اقتصادی آکادمی سبحان صمدی هستی.

برای هر رویدادی که در «دادهٔ زمینه‌ای» آمده، دقیقاً دو چیز می‌نویسی:
  what — یک جملهٔ کوتاه: این شاخص چه چیزی را اندازه می‌گیرد.
  tip  — یک نکتهٔ آموزشی، حداکثر دو جمله: چرا این رویداد برای بازار مهم است.

قوانین اجباری:
1. فقط بر اساس «دادهٔ زمینه‌ای» بنویس; چیزی حدس نزن یا اختراع نکن.
2. هرگز عدد ننویس — نه در what، نه در tip. اعداد جداگانه و خودکار به پیام اضافه می‌شوند و اگر تو هم بنویسی تکراری و متناقض می‌شود.
3. ساعت، نام رویداد، نام ارز و نشان اهمیت را هم ننویس؛ آن‌ها هم جدا اضافه می‌شوند.
4. هدف فقط آموزش است — هرگز توصیهٔ معاملاتی، سیگنال خرید/فروش، یا پیش‌بینی قطعی قیمت نده.
5. می‌توانی رابطهٔ کلی/تاریخی این شاخص با روند معمول ارزش را بگویی، ولی صریح بگو قانون قطعی نیست.
6. لحن ساده، آموزشی و بی‌طرف — نه هیجانی، نه تشویق‌کننده به معامله.
7. سلام، سرصفحه، تاریخ و جملهٔ سلب مسئولیت ننویس. همه جدا اضافه می‌شوند.
8. برای هر رویداد یک ورودی بده و id را دقیقاً همان «شناسه»‌ای بگذار که در زمینه آمده.
9. هیچ تگ HTML و هیچ ایموجی ننویس. متن ساده.
10. هر جمله را کوتاه نگه دار؛ کل what و tip هر رویداد زیر ۲۵۰ کاراکتر.

دادهٔ زمینه‌ای (رویدادهای مهم و متوسطِ امروز):
`;

// ─── توضیحِ یک خبر ──────────────────────────────────────────────────
//
// پرامپتِ بالا کلِ روز را می‌نویسد: فهرستی از رویدادها با ساعت و اعداد.
// این یکی درباره‌ی *یک* شاخص است و کارِ دیگری می‌کند - توضیح می‌دهد آن
// شاخص چیست، چرا مهم است و این عدد خاص چه می‌گوید. پس قالبِ «چهار خط
// برای هر رویداد» اینجا بی‌معنی است و عمداً تکرار نشده.
//
// قوانینِ ایمنی همان‌هاست و باید همان بماند: بدون توصیه‌ی معاملاتی،
// بدون عددِ اختراعی، بدون پیش‌بینیِ قطعی.
const EVENT_PROMPT = `تو دستیار توضیح‌دهندهٔ اخبار اقتصادی آکادمی سبحان صمدی هستی.

کاربر روی یک خبر اقتصادی مشخص زده و می‌خواهد همان یک خبر برایش توضیح داده شود.

قوانین اجباری:
1. فقط بر اساس «دادهٔ زمینه‌ای» توضیح بده; هیچ عددی اختراع نکن.
2. هدف فقط آموزش است — هرگز توصیهٔ معاملاتی، سیگنال خرید/فروش، یا پیش‌بینی قطعی قیمت نده.
3. اگر داده‌ای در زمینه نبود، صریح بگو در منبع داده موجود نیست.
4. می‌توانی رابطهٔ کلی/تاریخی این شاخص با روند معمول ارز را بگویی، ولی صریح بگو قانون قطعی نیست.
5. لحن ساده، آموزشی و بی‌طرف — نه هیجانی، نه تشویق‌کننده به معامله.

قالب answer — دقیقاً همین سه پاراگراف، بدون سرصفحه، بدون سلام، بدون سلب مسئولیت:
<b>این شاخص چیست</b>
دو تا سه جمله: چه چیزی را اندازه می‌گیرد و چه کسی منتشرش می‌کند.

<b>این عدد چه می‌گوید</b>
دو تا سه جمله دربارهٔ همین انتشار. اگر عدد واقعی هنوز منتشر نشده، دربارهٔ پیش‌بینی و قبلی حرف بزن و بگو هنوز منتشر نشده.

<b>چرا برای معامله‌گر مهم است</b>
دو تا سه جمله. رابطهٔ معمول با ارز مربوطه را اینجا بگو.

تگ‌ها: فقط <b> مجاز است. هرگز ** یا # یا <p> استفاده نکن. ایموجی نگذار.
کل متن را زیر ۹۰۰ کاراکتر نگه دار.

دادهٔ زمینه‌ای:
`;

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    is_trading_advice_request: { type: "boolean" },
  },
  required: ["answer", "is_trading_advice_request"],
};

// تحلیلِ روز دیگر یک رشته‌ی آماده نمی‌خواهد.
//
// وقتی از مدل «متنِ نهایی» خواسته می‌شد، چیدمان دستِ او بود و روی
// خروجیِ واقعی شکست: خط خالی بینِ رویدادها نمی‌گذاشت و چهار خط را به
// هم می‌چسباند. حالا فقط جمله می‌دهد و پیام را خودمان می‌چینیم.
const SCHEMA_DAY = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          what: { type: "string" },
          tip: { type: "string" },
        },
        required: ["id", "what", "tip"],
      },
    },
  },
  required: ["items"],
};

async function writeCache(env, cacheKey, answer, createdAt) {
  await env.DB
    .prepare(
      `INSERT INTO econ_ai_cache (cache_key, answer, created_at) VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           answer = excluded.answer, created_at = excluded.created_at`
    )
    .bind(String(cacheKey), String(answer), createdAt)
    .run();
}

/**
 * تحلیلِ روز: تازه یا کش‌شده.
 *
 * `rows` نقشه‌ی رویدادهاست که buildExplainPlan ساخته. وقتی بیاید، از
 * مدل فقط دو جمله برای هر رویداد خواسته می‌شود و خودِ پیام اینجا چیده
 * می‌شود - ساعت، نام، ارز، نشانِ اهمیت و اعداد همه از دادهٔ خودمان.
 *
 * بدونِ rows رفتارِ قدیمی می‌ماند: مدل یک متنِ آماده می‌دهد. آن مسیر
 * برای فراخوان‌هایی است که نقشه ندارند و عمداً دست‌نخورده مانده.
 *
 * @returns {Promise<{answer: string, created_at: string, cached: boolean}>}
 */
export async function explainToday(env, { cacheKey, question, context, rows }) {
  const key = String(cacheKey || "");

  if (key) {
    const row = await readAiAnswer(env, key);
    if (row && row.answer && row.created_at) {
      const age = Date.now() - new Date(row.created_at).getTime();
      if (age >= 0 && age < TTL_MS) {
        return { answer: row.answer, created_at: row.created_at, cached: true };
      }
    }
  }

  const structured = Array.isArray(rows);
  const data = await generateStructured(
    env,
    SYSTEM_PROMPT + String(context || ""),
    String(question || "اخبار مهم اقتصادی امروز رو برام خلاصه و توضیح بده."),
    structured ? SCHEMA_DAY : SCHEMA
  );

  let answer = "";
  if (structured) {
    // جمله‌ها به شناسه‌ی رویداد وصل می‌شوند. اگر مدل برای رویدادی چیزی
    // نگفته باشد، آن رویداد بدونِ جمله ولی با ساعت و عددش می‌آید -
    // ناقص بهتر از غایب است، و چیدمان هرچه باشد نمی‌شکند.
    const byKey = {};
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    for (const it of items) {
      if (it && it.id) byKey[String(it.id)] = { what: it.what, tip: it.tip };
    }
    answer = renderDayAnalysis(rows, byKey);
  } else {
    answer = data && typeof data.answer === "string" ? data.answer.trim() : "";
  }

  // پاسخ خالی نباید کش شود: یک ردیف خالی یعنی تا ۱۵ دقیقه‌ی بعد هر کسی
  // دکمه را بزند همان هیچ را می‌گیرد، بدون اینکه دلیلش معلوم باشد.
  if (!answer) throw new Error("پاسخ هوش مصنوعی خالی بود");

  const createdAt = new Date().toISOString();
  if (key) {
    // شکستِ نوشتن کش نباید پاسخِ آماده را از کاربر بگیرد.
    await writeCache(env, key, answer, createdAt).catch((err) =>
      console.error("کش تحلیل نوشته نشد:", err && err.message)
    );
  }

  return { answer, created_at: createdAt, cached: false };
}

/**
 * توضیحِ یک خبرِ مشخص.
 *
 * برخلاف explainToday اینجا TTL معنی ندارد. متنِ یک شاخص با گذشتِ زمان
 * کهنه نمی‌شود؛ چیزی که عوضش می‌کند انتشارِ عددِ واقعی است - و همان
 * داخلِ کلیدِ کش آمده. پس هر خبر حداکثر دو بار از مدل پرسیده می‌شود:
 * یک بار پیش از انتشار و یک بار بعدش، برای همه‌ی کاربران.
 *
 * @param {object} ev ردیفِ رویداد، همان شکلی که مینی‌اپ می‌سازد.
 */
export async function explainEvent(env, ev) {
  const id = String((ev && ev.event_id) || "");
  if (!id) throw new Error("رویداد بدون شناسه");

  const published = String((ev && ev.actual) || "").trim() !== "";
  const key = "ev:" + id + (published ? ":a" : ":p");

  const row = await readAiAnswer(env, key).catch(() => null);
  if (row && row.answer) return { answer: row.answer, created_at: row.created_at, cached: true };

  const context = [
    "نام شاخص (انگلیسی): " + (ev.en || ev.short || ""),
    ev.title ? "نام فارسی: " + ev.title : "",
    "ارز: " + (ev.currency || ""),
    "اهمیت: " + (ev.importance === "high" ? "زیاد" : ev.importance === "medium" ? "متوسط" : "کم"),
    ev.time_tehran ? "ساعت انتشار (تهران): " + ev.time_tehran : "",
    ev.previous ? "قبلی: " + ev.previous : "",
    ev.forecast ? "پیش‌بینی: " + ev.forecast : "",
    published ? "واقعی: " + ev.actual : "واقعی: هنوز منتشر نشده",
    // همان چیزی که اپ «Usual Effect» نشان می‌دهد. بدونِ این، مدل باید
    // جهت را از حافظه‌اش حدس بزند و گاهی برعکس می‌گوید - مثلاً مدعیانِ
    // بیکاری که عددِ کمترش خبرِ خوب است.
    ev.direction === "inverse"
      ? "جهت معمول: عددِ پایین‌تر از پیش‌بینی معمولاً به نفع این ارز است."
      : ev.direction
        ? "جهت معمول: عددِ بالاتر از پیش‌بینی معمولاً به نفع این ارز است."
        : "",
    ev.source ? "منبع: " + ev.source : "",
  ].filter(Boolean).join("\n");

  const data = await generateStructured(
    env,
    EVENT_PROMPT + context,
    "این خبر را برایم توضیح بده.",
    SCHEMA
  );

  const answer = data && typeof data.answer === "string" ? data.answer.trim() : "";
  if (!answer) throw new Error("پاسخ هوش مصنوعی خالی بود");

  const createdAt = new Date().toISOString();
  await writeCache(env, key, answer, createdAt).catch((err) =>
    console.error("کش توضیح خبر نوشته نشد:", err && err.message)
  );

  return { answer, created_at: createdAt, cached: false };
}

/**
 * نشانه‌ی کوتاهِ یک رویداد، برای دکمه‌های تلگرام.
 *
 * callback_data سقفِ ۶۴ بایت دارد و شناسه‌ی رویداد کوتاه نیست:
 * «FF_20260911_prelim_uom_consumer_sentiment» خودش ۴۱ بایت است و
 * نام‌های بلندتر از سقف رد می‌شوند. تلگرام در آن حالت کلِ پیام را رد
 * می‌کند - یعنی هشدار اصلاً ارسال نمی‌شود، بی‌صدا و فقط برای بعضی
 * خبرها. پس به‌جای خودِ شناسه یک هشِ هفت‌کاراکتری می‌رود و موقعِ کلیک
 * از روی همان فهرستی که ربات دارد پیدا می‌شود.
 *
 * FNV-1a سی‌ودو بیتی: نه رمزنگاری، فقط پخش‌شدنِ یکنواخت. فضای ۳۶^۷
 * برای چند صد رویدادِ هم‌زمان بیش از اندازه بزرگ است.
 */
export function eventToken(eventId) {
  let h = 0x811c9dc5;
  const s = String(eventId || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, "0").slice(-7);
}

/** رویدادی که این نشانه به آن اشاره می‌کند، یا null. */
export function eventByToken(events, token) {
  const want = String(token || "");
  const hits = (events || []).filter((e) => e && eventToken(e.event_id) === want);
  if (hits.length <= 1) return hits[0] || null;
  // برخوردِ هش تقریباً ناممکن است، ولی اگر شد نزدیک‌ترین تاریخ به امروز
  // درست‌ترین حدس است: دکمه روی پیامِ همین چند ساعت زده شده.
  const today = new Date().toISOString().slice(0, 10);
  return hits.sort((a, b) =>
    Math.abs(Date.parse(a.date) - Date.parse(today)) -
    Math.abs(Date.parse(b.date) - Date.parse(today)))[0];
}
