import { InlineKeyboard } from "grammy";
import { handleStart } from "./commands/start.js";
import { isOwner } from "./owner.js";
import { sendSection } from "./content/sectionText.js";

const CHANNEL_USERNAME = "@sobhanforex";
const CHANNEL_JOIN_URL = "https://t.me/sobhanforex";
// چک واقعی از API تلگرام فقط یک‌بار در این بازه برای هر کاربر انجام
// می‌شود، نه روی هر تک تعامل - هم سریع‌تر است هم روی مقیاس چند هزار
// کاربر همزمان به تلگرام فشار کمتری وارد می‌کند.
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function joinPromptKeyboard() {
  return new InlineKeyboard()
    .url("📢 عضویت در کانال", CHANNEL_JOIN_URL)
    .row()
    .text("✅ تایید عضویت", "CHECK_MEMBERSHIP");
}


async function getCachedVerification(env, userId) {
  if (!env?.DB) return null;
  try {
    const row = await env.DB
      .prepare("SELECT channel_verified_at FROM user_state WHERE telegram_user_id = ?")
      .bind(String(userId))
      .first();
    return row?.channel_verified_at || null;
  } catch (err) {
    console.error("خطای خواندن کش عضویت:", err);
    return null;
  }
}

async function markVerified(env, userId) {
  if (!env?.DB) return;
  try {
    await env.DB
      .prepare(
        `INSERT INTO user_state (telegram_user_id, channel_verified_at) VALUES (?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET channel_verified_at = excluded.channel_verified_at`
      )
      .bind(String(userId), new Date().toISOString())
      .run();
  } catch (err) {
    console.error("خطای ذخیره‌ی کش عضویت:", err);
  }
}

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

    // مدیران از چک عضویت معافند - همان‌طور که در نسخه‌ی قبلی هم بودند.
    // بدون این، مدیری که هنوز عضو کانال نشده پشت دروازه‌ی خودش می‌ماند.
    if (isOwner(ctx)) {
      return next();
    }

    const isRetryCallback = ctx.callbackQuery?.data === "CHECK_MEMBERSHIP";

    if (!isRetryCallback) {
      const cachedAt = await getCachedVerification(ctx.env, userId);
      if (cachedAt && Date.now() - new Date(cachedAt).getTime() < RECHECK_INTERVAL_MS) {
        return next();
      }
    }

    const member = await isChannelMember(ctx.api, userId);

    if (member) {
      await markVerified(ctx.env, userId);
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
      await sendSection(ctx, "JOIN_RETRY", joinPromptKeyboard());
      return;
    }

    await sendSection(ctx, "JOIN_FIRST", joinPromptKeyboard());
  };
}
