import { Bot } from "grammy";
import { handleStart } from "./commands/start.js";
import { mainMenuKeyboard, resolveMenuAction } from "./menu.js";
import { membershipGate } from "./membershipGate.js";
import { getUserState, clearUserState } from "./db.js";
import { sendEconCalendar, sendPendingSection, handleEconCallback } from "./menuActions.js";
import { sendAbout, sendTrustedBroker, sendContact } from "./staticContent.js";
import { startSupport, handleQuestion } from "./support.js";
import { startFlow as startRegistrationFlow, handleCourseChoice, handleText as handleFlowText, handleContact, handleConfirm, handleCancel } from "./registrationFlow.js";
import {
  sendLibrary,
  handleBookSelect,
  handleLibraryBack,
  sendExpert,
  handleExpertPlatform,
  sendFreeCoursesMenu,
  sendFreeIntro,
  sendFreeEq,
  handleContentRequest,
} from "./contentMenus.js";

// یک‌جا ساخته می‌شود تا هم روی Cloudflare Workers و هم (در صورت نیاز) در
// یک محیط دیگر قابل استفاده باشد. `env` (شامل env.DB) روی ctx.env قرار
// می‌گیرد تا همه‌ی ماژول‌ها بدون پاس دادن دستی بهش دسترسی داشته باشند.
export function createBot(token, env, botInfo) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);

  bot.use(async (ctx, next) => {
    ctx.env = env;
    return next();
  });

  bot.use(membershipGate());

  bot.command("start", handleStart);

  bot.on("message:contact", async (ctx) => {
    await handleContact(ctx);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const state = await getUserState(ctx.env, ctx.from.id);

    // اگر کاربر وسط یه فرآیند چندمرحله‌ای (ثبت‌نام/مشاوره/پشتیبانی) است
    // و این پیام یه دکمه‌ی منوی اصلی نیست، آن را به همون فرآیند بده.
    const action = resolveMenuAction(text);
    if (state?.current_flow && !action) {
      if (["ask_name", "ask_phone", "ask_level", "ask_topic", "ask_time"].includes(state.current_step)) {
        await handleFlowText(ctx, state);
        return;
      }
      if (state.current_flow === "faq" && state.current_step === "ask_question") {
        await handleQuestion(ctx);
        return;
      }
    }

    switch (action) {
      case "ECON_CALENDAR":
        return sendEconCalendar(ctx);
      case "ABOUT":
        return sendAbout(ctx);
      case "CONTACT":
        return sendContact(ctx);
      case "SUPPORT":
        return startSupport(ctx);
      case "LIBRARY":
        return sendLibrary(ctx);
      case "FREE_COURSES":
        return sendFreeCoursesMenu(ctx);
      case "PSY_VOICES":
        return sendPendingSection(ctx, "PSY_VOICES");
      case "EXPERT":
        return sendExpert(ctx);
      case "LIVE_TRADE":
        return sendPendingSection(ctx, "LIVE_TRADE");
      case "CONSULT":
        return startRegistrationFlow(ctx, "consultation");
      case "TRUSTED_BROKER":
        return sendTrustedBroker(ctx);
      default:
        return; // پیام‌های دیگر (بدون فرآیند فعال) نادیده گرفته می‌شوند.
    }
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data === "MENU_MAIN") {
      await clearUserState(ctx.env, ctx.from.id);
      await ctx.answerCallbackQuery();
      await ctx.reply("منوی اصلی:", { reply_markup: mainMenuKeyboard() });
      return;
    }

    if (data === "INTRO_REGISTER_ADVANCED") {
      await ctx.answerCallbackQuery();
      await startRegistrationFlow(ctx, "registration", "برای ثبت‌نام در مجموعه آموزشی پیشرفته، لطفاً دوره موردنظر خود را انتخاب کنید:");
      return;
    }

    if (data === "COURSE_PSY" || data === "COURSE_TECH" || data === "COURSE_BOTH") {
      await ctx.answerCallbackQuery();
      await handleCourseChoice(ctx, data);
      return;
    }

    if (data === "CONFIRM_YES") {
      await ctx.answerCallbackQuery();
      await handleConfirm(ctx);
      return;
    }

    if (data === "FLOW_CANCEL") {
      await ctx.answerCallbackQuery();
      await handleCancel(ctx);
      return;
    }

    if (data.startsWith("BOOK_SELECT|")) {
      await ctx.answerCallbackQuery();
      await handleBookSelect(ctx, data.split("|")[1]);
      return;
    }

    if (data === "BOOK_LIST_BACK") {
      await ctx.answerCallbackQuery();
      await handleLibraryBack(ctx);
      return;
    }

    if (data === "EXPERT_MT4" || data === "EXPERT_MT5") {
      await ctx.answerCallbackQuery();
      await handleExpertPlatform(ctx, data === "EXPERT_MT4" ? "MT4" : "MT5");
      return;
    }

    if (data === "MENU_FREE_INTRO") {
      await ctx.answerCallbackQuery();
      await sendFreeIntro(ctx);
      return;
    }

    if (data === "MENU_FREE_EQ") {
      await ctx.answerCallbackQuery();
      await sendFreeEq(ctx);
      return;
    }

    if (data.startsWith("CONTENT|")) {
      await handleContentRequest(ctx, data.split("|")[1]);
      return;
    }

    // handleEconCallback خودش callback را answer می‌کند.
    // MENU_ECON_CALENDAR پیشوند ECON_ ندارد ولی دکمه‌ی بازگشتِ همه‌ی
    // نماهای تقویم است، پس صریح به همان مسیر می‌رود.
    //
    // هر خطای پیش‌بینی‌نشده اینجا گرفته می‌شود تا کاربر دست‌کم یک پیام
    // بگیرد. بدون این، bot.catch فقط در لاگ می‌نویسد و از دید کاربر دکمه
    // «هیچ کاری نمی‌کند» - سخت‌ترین حالت برای تشخیص.
    if (data.startsWith("ECON_") || data === "MENU_ECON_CALENDAR") {
      try {
        await handleEconCallback(ctx, data);
      } catch (err) {
        console.error("خطای تقویم:", data, err && err.message);
        await ctx
          .reply("⚠️ در نمایش این بخش مشکلی پیش آمد. لطفاً دوباره امتحان کنید.")
          .catch(() => {});
      }
      return;
    }

    await ctx.answerCallbackQuery();
  });

  bot.catch((err) => {
    console.error("خطای بات:", err);
  });

  return bot;
}
