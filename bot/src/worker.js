import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";
import { debugFetchCandlesAndChartUrl } from "./priceChart.js";

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

    // مسیر تشخیصی موقت - بررسی fetch کندل‌ها و آدرس نمودار قبل از اطمینان
    // به این‌که ویژگی جدید کار می‌کند. بعد از تایید حذف می‌شود.
    if (url.pathname === "/debug/btc-chart") {
      try {
        const result = await debugFetchCandlesAndChartUrl();
        return new Response(JSON.stringify(result, null, 2), {
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
