// اندپوینت مینی‌اپ تقویم.
//
// چرا وجود دارد: مینی‌اپ تا امروز مستقیم به وبهوک n8n وصل بود. یعنی هر
// بار که آن هاست ۵۰۲ می‌داد - که کم پیش نمی‌آید - همه‌ی تب‌های تقویم
// خالی می‌شدند، در حالی که همان لحظه خودِ ربات درست کار می‌کرد چون از
// آینه‌ی D1 می‌خواند. این ماژول همان آینه را به مینی‌اپ هم می‌دهد.
//
// آنچه هنوز به n8n نیاز دارد فقط تنظیمات هشدار است، چون جدول مشترکین
// هنوز آنجاست و زمان‌بندِ ارسال هشدار هم آنجا اجرا می‌شود. اگر n8n در
// دسترس نباشد، به‌جای نشان دادن وضعیت اشتباهِ کلیدها، بخش هشدار پنهان
// می‌شود - نمایش «خاموش» برای کسی که واقعاً مشترک است، بدترین حالت
// ممکن بود چون یک ضربه‌ی بعدی واقعاً لغو اشتراکش می‌کرد.

import { readEvents, readLabels, readHolidays, readAiAnswer, todayCacheKey } from "./store.js";
import { makeLabelHelpers } from "./labels.js";
import { etTimeToTehran, etInstantIso } from "./format.js";

// مینی‌اپ از GitHub Pages سرو می‌شود، پس مبدأ درخواست با مبدأ ورکر یکی
// نیست و بدون این هدرها مرورگر پاسخ را به صفحه نمی‌دهد.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      ...CORS,
    },
  });
}

// ---------- احراز هویت ----------

