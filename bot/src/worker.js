import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { syncFromN8n, readSyncState } from "./econ/store.js";
import { drainLeadOutbox } from "./crmSync.js";
import { handleMiniapp } from "./econ/miniapp.js";

// grammy طبیعتاً روی اولین استفاده از بات یک درخواست getMe به تلگرام
// می‌زند تا اطلاعات خود بات را بگیرد. چون این Worker برای هر پیام یک
// نمونه‌ی تازه از Bot می‌سازد (روی Cloudflare Workers نمی‌شود حالت
// سراسری بین درخواست‌ها به‌طور مطمئن نگه داشت)، این یعنی یک رفت‌وبرگشت
// اضافه‌ی غیرضروری به تلگرام روی هر تک پیام - که با انباشته شدن روی
// هم (چک عضویت + نوشتن در D1 + چند پیام پشت‌سرهم) می‌تواند به تایم‌اوت
// سمت کلاینت تلگرام برای answerCallbackQuery نزدیک شود. اطلاعات بات
// ثابت است، پس یک‌بار می‌گیریم و به تمام نمونه‌های بعدی تزریق می‌کنیم -
// در حافظه‌ی این isolate تا وقتی گرمه.
let cachedBotInfo = null;

// نشانه‌ی نسخه. اگر /health چیز دیگری برگرداند، یعنی کدِ روی هوا قدیمی
// است و مشکل از تنظیمات نیست - از دیپلوی.
const BUILD = "econ+outbox+miniapp+faq-1";

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // بدون این، پاسخ می‌تواند کش شود و ساعت‌ها همان خطای قدیمی را نشان
      // بدهد در حالی که مشکل حل شده - دقیقاً چیزی که تشخیص را گمراه می‌کند.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

