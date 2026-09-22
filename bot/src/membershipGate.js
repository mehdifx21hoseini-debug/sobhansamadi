import { InlineKeyboard } from "grammy";
import { handleStart } from "./commands/start.js";
import { isOwner } from "./owner.js";
import { sendSection } from "./content/sectionText.js";
import { gateChannel } from "./content/botLinks.js";

// نامِ کانالِ دروازه، از همان لینکی که مدیر در /links می‌گذارد.
//
// چرا مشتق و نه یک ثابتِ جدا: دروازه با getChatMember روی نامِ کانال
// کار می‌کند و دکمه‌اش کاربر را به لینک می‌فرستد. اگر این دو جدا
// بودند، عوض کردنِ لینک یعنی کاربر به کانالِ تازه می‌رود و همچنان پشتِ
// در می‌ماند - و هیچ خطایی هم جایی ثبت نمی‌شود.
//
// GATE_CHANNEL به‌عنوان پیش‌فرض می‌ماند: /members و /diag هم از همین
// می‌خوانند، و اگر دیتابیس در دسترس نباشد همین مقدار به کار می‌آید.
export const GATE_CHANNEL = "@sobhanforex";
const CHANNEL_JOIN_URL = "https://t.me/sobhanforex";

function joinPromptKeyboard() {
  // آدرس همین پیش‌فرض می‌ماند و transformer آن را - اگر عوض شده باشد -
  // سرِ راه بازنویسی می‌کند، مثلِ هر دکمه‌ی لینک‌دارِ دیگری.
  return new InlineKeyboard()
    .url("📢 عضویت در کانال", CHANNEL_JOIN_URL)
    .row()
    .text("✅ تایید عضویت", "CHECK_MEMBERSHIP");
}

// وضعیت‌هایی که یعنی «داخل کانال است».
//
// چرا فهرست سفید و نه «هرچه left و kicked نیست»: تلگرام وضعیت
// restricted را هم برمی‌گرداند و آن یکی دو معنی دارد - محدودشده‌ای که
// هنوز عضو است، و محدودشده‌ای که بیرون رفته. با فهرست سیاه، حالت دومی
// عضو حساب می‌شد.
function isInsideChannel(result) {
  const status = result && result.status;
  if (status === "creator" || status === "administrator" || status === "member") return true;
  if (status === "restricted") return result.is_member === true;
  return false;
}

async function isChannelMember(api, env, userId) {
  try {
    const channel = await gateChannel(env);
    return isInsideChannel(await api.getChatMember(channel, userId));
  } catch (err) {
    console.error("خطای چک عضویت کانال:", err);
    // اگر خود API خطا داد، کاربر را مسدود نمی‌کنیم: یک اختلال موقت در
    // تلگرام - یا افتادن ربات از ادمینیِ کانال - نباید کل ربات را برای
    // همه ببندد.
    return true;
  }
}

// میدلور سراسری - قبل از هر دستور/پیام دیگری اجرا می‌شود و در صورت
// عدم عضویت، ادامه‌ی پردازش را متوقف می‌کند.
//
// عضویت روی هر تعامل از تلگرام پرسیده می‌شود، بدون کش.
//
// پیش از این نتیجه ۲۴ ساعت در D1 کش می‌شد تا فشار روی API کمتر شود، اما
// این یعنی کسی که از کانال بیرون می‌رفت تا یک شبانه‌روز دسترسی‌اش باز
// می‌ماند - و همان‌جا هم بود که دروازه معنایش را از دست می‌داد. حالا هر
// بار پرسیده می‌شود: یک فراخوانی به همان api.telegram.org که ربات
// به‌هرحال برای پاسخ دادن با آن حرف می‌زند، و در عوض خواندن از D1 هم از
// مسیر برداشته شد. لحظه‌ای که کاربر لفت بدهد، اولین پیام بعدی‌اش پشت
// دروازه می‌ماند.
export function membershipGate() {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    // مدیران از چک عضویت معافند. بدون این، مدیری که هنوز عضو کانال نشده
    // پشت دروازه‌ی خودش می‌ماند و دیگر نمی‌تواند چیزی را درست کند.
    if (isOwner(ctx)) {
      return next();
    }

    const isRetryCallback = ctx.callbackQuery?.data === "CHECK_MEMBERSHIP";
    const member = await isChannelMember(ctx.api, ctx.env, userId);

    if (member) {
      if (isRetryCallback) {
        // تایید موفق عضویت مستقیم می‌رود به منوی اصلی.
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
