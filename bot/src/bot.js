import { Bot } from "grammy";
import { handleStart } from "./commands/start.js";
import { MENU_LABELS, mainMenuKeyboard } from "./menu.js";
import { membershipGate } from "./membershipGate.js";
import { getUserState, clearUserState } from "./db.js";
import { sendEconCalendar } from "./menuActions.js";
import { sendAbout, sendTrustedBroker } from "./staticContent.js";
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
export function createBot(token, env) {
  const bot = new Bot(token);

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
    const isMenuLabel = Object.values(MENU_LABELS).includes(text);
    if (state?.current_flow && !isMenuLabel) {
      if (["ask_name", "ask_phone", "ask_level", "ask_topic", "ask_time"].includes(state.current_step)) {
        await handleFlowText(ctx, state);
        return;
      }
      if (state.current_flow === "faq" && state.current_step === "ask_question") {
        await handleQuestion(ctx);
        return;
      }
    }

    switch (text) {
      case MENU_LABELS.ECON_CALENDAR:
        return sendEconCalendar(ctx);
      case MENU_LABELS.ABOUT:
        return sendAbout(ctx);
      case MENU_LABELS.SUPPORT:
        return startSupport(ctx);
      case MENU_LABELS.LIBRARY:
        return sendLibrary(ctx);
      case MENU_LABELS.FREE_COURSES:
        return sendFreeCoursesMenu(ctx);
      case MENU_LABELS.PSY_VOICES:
        return ctx.reply("🎧 ویس‌های روانشناسی\n\nاین بخش به‌زودی تکمیل می‌شه. 🙏");
      case MENU_LABELS.EXPERT:
        return sendExpert(ctx);
      case MENU_LABELS.LIVE_TRADE:
        return ctx.reply("📈 ویدیوهای لایو ترید\n\nبه‌زودی ویدیوهای لایو معاملات اینجا اضافه می‌شود. 🎬");
      case MENU_LABELS.CONSULT:
        return startRegistrationFlow(ctx, "consultation");
      case MENU_LABELS.TRUSTED_BROKER:
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

    await ctx.answerCallbackQuery();
  });

  bot.catch((err) => {
    console.error("خطای بات:", err);
  });

  return bot;
}
