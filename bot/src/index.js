import express from "express";
import { Bot, webhookCallback } from "grammy";
import { handleStart } from "./commands/start.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error("BOT_TOKEN تنظیم نشده است (در env vars پلتفرم دیپلوی ست کنید)");
}

const bot = new Bot(token);

bot.command("start", handleStart);

// TODO(فاز پورت منو): مسیر هر دکمه (econ_calendar / mentoring / support و ...)
// باید همان منطقی که الان در n8n اجرا می‌شود را اینجا پیاده کند. فعلاً فقط
// یک پاسخ موقت می‌دهد تا مسیر webhook و دکمه‌ها قابل تست باشد.
bot.on("callback_query:data", async (ctx) => {
  await ctx.answerCallbackQuery();
  const data = ctx.callbackQuery.data;

  if (data === "econ_calendar") {
    await ctx.reply("این بخش هنوز به بات جدید منتقل نشده - به‌زودی.");
    return;
  }
  if (data === "mentoring") {
    await ctx.reply("این بخش هنوز به بات جدید منتقل نشده - به‌زودی.");
    return;
  }
  if (data === "support") {
    await ctx.reply("این بخش هنوز به بات جدید منتقل نشده - به‌زودی.");
    return;
  }
});

bot.catch((err) => {
  console.error("خطای بات:", err);
});

const app = express();
app.use(express.json());

// Railway/Render برای health-check از این مسیر استفاده می‌کنند.
app.get("/health", (req, res) => res.status(200).send("ok"));

app.use(`/webhook/${token}`, webhookCallback(bot, "express"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`bot server listening on port ${port}`);
});
