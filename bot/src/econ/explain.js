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
import { readConfig } from "../content/channel.js";

export const EXPLAIN_FLAG = "econ_worker_explain";

export async function explainEnabled(env) {
  const v = await readConfig(env, EXPLAIN_FLAG).catch(() => "");
  return String(v).toLowerCase() === "on";
}

// همان ۱۵ دقیقه‌ی نود Is Cache Fresh. کوتاه‌تر یعنی هزینه‌ی بی‌مورد،
// بلندتر یعنی بعد از انتشار یک عدد، تحلیل هنوز از «منتشر نشده» حرف می‌زند.
const TTL_MS = 15 * 60 * 1000;

const SYSTEM_PROMPT = `تو دستیار توضیح‌دهندهٔ اخبار اقتصادی آکادمی سبحان صمدی هستی، مخصوص بخش «تقویم اقتصادی دلار».

قوانین اجباری:
1. فقط بر اساس «دادهٔ زمینه‌ای» که در ادامه داده شده توضیح بده; چیزی حدس نزن یا اختراع نکن.
2. اگر داده‌ای برای پاسخ به سوال در زمینه نبود، صریح بگو «این اطلاعات در منبع داده فعلی موجود نیست».
3. هدف تو فقط «آموزش» و «توضیح» است — هرگز توصیهٔ معاملاتی، سیگنال خرید/فروش، یا پیش‌بینی قطعی قیمت نده.
4. اگر کاربر مستقیم پرسید «الان بخرم؟» یا «این معامله رو بزنم؟» یا مشابه، is_trading_advice_request را true بگذار و در answer فقط توضیح آموزشی بده (نه توصیه).
5. می‌تونی رابطهٔ کلی/تاریخی بین یک شاخص (مثل CPI بالاتر از انتظار) و روند معمول دلار را توضیح بدهی، ولی صریح بگو این یک قانون قطعی یا پیش‌بینی همین مورد خاص نیست.
6. هرگز عدد Forecast/Actual اختراع نکن; فقط از دادهٔ زمینه‌ای استفاده کن.
7. لحن ساده، آموزشی و بی‌طرف باشد — نه هیجانی، نه تشویق‌کننده به معامله.
8. خروجی را دقیقاً مطابق JSON Schema داده‌شده و به زبان فارسی بازگردان.

9. قالب متن answer — این بخش مهم است و باید مو‌به‌مو رعایت شود:
   - سرصفحه، تاریخ و سلام ننویس. متن پیام سرصفحهٔ خودش را جدا دارد؛ اگر تو هم بنویسی تکراری می‌شود. مستقیم از اولین رویداد شروع کن.
   - در پایان هیچ جملهٔ سلب مسئولیت ننویس. آن هم جدا اضافه می‌شود.
   - هر رویداد را دقیقاً با این چهار خط بنویس و بین دو رویداد یک خط خالی بگذار:
     ⏰ <b>ساعت HH:MM</b> — <b>نام رویداد</b>
     یک جملهٔ کوتاه که می‌گوید این شاخص چه چیزی را اندازه می‌گیرد.
     🔹 قبلی: X | پیش‌بینی: Y | واقعی: Z   (فقط مقادیری که در زمینه هست)
     💡 یک نکتهٔ آموزشی کوتاه، حداکثر دو جمله.
   - رویدادها را به ترتیب ساعت مرتب کن.
   - اگر امروز هیچ رویدادی نبود، فقط یک جملهٔ کوتاه بنویس و تمام.
   - کل متن را زیر ۲۵۰۰ کاراکتر نگه دار.

10. تگ‌ها: فقط <b>, <i>, <u>, <code> مجاز است؛ هرگز از ** یا # یا <p> و <div> استفاده نکن. ایموجی فقط همان‌هایی که در قالب بالا آمده (⏰ 🔹 💡) به‌علاوهٔ 🔴 یا 🟡 برای اهمیت خبر.

دادهٔ زمینه‌ای (رویدادهای امروز برای دلار):
`;

const SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    is_trading_advice_request: { type: "boolean" },
  },
  required: ["answer", "is_trading_advice_request"],
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
 * پاسخ تازه یا کش‌شده.
 *
 * @returns {Promise<{answer: string, created_at: string, cached: boolean}>}
 */
export async function explainToday(env, { cacheKey, question, context }) {
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

  const data = await generateStructured(
    env,
    SYSTEM_PROMPT + String(context || ""),
    String(question || "اخبار مهم اقتصادی امروز رو برام خلاصه و توضیح بده."),
    SCHEMA
  );

  const answer = data && typeof data.answer === "string" ? data.answer.trim() : "";
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
