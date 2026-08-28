import { InlineKeyboard, Keyboard } from "grammy";
import { getUserState, setUserState, clearUserState, createLead, readUserSource } from "./db.js";
import { queueLead, flushLeadOutboxSoon } from "./crmSync.js";
import { mainMenuKeyboard } from "./menu.js";
import { sendSection, resolveSection } from "./content/sectionText.js";

const COURSE_LABELS = {
  COURSE_PSY: "🧠 دوره روانشناسی",
  COURSE_TECH: "📚 مجموعه آموزشی پیشرفته",
  COURSE_BOTH: "📘 هر دو دوره",
};

// شیء خام و نه سازنده‌ی InlineKeyboard: گرامی فیلد style را بی‌صدا دور
// می‌ریزد و دکمه‌ها بی‌رنگ می‌شوند.
//
// «هر دو دوره» سبز است و آن دو آبی: سه گزینه‌ی هم‌رنگ یعنی سه گزینه‌ی
// هم‌ارزش، در حالی که این یکی کامل‌ترین مسیر است و باید در یک نگاه
// معلوم باشد.
function courseChoiceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🧠 دوره روانشناسی", callback_data: "COURSE_PSY", style: "primary" }],
      [{ text: "📚 مجموعه آموزشی پیشرفته", callback_data: "COURSE_TECH", style: "primary" }],
      [{ text: "📘 هر دو دوره", callback_data: "COURSE_BOTH", style: "success" }],
      [{ text: "🏠 منوی اصلی", callback_data: "MENU_MAIN" }],
    ],
  };
}

function cancelOnlyKeyboard() {
  return { inline_keyboard: [[{ text: "❌ لغو فرآیند", callback_data: "FLOW_CANCEL", style: "danger" }]] };
}

function requestContactKeyboard() {
  return new Keyboard()
    .requestContact("ارسال شماره موبایل ☎️")
    .row()
    .text("🔙 برگشت")
    .resized();
}

// تایید سبز و انصراف قرمز: در مرحله‌ی آخر یک ثبت‌نام، ضربه‌ی اشتباه
// گران‌ترین جای کل مسیر است.
function confirmCancelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "✅ تایید نهایی", callback_data: "CONFIRM_YES", style: "success" }],
      [{ text: "❌ انصراف", callback_data: "FLOW_CANCEL", style: "danger" }],
    ],
  };
}

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("98")) return "0" + digits.slice(2);
  if (digits.length === 10 && digits.startsWith("9")) return "0" + digits;
  return digits;
}

function buildConfirmText(flow, temp) {
  if (flow === "registration") {
    return (
      "لطفاً اطلاعات زیر را بررسی کنید:\n\n" +
      `👤 <b>نام:</b> ${temp.name}\n📱 <b>شماره:</b> ${temp.phone}\n🎓 <b>دوره:</b> ${temp.course}\n\n` +
      "آیا اطلاعات را تایید می‌کنید؟"
    );
  }
  return (
    "✅ اطلاعات شما ثبت شد.\n\nلطفاً اطلاعات زیر را بررسی کنید:\n\n" +
    `👤 نام: ${temp.name}\n📱 موبایل: ${temp.phone}\n🎯 دوره موردنظر: ${temp.course}\n` +
    `📊 سطح معامله‌گری: ${temp.level}\n💬 موضوع مشاوره: ${temp.topic}\n🕐 زمان مناسب تماس: ${temp.preferred_time}\n\n` +
    "اگر اطلاعات صحیح است، روی «✅ تایید نهایی» بزنید."
  );
}

export async function startFlow(ctx, flow, promptOverride) {
  await setUserState(ctx.env, ctx.from.id, {
    current_flow: flow,
    current_step: "choose_course",
    temp_data: {},
  });

  // مسیر ثبت‌نام متن خودش را از صداکننده می‌گیرد (دکمه‌ی «مجموعه آموزشی
  // پیشرفته» در پایان دوره‌ی مقدماتی)؛ فقط مسیر مشاوره متن ثابت دارد و
  // همان است که قابل ویرایش شده.
  if (promptOverride) {
    await ctx.reply(promptOverride, { reply_markup: courseChoiceKeyboard() });
    return;
  }
  if (flow === "registration") {
    await ctx.reply("برای ثبت‌نام، لطفاً دوره موردنظر خود را انتخاب کنید:", {
      reply_markup: courseChoiceKeyboard(),
    });
    return;
  }
  await sendSection(ctx, "CONSULT_START", courseChoiceKeyboard());
}

export async function handleCourseChoice(ctx, cb) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || !COURSE_LABELS[cb]) return;
  const temp = { ...state.temp_data, course: COURSE_LABELS[cb] };

  if (state.current_flow === "consultation") {
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name", temp_data: temp });
    await ctx.editMessageText(
      "👤 لطفاً نام و نام خانوادگی خودتان را وارد کنید:\n\nاین اطلاعات برای پیگیری و هماهنگی مشاوره استفاده می‌شود.",
      { reply_markup: undefined }
    );
    await ctx.reply("👆", { reply_markup: cancelOnlyKeyboard() }).catch(() => {});
    return;
  }

  await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name", temp_data: temp });
  await ctx.editMessageText("نام و نام خانوادگی خود را وارد کنید:", { reply_markup: cancelOnlyKeyboard() });
}

