// متنی که کاربر آزادانه می‌نویسد و هیچ دکمه‌ای نیست.
//
// نسخه‌ی n8n این را به دستیار پشتیبانی می‌داد (نود Build Response:
// tryAi = delegate && hasRealFreeText && noActiveFlow). پورت اولیه‌ی ما
// آن را بی‌صدا دور می‌ریخت - یعنی کاربری که «سلام» یا «قیمت دوره چنده؟»
// می‌نوشت هیچ جوابی نمی‌گرفت. برای رباتی که قرار است عمومی شود، سکوت
// بدترین پاسخ ممکن است: کاربر فکر می‌کند ربات خراب است و می‌رود.

import { createSupportTicket, setUserState } from "./db.js";
import { mainMenuKeyboard } from "./menu.js";
import { askFaq } from "./ai/faq.js";
import { recordKbUsage } from "./ai/kb.js";
import { logAnswer, answerKeyboard } from "./ai/log.js";

// وقتی دستیار در دسترس نیست. عمداً تیکت ساخته نمی‌شود.
//
// اینجا تنها جایی است که از رفتار n8n فاصله می‌گیریم و دلیلش مقیاس است:
// n8n در این حالت تیکت می‌ساخت، ولی آنجا پایگاه دانش همیشه پر بود و این
// مسیر به‌ندرت فعال می‌شد. روی یک ربات عمومی با پایگاه دانش خالی، هر
// «سلام» یک تیکت می‌شود و صف پشتیبانی را در چند ساعت پر می‌کند. کاربری
// که سوال واقعی دارد همچنان می‌تواند از دکمه‌ی پشتیبانی تیکت بسازد.
const NUDGE_TEXT = [
  "متوجه منظورتون نشدم 🙏",
  "",
  "از منوی پایین یکی از بخش‌ها رو انتخاب کنید، یا اگر سوالی دارید روی «💬 پشتیبانی» بزنید تا تیم آکادمی جواب بده.",
].join("\n");

export async function handleFreeText(ctx, state) {
  const text = (ctx.message.text || "").trim();
  if (!text) return;

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
    console.error("دستیار روی متن آزاد پاسخ نداد:", err && err.message);
  }

  if (!result) {
    await ctx.reply(NUDGE_TEXT, { reply_markup: mainMenuKeyboard() });
    return;
  }

  const logId = await logAnswer(ctx.env, {
    userId: ctx.from.id,
    question: text,
    answer: result.answer,
    needsHuman: result.needsHuman,
    reason: result.reason,
    intent: result.intent,
    confidence: result.confidence,
    matchedKbIds: result.matchedKbIds,
  });

  // دستیار خودش تشخیص داد این به انسان نیاز دارد - مسائل مالی، شکایت،
  // یا هر چیزی که در پایگاه دانش جوابی ندارد. اینجا تیکت درست است، چون
  // یک تصمیم است نه یک بن‌بست.
  if (result.needsHuman) {
    await createSupportTicket(ctx.env, {
      telegram_user_id: ctx.from.id,
      telegram_username: ctx.from.username,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      message: text,
    });
    await ctx.reply(result.answer, { reply_markup: mainMenuKeyboard() });
    return;
  }

  await ctx.reply(result.answer, { reply_markup: answerKeyboard(logId) });

  // تاریخچه را نگه می‌داریم تا سوال بعدی ادامه‌ی همین مکالمه باشد و
  // دستیار دوباره سلام نکند. اگر کاربر وسط یک فرآیند بود، فرآیندش
  // دست‌نخورده می‌ماند: فقط سوالش جواب داده شد، مسیرش عوض نشد.
  await setUserState(ctx.env, ctx.from.id, {
    temp_data: { ...(state?.temp_data || {}), ai_history: result.history.ai_history },
  }).catch((err) => console.error("ذخیره‌ی تاریخچه‌ی گفتگو شکست خورد:", err && err.message));

  await recordKbUsage(ctx.env, result.matchedKbIds).catch((err) =>
    console.error("ثبت آمار پایگاه دانش شکست خورد:", err && err.message)
  );
}
