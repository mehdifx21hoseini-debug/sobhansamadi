// دریافت فرم منتورینگ سایت، مستقیم روی ورکر.
//
// تا امروز فرم سایت مستقیم به n8n می‌زد. نتیجه‌اش را دیدیم: n8n درخواست
// را رد کرد، وردپرس تلاش مجددی ندارد، و سه درخواست واقعی برای همیشه
// رفتند - سه هفته بی‌آنکه کسی بفهمد.
//
// حالا ورکر گیرنده است:
//
//   ۱. درخواست در D1 نوشته می‌شود، خام و دست‌نخورده. از این لحظه دیگر
//      گم نمی‌شود، حتی اگر بقیه‌ی مسیر بشکند.
//   ۲. یک ردیف در صندوق خروجی می‌نشیند تا به n8n برسد و در CRM دیده شود.
//   ۳. به سایت بلافاصله پاسخ می‌رود؛ معطل n8n نمی‌ماند.
//
// اعتبارسنجی هم عوض شده: نبودن نام دیگر دلیل دور ریختن نیست. یک درخواست
// بی‌نام هنوز شماره و پرسشنامه دارد و کاملاً قابل پیگیری است؛ دور ریختنش
// یعنی از دست دادن مشتری برای رعایت یک قاعده‌ی شکلی.

import { queueOutbound } from "../crmSync.js";
import { ensureCrmSchema } from "../crm/schema.js";

const DDL = `CREATE TABLE IF NOT EXISTS mentoring_intake (
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   received_at TEXT NOT NULL,
   full_name TEXT, phone TEXT, telegram_id TEXT, email TEXT,
   message TEXT, answers_json TEXT, raw_payload TEXT NOT NULL,
   forwarded INTEGER NOT NULL DEFAULT 0)`;

export async function ensureIntakeSchema(env) {
  await env.DB.prepare(DDL).run();
}

// ─── نگاشت فیلدهای فرم ────────────────────────────────────────────
//
// افزونه‌ی فرم وردپرس پاسخ‌ها را با شماره‌ی فیلد می‌فرستد، نه با نام:
// {"19":"نام","5":"0912..."}. این نگاشت از روی درخواست‌های واقعی ثبت‌شده
// در n8n استخراج و با دو نمونه‌ی مستقل تایید شده.
//
// به form_id بسته است: اگر فرم سایت بازسازی شود شماره‌ها جابه‌جا می‌شوند،
// و نگاشتِ اشتباه یعنی پاسخ‌ها زیر سوال‌های دیگر بایگانی شوند - از
// نگاشت‌نشدن بدتر. با form_id متفاوت، هر کلید زیر نام خودش می‌ماند.
const NUMERIC_FORMS = {
  "2": {
    19: "full_name",
    5: "phone",
    4: "telegram_id",
    18: "consultation_goal",
    6: "market_experience",
    7: "has_real_account",
    8: "real_account_duration",
    9: "capital_traded",
    10: "styles_learned",
    12: "teacher_name",
    13: "trading_goal",
    14: "has_strategy",
    15: "strategy_performance",
    16: "strategy_image_url",
  },
};

const NAMED = {
  full_name: ["full_name", "name", "fullname", "نام و نام خانوادگی"],
  phone: ["phone", "mobile", "tel", "شماره تماس", "تلفن تماس شما"],
  telegram_id: ["telegram_id", "telegram", "آیدی تلگرام"],
  email: ["email", "ایمیل"],
  consultation_goal: ["consultation_goal", "message", "notes"],
};

// دفترداری افزونه‌ی فرم. این‌ها پاسخ نیستند و اگر دور ریخته نشوند، در
// CRM کنار سوال‌های واقعی نمایش داده می‌شوند.
const META = new Set([
  "id", "form_id", "post_id", "date_created", "date_updated", "is_starred",
  "is_read", "ip", "source_url", "user_agent", "currency", "payment_status",
  "payment_date", "payment_amount", "payment_method", "transaction_id",
  "is_fulfilled", "created_by", "transaction_type", "status", "api_key",
]);