export async function handleText(ctx, state) {
  const step = state.current_step;
  const flow = state.current_flow;
  const text = ctx.message.text.trim();
  const temp = { ...state.temp_data };

  if (step === "ask_name") {
    temp.name = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_phone", temp_data: temp });
    const promptText =
      flow === "consultation"
        ? "☎️ شماره موبایل خود را برای هماهنگی مشاوره ارسال کنید.\n\nلطفاً روی دکمه «☎️ ارسال شماره موبایل» بزنید تا شماره شما به‌صورت خودکار برای ما ارسال شود."
        : "📌 برای وارد کردن شماره، روی دکمه «☎️ ارسال شماره موبایل» در پایین صفحه کلیک کنید 👇\n\n⚠️ توجه: لطفاً شماره خود را دستی تایپ نکنید!";
    await ctx.reply(promptText, { reply_markup: requestContactKeyboard() });
    return;
  }

  if (step === "ask_phone") {
    if (text === "🔙 برگشت") {
      await setUserState(ctx.env, ctx.from.id, { current_step: "ask_name" });
      await ctx.reply("نام و نام خانوادگی خود را وارد کنید:", { reply_markup: { remove_keyboard: true } });
      await ctx.reply("👆", { reply_markup: cancelOnlyKeyboard() }).catch(() => {});
      return;
    }
    await ctx.reply("❗️ لطفاً فقط از دکمه «ارسال شماره موبایل ☎️» استفاده کنید؛ شماره تایپ‌شده پذیرفته نمی‌شود.", {
      reply_markup: requestContactKeyboard(),
    });
    return;
  }

  if (step === "ask_level") {
    temp.level = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_topic", temp_data: temp });
    await sendSection(ctx, "CONSULT_TOPIC", cancelOnlyKeyboard());
    return;
  }

  if (step === "ask_topic") {
    temp.topic = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_time", temp_data: temp });
    await sendSection(ctx, "CONSULT_TIME", cancelOnlyKeyboard());
    return;
  }

  if (step === "ask_time") {
    temp.preferred_time = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: temp });
    await ctx.reply(buildConfirmText(flow, temp), { parse_mode: "HTML", reply_markup: confirmCancelKeyboard() });
    return;
  }
}

export async function handleContact(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "ask_phone") return;

  const phone = normalizePhone(ctx.message.contact.phone_number);
  const temp = { ...state.temp_data, phone };
  await setUserState(ctx.env, ctx.from.id, { phone, temp_data: temp });

  await ctx.reply("✅ شماره شما با موفقیت ثبت شد.", { reply_markup: { remove_keyboard: true } });

  if (state.current_flow === "consultation") {
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_level" });
    await sendSection(ctx, "CONSULT_LEVEL", cancelOnlyKeyboard());
    return;
  }

  await setUserState(ctx.env, ctx.from.id, { current_step: "confirm" });
  await ctx.reply(buildConfirmText("registration", temp), { parse_mode: "HTML", reply_markup: confirmCancelKeyboard() });
}

export async function handleConfirm(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state) return;
  const temp = state.temp_data;
  const acqSource = await readUserSource(ctx.env, ctx.from.id).catch(() => null);

  const lead = {
    request_type: state.current_flow === "registration" ? "ثبت‌نام" : "مشاوره",
    telegram_user_id: ctx.from.id,
    username: ctx.from.username,
    name: temp.name,
    phone: temp.phone,
    course: temp.course,
    level: temp.level,
    topic: temp.topic,
    preferred_time: temp.preferred_time,
    confirmed: "true",
    // اگر کاربر از یک لینک عمیق آمده بود، همان کمپین روی لید می‌نشیند -
    // این‌طور در CRM معلوم است هر مشتری از کجا آمده، نه فقط «تلگرام».
    source: acqSource ? "telegram_bot:" + acqSource : "telegram_bot",
  };

  await createLead(ctx.env, lead);

  // CRM لیدها را از جدول‌های n8n می‌خواند، نه از D1. بدون این صف، لیدی که
  // ربات می‌گیرد در CRM دیده نمی‌شود و مشاور هرگز با آن مشتری تماس
  // نمی‌گیرد. ثبت در صف نباید جلوی پاسخ به کاربر را بگیرد، پس خطایش
  // بلعیده می‌شود - رکورد اصلی در جدول leads است و از دست نمی‌رود.
  await queueLead(ctx.env, lead).catch((err) =>
    console.error("ثبت لید در صف CRM شکست خورد:", err && err.message)
  );

  await clearUserState(ctx.env, ctx.from.id);

  await ctx.editMessageText("✅ اطلاعات شما تایید و ثبت شد.", { reply_markup: undefined });
  await sendLeadDone(ctx);

  // بعد از اینکه کاربر پاسخش را گرفت: یک تلاش فوری تا لید در همان لحظه در
  // CRM ظاهر شود، نه ده دقیقه بعد. عمداً بعد از reply است تا اگر n8n کند
  // یا قطع بود، کاربر منتظر نماند.
  await flushLeadOutboxSoon(ctx.env);
}

export async function handleCancel(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.reply("فرآیند لغو شد. به منوی اصلی برگشتید.", { reply_markup: mainMenuKeyboard() });
}

// پیام پایان، بدون parse_mode: متنش قابل ویرایش است و یک «<» در چیزی که
// مدیر می‌نویسد کل پیام را رد می‌کند.
async function sendLeadDone(ctx) {
  const { text } = await resolveSection(ctx.env, "LEAD_DONE");
  await ctx.reply(text, { reply_markup: mainMenuKeyboard() });
}