// initData رشته‌ای است که تلگرام به صفحه می‌دهد و با توکن بات امضا شده.
// این تنها چیزی است که ثابت می‌کند درخواست از داخل تلگرام و از طرف همان
// کاربر آمده. بدون بررسی امضا، هر کسی می‌توانست با یک curl ساده اشتراک
// هر آیدی دلخواهی را عوض کند - این اندپوینت عمومی است.
//
// الگوریتم همان چیزی است که تلگرام مستند کرده:
//   secret = HMAC_SHA256(key = "WebAppData", data = bot_token)
//   hash   = HMAC_SHA256(key = secret,       data = data_check_string)
async function hmac(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function toHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

// مقایسه‌ی زمان‌ثابت. مقایسه‌ی معمولی رشته‌ها روی اولین بایت متفاوت
// برمی‌گردد و همان اختلاف زمانی، در تئوری، اجازه‌ی حدس بایت‌به‌بایت
// امضا را می‌دهد.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// یک روز. کهنه‌تر از این یعنی رشته‌ای که جایی ذخیره یا لو رفته دوباره
// پخش می‌شود؛ امضا هنوز معتبر است ولی نباید پذیرفته شود.
const MAX_AUTH_AGE_SEC = 86400;

export async function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const pairs = [];
  for (const [k, v] of params) {
    if (k === "hash" || k === "signature") continue;
    pairs.push(k + "=" + v);
  }
  pairs.sort();

  const secret = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secret, pairs.join("\n")));
  if (!timingSafeEqual(expected, String(hash).toLowerCase())) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate)) return null;
  if (Math.floor(Date.now() / 1000) - authDate > MAX_AUTH_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

// ---------- داده ----------

// شکل خروجی عیناً همان چیزی است که econ-app.html انتظار دارد. اگر اینجا
// نامی عوض شود صفحه بی‌صدا خالی می‌ماند، پس هیچ‌کدام «مرتب‌سازی» نشده‌اند.
export async function buildMiniappPayload(env, user) {
  const [rows, labels, holidays] = await Promise.all([
    readEvents(env),
    readLabels(env),
    readHolidays(env),
  ]);

  const { enShort, enFull, faName } = makeLabelHelpers(labels);
  const today = new Date().toISOString().slice(0, 10);

  // فقط از امروز به بعد. صفحه هرگز گذشته را نشان نمی‌دهد و در عوض
  // events[0] را «رویداد بعدی» فرض می‌کند - با ردیف‌های گذشته در آرایه،
  // آن فرض می‌شکست.
  const events = rows
    .filter((e) => e && e.date && e.date >= today)
    .sort((a, b) => (a.date + (a.time || "99:99")).localeCompare(b.date + (b.time || "99:99")))
    .map((e) => ({
      event_id: e.event_id,
      date: e.date,
      time_tehran: e.time ? etTimeToTehran(e.date, e.time) : "",
      at: etInstantIso(e.date, e.time),
      title: faName(e),
      en: enFull(e) || e.event || "",
      short: enShort(e),
      importance: e.importance || "low",
      forecast: e.forecast || "",
      previous: e.previous || "",
      actual: e.actual || "",
      source: e.source || "",
    }));

  return {
    success: true,
    today,
    // شبکه‌ی ماهانه هرچه را که واقعاً در آینه هست نشان می‌دهد، نه یک عدد
    // ثابت که با تغییر افق n8n از واقعیت جدا بیفتد.
    horizon_end: events.length ? events[events.length - 1].date : today,
    events,
    holidays: (holidays || []).map((h) => ({
      date: h.date,
      name: h.name_fa || h.name || "",
    })),
    user: user ? { first_name: user.first_name || "" } : null,
  };
}

// ---------- بخش‌هایی که هنوز از n8n می‌آیند ----------

// درخواست را دست‌نخورده به همان وبهوکی می‌فرستد که مینی‌اپ قبلاً
// مستقیم صدا می‌زد. قرارداد عوض نشده، فقط یک واسطه اضافه شده - پس
// خواندن/نوشتن اشتراک دقیقاً مثل قبل کار می‌کند.
async function callN8n(env, payload, timeoutMs) {
  if (!env.ECON_MINIAPP_URL) throw new Error("ECON_MINIAPP_URL تنظیم نشده است");
  const res = await fetch(env.ECON_MINIAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error("پاسخ ناموفق از n8n: " + res.status);
  return res.json();
}

// ---------- مسیریابی ----------

export async function handleMiniapp(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return reply({ success: false, error: "method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ success: false, error: "bad request" }, 400);
  }

  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  if (!user) {
    return reply({ success: false, error: "unauthorized" }, 401);
  }

  const action = body.action;

  if (action === "data") {
    const payload = await buildMiniappPayload(env, user);

    // اشتراک تنها چیزی است که هنوز فقط در n8n هست. اگر نرسید، صفحه بدون
    // بخش هشدار بالا می‌آید - که بی‌نهایت بهتر از خالی ماندن کل تقویم
    // است، و همان چیزی است که این تغییر برای حلش نوشته شد.
    payload.subscription = null;
    try {
      const upstream = await callN8n(env, { action: "data", initData: body.initData }, 8000);
      if (upstream && upstream.subscription) payload.subscription = upstream.subscription;
    } catch (err) {
      console.error("اشتراک مینی‌اپ از n8n نیامد:", err && err.message);
    }

    return reply(payload);
  }

  if (action === "explain") {
    // همان کشی که ربات پر می‌کند. مینی‌اپ عمداً نسخه‌ی تازه نمی‌سازد تا
    // دو متن متفاوت برای یک روز وجود نداشته باشد.
    const row = await readAiAnswer(env, todayCacheKey());
    if (!row) return reply({ success: true, available: false });
    return reply({ success: true, available: true, answer: row.answer, created_at: row.created_at });
  }

  if (action === "subscribe") {
    // نوشتن است، پس بی‌صدا شکست خوردن ممنوع: اگر n8n نبود، صفحه باید
    // خطا بگیرد و کلیدها را برگرداند سر جایشان.
    try {
      const upstream = await callN8n(
        env,
        {
          action: "subscribe",
          initData: body.initData,
          subscribed: body.subscribed,
          alert_minutes: body.alert_minutes,
          show_low_importance: body.show_low_importance,
        },
        10000
      );
      return reply(upstream && upstream.success === false ? upstream : { success: true });
    } catch (err) {
      return reply({ success: false, error: String(err && err.message) }, 502);
    }
  }

  return reply({ success: false, error: "unknown action" }, 400);
}