async function handleAdmin(url, env) {
  // با همان کلید تقویم محافظت می‌شود. اگر کلید اصلاً ست نشده باشد، همین
  // پیام خودش جواب سوال است: متغیرها به ورکر نرسیده‌اند.
  if (!env.ECON_EXPORT_KEY) {
    // نامِ متغیرها را برمی‌گرداند، نه مقدارشان. دلیلش این است که «اسم را
    // غلط نوشته‌ای»، «فاصله‌ی اضافه چسبیده» و «اصلاً اضافه نشده» از بیرون
    // یک شکل دارند و بدون دیدن فهرست واقعی نمی‌شود از هم جدایشان کرد.
    // JSON.stringify روی نام‌ها اجرا می‌شود تا فاصله یا کاراکتر نامرئی
    // داخل اسم هم دیده شود.
    const names = Object.keys(env).sort();
    return json(
      {
        ok: false,
        build: BUILD,
        error: "ECON_EXPORT_KEY تنظیم نشده است",
        hint: "این‌ها متغیرهایی هستند که ورکر واقعاً می‌بیند - اگر ECON_EXPORT_KEY در فهرست نیست یعنی در بخش Runtime ذخیره نشده",
        bindings_present: names.map((n) => JSON.stringify(n)),
        count: names.length,
      },
      503
    );
  }
  if (url.searchParams.get("key") !== env.ECON_EXPORT_KEY) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  if (url.pathname === "/admin/sync") {
    try {
      const result = await syncFromN8n(env);
      return json({ ok: true, build: BUILD, synced: result });
    } catch (err) {
      return json({ ok: false, build: BUILD, error: String(err && err.message) }, 502);
    }
  }

  // status: هرگز مقدار متغیرها را برنمی‌گرداند، فقط بودن یا نبودنشان.
  const env_set = {
    ECON_EXPORT_URL: !!env.ECON_EXPORT_URL,
    ECON_EXPLAIN_URL: !!env.ECON_EXPLAIN_URL,
    ECON_MINIAPP_URL: !!env.ECON_MINIAPP_URL,
    ECON_EXPORT_KEY: !!env.ECON_EXPORT_KEY,
    CRM_LEAD_INTAKE_URL: !!env.CRM_LEAD_INTAKE_URL,
    CRM_LEAD_INTAKE_KEY: !!env.CRM_LEAD_INTAKE_KEY,
    GEMINI_API_KEY: !!env.GEMINI_API_KEY,
    DB: !!env.DB,
  };

  async function count(sql) {
    try {
      const row = await env.DB.prepare(sql).first();
      return row ? Object.values(row)[0] : null;
    } catch (err) {
      return "no table";
    }
  }

  return json({
    ok: true,
    build: BUILD,
    env_set,
    last_sync: await readSyncState(env),
    mirrored: {
      events: await count("SELECT COUNT(*) FROM econ_events"),
      labels: await count("SELECT COUNT(*) FROM econ_labels"),
      holidays: await count("SELECT COUNT(*) FROM econ_holidays"),
      ai_cache: await count("SELECT COUNT(*) FROM econ_ai_cache"),
      ai_kb: await count("SELECT COUNT(*) FROM ai_kb"),
    },
    lead_outbox_pending: await count("SELECT COUNT(*) FROM lead_outbox"),
  });
}

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN تنظیم نشده است (به‌عنوان secret در Cloudflare ست کنید)", {
        status: 500,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok " + BUILD);
    }

    // مسیرهای تشخیص. وقتی چیزی کار نمی‌کند، بدون این‌ها باید بین «کد
    // دیپلوی نشده»، «متغیر ست نشده»، «Cron اجرا نمی‌شود» و «n8n جواب
    // نمی‌دهد» حدس زد. این‌ها همان چهار حالت را از هم جدا می‌کنند.
    if (url.pathname === "/admin/status" || url.pathname === "/admin/sync") {
      return handleAdmin(url, env);
    }

    // مینی‌اپ تقویم. تا پیش از این مستقیم به n8n می‌زد و با هر قطعی آن
    // هاست، همه‌ی تب‌های تقویم خالی می‌شدند در حالی که خود ربات - که از
    // آینه‌ی D1 می‌خواند - سالم بود. حالا هر دو از یک منبع می‌خوانند.
    if (url.pathname === "/econ/miniapp") {
      return handleMiniapp(request, env);
    }

    // مسیر webhook شامل خود توکن است تا کسی نتواند بدون دانستن توکن
    // درخواست جعلی به این آدرس بفرستد.
    if (url.pathname === `/webhook/${env.BOT_TOKEN}`) {
      const bot = createBot(env.BOT_TOKEN, env, cachedBotInfo);
      if (!cachedBotInfo) {
        await bot.init();
        cachedBotInfo = bot.botInfo;
      }
      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    return new Response("not found", { status: 404 });
  },

  // زمان‌بند آینه‌ی تقویم. اگر n8n قطع باشد این اجرا شکست می‌خورد و
  // آینه‌ی قبلی دست‌نخورده می‌ماند، پس تقویم همچنان جواب می‌دهد - فقط با
  // داده‌ی اجرای موفق قبلی. خطا را بالا نمی‌دهیم تا یک قطعی موقت n8n به
  // خطای مکرر در لاگ ورکر تبدیل نشود؛ ثبتش برای تشخیص کافی است.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncFromN8n(env)
        .then((n) => console.log("همگام‌سازی تقویم:", JSON.stringify(n)))
        .catch((err) => console.error("همگام‌سازی تقویم شکست خورد:", err && err.message))
    );

    // تلاش دوباره برای لیدهایی که موقع ثبت نتوانستند به CRM برسند. این
    // چیزی است که قطعی n8n را از «مشتری از دست رفت» به «مشتری چند دقیقه
    // دیرتر در CRM ظاهر شد» تبدیل می‌کند.
    ctx.waitUntil(
      drainLeadOutbox(env)
        .then((n) => {
          if (n && !n.skipped && (n.sent || n.failed)) {
            console.log("ارسال لیدهای معلق:", JSON.stringify(n));
          }
        })
        .catch((err) => console.error("ارسال لیدهای معلق شکست خورد:", err && err.message))
    );
  },
};
