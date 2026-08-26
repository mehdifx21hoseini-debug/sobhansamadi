import { InlineKeyboard } from "grammy";
import { handleStart } from "./commands/start.js";

const CHANNEL_USERNAME = "@sobhanforex";
const CHANNEL_JOIN_URL = "https://t.me/sobhanforex";
// این آیدی (صاحب/ادمین اصلی) در نسخه‌ی قبلی از چک عضویت معاف بود.
const EXEMPT_TELEGRAM_ID = "6923823275";

function joinPromptKeyboard() {
  return new InlineKeyboard()
    .url("📢 عضویت در کانال", CHANNEL_JOIN_URL)
    .row()
    .text("✅ بررسی مجدد", "CHECK_MEMBERSHIP");
}

const FIRST_PROMPT_TEXT = [
  "🔒 برای استفاده از ربات آکادمی سبحان صمدی، ابتدا باید عضو کانال ما بشی.",
  "",
  "👇 روی دکمه پایین بزن و عضو شو، بعد از عضویت دوباره «بررسی مجدد» رو بزن.",
].join("\n");

const RETRY_PROMPT_TEXT = [
  "❌ هنوز عضویت شما در کانال تایید نشد.",
  "",
  "ابتدا از طریق دکمه زیر عضو کانال بشو، سپس دوباره روی «بررسی مجدد» بزن.",
].join("\n");

async function isChannelMember(api, userId) {
  try {
    const result = await api.getChatMember(CHANNEL_USERNAME, userId);
    return result.status !== "left" && result.status !== "kicked";
  } catch (err) {
    console.error("خطای چک عضویت کانال:", err);
    // مثل نسخه‌ی قبلی: اگر خود API خطا داد، کاربر را مسدود نمی‌کنیم.
    return true;
  }
}

// میدلور سراسری - قبل از هر دستور/پیام دیگری اجرا می‌شود و در صورت
// عدم عضویت، ادامه‌ی پردازش را متوقف می‌کند.
export function membershipGate() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    if (String(userId) === EXEMPT_TELEGRAM_ID) {
      return next();
    }

    const isRetryCallback = ctx.callbackQuery?.data === "CHECK_MEMBERSHIP";
    const member = await isChannelMember(ctx.api, userId);

    if (member) {
      if (isRetryCallback) {
        // در نسخه‌ی قبلی، تایید موفق عضویت مستقیم می‌رود به منوی اصلی.
        await ctx.answerCallbackQuery();
        await handleStart(ctx);
        return;
      }
      return next();
    }

    if (isRetryCallback) {
      await ctx.answerCallbackQuery();
      await ctx.reply(RETRY_PROMPT_TEXT, { reply_markup: joinPromptKeyboard() });
      return;
    }

    await ctx.reply(FIRST_PROMPT_TEXT, { reply_markup: joinPromptKeyboard() });
  };
}
