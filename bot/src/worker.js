import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";

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
};