const ANSWER_ORDER = [
  "market_experience", "has_real_account", "real_account_duration",
  "capital_traded", "styles_learned", "teacher_name", "trading_goal",
  "has_strategy", "strategy_performance", "strategy_image_url",
];

function canon(k) {
  return String(k).toLowerCase().replace(/[\s‌‎‏_\-?؟:.،,()\/]/g, "");
}

const namedLookup = new Map();
for (const [key, aliases] of Object.entries(NAMED)) {
  for (const a of aliases) namedLookup.set(canon(a), key);
}

/**
 * شماره‌ی تلفن به یک شکل واحد.
 *
 * لازم است چون تشخیص تکراری روی شماره انجام می‌شود: «+۹۸۹۱۲…» و
 * «۰۹۱۲…» یک نفرند و بدون یکسان‌سازی دو لید جدا می‌شدند و دو مشاور به
 * یک نفر زنگ می‌زدند.
 */
export function normalizePhone(raw) {
  let d = String(raw || "").replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0));
  d = d.replace(/\D/g, "");
  if (d.startsWith("98") && d.length === 12) return "0" + d.slice(2);
  if (d.length === 10 && d[0] === "9") return "0" + d;
  return d;
}

/**
 * بدنه‌ی خام فرم → فیلدهای نام‌دار.
 * @returns {{full_name, phone, telegram_id, email, message, answers, extras}}
 */
export function normalizeForm(body) {
  const b = body || {};
  const numericMap = NUMERIC_FORMS[String(b.form_id || "").trim()] || {};

  const mapped = {};
  const extras = {};
  for (const [k, v] of Object.entries(b)) {
    if (META.has(k)) continue;
    const text = v == null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v)).trim();
    if (!text) continue;
    // نام واقعی اول، بعد نگاشت شماره‌ای: اگر روزی سایت نام‌های درست
    // بفرستد، همان‌ها برنده‌اند و این نگاشت به منبع حقیقتِ رقیب تبدیل
    // نمی‌شود.
    const target = namedLookup.get(canon(k)) || numericMap[k];
    if (target) mapped[target] = text;
    else extras[k] = text;
  }

  const answers = {};
  for (const k of ANSWER_ORDER) if (mapped[k]) answers[k] = mapped[k];
  // کلید ناشناخته زیر نام خودش نگه داشته می‌شود، نه دور ریخته: یک تغییر
  // در فرم سایت هرگز نباید بی‌صدا یک پاسخ را از بین ببرد.
  for (const [k, v] of Object.entries(extras)) answers[k] = v;

  return {
    full_name: mapped.full_name || "",
    phone: normalizePhone(mapped.phone),
    telegram_id: mapped.telegram_id || "",
    email: mapped.email || "",
    message: mapped.consultation_goal || "",
    answers,
    extras,
  };
}

