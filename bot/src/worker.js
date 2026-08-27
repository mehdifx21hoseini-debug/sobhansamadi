import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { syncFromN8n } from "./econ/store.js";
import { drainLeadOutbox } from "./crmSync.js";

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

export default {
  async fetch(request, env) {
    if (!env.BOT_TOKEN) {
      return new Response("BOT_TOKEN تنظیم نشده است (به‌عنوان secret در Cloudflare ست کنید)", {
        status: 500,
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
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
