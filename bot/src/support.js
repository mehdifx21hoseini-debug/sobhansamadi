import { setUserState, clearUserState, createSupportTicket } from "./db.js";
import { mainMenuKeyboard } from "./menu.js";

export async function startSupport(ctx) {
  await setUserState(ctx.env, ctx.from.id, { current_flow: "faq", current_step: "ask_question", temp_data: {} });
  await ctx.reply(
    "هر سوالی دارید بفرمایید تیم آکادمی ما در لحظه پاسخگوی شما عزیز خواهد بود\nاگر سوالتون نیاز به بررسی دقیق‌تر داشت تیم پشتیبانی آکادمی مستقیم پیگیری خواهد کرد"
  );
}

export async function handleQuestion(ctx) {
  const text = ctx.message.text.trim();
  await createSupportTicket(ctx.env, {
    telegram_user_id: ctx.from.id,
    telegram_username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
    message: text,
  });
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.reply("✅ سوال شما دریافت شد و طی ۲۴ ساعت کاری پاسخ داده می‌شود.", { reply_markup: mainMenuKeyboard() });
}
