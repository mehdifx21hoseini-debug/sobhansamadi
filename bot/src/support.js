import { getUserState, setUserState, clearUserState, createSupportTicket } from "./db.js";
import { mainMenuKeyboard } from "./menu.js";
import { askFaq } from "./ai/faq.js";
import { recordKbUsage } from "./ai/kb.js";
import { sendSection } from "./content/sectionText.js";

export async function startSupport(ctx) {
  await setUserState(ctx.env, ctx.from.id, {
    current_flow: "faq",
    current_step: "ask_question",
    temp_data: {},
  });
  await sendSection(ctx, "SUPPORT");
}

// وقتی دستیار خودش پاسخ داده، گفتگو باز می‌ماند تا کاربر بتواند ادامه
// بدهد؛ این دکمه راه خروج است. زدن هر دکمه‌ی منوی اصلی هم کار می‌کند،
// چون مسیریاب اول کنش منو را تشخیص می‌دهد.
const KEEP_ASKING_KEYBOARD = {
  inline_keyboard: [[{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }]],
};

async function escalate(ctx, text, replyText) {
  await createSupportTicket(ctx.env, {
    telegram_user_id: ctx.from.id,
    telegram_username: ctx.from.username,
    first_name: ctx.from.first_name,
    last_name: ctx.from.last_name,
    message: text,
  });
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.reply(replyText, { reply_markup: mainMenuKeyboard() });
}

export async function handleQuestion(ctx) {
  const text = ctx.message.text.trim();
  const state = await getUserState(ctx.env, ctx.from.id);

  // ساختن پاسخ چند ثانیه طول می‌کشد. بدون این نشانه، کاربر فکر می‌کند
  // پیامش نرسیده و دوباره می‌فرستد.
  await ctx.replyWithChatAction("typing").catch(() => {});

  let result = null;
  try {
    result = await askFaq(ctx.env, {
      question: text,
      user: ctx.from,
      history: state?.temp_data?.ai_history
        ? JSON.stringify({ ai_history: state.temp_data.ai_history })
        : "",
      currentFlow: state?.current_flow,
      currentStep: state?.current_step,
    });
  } catch (err) {
    // خطای دستیار نباید سوال کاربر را از بین ببرد. مسیر پایین همان رفتار
    // قبلی ربات است، پس بدترین حالت «مثل قبل» است نه «خراب».
    console.error("دستیار پشتیبانی پاسخ نداد:", err && err.message);
  }

  // دستیار در دسترس نبود یا خطا داد: تیکت، دقیقاً مثل قبل.
  if (!result) {
    await escalate(ctx, text, "✅ سوال شما دریافت شد و طی ۲۴ ساعت کاری پاسخ داده می‌شود.");
    return;
  }

  // دستیار خودش تشخیص داد که این سوال باید به انسان برسد - مسائل مالی،
  // شکایت، یا هر چیزی که در پایگاه دانش جوابی ندارد.
  if (result.needsHuman) {
    await escalate(ctx, text, result.answer);
    return;
  }

  // پاسخ داده شد. گفتگو باز می‌ماند و تاریخچه ذخیره می‌شود تا سوال بعدی
  // ادامه‌ی همین مکالمه باشد، نه یک شروع تازه با سلام دوباره.
  await setUserState(ctx.env, ctx.from.id, {
    current_flow: "faq",
    current_step: "ask_question",
    temp_data: { ...(state?.temp_data || {}), ai_history: result.history.ai_history },
  });

  await ctx.reply(result.answer, { reply_markup: KEEP_ASKING_KEYBOARD });

  // بعد از اینکه کاربر پاسخش را گرفت: آماری است، نه پاسخ - پس نه منتظرش
  // می‌مانیم و نه خطایش را به کاربر نشان می‌دهیم.
  await recordKbUsage(ctx.env, result.matchedKbIds).catch((err) =>
    console.error("ثبت آمار پایگاه دانش شکست خورد:", err && err.message)
  );
}
