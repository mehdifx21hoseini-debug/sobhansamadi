import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { fetchLiveData } from "./livePrices.js";

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

    // مسیر تشخیصی موقت - برای دیدن خطای واقعی fetch قیمت‌ها، بدون نیاز
    // به Observability/Logs که فعلاً روی این Worker خاموش است.
    if (url.pathname === "/debug/live-prices") {
      try {
        const data = await fetchLiveData();
        return new Response(JSON.stringify(data, null, 2), {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        return new Response(
          JSON.stringify({ error: String(err), stack: err && err.stack }, null, 2),
          { status: 500, headers: { "content-type": "application/json" } }
        );
      }
    }

    // مسیر webhook شامل خود توکن است تا کسی نتواند بدون دانستن توکن
    // درخواست جعلی به این آدرس بفرستد.
    if (url.pathname === `/webhook/${env.BOT_TOKEN}`) {
      const bot = createBot(env.BOT_TOKEN);
      return webhookCallback(bot, "cloudflare-mod")(request);
    }

    return new Response("not found", { status: 404 });
  },
};
