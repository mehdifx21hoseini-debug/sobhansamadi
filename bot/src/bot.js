import { Bot } from "grammy";
import { handleStart, handleHelp } from "./commands/start.js";
import { handleDiag, handleResetChannel, handleDeleteContent } from "./commands/diag.js";
import { mainMenuKeyboard, resolveMenuAction } from "./menu.js";
import { membershipGate } from "./membershipGate.js";
import { getUserState, clearUserState } from "./db.js";
import {
  sendEconCalendar,
  sendPendingSection,
  handleSectionListPage,
  handleEconCallback,
} from "./menuActions.js";
import { sendAbout, sendTrustedBroker, sendContact } from "./staticContent.js";
import { sendLearnMenu, sendToolsMenu, sendAboutUsMenu } from "./sections.js";
import { handleFreeText } from "./freeText.js";
import { handleChannelPost } from "./content/ingest.js";
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
export function createBot(token, env, botInfo, build = "?") {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);

  bot.use(async (ctx, next) => {
    ctx.env = env;
    return next();
  });

  // پست‌های کانال پیش از دروازه‌ی عضویت می‌آیند: آن‌ها کاربر ندارند و
  // چک عضویت رویشان بی‌معنی است. اینجا هم هیچ پاسخی به کانال فرستاده
  // نمی‌شود؛ فقط فایل در کتابخانه می‌نشیند.
  bot.on(["channel_post", "edited_channel_post"], async (ctx) => {
    try {
      await handleChannelPost(ctx);
    } catch (err) {
      console.error("دریافت پست کانال شکست خورد:", err && err.message);
    }
  });

  bot.use(membershipGate());

  bot.command("start", handleStart);
  bot.command("help", handleHelp);
  // فقط مدیر پاسخ می‌گیرد؛ برای بقیه انگار وجود ندارد.
  bot.command("diag", (ctx) => handleDiag(ctx, build));
  bot.command("resetchannel", handleResetChannel);
  bot.command("delete", handleDeleteContent);

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

      // مرحله‌هایی که منتظر ضربه‌ی دکمه‌اند (انتخاب دوره و تایید نهایی).
      // کاربری که به‌جای دکمه سوال می‌نویسد - «کدوم دوره بهتره؟» - قبلاً
      // هیچ جوابی نمی‌گرفت. نسخه‌ی n8n همین حالت را هم به دستیار می‌داد.
      // فرآیندش دست‌نخورده می‌ماند؛ فقط سوالش جواب داده می‌شود.
      if (["choose_course", "confirm"].includes(state.current_step)) {
        await handleFreeText(ctx, state);
        return;
      }
    }

    switch (action) {
      case "ECON_CALENDAR":
        return sendEconCalendar(ctx);

      // یک دکمه در منوی اصلی که دو گزینه‌ی inline باز می‌کند: معرفی
      // آکادمی، و راه‌های تماس.
      case "ABOUT_US":
        return sendAboutUsMenu(ctx);

      // دو دسته‌ی سطح دوم که فقط برای کیبوردهای کش‌شده مانده‌اند.
      case "LEARN":
        return sendLearnMenu(ctx);
      case "TOOLS":
        return sendToolsMenu(ctx);

      // از اینجا به پایین، کنش‌هایی که دیگر دکمه‌ی سطح اول ندارند ولی چون
      // کیبورد تلگرام سمت کاربر کش می‌شود هنوز از راه متن می‌رسند.
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
        // متن آزاد بدون فرآیند فعال. سکوت بدترین پاسخ ممکن است، پس به
        // دستیار می‌رود و اگر او هم در دسترس نبود، دست‌کم راهنمایی.
        return handleFreeText(ctx, state);
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

    // زیرمنوهای سطح دوم (آموزش‌ها / ابزارها / درباره ما). همان توابعی که
    // قبلاً دکمه‌ی مستقیم داشتند، حالا از این مسیر صدا زده می‌شوند.
    const SECTIONS = {
      SEC_FREE_COURSES: sendFreeCoursesMenu,
      SEC_LIBRARY: sendLibrary,
      SEC_PSY_VOICES: (c) => sendPendingSection(c, "PSY_VOICES"),
      SEC_LIVE_TRADE: (c) => sendPendingSection(c, "LIVE_TRADE"),
      SEC_EXPERT: sendExpert,
      SEC_BROKER: sendTrustedBroker,
      SEC_ABOUT: sendAbout,
      SEC_CONTACT: sendContact,
    };
    if (SECTIONS[data]) {
      await ctx.answerCallbackQuery();
      // مثل تقویم: اگر چیزی خطا داد کاربر نباید فقط سکوت ببیند.
      try {
        await SECTIONS[data](ctx);
      } catch (err) {
        console.error("خطای زیرمنو:", data, err && err.message);
        await ctx
          .reply("⚠️ در نمایش این بخش مشکلی پیش آمد. لطفاً دوباره امتحان کنید.")
          .catch(() => {});
      }
      return;
    }

    // دکمه‌های تزئینی ردیف صفحه‌بندی (شماره‌ی صفحه و جای خالی). فقط
    // ساعت شنی را برمی‌دارند و کار دیگری نمی‌کنند.
    if (data === "NOOP") {
      await ctx.answerCallbackQuery();
      return;
    }

    if (data.startsWith("LIST|")) {
      const [, key, page] = data.split("|");
      await ctx.answerCallbackQuery();
      await handleSectionListPage(ctx, key, Number(page) || 0);
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

  // آخرین تور ایمنی. بدون این، هر خطای پیش‌بینی‌نشده فقط در لاگ می‌نشیند
  // و کاربر سکوت می‌بیند - که از دید او یعنی «ربات خراب است».
  bot.catch(async (err) => {
    console.error("خطای بات:", err);
    await err.ctx
      ?.reply("⚠️ مشکلی پیش آمد. لطفاً دوباره امتحان کنید یا /start بزنید.")
      .catch(() => {});
  });

  return bot;
}
