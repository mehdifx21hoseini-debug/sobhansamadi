import { Bot } from "grammy";
import { handleStart } from "./commands/start.js";
import { mainMenuKeyboard } from "./menu.js";
import { sendLivePrices, refreshLivePrices } from "./livePrices.js";

// یک‌جا ساخته می‌شود تا هم روی Cloudflare Workers و هم (در صورت نیاز) در
// یک محیط دیگر قابل استفاده باشد.
export function createBot(token) {
  const bot = new Bot(token);

  bot.command("start", handleStart);

  // TODO(فاز پورت منو): مسیر هر دکمه (econ_calendar / mentoring / support و ...)
  // باید همان منطقی که الان در n8n اجرا می‌شود را اینجا پیاده کند. فعلاً فقط
  // یک پاسخ موقت می‌دهد تا مسیر webhook و دکمه‌ها قابل تست باشد.
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery();
    const data = ctx.callbackQuery.data;

    if (data === "econ_calendar" || data === "mentoring" || data === "support") {
      await ctx.reply("این بخش هنوز به بات جدید منتقل نشده - به‌زودی.");
      return;
    }

    if (data === "live_prices") {
      await sendLivePrices(ctx);
      return;
    }

    if (data === "live_prices_refresh") {
      await refreshLivePrices(ctx);
      return;
    }

    if (data === "back_to_menu") {
      await ctx.editMessageText("منوی اصلی:", { reply_markup: mainMenuKeyboard() });
      return;
    }
  });

  bot.catch((err) => {
    console.error("خطای بات:", err);
  });

  return bot;
}