// چه چیزی درخواست را غیرقابل استفاده می‌کند.
//
// عمداً فقط یکی: بدون هیچ راه تماسی نمی‌شود پیگیری کرد. نسخه‌ی n8n نامِ
// خالی را هم رد می‌کرد و همان قاعده بود که سه مشتری واقعی را دور ریخت.
function unusableReason(data) {
  if (!data.phone && !data.telegram_id && !data.email) {
    return "هیچ راه تماسی در درخواست نبود (نه شماره، نه تلگرام، نه ایمیل)";
  }
  return "";
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * POST /intake/mentoring — همان آدرسی که فرم سایت باید به آن بزند.
 */
export async function handleMentoringIntake(request, env) {
  if (request.method !== "POST") return json({ success: false, error: "method not allowed" }, 405);

  const expected = env.MENTORING_INTAKE_KEY;
  if (!expected) return json({ success: false, error: "کلید سرویس تنظیم نشده است" }, 503);

  const key = request.headers.get("x-api-key") || "";
  if (key !== expected) return json({ success: false, error: "unauthorized" }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "بدنه‌ی JSON معتبر نبود" }, 400);
  }

  const data = normalizeForm(body);
  const reason = unusableReason(data);
  const raw = JSON.stringify(body);
  const now = new Date().toISOString();

  // نوشتن پیش از هر تصمیمی، حتی برای درخواستِ غیرقابل استفاده.
  //
  // یک درخواست بی‌شماره هم شاید متن قابل خواندنی داشته باشد که بشود
  // دستی پیگیری‌اش کرد. آنچه ذخیره نشود، برای همیشه رفته - و همین بود
  // که سه هفته کسی نفهمید.
  try {
    await ensureIntakeSchema(env);
    await env.DB
      .prepare(
        `INSERT INTO mentoring_intake
           (received_at, full_name, phone, telegram_id, email, message, answers_json, raw_payload)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        now, data.full_name, data.phone, data.telegram_id, data.email,
        data.message, JSON.stringify(data.answers), raw
      )
      .run();
  } catch (err) {
    // نتوانستیم ذخیره کنیم: این تنها حالتی است که باید به سایت خطا
    // بدهیم، تا اگر روزی افزونه‌ای تلاش مجدد داشت، دوباره بفرستد.
    console.error("ثبت درخواست منتورینگ شکست خورد:", err && err.message);
    return json({ success: false, error: "ثبت درخواست ممکن نشد" }, 500);
  }

  // و همان درخواست، در جدولی که پنل CRM می‌خواند.
  //
  // جدول بالا رکوردِ خامِ ماست و هیچ‌وقت پاک نمی‌شود؛ این یکی چیزی است
  // که صفحه‌ی «درخواست‌های منتورینگ» نشان می‌دهد. تا پیش از سوییچ، پنل
  // از n8n می‌خواند و همین ارسالِ صف کافی بود - حالا دیگر نیست.
  //
  // شکستش نباید جلوی پاسخ ۲۰۰ را بگیرد: داده در جدول بالا هست و از بین
  // نمی‌رود.
  try {
    await ensureCrmSchema(env);
    await env.DB
      .prepare(
        `INSERT INTO crm_mentoring_requests
           (request_id, created_at, full_name, phone, telegram_id, email,
            consultation_goal, answers_json, raw_payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        "MREQ-" + Date.now().toString(36) + "-" + Math.floor(1000 + Math.random() * 9000),
        now, data.full_name, data.phone, data.telegram_id, data.email,
        data.message, JSON.stringify(data.answers), raw
      )
      .run();
  } catch (err) {
    console.error("ثبت منتورینگ در crm_mentoring_requests شکست خورد:", err && err.message);
  }

  if (reason) {
    await alertOwner(env, ["⚠️ یک درخواست منتورینگ ناقص بود", "", "علت: " + reason, "", "——— محتوای خام ———", raw.slice(0, 2500)]);
    // ۲۰۰ برمی‌گردد، نه خطا: از دید فرستنده درخواست رسید و ذخیره شد.
    // چیزی که کم است، اطلاعاتِ خود اوست، نه خرابی سرویس.
    return json({ success: true, stored: true, needs_review: true });
  }

  await queueOutbound(env, "mentoring", {
    full_name: data.full_name,
    phone: data.phone,
    telegram_id: data.telegram_id,
    email: data.email,
    message: data.message,
    ...data.answers,
    form_id: String(body.form_id || ""),
  }).catch((err) => {
    // صف پر نشد ولی خودِ درخواست ذخیره شده. هشدار می‌دهیم چون تنها
    // راهِ باقی‌مانده برای دیدنش، همین پیام است.
    console.error("صف منتورینگ پر نشد:", err && err.message);
    return alertOwner(env, ["⚠️ درخواست منتورینگ ذخیره شد ولی در صف CRM ننشست", "", (data.full_name || "بدون نام") + " — " + (data.phone || "بدون شماره")]);
  });

  return json({ success: true, stored: true });
}

async function alertOwner(env, lines) {
  if (!env.BOT_TOKEN) return;
  const { OWNER_ID } = await import("../owner.js");
  try {
    await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({ chat_id: OWNER_ID, text: lines.join("\n") }),
    });
  } catch (err) {
    console.error("هشدار منتورینگ فرستاده نشد:", err && err.message);
  }
}
