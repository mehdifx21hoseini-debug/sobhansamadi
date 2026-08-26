import { InlineKeyboard, Keyboard } from "grammy";
import { getUserState, setUserState, clearUserState, createLead } from "./db.js";
import { mainMenuKeyboard } from "./menu.js";

const COURSE_LABELS = {
  COURSE_PSY: "🧠 دوره روانشناسی",
  COURSE_TECH: "📚 مجموعه آموزشی پیشرفته",
  COURSE_BOTH: "📘 هر دو دوره",
};

function courseChoiceKeyboard() {
  return new InlineKeyboard()
    .text("🧠 دوره روانشناسی", "COURSE_PSY")
    .row()
    .text("📚 مجموعه آموزشی پیشرفته", "COURSE_TECH")
    .row()
    .text("📘 هر دو دوره", "COURSE_BOTH")
    .row()
    .text("🏠 منوی اصلی", "MENU_MAIN");
}

function cancelOnlyKeyboard() {
  return new InlineKeyboard().text("❌ لغو فرآیند", "FLOW_CANCEL");
}

function requestContactKeyboard() {
  return new Keyboard()
    .requestContact("ارسال شماره موبایل ☎️")
    .row()
    .text("🔙 برگشت")
    .resized();
}

function confirmCancelKeyboard() {
  return new InlineKeyboard()
    .text("✅ تایید نهایی", "CONFIRM_YES")
    .row()
    .text("❌ انصراف", "FLOW_CANCEL");
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

export async function startFlow(ctx, flow) {
  const promptText =
    flow === "registration"
      ? "برای ثبت‌نام، لطفاً دوره موردنظر خود را انتخاب کنید:"
      : "🎯 برای شروع، کدام دوره یا خدمات آموزشی موردنظرتان است؟";
  await setUserState(ctx.env, ctx.from.id, {
    current_flow: flow,
    current_step: "choose_course",
    temp_data: {},
  });
  await ctx.reply(promptText, { reply_markup: courseChoiceKeyboard() });
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
    await ctx.reply("💬 بیشتر برای چه موضوعی نیاز به مشاوره دارید؟\n\nهر چیزی که فکر می‌کنید برای شناخت بهتر شرایط شما مهم است، بنویسید.", {
      reply_markup: cancelOnlyKeyboard(),
    });
    return;
  }

  if (step === "ask_topic") {
    temp.topic = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "ask_time", temp_data: temp });
    await ctx.reply("🕐 چه زمان یا ساعاتی برای تماس مشاور با شما مناسب‌تر است؟\n\nمثلاً: «شنبه تا چهارشنبه، ساعت ۱۸ تا ۲۱»", {
      reply_markup: cancelOnlyKeyboard(),
    });
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
    await ctx.reply(
      "📊 در حال حاضر سطح خودتان در معامله‌گری را چطور ارزیابی می‌کنید؟\n\nمثلاً می‌توانید درباره میزان تجربه، مدت فعالیت یا تجربه‌تان در معاملات توضیح دهید.",
      { reply_markup: cancelOnlyKeyboard() }
    );
    return;
  }

  await setUserState(ctx.env, ctx.from.id, { current_step: "confirm" });
  await ctx.reply(buildConfirmText("registration", temp), { parse_mode: "HTML", reply_markup: confirmCancelKeyboard() });
}

export async function handleConfirm(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state) return;
  const temp = state.temp_data;

  await createLead(ctx.env, {
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
    source: "telegram_bot",
  });

  await clearUserState(ctx.env, ctx.from.id);

  await ctx.editMessageText("✅ اطلاعات شما تایید و ثبت شد.", { reply_markup: undefined });
  await ctx.reply("🎉 درخواست شما با موفقیت ثبت شد!\n\nهمکاران آکادمی طی <b>۲۴ ساعت کاری</b> با شما تماس خواهند گرفت. 🙏", {
    parse_mode: "HTML",
    reply_markup: mainMenuKeyboard(),
  });
}

export async function handleCancel(ctx) {
  await clearUserState(ctx.env, ctx.from.id);
  await ctx.reply("فرآیند لغو شد. به منوی اصلی برگشتید.", { reply_markup: mainMenuKeyboard() });
}
