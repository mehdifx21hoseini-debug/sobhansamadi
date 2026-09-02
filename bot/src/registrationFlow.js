import { InlineKeyboard, Keyboard } from "grammy";
import { getUserState, setUserState, clearUserState, createLead, readUserSource } from "./db.js";
import { upsertBotLead } from "./crm/intake.js";
import { ensureCrmSchema } from "./crm/schema.js";
import { mainMenuKeyboard } from "./menu.js";
import { sendSection, resolveSection } from "./content/sectionText.js";
import { supportChatUrl, supportPrefill, supportUsername } from "./supportContact.js";
import { savePhone } from "./phones.js";

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
//
// ترتیب هم تصادفی نیست: «مجموعه آموزشی پیشرفته» اول می‌آید چون کاربر
// معمولاً از دکمه‌ی هم‌نامِ منو به اینجا رسیده و باید همان چیزی را که
// رویش زده، اول ببیند.
function courseChoiceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📚 مجموعه آموزشی پیشرفته", callback_data: "COURSE_TECH", style: "primary" }],
      [{ text: "🧠 دوره روانشناسی", callback_data: "COURSE_PSY", style: "primary" }],
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

// یک متن تایید برای هر دو مسیر.
//
// پیش‌تر مسیر ثبت‌نام متن جداگانه‌ای داشت که فقط نام و شماره و دوره را
// نشان می‌داد - چون آن مسیر هم فقط همان‌ها را می‌پرسید. حالا که هر دو
// یک سوال‌نامه دارند، دو متن یعنی دو جای دیگر که باید هم‌گام بمانند.
//
// هر فیلدی که پر نشده باشد اصلاً نمایش داده نمی‌شود، نه با «undefined»
// روبه‌روی برچسبش.
function buildConfirmText(flow, temp) {
  const lines = [
    flow === "registration"
      ? "لطفاً اطلاعات ثبت‌نام خود را بررسی کنید:"
      : "✅ اطلاعات شما ثبت شد.\n\nلطفاً اطلاعات زیر را بررسی کنید:",
    "",
  ];

  const fields = [
    ["👤 نام", temp.name],
    ["📱 موبایل", temp.phone],
    ["🎯 دوره موردنظر", temp.course],
    ["📊 سطح و سابقه", temp.level],
    ["🎯 هدف", temp.topic],
  ];
  for (const [label, value] of fields) {
    if (value) lines.push(label + ": " + value);
  }

  lines.push("");
  lines.push("اگر اطلاعات صحیح است، روی «✅ تایید نهایی» بزنید.");
  return lines.join("\n");
}

/**
 * @param {object} opts
 * @param {boolean} opts.skipCourseChoice پرسیدن دوره را رد کن و مستقیم
 *   سراغ فرم برو. فقط ورودیِ پایان دوره‌ی مقدماتی این را می‌دهد: آنجا
 *   کاربر تازه یک دوره را تمام کرده و روی دکمه‌ای زده که اسم دوره‌ی بعدی
 *   رویش نوشته - پرسیدن دوباره‌اش یک قدم اضافه است بین «بله می‌خواهم» و
 *   «اینم مشخصاتم».
 *
 *   ورودی منوی اصلی این را نمی‌دهد و هر سه گزینه را نشان می‌دهد، چون
 *   کسی که از منو می‌آید هنوز چیزی انتخاب نکرده.
 */
export async function startFlow(ctx, flow, promptOverride, { skipCourseChoice = false } = {}) {
  if (skipCourseChoice) {
    // دوره همین‌جا ثبت می‌شود تا آن سر ماجرا، در CRM، ستون دوره خالی نماند.
    await setUserState(ctx.env, ctx.from.id, {
      current_flow: flow,
      current_step: "ask_name",
      temp_data: { course: COURSE_LABELS.COURSE_TECH },
    });
    if (promptOverride) await ctx.reply(promptOverride);
    await ctx.reply("👤 نام و نام خانوادگی خود را وارد کنید:", {
      reply_markup: cancelOnlyKeyboard(),
    });
    return;
  }

  await setUserState(ctx.env, ctx.from.id, {
    current_flow: flow,
    current_step: "choose_course",
    temp_data: {},
  });

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

  // موضوع، آخرین پرسش است. پیش‌تر یک پرسش «زمان مناسب تماس» هم بعدش
  // بود؛ برداشته شد چون تیم فروش در هر ساعتی که برسد زنگ می‌زند و آن
  // پاسخ عملاً استفاده نمی‌شد - یک مرحله‌ی اضافه در انتهای فرم، درست
  // همان‌جایی که بیشترین ریزش را دارد.
  //
  // «ask_time» هنوز پذیرفته می‌شود: کاربری که لحظه‌ی انتشار وسط همین
  // مرحله بود، وگرنه به یک بن‌بستِ بی‌پاسخ می‌خورد.
  if (step === "ask_topic" || step === "ask_time") {
    if (step === "ask_topic") temp.topic = text;
    await setUserState(ctx.env, ctx.from.id, { current_step: "confirm", temp_data: temp });
    // بدون parse_mode: متن هیچ تگی ندارد و نام کاربر مستقیم داخلش
    // می‌نشیند. با HTML، نامی که یک < داشته باشد کل پیام را از سمت
    // تلگرام رد می‌کرد و کاربر در انتهای فرم به دیوار می‌خورد.
    await ctx.reply(buildConfirmText(flow, temp), { reply_markup: confirmCancelKeyboard() });
    return;
  }
}

export async function handleContact(ctx) {
  const state = await getUserState(ctx.env, ctx.from.id);
  if (!state || state.current_step !== "ask_phone") return;

  const phone = normalizePhone(ctx.message.contact.phone_number);
  const temp = { ...state.temp_data, phone };
  await setUserState(ctx.env, ctx.from.id, { phone, temp_data: temp });

  // همان شماره در دفترچه هم می‌نشیند.
  //
  // دو دلیل: خروجی شماره‌ها باید همه‌ی شماره‌هایی را داشته باشد که
  // داریم، نه فقط آن‌هایی که از دروازه‌ی دوره‌ها آمده‌اند؛ و کسی که
  // اینجا شماره داده نباید چند دقیقه بعد سر دوره‌ی مقدماتی دوباره
  // پرسیده شود. شکستش نباید جلوی ثبت‌نام را بگیرد - رکورد اصلی لید است.
  await savePhone(ctx.env, {
    telegramUserId: ctx.from.id,
    phone,
    name: temp.name || ctx.from.first_name || "",
    username: ctx.from.username || "",
    source: state.current_flow === "registration" ? "ثبت‌نام" : "مشاوره",
  }).catch((err) => console.error("ثبت شماره در دفترچه شکست خورد:", err && err.message));

  await ctx.reply("✅ شماره شما با موفقیت ثبت شد.", { reply_markup: { remove_keyboard: true } });

  // هر دو مسیر از اینجا یک راه می‌روند.
  //
  // پیش‌تر مسیر ثبت‌نام (دکمه‌ی «مجموعه آموزشی پیشرفته» در پایان دوره‌ی
  // مقدماتی) مستقیم به تایید می‌رفت و سه سوال بعدی را نمی‌پرسید. نتیجه‌اش
  // این بود که هر لیدی که از آن دکمه می‌آمد، در CRM ستون‌های سطح، موضوع
  // و زمان تماسش خالی بود - و مشاور بدون هیچ زمینه‌ای زنگ می‌زد، آن هم
  // به کسی که تازه شانزده جلسه را تمام کرده و آماده‌ترین مشتری است.
  await setUserState(ctx.env, ctx.from.id, { current_step: "ask_level" });
  await sendSection(ctx, "CONSULT_LEVEL", cancelOnlyKeyboard());
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
    // دیگر پرسیده نمی‌شود، ولی کلید می‌ماند: JSON.stringify کلیدِ
    // undefined را حذف می‌کند و آن‌طرف در n8n ستونِ غایب با ستونِ خالی
    // یکی نیست.
    preferred_time: temp.preferred_time || "",
    confirmed: "true",
    // اگر کاربر از یک لینک عمیق آمده بود، همان کمپین روی لید می‌نشیند -
    // این‌طور در CRM معلوم است هر مشتری از کجا آمده، نه فقط «تلگرام».
    source: acqSource ? "telegram_bot:" + acqSource : "telegram_bot",
  };

  await createLead(ctx.env, lead);

  // پنل CRM حالا از crm_leads در D1 می‌خواند، پس لید باید همان‌جا هم
  // بنشیند - وگرنه مشتری‌ای که همین حالا ثبت‌نام کرده در فهرست مشاورها
  // دیده نمی‌شود. خطایش بلعیده می‌شود چون رکورد اصلی در جدول leads است.
  //
  // upsert است نه insert: اگر همین شماره لید قبلی داشته باشد، یادداشت
  // تازه به همان پرونده می‌چسبد. بدون این، مشتریِ برگشته یک ردیف دوم
  // می‌سازد و دو مشاور به یک نفر زنگ می‌زنند - قاعده‌ای که n8n داشت.
  const saved = await ensureCrmSchema(ctx.env)
    .then(() => upsertBotLead(ctx.env, lead))
    .catch((err) => {
      console.error("نوشتن لید در crm_leads شکست خورد:", err && err.message);
      return null;
    });

  await clearUserState(ctx.env, ctx.from.id);

  await ctx.editMessageText("✅ اطلاعات شما تایید و ثبت شد.", { reply_markup: undefined });
  await sendLeadDone(ctx);
  await sendSupportInvite(ctx, {
    leadId: saved && saved.lead_id,
    name: temp.name,
    course: temp.course,
    level: temp.level,
    topic: temp.topic,
  });
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

/**
 * دعوت به پشتیبانی، درست بعد از «ثبت شد».
 *
 * دکمه چت پشتیبانی را با پیامِ آماده باز می‌کند. رنگ دکمه دستِ ما نیست -
 * تلگرام همه‌شان را هم‌رنگ تمِ کاربر می‌کشد - پس ✅ کارِ رنگ سبز را
 * می‌کند.
 *
 * شکستش بلعیده می‌شود: لید ثبت شده و کاربر «ثبت شد» را گرفته؛ یک پیامِ
 * تکمیلی نباید آن لحظه را به خطا تبدیل کند.
 */
async function sendSupportInvite(ctx, info) {
  try {
    const { text } = await resolveSection(ctx.env, "LEAD_SUPPORT");
    const url = supportChatUrl(ctx.env, supportPrefill(info));
    const body = text + "\n\n🆔 @" + supportUsername(ctx.env);
    await ctx.reply(body, {
      reply_markup: new InlineKeyboard().url("✅ پیام به پشتیبانی آکادمی", url),
      // پیش‌نمایشِ لینکِ t.me زیر پیام، دکمه را از چشم می‌اندازد.
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.error("ارسال دعوتِ پشتیبانی شکست خورد:", err && err.message);
  }
}
